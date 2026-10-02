// ---------------------------------------------------------------------------
// CineDeck keyless metadata (via Cinemeta / IMDB ids) — shared types.
// Used by /api/meta/* routes and the IMDB watch mode.
// ---------------------------------------------------------------------------

export interface MetaSearchItem {
  imdbId: string;
  title: string;
  year: string;
  poster: string | null;
  /** 'movie' | 'tv' (Cinemeta 'series' is normalized to 'tv'). */
  mediaType: 'movie' | 'tv';
  voteAverage: number;
  /** Optional TMDB id — Cinemeta includes `moviedb_id` for popular catalog
   * items, which lets the card build the watch URL as ?id=…&type=… (TMDB
   * mode, more providers supported) instead of falling back to ?imdb=…
   * (keyless IMDB mode). */
  tmdbId?: number;
  /** Optional genre label (first of Cinemeta's genre[] array). Used by the
   * MediaCard component for the bottom meta row. */
  genre?: string;
  /** Optional full backdrop URL (Cinemeta `background`) — used by the hero. */
  backdrop?: string | null;
}

// ---------------------------------------------------------------------------
// TVmaze (second keyless source — zero signup, rich TV data)
// ---------------------------------------------------------------------------

/** Normalized TVmaze show facts (HTML stripped, only what CineDeck renders). */
export interface TvmazeShow {
  tvmazeId: number;
  name: string;
  status: string | null;
  /** Broadcast network or web channel ("AMC", "Netflix"). */
  network: string | null;
  premiered: string | null;
  ended: string | null;
  runtime: number | null;
  rating: number | null;
  genres: string[];
  officialSite: string | null;
  scheduleDays: string[];
  summary: string;
  imageUrl: string | null;
}

/** One TVmaze episode — real names, so keyless TV gets a proper episode menu. */
export interface TvmazeEpisode {
  season: number;
  number: number;
  name: string;
  airdate: string | null;
  runtime: number | null;
  summary: string;
}

export interface MetaDetails {
  imdbId: string;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
  poster: string | null;
  backdrop: string | null;
  overview: string;
  genres: string[];
  cast: string[];
  director: string | null;
  runtime: number | null;
  voteAverage: number;
  trailerKey: string | null;
}

export interface ScanResult {
  providerId: string;
  name: string;
  ok: boolean;
  status: number | null;
  ms: number;
  /** 2-letter dub code the probed embed URL requested (null = original audio). */
  lang?: string | null;
}
