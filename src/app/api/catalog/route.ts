import { apiError } from '@/lib/server/api';
import { resolveTmdbKey } from '@/lib/server/tmdb';

export const dynamic = 'force-dynamic';

// GET /api/catalog?mediaType=movie|tv&with_genres=28,53&sort_by=popularity.desc
//                     &<any raw TMDB discover filter>&limit=40
//
// Powers the home page genre rows (New This Week, Action & Thriller, Hidden
// Gems, Anime …) with FULL TMDB discover filters that the curated
// /api/meta/catalog route doesn't express. Raw filter params are passed
// through a strict allowlist (see tmdbDiscoverRaw) and hit
// /discover/{movie,tv} server-side with the resolved TMDB key.
//
// Keyless (no user key, no env key) → 503 `tmdb_key`; the client hook falls
// back to the keyless Cinemeta catalog + genre-name filtering honestly.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const mediaTypeRaw = (searchParams.get('mediaType') ?? searchParams.get('type') ?? 'movie')
    .trim()
    .toLowerCase();
  if (mediaTypeRaw !== 'movie' && mediaTypeRaw !== 'tv') {
    return apiError(400, 'bad_request', 'mediaType must be movie|tv');
  }

  const limitRaw = Number(searchParams.get('limit'));
  const limit =
    Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 40 ? Math.floor(limitRaw) : 40;

  const extraParams: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (key === 'mediaType' || key === 'type' || key === 'limit' || key === 'key') continue;
    extraParams[key] = value;
  }

  const tmdbKey = resolveTmdbKey(request);
  if (!tmdbKey) return apiError(503, 'tmdb_key');

  try {
    const { tmdbDiscoverRaw } = await import('@/lib/server/tmdb-discover');
    const results = await tmdbDiscoverRaw(tmdbKey, mediaTypeRaw, extraParams, limit);
    return Response.json(
      { results },
      { headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=1800' } },
    );
  } catch {
    return apiError(502, 'bad_gateway', 'catalog_upstream_failed');
  }
}
