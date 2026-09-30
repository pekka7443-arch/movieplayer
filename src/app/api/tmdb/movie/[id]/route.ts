import {
  badRequestResponse,
  languageParam,
  normalizeMediaDetails,
  parseIdParam,
  tmdbErrorResponse,
  tmdbFetch,
} from "@/lib/server/tmdb";

// GET /api/tmdb/movie/[id]?language=
// Normalized movie details (credits, videos, similar, watch/providers appended).
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
      `/movie/${mediaId}`,
      { append_to_response: "credits,videos,similar,watch/providers", language },
      request,
    );
    return Response.json(normalizeMediaDetails(data, "movie"));
  } catch (error) {
    return tmdbErrorResponse(error);
  }
}
