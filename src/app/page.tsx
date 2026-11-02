import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';

import AppRoot from '@/components/site/app-root';
import { cinemetaPopularMixed, cinemetaDetails } from '@/lib/server/cinemeta';
import { tmdbFetch } from '@/lib/server/tmdb';
import { db } from '@/lib/db';
import type { MetaSearchItem } from '@/lib/meta';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0d0d0d',
};

/** Fetch title facts for a watch link's OG card (fail-soft). */
async function watchOg(
  tmdbId: string | undefined,
  imdbId: string | undefined,
  type: string,
): Promise<{ title: string; description: string; image: string | null } | null> {
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  try {
    if (imdbId && /^tt\d+$/.test(imdbId)) {
      const meta = await cinemetaDetails(imdbId, mediaType);
      return {
        title: meta.year ? `${meta.title} (${meta.year})` : meta.title,
        description: meta.overview?.slice(0, 200) || `Watch ${meta.title} on CineDeck.`,
        image: meta.backdrop ?? meta.poster ?? null,
      };
    }
    if (tmdbId && /^\d+$/.test(tmdbId)) {
      // With a server TMDB key we resolve real title facts; keyless tmdb
      // links fall back to the branded card (Cinemeta indexes by imdb only).
      const key = process.env.TMDB_API_KEY ?? null;
      if (key) {
        // Synthesize a request carrying the server key so tmdbFetch's
        // resolveTmdbKey + cache/retry machinery applies unchanged.
        const synthetic = new Request('https://cinedeck.internal/og', {
          headers: { 'x-tmdb-key': key },
        });
        const data = await tmdbFetch<{ title?: string; name?: string; overview?: string; backdrop_path?: string | null; poster_path?: string | null; release_date?: string; first_air_date?: string }>(
          `/${mediaType}/${tmdbId}`,
          { language: 'en-US' },
          synthetic,
        );
        const name = data.title ?? data.name ?? 'CineDeck';
        const year = (data.release_date ?? data.first_air_date ?? '').slice(0, 4);
        return {
          title: year ? `${name} (${year})` : name,
          description: data.overview?.slice(0, 200) || `Watch ${name} on CineDeck.`,
          image: data.backdrop_path ?? data.poster_path ?? null,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Dynamic social metadata: shared list links (`/?share=token`) and watch
 * links (`/?id=&type=` / `/?imdb=&type=`) get real Open Graph titles +
 * poster art so they unfurl as content cards in chat apps.
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
      // fall through to the watch/default branches below
    }
  }

  const tmdbParam = typeof params.id === 'string' ? params.id : undefined;
  const imdbParam = typeof params.imdb === 'string' ? params.imdb : undefined;
  const typeParam = typeof params.type === 'string' ? params.type : 'movie';
  if (tmdbParam || imdbParam) {
    const og = await watchOg(tmdbParam, imdbParam, typeParam);
    if (og) {
      const description = `${og.description}\n\nPress play on CineDeck — every source scanned, the healthiest one wins.`;
      return {
        title: `${og.title} — watch on CineDeck`,
        description,
        openGraph: {
          title: og.title,
          description,
          images: og.image ? [og.image] : ['/api/og'],
          type: 'video.movie',
        },
        twitter: {
          card: og.image ? 'summary_large_image' : 'summary',
          title: og.title,
          description,
        },
      };
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
  // CSP nonce from the proxy middleware → next-themes' inline bootstrap.
  const cspNonce = (await headers()).get('x-nonce') ?? undefined;
  return <AppRoot initialTrending={heroSeed} cspNonce={cspNonce} />;
}
