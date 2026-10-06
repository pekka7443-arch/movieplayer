// TMDB discover — the full-power backend behind the Explore section's
// advanced filters (decade / runtime / original language / origin country).
// Requires a TMDB API key; the keyless catalog route falls back to Cinemeta.

const TMDB_GENRES_MOVIE: Record<string, number> = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Drama: 18,
  Fantasy: 14,
  Horror: 27,
  Mystery: 9648,
  Romance: 10749,
  'Science Fiction': 878,
  Thriller: 53,
  War: 10752,
  Documentary: 99,
  Family: 10751,
  'Music': 10402,
  Western: 37,
};

const TMDB_GENRES_TV: Record<string, number> = {
  Action: 10759, // "Action & Adventure"
  Adventure: 10759,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Drama: 18,
  Fantasy: 10765, // "Sci-Fi & Fantasy"
  Horror: 9648, // TV horror maps to Mystery on TMDB
  Mystery: 9648,
  Romance: 10749,
  'Science Fiction': 10765,
  Thriller: 9648,
  War: 10768,
  Documentary: 99,
  Family: 10751,
  Music: 10402,
  Western: 37,
};

export interface TmdbDiscoverParams {
  type: 'movie' | 'tv';
  sort: 'top' | 'imdbRating';
  genre: string | null;
  year: number | null;
  minRating: number | null;
  decade: number | null;
  maxRuntime: number | null;
  language: string | null;
  country: string | null;
  limit: number;
}

interface TmdbDiscoverItem {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
}

const GENRE_ID_TO_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(TMDB_GENRES_MOVIE).map(([name, id]) => [id, name]),
);

/** Year range for a decade label (2010 → [2010, 2019]). */
function decadeRange(decade: number): { gte: string; lte: string } {
  const end = Math.min(decade + 9, new Date().getFullYear() + 1);
  return { gte: `${decade}-01-01`, lte: `${end}-12-31` };
}

export async function tmdbDiscover(
  apiKey: string,
  params: TmdbDiscoverParams,
): Promise<
  {
    imdbId: string;
    tmdbId: number;
    title: string;
    year: string;
    poster: string | null;
    backdrop: string | null;
    mediaType: 'movie' | 'tv';
    voteAverage: number;
    genre?: string;
  }[]
> {
  const { type, sort, genre, year, minRating, decade, maxRuntime, language, country, limit } = params;
  const path = type === 'tv' ? '/discover/tv' : '/discover/movie';

  const search = new URLSearchParams({
    api_key: apiKey,
    include_adult: 'false',
    sort_by: sort === 'imdbRating' ? 'vote_average.desc' : 'popularity.desc',
    'vote_count.gte': String(sort === 'imdbRating' ? 300 : 50),
    page: '1',
  });

  const genreId = genre
    ? type === 'tv'
      ? TMDB_GENRES_TV[genre]
      : TMDB_GENRES_MOVIE[genre]
    : undefined;
  if (genreId) search.set('with_genres', String(genreId));

  const dateKey = type === 'tv' ? 'first_air_date' : 'primary_release_date';
  if (year != null) {
    search.set(type === 'tv' ? 'first_air_date_year' : 'primary_release_year', String(year));
  } else if (decade != null) {
    const range = decadeRange(decade);
    search.set(`${dateKey}.gte`, range.gte);
    search.set(`${dateKey}.lte`, range.lte);
  }

  if (minRating != null) search.set('vote_average.gte', String(minRating));
  if (maxRuntime != null) search.set(type === 'tv' ? 'episode_run_time.lte' : 'with_runtime.lte', String(maxRuntime));
  if (language) search.set('with_original_language', language);
  if (country) search.set('with_origin_country', country);

  const res = await fetch(`https://api.themoviedb.org/3${path}?${search.toString()}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`tmdb_discover_${res.status}`);
  const data = (await res.json()) as { results?: TmdbDiscoverItem[] };

  return (data.results ?? []).slice(0, limit).map((item) => {
    const date = item.release_date ?? item.first_air_date ?? '';
    const genreId = item.genre_ids?.[0];
    return {
      imdbId: `tmdb-${item.id}`, // discover has no imdb id; the id-form fallback keeps watch links working
      tmdbId: item.id,
      title: item.title ?? item.name ?? '',
      year: date.slice(0, 4),
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
      backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
      mediaType: type,
      voteAverage: item.vote_average ?? 0,
      genre: genreId ? GENRE_ID_TO_NAME[genreId] : undefined,
    };
  });
}
