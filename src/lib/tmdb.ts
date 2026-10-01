import { getTmdbKey } from '@/lib/settings';
import type { MetaSearchItem } from '@/lib/meta';

// ---------------------------------------------------------------------------
// Shared types (API contract v1)
// ---------------------------------------------------------------------------

export type MediaType = 'movie' | 'tv';

export interface SearchItem {
  id: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string;
  voteAverage: number;
  overview: string;
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profilePath: string | null;
}

export interface SimilarItem {
  id: number;
  title: string;
  posterPath: string | null;
  releaseDate: string;
  voteAverage: number;
}

export interface ProviderItem {
  name: string;
  logoPath: string;
}

export interface MediaDetails {
  id: number;
  mediaType: MediaType;
  title: string;
  tagline: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  voteAverage: number;
  runtime: number | null;
  releaseDate: string;
  genres: string[];
  cast: CastMember[];
  director: string | null;
  trailerKey: string | null;
  similar: SimilarItem[];
  providers: ProviderItem[];
}

export interface SeasonSummary {
  seasonNumber: number;
  name: string;
  episodeCount: number;
}

export interface TvDetails extends MediaDetails {
  numberOfSeasons: number;
  seasons: SeasonSummary[];
}

export interface EpisodeInfo {
  episodeNumber: number;
  name: string;
  overview: string;
  stillPath: string | null;
  runtime: number | null;
  airDate: string;
}

export interface SeasonInfo {
  seasonNumber: number;
  episodes: EpisodeInfo[];
}

export interface HistoryItem {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  season: number | null;
  episode: number | null;
  updatedAt: string;
}

export interface WatchlistItem {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  addedAt: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | 'tmdb_key'
  | 'not_found'
  | 'bad_request'
  | 'tmdb_unreachable'
  | 'server_error'
  | 'network'
  | 'unknown';

export class ApiError extends Error {
  code: ApiErrorCode;
  status: number;

  constructor(code: ApiErrorCode, message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  tmdb_key: 'Add your free TMDB API key in Settings to unlock metadata.',
  not_found: 'Title not found on TMDB.',
  bad_request: 'Invalid request.',
  tmdb_unreachable: 'TMDB is unreachable right now. Try again shortly.',
  server_error: 'Something went wrong on our side. Try again.',
  network: 'Network error — check your connection.',
  unknown: 'Something went wrong. Try again.',
};

export function errorText(code: ApiErrorCode): string {
  return ERROR_MESSAGES[code];
}

// ---------------------------------------------------------------------------
// Fetch core
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('network', ERROR_MESSAGES.network);
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const code =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : '';
    const knownCodes: readonly string[] = [
      'tmdb_key',
      'not_found',
      'bad_request',
      'tmdb_unreachable',
      'server_error',
    ];
    const mapped: ApiErrorCode = knownCodes.includes(code)
      ? (code as ApiErrorCode)
      : response.status === 404
        ? 'not_found'
        : response.status >= 500
          ? 'server_error'
          : 'unknown';
    throw new ApiError(mapped, ERROR_MESSAGES[mapped], response.status);
  }

  return payload as T;
}

/** Headers shared by every /api/tmdb/* call. */
function tmdbHeaders(language: string): Record<string, string> {
  const headers: Record<string, string> = {
    'x-tmdb-key': getTmdbKey(),
  };
  if (language) headers['x-language'] = language;
  return headers;
}

// The contract passes language via query param; keep it there and also mirror
// it in a header for robustness (backend reads either).
function withLang(path: string, language: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}language=${encodeURIComponent(language)}`;
}

// ---------------------------------------------------------------------------
// TMDB endpoints (require user key)
// ---------------------------------------------------------------------------

export async function searchTmdb(query: string, language: string): Promise<SearchItem[]> {
  const data = await apiFetch<{ results: SearchItem[] }>(
    withLang(`/api/tmdb/search?q=${encodeURIComponent(query)}`, language),
    { headers: tmdbHeaders(language) }
  );
  return data.results ?? [];
}

export async function fetchTrending(language: string): Promise<SearchItem[]> {
  const data = await apiFetch<{ results: SearchItem[] }>(
    withLang(`/api/tmdb/trending?window=week`, language),
    { headers: tmdbHeaders(language) }
  );
  return data.results ?? [];
}

/** Fetch all-time popular movies or TV shows (distinct from weekly trending). */
export async function fetchPopular(
  type: 'movie' | 'tv',
  language: string
): Promise<SearchItem[]> {
  const data = await apiFetch<{ results: SearchItem[] }>(
    withLang(`/api/tmdb/popular?type=${type}`, language),
    { headers: tmdbHeaders(language) }
  );
  return data.results ?? [];
}

/**
 * KEYLESS FALLBACK — fetch popular movies/TV from Cinemeta (Stremio public
 * catalog). Used when the user has NOT added a TMDB API key, so the home
 * page's "Trending Now" / "Popular Movies" / "Popular TV Shows" rows still
 * show real content instead of "Connect TMDB" prompts.
 *
 * Cinemeta returns MetaSearchItem[] (imdbId, title, poster, year, rating,
 * mediaType). The MediaCard component accepts both shapes via the optional
 * `posterUrl` field — Cinemeta items use the full metahub.space poster URL.
 *
 * @param type 'movie' | 'tv' | 'all' (mixed movies+TV interleaved)
 */
export async function fetchPopularMeta(
  type: 'movie' | 'tv' | 'all'
): Promise<MetaSearchItem[]> {
  const data = await apiFetch<{ results: MetaSearchItem[] }>(
    `/api/meta/popular?type=${type}`,
    { headers: { accept: 'application/json' } }
  );
  return data.results ?? [];
}

/**
 * KEYLESS catalog fetch for the home page's extra rows — Top Rated
 * (sort=imdbRating), New This Year (year=YYYY) and Explore-by-genre
 * (genre=Action …). Always served from Cinemeta, never needs a key.
 */
export async function fetchCatalogMeta(params: {
  type: 'movie' | 'tv';
  sort?: 'top' | 'imdbRating';
  genre?: string | null;
  year?: number | null;
}): Promise<MetaSearchItem[]> {
  const search = new URLSearchParams({ type: params.type });
  if (params.sort) search.set('sort', params.sort);
  if (params.genre) search.set('genre', params.genre);
  if (params.year) search.set('year', String(params.year));
  const data = await apiFetch<{ results: MetaSearchItem[] }>(
    `/api/meta/catalog?${search.toString()}`,
    { headers: { accept: 'application/json' } }
  );
  return data.results ?? [];
}

export async function fetchDetails(
  id: number,
  mediaType: MediaType,
  language: string
): Promise<MediaDetails> {
  return apiFetch<MediaDetails>(withLang(`/api/tmdb/${mediaType}/${id}`, language), {
    headers: tmdbHeaders(language),
  });
}

export async function fetchSeason(
  id: number,
  seasonNumber: number,
  language: string
): Promise<SeasonInfo> {
  return apiFetch<SeasonInfo>(
    withLang(`/api/tmdb/tv/${id}/season/${seasonNumber}`, language),
    { headers: tmdbHeaders(language) }
  );
}

// ---------------------------------------------------------------------------
// History & watchlist
// ---------------------------------------------------------------------------

interface HistoryPost {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  season?: number | null;
  episode?: number | null;
}

export async function fetchHistory(): Promise<HistoryItem[]> {
  const data = await apiFetch<{ items: HistoryItem[] }>('/api/history');
  return data.items ?? [];
}

export async function saveHistory(entry: HistoryPost): Promise<HistoryItem> {
  const data = await apiFetch<{ item: HistoryItem }>('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  return data.item;
}

export async function removeHistory(rowId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/history?id=${encodeURIComponent(rowId)}`, {
    method: 'DELETE',
  });
}

export async function clearHistory(): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/history?all=1', { method: 'DELETE' });
}

export async function fetchWatchlist(): Promise<WatchlistItem[]> {
  const data = await apiFetch<{ items: WatchlistItem[] }>('/api/watchlist');
  return data.items ?? [];
}

export async function addToWatchlist(entry: {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
}): Promise<WatchlistItem> {
  const data = await apiFetch<{ item: WatchlistItem }>('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  return data.item;
}

export async function removeWatchlist(rowId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/watchlist?id=${encodeURIComponent(rowId)}`, {
    method: 'DELETE',
  });
}

export async function clearWatchlist(): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/watchlist?all=1', { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export function yearOf(date: string | null | undefined): string {
  if (!date) return '';
  const y = date.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : '';
}

export function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
