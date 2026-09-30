// Server-side TMDB v3 proxy helpers.
// Server-only module — never import from client components.

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_TIMEOUT_MS = 8_000;
const CACHE_MAX_ENTRIES = 200;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type TmdbErrorCode =
  | "tmdb_key"
  | "not_found"
  | "bad_request"
  | "tmdb_unreachable"
  | "server_error";

export const TMDB_KEY_MESSAGE = "Add a free TMDB API key in Settings";

/** Typed error thrown by tmdbFetch; handlers map it to JSON responses. */
export class TmdbApiError extends Error {
  readonly code: TmdbErrorCode;
  readonly status: number;

  constructor(code: TmdbErrorCode, status: number, message?: string) {
    super(message ?? code);
    this.name = "TmdbApiError";
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Small in-memory cache (survives dev hot reloads via globalThis).
// Caches only successful TMDB GET responses for 5 minutes, max 200 entries.
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const globalForTmdb = globalThis as unknown as {
  __cinedeckTmdbCache?: Map<string, CacheEntry>;
};

const tmdbCache: Map<string, CacheEntry> =
  globalForTmdb.__cinedeckTmdbCache ?? new Map<string, CacheEntry>();
globalForTmdb.__cinedeckTmdbCache = tmdbCache;

function cacheGet(key: string): { hit: true; value: unknown } | { hit: false } {
  const entry = tmdbCache.get(key);
  if (!entry) return { hit: false };
  if (Date.now() > entry.expiresAt) {
    tmdbCache.delete(key);
    return { hit: false };
  }
  // Bump recency for simple LRU behavior.
  tmdbCache.delete(key);
  tmdbCache.set(key, entry);
  return { hit: true, value: entry.value };
}

function cacheSet(key: string, value: unknown): void {
  tmdbCache.delete(key);
  tmdbCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  while (tmdbCache.size > CACHE_MAX_ENTRIES) {
    const oldest = tmdbCache.keys().next();
    if (oldest.done) break;
    tmdbCache.delete(oldest.value);
  }
}

// ---------------------------------------------------------------------------
// Key resolution: x-tmdb-key header → `key` query param → env → null
// ---------------------------------------------------------------------------

export function resolveTmdbKey(request: Request): string | null {
  const headerKey = request.headers.get("x-tmdb-key");
  if (headerKey && headerKey.trim().length > 0) return headerKey.trim();

  try {
    const queryKey = new URL(request.url).searchParams.get("key");
    if (queryKey && queryKey.trim().length > 0) return queryKey.trim();
  } catch {
    // Malformed request URL — fall through to env.
  }

  const envKey = process.env.TMDB_API_KEY;
  if (envKey && envKey.trim().length > 0) return envKey.trim();

  return null;
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

function buildTmdbUrl(path: string, params: Record<string, string>, apiKey: string): string {
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  const search = new URLSearchParams({ ...params, api_key: apiKey });
  search.sort(); // deterministic order → stable cache keys
  url.search = search.toString();
  return url.toString();
}

/**
 * Fetch a TMDB v3 endpoint. Throws TmdbApiError for every failure mode:
 * no key / upstream 401 → tmdb_key (503), 404 → not_found (404),
 * network/timeout/garbage → tmdb_unreachable (502), other 4xx → bad_request (400),
 * anything else → server_error (500).
 */
export async function tmdbFetch<T = unknown>(
  path: string,
  params: Record<string, string>,
  request: Request,
): Promise<T> {
  const apiKey = resolveTmdbKey(request);
  if (!apiKey) {
    throw new TmdbApiError("tmdb_key", 503, TMDB_KEY_MESSAGE);
  }

  const url = buildTmdbUrl(path, params, apiKey);

  const cached = cacheGet(url);
  if (cached.hit) return cached.value as T;

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new TmdbApiError("tmdb_unreachable", 502, "Could not reach TMDB");
  }

  if (response.status === 401) {
    throw new TmdbApiError("tmdb_key", 503, TMDB_KEY_MESSAGE);
  }
  if (response.status === 404) {
    throw new TmdbApiError("not_found", 404, "Not found");
  }
  if (response.status >= 400 && response.status < 500) {
    throw new TmdbApiError("bad_request", 400, `TMDB responded with ${response.status}`);
  }
  if (!response.ok) {
    throw new TmdbApiError("server_error", 500, `TMDB responded with ${response.status}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new TmdbApiError("tmdb_unreachable", 502, "Invalid response from TMDB");
  }

  cacheSet(url, data);
  return data as T;
}

// ---------------------------------------------------------------------------
// Response helpers for route handlers
// ---------------------------------------------------------------------------

/** Map any thrown value to the standard JSON error shape. Never throws. */
export function tmdbErrorResponse(error: unknown): Response {
  if (error instanceof TmdbApiError) {
    const body: Record<string, string> = { error: error.code };
    if (error.message) body.message = error.message;
    return Response.json(body, { status: error.status });
  }
  console.error("[api/tmdb] unexpected error:", error);
  return Response.json({ error: "server_error" }, { status: 500 });
}

export function badRequestResponse(message?: string): Response {
  const body: Record<string, string> = { error: "bad_request" };
  if (message) body.message = message;
  return Response.json(body, { status: 400 });
}

/** Validate a positive integer id path/query param (default min 1). Returns null when invalid. */
export function parseIdParam(
  value: string | null | undefined,
  options?: { min?: number },
): number | null {
  const min = options?.min ?? 1;
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min ? parsed : null;
}

/** `language` query param with a sane default. */
export function languageParam(searchParams: URLSearchParams): string {
  const value = searchParams.get("language")?.trim();
  return value && value.length > 0 ? value : "en-US";
}

// ---------------------------------------------------------------------------
// Normalization — search/trending card shape
// ---------------------------------------------------------------------------

export interface TmdbMediaCard {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string;
  voteAverage: number;
  overview: string;
}

export interface TmdbCastMember {
  id: number;
  name: string;
  character: string;
  profilePath: string | null;
}

export interface TmdbSimilarItem {
  id: number;
  title: string;
  posterPath: string;
  releaseDate: string;
  voteAverage: number;
}

export interface TmdbProvider {
  name: string;
  logoPath: string;
}

export interface TmdbSeasonSummary {
  seasonNumber: number;
  name: string;
  episodeCount: number;
}

export interface TmdbMediaDetails {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  tagline: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  voteAverage: number;
  runtime: number | null;
  releaseDate: string;
  genres: string[];
  cast: TmdbCastMember[];
  director: string | null;
  trailerKey: string | null;
  similar: TmdbSimilarItem[];
  providers: TmdbProvider[];
}

export interface TmdbTvDetails extends TmdbMediaDetails {
  numberOfSeasons: number;
  seasons: TmdbSeasonSummary[];
}

export interface TmdbSeasonEpisodes {
  seasonNumber: number;
  episodes: {
    episodeNumber: number;
    name: string;
    overview: string;
    stillPath: string | null;
    runtime: number | null;
    airDate: string | null;
  }[];
}

// --- tiny unknown-safe accessors (no `any`) ---

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toStrOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Extract the `results` array from a TMDB list payload. */
export function extractResults(data: unknown): unknown[] {
  return asArray(asRecord(data).results);
}

/** Normalize one search/trending item; returns null for non movie/tv entries. */
export function normalizeMediaCard(raw: unknown): TmdbMediaCard | null {
  const item = asRecord(raw);
  if (item.media_type !== "movie" && item.media_type !== "tv") return null;
  return {
    id: toNumber(item.id),
    mediaType: item.media_type,
    title: toStr(item.title) || toStr(item.name),
    posterPath: toStrOrNull(item.poster_path),
    backdropPath: toStrOrNull(item.backdrop_path),
    releaseDate: toStr(item.release_date) || toStr(item.first_air_date),
    voteAverage: toNumber(item.vote_average),
    overview: toStr(item.overview),
  };
}

/** Filter to movie/tv cards and cap the list length. */
export function normalizeMediaCardList(rawList: unknown, limit: number): TmdbMediaCard[] {
  return asArray(rawList)
    .map((entry) => normalizeMediaCard(entry))
    .filter((entry): entry is TmdbMediaCard => entry !== null)
    .slice(0, limit);
}

// --- detail normalization ---

function pickTrailerKey(videos: unknown[]): string | null {
  const candidates = videos.filter((entry) => {
    const video = asRecord(entry);
    return (
      video.site === "YouTube" &&
      (video.type === "Trailer" || video.type === "Teaser")
    );
  });
  const official = candidates.find((entry) => asRecord(entry).official === true);
  const chosen = official ?? candidates[0];
  const key = chosen ? toStr(asRecord(chosen).key) : "";
  return key.length > 0 ? key : null;
}

function extractProviders(watchProviders: unknown): TmdbProvider[] {
  const regions = asRecord(asRecord(watchProviders).results);
  const regionKeys = Object.keys(regions);
  if (regionKeys.length === 0) return [];

  const orderedKeys = [
    "US",
    "GB",
    ...regionKeys.filter((key) => key !== "US" && key !== "GB"),
  ];

  for (const key of orderedKeys) {
    const flatrate = asArray(asRecord(regions[key]).flatrate);
    if (flatrate.length === 0) continue;

    const seen = new Set<number>();
    const providers: TmdbProvider[] = [];
    for (const entry of flatrate) {
      const provider = asRecord(entry);
      const providerId = toNumber(provider.provider_id);
      if (seen.has(providerId)) continue;
      seen.add(providerId);
      providers.push({
        name: toStr(provider.provider_name),
        logoPath: toStr(provider.logo_path),
      });
    }
    return providers;
  }
  return [];
}

/** Normalize a `/movie/{id}` or `/tv/{id}` payload (with append_to_response). */
export function normalizeMediaDetails(
  raw: unknown,
  mediaType: "movie" | "tv",
): TmdbMediaDetails {
  const detail = asRecord(raw);
  const credits = asRecord(detail.credits);

  const cast: TmdbCastMember[] = asArray(credits.cast)
    .slice(0, 12)
    .map((entry) => {
      const member = asRecord(entry);
      return {
        id: toNumber(member.id),
        name: toStr(member.name),
        character: toStr(member.character),
        profilePath: toStrOrNull(member.profile_path),
      };
    });

  const directorEntry = asArray(credits.crew).find(
    (entry) => asRecord(entry).job === "Director",
  );
  const director = directorEntry ? toStr(asRecord(directorEntry).name) : "";

  const similar: TmdbSimilarItem[] = asArray(asRecord(detail.similar).results)
    .filter((entry) => asRecord(entry).poster_path != null)
    .slice(0, 12)
    .map((entry) => {
      const item = asRecord(entry);
      return {
        id: toNumber(item.id),
        title: toStr(item.title) || toStr(item.name),
        posterPath: toStr(item.poster_path),
        releaseDate: toStr(item.release_date) || toStr(item.first_air_date),
        voteAverage: toNumber(item.vote_average),
      };
    });

  const runtime =
    mediaType === "tv"
      ? numOrNull(asArray(detail.episode_run_time)[0])
      : numOrNull(detail.runtime);

  return {
    id: toNumber(detail.id),
    mediaType,
    title:
      toStr(detail.title) ||
      toStr(detail.name) ||
      toStr(detail.original_title) ||
      toStr(detail.original_name),
    tagline: toStr(detail.tagline),
    overview: toStr(detail.overview),
    posterPath: toStrOrNull(detail.poster_path),
    backdropPath: toStrOrNull(detail.backdrop_path),
    voteAverage: toNumber(detail.vote_average),
    runtime,
    releaseDate: toStr(detail.release_date) || toStr(detail.first_air_date),
    genres: asArray(detail.genres)
      .map((entry) => toStr(asRecord(entry).name))
      .filter((name) => name.length > 0),
    cast,
    director: director.length > 0 ? director : null,
    trailerKey: pickTrailerKey(asArray(asRecord(detail.videos).results)),
    similar,
    providers: extractProviders(detail["watch/providers"]),
  };
}

/** Normalize a `/tv/{id}` payload: movie shape + numberOfSeasons + seasons. */
export function normalizeTvDetails(raw: unknown): TmdbTvDetails {
  const detail = asRecord(raw);
  const base = normalizeMediaDetails(raw, "tv");

  const seasonsRaw: TmdbSeasonSummary[] = asArray(detail.seasons).map((entry) => {
    const season = asRecord(entry);
    return {
      seasonNumber: toNumber(season.season_number),
      name: toStr(season.name),
      episodeCount: toNumber(season.episode_count),
    };
  });
  const regularSeasons = seasonsRaw.filter((season) => season.seasonNumber >= 1);
  const seasons = regularSeasons.length > 0 ? regularSeasons : seasonsRaw;

  const createdBy = asArray(detail.created_by);
  const creator = createdBy.length > 0 ? toStr(asRecord(createdBy[0]).name) : "";
  const directorName = creator.length > 0 ? creator : null;

  return {
    ...base,
    director: directorName,
    numberOfSeasons: numOr(detail.number_of_seasons, seasons.length),
    seasons,
  };
}

/** Normalize a `/tv/{id}/season/{n}` payload. */
export function normalizeSeason(
  raw: unknown,
  fallbackSeasonNumber: number,
): TmdbSeasonEpisodes {
  const season = asRecord(raw);
  const episodes = asArray(season.episodes).map((entry) => {
    const episode = asRecord(entry);
    return {
      episodeNumber: toNumber(episode.episode_number),
      name: toStr(episode.name),
      overview: toStr(episode.overview),
      stillPath: toStrOrNull(episode.still_path),
      runtime: numOrNull(episode.runtime),
      airDate: toStrOrNull(episode.air_date),
    };
  });
  return {
    seasonNumber: numOr(season.season_number, fallbackSeasonNumber),
    episodes,
  };
}
