import {
  languageParam,
  tmdbErrorResponse,
  tmdbFetch,
} from "@/lib/server/tmdb";
import { apiError } from '@/lib/server/api';

// GET /api/tmdb/person/:id?language=
// Person details + combined filmography (cast + crew credits, newest first).
// Requires a TMDB key (same resolution as the rest of /api/tmdb/*).
interface RawCredit {
  id?: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  media_type?: string;
  character?: string;
  job?: string;
  episode_count?: number;
}

interface FilmographyItem {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  posterPath: string | null;
  releaseDate: string;
  voteAverage: number;
  credit: string;
  episodeCount: number | null;
}

function collectCredits(
  list: RawCredit[] | undefined,
  kind: "cast" | "crew",
  seen: Set<number>,
): FilmographyItem[] {
  const out: FilmographyItem[] = [];
  for (const c of list ?? []) {
    if (!c.id || seen.has(c.id)) continue;
    const mediaType = c.media_type === "tv" ? "tv" : "movie";
    const title = c.title ?? c.name ?? "";
    if (!title) continue;
    seen.add(c.id);
    out.push({
      id: c.id,
      mediaType,
      title,
      posterPath: c.poster_path ?? null,
      releaseDate: c.release_date ?? c.first_air_date ?? "",
      voteAverage: c.vote_average ?? 0,
      credit: kind === "cast" ? (c.character ?? "") : (c.job ?? ""),
      episodeCount: c.episode_count ?? null,
    });
  }
  return out;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return apiError(400, 'bad_request');
  }
  const language = languageParam(new URL(request.url).searchParams);

  try {
    const person = (await tmdbFetch(`/person/${id}`, { language }, request)) as {
      id?: number;
      name?: string;
      biography?: string;
      birthday?: string | null;
      deathday?: string | null;
      place_of_birth?: string | null;
      known_for_department?: string | null;
      profile_path?: string | null;
    };

    const credits = (await tmdbFetch(
      `/person/${id}/combined_credits`,
      { language },
      request,
    )) as { cast?: RawCredit[]; crew?: RawCredit[] };

    const seen = new Set<number>();
    const filmography = [
      ...collectCredits(credits.cast, "cast", seen),
      ...collectCredits(credits.crew, "crew", seen),
    ]
      .sort((a, b) => (b.releaseDate || "").localeCompare(a.releaseDate || ""))
      .slice(0, 60);

    return Response.json({
      person: {
        id: person.id ?? id,
        name: person.name ?? "",
        biography: person.biography ?? "",
        birthday: person.birthday ?? null,
        deathday: person.deathday ?? null,
        placeOfBirth: person.place_of_birth ?? null,
        department: person.known_for_department ?? null,
        profilePath: person.profile_path ?? null,
      },
      filmography,
    });
  } catch (error) {
    return tmdbErrorResponse(error);
  }
}
