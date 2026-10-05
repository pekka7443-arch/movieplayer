import { tvmazeFullByImdb } from "@/lib/server/tvmaze";
import { apiError } from '@/lib/server/api';

// GET /api/meta/tvmaze?imdb=tt0903747
//
// CineDeck's second keyless metadata source (TVmaze — no API key, no signup).
// Returns show facts + the full episode list so the keyless TV watch mode can
// offer real season/episode menus. 404 when TVmaze doesn't know the IMDB id,
// 502 when the API is unreachable.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imdb = (searchParams.get("imdb") ?? "").trim();

  if (!/^tt\d+$/.test(imdb)) {
    return apiError(400, 'bad_id');
  }

  const full = await tvmazeFullByImdb(imdb);
  if (!full) {
    // Distinguish "unknown show" (fine — degrade quietly) from upstream down.
    return apiError(404, 'not_found');
  }

  return Response.json(full);
}
