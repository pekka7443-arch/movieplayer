import {
  badRequestResponse,
  languageParam,
  normalizeSeason,
  parseIdParam,
  tmdbErrorResponse,
  tmdbFetch,
} from "@/lib/server/tmdb";

// GET /api/tmdb/tv/[id]/season/[season]?language=
// Episode list for one season (season 0 = specials allowed).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; season: string }> },
) {
  const { id, season } = await params;
  const mediaId = parseIdParam(id);
  const seasonNumber = parseIdParam(season, { min: 0 });
  if (mediaId === null || seasonNumber === null) {
    return badRequestResponse("id and season must be non-negative integers");
  }

  const { searchParams } = new URL(request.url);
  const language = languageParam(searchParams);

  try {
    const data = await tmdbFetch(
      `/tv/${mediaId}/season/${seasonNumber}`,
      { language },
      request,
    );
    return Response.json(normalizeSeason(data, seasonNumber));
  } catch (error) {
    return tmdbErrorResponse(error);
  }
}
