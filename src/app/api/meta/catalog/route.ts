import { cinemetaCatalog } from '@/lib/server/cinemeta';

// GET /api/meta/catalog?type=movie|tv&sort=top|imdbRating&genre=Action&year=2026
//
// Generic keyless catalog endpoint powering the home page's extra rows
// (Top Rated, New This Year, Explore-by-genre). No TMDB API key required.
export const dynamic = 'force-dynamic';

const CURRENT_YEAR = new Date().getFullYear();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const type = (searchParams.get('type') ?? 'movie').trim().toLowerCase();
  if (type !== 'movie' && type !== 'tv') {
    return Response.json({ error: 'type must be movie|tv' }, { status: 400 });
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

  try {
    const results = await cinemetaCatalog(type, { sort, genre, year, limit: 20 });
    return Response.json({ results }, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=1800" } });
  } catch {
    // Graceful degradation — an unreachable upstream renders an empty row
    // instead of an error banner on the home page.
    return Response.json({ results: [] }, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=600" } });
  }
}
