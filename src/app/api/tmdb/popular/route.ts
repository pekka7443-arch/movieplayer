import {
  badRequestResponse,
  extractResults,
  languageParam,
  normalizeMediaCardList,
  tmdbErrorResponse,
  tmdbFetch,
} from "@/lib/server/tmdb";

// GET /api/tmdb/popular?type=movie|tv&language=
//
// Returns TMDB's "popular" list (all-time popularity, distinct from the
// trending/all/week endpoint which only reflects this week's heat). Lets
// the home view render dedicated "Popular Movies" + "Popular TV Shows"
// rows separately, like Zoryva does — instead of one mixed trending row.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const language = languageParam(searchParams);
  const type = searchParams.get("type") ?? "movie";

  if (type !== "movie" && type !== "tv") {
    return badRequestResponse("type must be 'movie' or 'tv'");
  }

  try {
    const data = await tmdbFetch(`/${type}/popular`, { language }, request);
    const results = normalizeMediaCardList(extractResults(data), 20);
    return Response.json({ results });
  } catch (error) {
    return tmdbErrorResponse(error);
  }
}
