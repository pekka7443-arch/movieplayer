import { cinemetaPopular, cinemetaPopularMixed } from "@/lib/server/cinemeta";

// GET /api/meta/popular?type=movie|tv  (or ?type=all for the mixed feed)
//
// Keyless alternative to TMDB's /movie/popular + /tv/popular + /trending/all/week.
// Returns up to 20 popular titles from Cinemeta's public "top" catalog — no
// TMDB API key required. Each item carries an IMDB id + poster URL + year +
// rating, so the home view can render real cards without prompting the user
// to add a key.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = (searchParams.get("type") ?? "movie").trim().toLowerCase();

  try {
    if (type === "all" || type === "mixed") {
      const results = await cinemetaPopularMixed(20);
      return Response.json({ results });
    }
    if (type !== "movie" && type !== "tv") {
      return Response.json(
        { error: "type must be 'movie', 'tv', or 'all'" },
        { status: 400 },
      );
    }
    const results = await cinemetaPopular(type, 20);
    return Response.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: "cinemeta_unreachable", message },
      { status: 502 },
    );
  }
}
