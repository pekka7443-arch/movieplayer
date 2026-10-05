import { finnishCurated, finnishTmdb } from "@/lib/server/finnish";
import { resolveTmdbKey } from "@/lib/server/tmdb";
import type { MetaSearchItem } from "@/lib/meta";

// GET /api/meta/finnish?type=movie|tv[&limit=20]
//
// Finnish movies & series for the home page's "Suomalaista sisältöä" row.
// With a TMDB key → TMDB discover (with_original_language=fi) enriched with
// IMDB ids. Without a key → curated catalog resolved via Cinemeta search.
// Both paths return items carrying IMDB ids (+ TMDB ids when known) so the
// player can scan every provider under whichever id form actually indexes
// the title — the reason Finnish films were previously "not found".
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const typeParam = (searchParams.get("type") ?? "movie").trim().toLowerCase();
  const type = typeParam === "tv" ? "tv" : "movie";

  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 4), 24) : 20;

  const hasTmdbKey = Boolean(resolveTmdbKey(request));

  try {
    if (hasTmdbKey) {
      try {
        const items = await finnishTmdb(type, request, limit);
        if (items.length > 0) {
          return Response.json({ results: items, source: "tmdb" });
        }
      } catch {
        // TMDB unreachable/bad key — silently fall back to the keyless path.
      }
    }

    const items = await finnishCurated(type, limit);
    return Response.json({ results: items, source: "cinemeta" });
  } catch (error) {
    console.error("[meta/finnish] failed:", error);
    return Response.json({ results: [] satisfies MetaSearchItem[], source: "none" });
  }
}
