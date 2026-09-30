import { cinemetaDetails } from "@/lib/server/cinemeta";
import type { MetaDetails } from "@/lib/meta";

// GET /api/meta/details?imdb=tt1375666&type=movie|tv
// Keyless details via Cinemeta for the IMDB watch mode.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imdb = (searchParams.get("imdb") ?? "").trim();
  const type = searchParams.get("type") === "tv" ? "tv" : "movie";

  if (!/^tt\d+$/.test(imdb)) {
    return Response.json({ error: "bad_imdb" }, { status: 400 });
  }

  try {
    const details = await cinemetaDetails(imdb, type);
    return Response.json({ details });
  } catch (error) {
    console.error("[meta/details] failed:", error);
    const status = error instanceof Error && error.message === "cinemeta_not_found" ? 404 : 502;
    return Response.json({ error: "meta_unreachable" }, { status });
  }
}
