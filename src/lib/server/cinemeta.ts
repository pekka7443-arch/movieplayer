// Server-only helper for the Cinemeta (Stremio) public metadata API.
// Keyless source of IMDB-id metadata used by the IMDB watch mode.
// Never import from client components.

import type { MetaDetails, MetaSearchItem } from '@/lib/meta';

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

async function cinemetaFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${CINEMETA_BASE}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`cinemeta_${res.status}`);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Search — /catalog/{type}/top/search={query}.json
// ---------------------------------------------------------------------------

interface CinemetaSearchMeta {
  id: string;
  imdb_id?: string;
  name: string;
  type: string;
  poster?: string | null;
  releaseInfo?: string;
  imdbRating?: string;
}

interface CinemetaCatalogResponse {
  metas?: CinemetaSearchMeta[];
}

function normalizeType(cinemetaType: string): 'movie' | 'tv' {
  return cinemetaType === 'series' ? 'tv' : 'movie';
}

export async function cinemetaSearch(
  mediaType: 'movie' | 'tv',
  query: string,
): Promise<MetaSearchItem[]> {
  const key = `search:${mediaType}:${query.toLowerCase()}`;
  const cached = cacheGet<MetaSearchItem[]>(key);
  if (cached) return cached;

  const encoded = encodeURIComponent(query).replace(/%20/g, '%20');
  const data = await cinemetaFetch<CinemetaCatalogResponse>(
    `/catalog/${mediaType === 'tv' ? 'series' : 'movie'}/top/search=${encoded}.json`,
  );

  const items = (data.metas ?? [])
    .filter((m) => typeof m.id === 'string' && /^tt\d+$/.test(m.id))
    .slice(0, 12)
    .map((m) => ({
      imdbId: m.id,
      title: m.name,
      year: (m.releaseInfo ?? '').match(/\d{4}/)?.[0] ?? '',
      poster: m.poster ?? null,
      mediaType: normalizeType(m.type),
      voteAverage: Number.parseFloat(m.imdbRating ?? '') || 0,
    }));

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
  };

  cacheSet(key, details, 30 * 60 * 1000);
  return details;
}
