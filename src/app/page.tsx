import AppRoot from '@/components/site/app-root';
import { cinemetaPopularMixed } from '@/lib/server/cinemeta';
import type { MetaSearchItem } from '@/lib/meta';

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

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
