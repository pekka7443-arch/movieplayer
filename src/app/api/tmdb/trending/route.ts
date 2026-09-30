import {
  badRequestResponse,
  extractResults,
  languageParam,
  normalizeMediaCardList,
  tmdbErrorResponse,
  tmdbFetch,
} from "@/lib/server/tmdb";

// GET /api/tmdb/trending?language=&window=week|day
// Trending across movie|tv, top 20.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const language = languageParam(searchParams);
  const timeWindow = searchParams.get("window") ?? "week";

  if (timeWindow !== "week" && timeWindow !== "day") {
    return badRequestResponse("window must be 'week' or 'day'");
  }

  try {
    const data = await tmdbFetch(
      `/trending/all/${timeWindow}`,
      { language },
      request,
    );
    const results = normalizeMediaCardList(extractResults(data), 20);
    return Response.json({ results });
  } catch (error) {
    return tmdbErrorResponse(error);
  }
}
