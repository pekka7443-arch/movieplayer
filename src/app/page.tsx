import type { Metadata } from 'next';

import AppRoot from '@/components/site/app-root';
import { cinemetaPopularMixed } from '@/lib/server/cinemeta';
import { db } from '@/lib/db';
import type { MetaSearchItem } from '@/lib/meta';

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

/**
 * Dynamic social metadata: shared list links (`/?share=token`) and watch
 * links (`/?id=&type=`) get proper Open Graph titles + a generated OG card
 * image (/api/og) so they unfurl as real content cards in chat apps.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const share = typeof params.share === 'string' ? params.share : undefined;

  if (share) {
    try {
      const list = await db.list.findUnique({ where: { shareToken: share } });
      if (list && list.isPublic) {
        const count = await db.listMember.count({ where: { listId: list.id } });
        const title = `${list.name} — a CineDeck list`;
        const description =
          list.description?.slice(0, 180) ?? `${count} titles curated on CineDeck. Watch them free.`;
        const ogImage = `/api/og?share=${encodeURIComponent(share)}`;
        return {
          title,
          description,
          openGraph: { title, description, images: [ogImage] },
          twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
        };
      }
    } catch {
      // fall through to the site default below
    }
  }

  return {};
}

/**
 * Server-fetched hero seed: the #1 trending title (keyless Cinemeta feed)
 * is resolved ON THE SERVER so the first HTML paint already contains the
 * hero backdrop image — the LCP element starts loading at FCP instead of
 * waiting for hydration → React Query fetch → render. Global metadata and
 * fonts live in layout.tsx.
 *
 * Fail-soft: any upstream problem just means the client fetches as before.
 */
async function getHeroSeed(): Promise<MetaSearchItem[] | undefined> {
  try {
    return await cinemetaPopularMixed(20);
  } catch {
    return undefined;
  }
}

export default async function Page() {
  const heroSeed = await getHeroSeed();
  return <AppRoot initialTrending={heroSeed} />;
}
