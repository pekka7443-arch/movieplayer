import {
  extractResults,
  languageParam,
  normalizeMediaCardList,
  tmdbErrorResponse,
  tmdbFetch,
} from "@/lib/server/tmdb";

// GET /api/tmdb/search?q=&language=
// Multi-search TMDB (movie|tv only, top 8).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const language = languageParam(searchParams);

  if (q.length === 0) {
    return Response.json({ results: [] });
  }

  try {
    const data = await tmdbFetch(
      "/search/multi",
      { query: q, include_adult: "false", language },
      request,
    );
    const results = normalizeMediaCardList(extractResults(data), 8);
    return Response.json({ results });
  } catch (error) {
    return tmdbErrorResponse(error);
  }
}
