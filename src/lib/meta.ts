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
}
