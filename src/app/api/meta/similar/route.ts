import { cinemetaSimilar } from "@/lib/server/cinemeta";
import { apiError } from '@/lib/server/api';

// GET /api/meta/similar?type=movie|tv&imdb=tt1375666&genre=Thriller&language=fi
//
// Keyless "More like this": Cinemeta's genre-filtered top catalog, minus the
// title we're currently watching. No TMDB key needed. Falls back to the plain
// top catalog when the genre is missing or returns too few items.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") === "tv" ? "tv" : "movie";
  const imdb = (searchParams.get("imdb") ?? "").trim();
  const genre = (searchParams.get("genre") ?? "").trim();
  const language = (searchParams.get("language") ?? "").trim();
  void language; // accepted for parity with the TMDB route; Cinemeta is EN-only

  if (!/^tt\d+$/.test(imdb)) {
    return apiError(400, 'bad_id');
  }

  try {
    const results = await cinemetaSimilar(type, imdb, genre || null);
    return Response.json({ results });
  } catch {
    return apiError(502, 'meta_unreachable');
  }
}
