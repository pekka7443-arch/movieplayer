import { cinemetaSearchMulti } from "@/lib/server/cinemeta";
import type { MetaSearchItem } from "@/lib/meta";

// GET /api/meta/search?q=
// Keyless title search via Cinemeta (movies + series, IMDB ids).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (q.length < 2) {
    return Response.json({ results: [] satisfies MetaSearchItem[] });
  }

  try {
    const results = await cinemetaSearchMulti(q);
    return Response.json({ results });
  } catch (error) {
    console.error("[meta/search] failed:", error);
    return Response.json(
      { error: "meta_unreachable", results: [] },
      { status: 502 },
    );
  }
}
