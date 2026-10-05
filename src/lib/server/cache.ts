// In-memory response cache for outbound metadata APIs (TMDB, Cinemeta,
// TVmaze, ESPN, TheSportsDB).
//
// - LRU eviction with a hard cap so the process can't grow unbounded
// - in-flight request DEDUPE: concurrent callers share one promise
// - stale-while-revalidate: expired entries are returned immediately while a
//   background refresh runs (bounded by staleTtl)

interface Entry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
}

interface Inflight {
  promise: Promise<unknown>;
}

const MAX_ENTRIES = 2_000;
const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_STALE_MS = 30 * 60_000;

const globalForCache = globalThis as unknown as {
  __cinedeckApiCache?: Map<string, Entry<unknown>>;
  __cinedeckApiInflight?: Map<string, Inflight>;
};

const cache: Map<string, Entry<unknown>> =
  globalForCache.__cinedeckApiCache ?? new Map();
const inflight: Map<string, Inflight> =
  globalForCache.__cinedeckApiInflight ?? new Map();
globalForCache.__cinedeckApiCache = cache;
globalForCache.__cinedeckApiInflight = inflight;

function evictIfNeeded(): void {
  if (cache.size <= MAX_ENTRIES) return;
  // Map iteration order = insertion order — drop the oldest third.
  const drop = Math.floor(MAX_ENTRIES / 3);
  let removed = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    removed += 1;
    if (removed >= drop) break;
  }
}

export interface CacheOptions {
  /** Fresh window in ms (default 5 min). */
  ttlMs?: number;
  /** Extra stale window served while refreshing (default 30 min). */
  staleMs?: number;
}

/**
 * Cached + deduped fetch wrapper.
 *
 * - cache HIT (fresh) → resolves immediately
 * - cache HIT (stale)  → resolves with the stale value, refreshes in background
 * - cache MISS         → single shared network request for all callers
 */
export function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {},
): Promise<T> {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const stale = options.staleMs ?? DEFAULT_STALE_MS;
  const now = Date.now();

  const entry = cache.get(key) as Entry<T> | undefined;
  if (entry) {
    if (entry.expiresAt > now) {
      return Promise.resolve(entry.value);
    }
    if (entry.staleUntil > now) {
      // SWR: serve stale, refresh behind a deduped promise.
      void refresh(key, fetcher, ttl, stale);
      return Promise.resolve(entry.value);
    }
  }

  return refresh(key, fetcher, ttl, stale);
}

function refresh<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number,
  stale: number,
): Promise<T> {
  const existing = inflight.get(key) as Inflight | undefined;
  if (existing) {
    return existing.promise as Promise<T>;
  }

  const promise = fetcher()
    .then((value) => {
      cache.set(key, {
        value,
        expiresAt: Date.now() + ttl,
        staleUntil: Date.now() + ttl + stale,
      });
      evictIfNeeded();
      return value;
    })
    .catch((error) => {
      // Upstream is down — fail soft: serve the last known value while it is
      // still within the stale window instead of rejecting the callers.
      const fallback = cache.get(key) as Entry<T> | undefined;
      if (fallback && fallback.staleUntil > Date.now()) {
        return fallback.value;
      }
      throw error;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, { promise });
  return promise;
}

/** Test/debug helper — wipe the whole cache. */
export function clearApiCache(): void {
  cache.clear();
}
