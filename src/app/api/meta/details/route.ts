import { cinemetaDetails } from "@/lib/server/cinemeta";
import type { MetaDetails } from "@/lib/meta";
import { apiError } from '@/lib/server/api';

// GET /api/meta/details?imdb=tt1375666&type=movie|tv
// Keyless details via Cinemeta for the IMDB watch mode.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imdb = (searchParams.get("imdb") ?? "").trim();
  const type = searchParams.get("type") === "tv" ? "tv" : "movie";

  if (!/^tt\d+$/.test(imdb)) {
    return apiError(400, 'bad_imdb');
  }

  try {
    const details = await cinemetaDetails(imdb, type);
    return Response.json({ details });
  } catch (error) {
    console.error("[meta/details] failed:", error);
    const status = error instanceof Error && error.message === "cinemeta_not_found" ? 404 : 502;
    return apiError(status, 'meta_unreachable');
  }
}
