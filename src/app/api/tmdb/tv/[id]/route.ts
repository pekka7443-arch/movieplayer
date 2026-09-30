import {
  badRequestResponse,
  languageParam,
  normalizeTvDetails,
  parseIdParam,
  tmdbErrorResponse,
  tmdbFetch,
} from "@/lib/server/tmdb";

// GET /api/tmdb/tv/[id]?language=
// Normalized TV details (movie shape + numberOfSeasons + seasons list).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const mediaId = parseIdParam(id);
  if (mediaId === null) {
    return badRequestResponse("id must be a positive integer");
  }

  const { searchParams } = new URL(request.url);
  const language = languageParam(searchParams);

  try {
    const data = await tmdbFetch(
      `/tv/${mediaId}`,
      { append_to_response: "credits,videos,similar,watch/providers", language },
      request,
    );
    return Response.json(normalizeTvDetails(data));
  } catch (error) {
    return tmdbErrorResponse(error);
  }
}
