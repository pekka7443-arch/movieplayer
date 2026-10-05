import {
  extractResults,
  languageParam,
  tmdbErrorResponse,
  tmdbFetch,
} from "@/lib/server/tmdb";

// GET /api/tmdb/person-search?q=&language=
// Search people on TMDB (top 6) — powers actor/director search in the
// command palette and search bar. Requires a TMDB key (same resolution as
// the rest of /api/tmdb/*: user header or server env).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const language = languageParam(searchParams);

  if (q.length === 0) {
    return Response.json({ results: [] });
  }

  try {
    const data = await tmdbFetch(
      "/search/person",
      { query: q, include_adult: "false", language },
      request,
    );
    const results = extractResults(data)
      .slice(0, 6)
      .map((raw) => {
        const person = raw as {
          id?: number;
          name?: string;
          known_for_department?: string;
          profile_path?: string | null;
          known_for?: { title?: string; name?: string }[];
        };
        const knownFor = (person.known_for ?? [])
          .map((k) => k.title ?? k.name ?? "")
          .filter(Boolean)
          .slice(0, 3)
          .join(", ");
        return {
          id: person.id ?? 0,
          name: person.name ?? "",
          department: person.known_for_department ?? "",
          profilePath: person.profile_path ?? null,
          knownFor,
        };
      })
      .filter((p) => p.id > 0 && p.name);
    return Response.json({ results });
  } catch (error) {
    return tmdbErrorResponse(error);
  }
}
