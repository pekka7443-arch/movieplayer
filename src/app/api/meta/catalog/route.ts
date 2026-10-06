import { cinemetaCatalog } from '@/lib/server/cinemeta';
import { apiError } from '@/lib/server/api';
import { resolveTmdbKey } from '@/lib/server/tmdb';

export const dynamic = 'force-dynamic';

const CURRENT_YEAR = new Date().getFullYear();

// GET /api/meta/catalog?type=movie|tv&sort=top|imdbRating&genre=Action&year=2026
//                     &minRating=7&decade=2010&maxRuntime=120&language=fi&country=fi
//
// Powers the home page catalog rows + the Explore section's advanced filters.
// Two backends:
//  - TMDB key present (x-tmdb-key header / `key` query param): full-power
//    TMDB discover — decade/runtime/language/country filters all supported.
//  - Keyless: Cinemeta catalogs (genre/year/rating) + server-side minRating
//    post-filter. Filters the upstream can't express degrade to post-filter
//    or are ignored honestly.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const type = (searchParams.get('type') ?? 'movie').trim().toLowerCase();
  if (type !== 'movie' && type !== 'tv') {
    return apiError(400, 'bad_request', 'type must be movie|tv');
  }

  const sortParam = (searchParams.get('sort') ?? 'top').trim().toLowerCase();
  const sort = sortParam === 'imdbrating' ? 'imdbRating' : 'top';

  const genreRaw = (searchParams.get('genre') ?? '').trim();
  const genre = genreRaw.length > 0 && genreRaw.length <= 40 ? genreRaw : null;

  const yearRaw = searchParams.get('year');
  const year =
    yearRaw && /^\d{4}$/.test(yearRaw) && Number(yearRaw) >= 1900 && Number(yearRaw) <= CURRENT_YEAR + 1
      ? Number(yearRaw)
      : null;

  // Advanced filters --------------------------------------------------------
  const minRatingRaw = Number(searchParams.get('minRating'));
  const minRating =
    Number.isFinite(minRatingRaw) && minRatingRaw >= 0 && minRatingRaw <= 10 ? minRatingRaw : null;

  const decadeRaw = Number(searchParams.get('decade'));
  const decade =
    Number.isInteger(decadeRaw) && decadeRaw >= 1900 && decadeRaw <= CURRENT_YEAR ? decadeRaw : null;

  const runtimeRaw = Number(searchParams.get('maxRuntime'));
  const maxRuntime =
    Number.isFinite(runtimeRaw) && runtimeRaw >= 30 && runtimeRaw <= 300 ? runtimeRaw : null;

  const languageRaw = (searchParams.get('language') ?? '').trim().toLowerCase();
  const language = /^[a-z]{2}$/.test(languageRaw) ? languageRaw : null;

  const countryRaw = (searchParams.get('country') ?? '').trim().toLowerCase();
  const country = /^[a-z]{2}$/.test(countryRaw) ? countryRaw : null;

  const headers = { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=1800' };

  // --- TMDB-keyed path: full TMDB discover ---------------------------------
  const tmdbKey = await resolveTmdbKey(request);
  if (tmdbKey) {
    try {
      const { tmdbDiscover } = await import('@/lib/server/tmdb-discover');
      const results = await tmdbDiscover(tmdbKey, {
        type,
        sort,
        genre,
        year,
        minRating,
        decade,
        maxRuntime,
        language,
        country,
        limit: 20,
      });
      return Response.json({ results }, { headers });
    } catch {
      // fall through to the keyless path — degraded, never broken
    }
  }

  // --- Keyless path: Cinemeta + post-filter --------------------------------
  try {
    const results = await cinemetaCatalog(type, { sort, genre, year, limit: 20 });
    const filtered =
      minRating != null
        ? results.filter((item) => item.voteAverage >= minRating)
        : results;
    return Response.json({ results: filtered }, { headers });
  } catch {
    // Graceful degradation — an unreachable upstream renders an empty row
    // instead of an error banner on the home page.
    return Response.json({ results: [] }, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=600' } });
  }
}
