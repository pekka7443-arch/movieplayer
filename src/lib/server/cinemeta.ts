// Server-only helper for the Cinemeta (Stremio) public metadata API.
// Keyless source of IMDB-id metadata used by the IMDB watch mode.
// Never import from client components.

import type { MetaDetails, MetaSearchItem } from '@/lib/meta';
import { withCache } from '@/lib/server/cache';
import { withRetries } from '@/lib/server/http';

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const TIMEOUT_MS = 9_000;

// Small in-memory cache (survives dev hot reloads via globalThis).
interface CacheEntry {
  value: unknown;
  expiresAt: number;
}
const globalForCinemeta = globalThis as unknown as {
  __cinedeckCinemetaCache?: Map<string, CacheEntry>;
};
const cache: Map<string, CacheEntry> =
  globalForCinemeta.__cinedeckCinemetaCache ?? new Map<string, CacheEntry>();
globalForCinemeta.__cinedeckCinemetaCache = cache;

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.value as T;
  if (entry) cache.delete(key);
  return null;
}

function cacheSet(key: string, value: unknown, ttlMs: number): void {
  if (cache.size > 300) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function cinemetaFetchUncached<T>(path: string): Promise<T> {
  return withRetries(
    async () => {
      const res = await fetch(`${CINEMETA_BASE}${path}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`cinemeta_${res.status}`);
      return (await res.json()) as T;
    },
    { attempts: 2 },
  );
}

/**
 * Dedupe + SWR layer under the per-call caches above: concurrent identical
 * requests share one promise, and popular paths get a short fresh window +
 * long stale window (fail-soft — failures bypass the cache).
 */
function cinemetaFetch<T>(path: string): Promise<T> {
  return withCache(`cinemeta:${path}`, () => cinemetaFetchUncached<T>(path), {
    ttlMs: 60_000,
    staleMs: 10 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Search — /catalog/{type}/top/search={query}.json
// ---------------------------------------------------------------------------

interface CinemetaSearchMeta {
  id: string;
  imdb_id?: string;
  moviedb_id?: number;
  name: string;
  type: string;
  poster?: string | null;
  background?: string | null;
  releaseInfo?: string;
  imdbRating?: string;
}

interface CinemetaCatalogResponse {
  metas?: CinemetaSearchMeta[];
}

function normalizeType(cinemetaType: string): 'movie' | 'tv' {
  return cinemetaType === 'series' ? 'tv' : 'movie';
}

// ---------------------------------------------------------------------------
// Popular — /catalog/{type}/top.json
// Keyless alternative to TMDB's /movie/popular + /tv/popular + /trending/all/week.
// Returns up to N top-rated / most-popular titles (Cinemeta blends IMDB + TMDB
// + Stremio + Trakt popularity signals). Each meta carries `moviedb_id` (TMDB ID)
// so the existing watch view (?id=…&type=…) plays it back without any API key.
// ---------------------------------------------------------------------------

interface CinemetaPopularMeta {
  id: string;
  imdb_id?: string;
  moviedb_id?: number;
  tvdb_id?: number;
  name: string;
  type: string;
  poster?: string | null;
  background?: string | null;
  description?: string;
  releaseInfo?: string;
  released?: string;
  year?: string;
  imdbRating?: string;
  genre?: string[] | string;
  genres?: string[];
  runtime?: string;
  cast?: string[];
  director?: string | string[];
}

interface CinemetaPopularResponse {
  metas?: CinemetaPopularMeta[];
}

/** Shared Cinemeta meta → MetaSearchItem mapper (catalogs carry moviedb_id). */
function mapPopularMetas(
  metas: CinemetaPopularMeta[],
  limit: number,
): MetaSearchItem[] {
  return metas
    .filter((m) => typeof m.id === 'string' && /^tt\d+$/.test(m.id))
    .slice(0, limit)
    .map((m) => {
      // Genres — Cinemeta returns either `genres` (array) or `genre` (array
      // or comma string). Normalize to first label only — we only show one
      // in the card's bottom row.
      const genreArray = Array.isArray(m.genres)
        ? m.genres
        : Array.isArray(m.genre)
          ? m.genre
          : typeof m.genre === 'string'
            ? [m.genre]
            : [];
      return {
        imdbId: m.id,
        title: m.name,
        year: (m.releaseInfo ?? m.year ?? '').match(/\d{4}/)?.[0] ?? '',
        poster: m.poster ?? null,
        backdrop: m.background ?? null,
        mediaType: normalizeType(m.type),
        voteAverage: Number.parseFloat(m.imdbRating ?? '') || 0,
        // Cinemeta carries `moviedb_id` (TMDB) for most popular catalog
        // items — include it so cards can build the watch URL in TMDB
        // mode (?id=…&type=…) rather than the IMDB-mode fallback.
        tmdbId: typeof m.moviedb_id === 'number' ? m.moviedb_id : undefined,
        genre: genreArray[0] ?? undefined,
      };
    });
}

/**
 * Fetch the Cinemeta "top" catalog (popular movies or TV series).
 * Caches 30 minutes — these lists change slowly.
 *
 * @param mediaType 'movie' or 'tv' (Cinemeta's 'series' is normalized)
 * @param limit max items to return (default 20)
 */
export async function cinemetaPopular(
  mediaType: 'movie' | 'tv',
  limit = 20,
): Promise<MetaSearchItem[]> {
  const key = `popular:${mediaType}`;
  const cached = cacheGet<MetaSearchItem[]>(key);
  if (cached) return cached;

  const cinemetaType = mediaType === 'tv' ? 'series' : 'movie';
  const data = await cinemetaFetch<CinemetaPopularResponse>(
    `/catalog/${cinemetaType}/top.json`,
  );

  const items = mapPopularMetas(data.metas ?? [], limit);
  cacheSet(key, items, 30 * 60 * 1000);
  return items;
}

export interface CinemetaCatalogOptions {
  /** Filter by genre (Cinemeta label, e.g. "Action"). */
  genre?: string | null;
  /** Catalog id: "top" (blended popularity) or "imdbRating" (top rated). */
  sort?: 'top' | 'imdbRating';
  /** Year catalog — returns titles released that year. */
  year?: number | null;
  limit?: number;
}

/**
 * Generic keyless catalog fetch backing the home page's extra rows
 * (Top Rated, New This Year, Explore-by-genre). Same mapping + 30 min cache
 * as cinemetaPopular.
 */
export async function cinemetaCatalog(
  mediaType: 'movie' | 'tv',
  options: CinemetaCatalogOptions = {},
): Promise<MetaSearchItem[]> {
  const { genre = null, sort = 'top', year = null, limit = 20 } = options;
  const cinemetaType = mediaType === 'tv' ? 'series' : 'movie';

  let path: string;
  let cacheKey: string;
  if (year != null) {
    path = `/catalog/${cinemetaType}/year/year=${encodeURIComponent(String(year))}.json`;
    cacheKey = `catalog:${cinemetaType}:year:${year}`;
  } else if (sort === 'imdbRating') {
    path = genre
      ? `/catalog/${cinemetaType}/imdbRating/genre=${encodeURIComponent(genre)}.json`
      : `/catalog/${cinemetaType}/imdbRating.json`;
    cacheKey = `catalog:${cinemetaType}:imdbRating:${genre ?? '_all'}`;
  } else {
    path = genre
      ? `/catalog/${cinemetaType}/top/genre=${encodeURIComponent(genre)}.json`
      : `/catalog/${cinemetaType}/top.json`;
    cacheKey = `catalog:${cinemetaType}:top:${genre ?? '_all'}`;
  }

  const cached = cacheGet<MetaSearchItem[]>(cacheKey);
  if (cached) return cached;

  const data = await cinemetaFetch<CinemetaPopularResponse>(path);
  const items = mapPopularMetas(data.metas ?? [], limit);
  cacheSet(cacheKey, items, 30 * 60 * 1000);
  return items;
}

/**
 * Fetch popular movies AND popular TV series, interleaved (movies first) so
 * the "Trending Now" row shows a mixed catalog the same way TMDB's
 * /trending/all/week would. Used as the keyless fallback for useTrending.
 */
export async function cinemetaPopularMixed(limit = 20): Promise<MetaSearchItem[]> {
  const [movies, series] = await Promise.allSettled([
    cinemetaPopular('movie', limit),
    cinemetaPopular('tv', limit),
  ]);
  const m = movies.status === 'fulfilled' ? movies.value : [];
  const s = series.status === 'fulfilled' ? series.value : [];
  // Interleave movies and series (movies first, alternating) — same shape as
  // cinemetaSearchMulti, gives the home page a mixed catalog feed.
  const out: MetaSearchItem[] = [];
  const max = Math.max(m.length, s.length);
  for (let i = 0; i < max; i++) {
    if (m[i]) out.push(m[i]);
    if (s[i]) out.push(s[i]);
  }
  return out.slice(0, limit);
}

/**
 * Keyless "More like this": the Cinemeta top catalog filtered by genre,
 * minus the title we're currently watching. Falls back to the unfiltered top
 * catalog when the genre is unknown, empty or yields too few results.
 * Caches 30 minutes per (type, genre).
 */
export async function cinemetaSimilar(
  mediaType: 'movie' | 'tv',
  excludeImdbId: string,
  genre: string | null,
  limit = 16,
): Promise<MetaSearchItem[]> {
  const fetchGenre = async (g: string | null): Promise<MetaSearchItem[]> => {
    const key = `similar:${mediaType}:${g ?? '_all'}`;
    const cached = cacheGet<MetaSearchItem[]>(key);
    if (cached) return cached;

    const cinemetaType = mediaType === 'tv' ? 'series' : 'movie';
    const path = g
      ? `/catalog/${cinemetaType}/top/genre=${encodeURIComponent(g)}.json`
      : `/catalog/${cinemetaType}/top.json`;
    const data = await cinemetaFetch<CinemetaPopularResponse>(path);

    const items = (data.metas ?? [])
      .filter((m) => typeof m.id === 'string' && /^tt\d+$/.test(m.id))
      .slice(0, limit)
      .map((m) => ({
        imdbId: m.id,
        title: m.name,
        year: (m.releaseInfo ?? '').match(/\d{4}/)?.[0] ?? '',
        poster: m.poster ?? null,
        backdrop: m.background ?? null,
        mediaType: normalizeType(m.type),
        voteAverage: Number.parseFloat(m.imdbRating ?? '') || 0,
        tmdbId: typeof m.moviedb_id === 'number' ? m.moviedb_id : undefined,
      }));
    cacheSet(key, items, 30 * 60 * 1000);
    return items;
  };

  const run = async () => {
    if (genre) {
      try {
        const byGenre = await fetchGenre(genre);
        const filtered = byGenre.filter((m) => m.imdbId !== excludeImdbId);
        if (filtered.length >= 4) return filtered.slice(0, limit);
      } catch {
        // Unknown genre name → fall through to the unfiltered catalog.
      }
    }
    const all = await fetchGenre(null);
    return all.filter((m) => m.imdbId !== excludeImdbId).slice(0, limit);
  };

  return run();
}

/**
 * Raw normalized search results incl. every id Cinemeta carries (IMDB + TMDB
 * `moviedb_id`) and the backdrop image. Used by the Finnish catalog resolver,
 * which needs both id forms so the player can try either index.
 */
export async function cinemetaSearchRaw(
  mediaType: 'movie' | 'tv',
  query: string,
  limit = 25,
): Promise<MetaSearchItem[]> {
  const encoded = encodeURIComponent(query);
  const data = await cinemetaFetch<CinemetaCatalogResponse>(
    `/catalog/${mediaType === 'tv' ? 'series' : 'movie'}/top/search=${encoded}.json`,
  );

  return (data.metas ?? [])
    .filter((m) => typeof m.id === 'string' && /^tt\d+$/.test(m.id))
    .slice(0, limit)
    .map((m) => ({
      imdbId: m.id,
      title: m.name,
      year: (m.releaseInfo ?? '').match(/\d{4}/)?.[0] ?? '',
      poster: m.poster ?? null,
      backdrop: m.background ?? null,
      mediaType: normalizeType(m.type),
      voteAverage: Number.parseFloat(m.imdbRating ?? '') || 0,
      tmdbId: typeof m.moviedb_id === 'number' ? m.moviedb_id : undefined,
    }));
}

export async function cinemetaSearch(
  mediaType: 'movie' | 'tv',
  query: string,
): Promise<MetaSearchItem[]> {
  const key = `search:${mediaType}:${query.toLowerCase()}`;
  const cached = cacheGet<MetaSearchItem[]>(key);
  if (cached) return cached;

  const items = (await cinemetaSearchRaw(mediaType, query, 12)).map(
    ({ backdrop: _backdrop, ...rest }) => rest,
  );

  cacheSet(key, items, 10 * 60 * 1000);
  return items;
}

/** Search both movies and series, interleaved (movies first). */
export async function cinemetaSearchMulti(query: string): Promise<MetaSearchItem[]> {
  const [movies, series] = await Promise.allSettled([
    cinemetaSearch('movie', query),
    cinemetaSearch('tv', query),
  ]);

  const m = movies.status === 'fulfilled' ? movies.value : [];
  const s = series.status === 'fulfilled' ? series.value : [];

  const out: MetaSearchItem[] = [];
  const max = Math.max(m.length, s.length);
  for (let i = 0; i < max; i++) {
    if (m[i]) out.push(m[i]);
    if (s[i]) out.push(s[i]);
  }
  return out.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Meta details — /meta/{type}/{imdbId}.json
// ---------------------------------------------------------------------------

interface CinemetaFullMeta {
  meta?: {
    id: string;
    name: string;
    type: string;
    poster?: string | null;
    background?: string | null;
    description?: string;
    releaseInfo?: string;
    released?: string;
    country?: string;
    genres?: string[];
    genre?: string | string[];
    cast?: string[];
    director?: string | string[];
    runtime?: string;
    imdbRating?: string;
    trailers?: { source?: string; type?: string }[];
  };
}

function parseRuntime(raw: string | undefined): number | null {
  if (!raw) return null;
  const minutes = Number.parseInt(raw, 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function firstOf(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function cinemetaDetails(
  imdbId: string,
  mediaType: 'movie' | 'tv',
): Promise<MetaDetails> {
  const key = `meta:${mediaType}:${imdbId}`;
  const cached = cacheGet<MetaDetails>(key);
  if (cached) return cached;

  const data = await cinemetaFetch<CinemetaFullMeta>(
    `/meta/${mediaType === 'tv' ? 'series' : 'movie'}/${imdbId}.json`,
  );
  const meta = data.meta;
  if (!meta || !meta.name) throw new Error('cinemeta_not_found');

  const trailer = (meta.trailers ?? []).find((t) => typeof t.source === 'string' && t.source);

  const details: MetaDetails = {
    imdbId: meta.id || imdbId,
    mediaType,
    title: meta.name,
    year: (meta.releaseInfo ?? '').match(/\d{4}/)?.[0] ?? '',
    poster: meta.poster ?? null,
    backdrop: meta.background ?? null,
    overview: meta.description ?? '',
    genres: Array.isArray(meta.genres)
      ? meta.genres.slice(0, 6)
      : typeof meta.genre === 'string'
        ? [meta.genre]
        : Array.isArray(meta.genre)
          ? meta.genre.slice(0, 6)
          : [],
    cast: (meta.cast ?? []).slice(0, 12),
    director: firstOf(meta.director),
    runtime: parseRuntime(meta.runtime),
    voteAverage: Number.parseFloat(meta.imdbRating ?? '') || 0,
    trailerKey: trailer?.source ?? null,
    country: meta.country ?? null,
    released: typeof meta.released === 'string' && meta.released ? meta.released : null,
  };

  cacheSet(key, details, 30 * 60 * 1000);
  return details;
}
