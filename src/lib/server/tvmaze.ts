// Server-only helper for the TVmaze public API (https://www.tvmaze.com/api).
// CineDeck's SECOND keyless metadata source: zero signup, zero API key, and
// richer TV data than anything else keyless — full episode lists with real
// names, summaries, air dates, networks and status. Never import from client
// components.

import https from 'node:https';
import type { TvmazeEpisode, TvmazeShow } from '@/lib/meta';
import { withRetries } from '@/lib/server/http';

const TVMAZE_BASE = 'https://api.tvmaze.com';
const TIMEOUT_MS = 9_000;

/**
 * Node's global fetch (undici) prefers IPv6 and never falls back inside this
 * sandbox (api.tvmaze.com is dual-stack; v6 egress is unreachable here), so we
 * use node:https pinned to IPv4 with manual redirect following instead.
 * Graceful failure everywhere — callers treat null as "TVmaze unavailable".
 */
// Retry transient 5xx with backoff; 4xx responses pass through unchanged.
function httpsJson<T>(url: string): Promise<{ status: number; body: unknown } | null> {
  return withRetries(() => httpsJsonOnce<T>(url), {
    attempts: 2,
    retryIf: (v) => v !== null && v.status >= 500,
  });
}

function httpsJsonOnce<T>(url: string, depth = 0): Promise<{ status: number; body: unknown } | null> {
  return new Promise((resolve) => {
    if (depth > 3) {
      resolve(null);
      return;
    }
    const req = https.get(
      url,
      {
        family: 4,
        headers: { accept: 'application/json' },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          resolve(httpsJsonOnce<T>(new URL(location, url).toString(), depth + 1));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status, body: JSON.parse(text) as T });
          } catch {
            resolve({ status, body: text });
          }
        });
        res.on('error', () => resolve(null));
      },
    );
    req.on('timeout', () => req.destroy(new Error('tvmaze_timeout')));
    req.on('error', () => resolve(null));
  });
}

// Small in-memory cache (survives dev hot reloads via globalThis) — TVmaze
// asks heavy consumers to cache aggressively, and shows/episodes barely change.
interface CacheEntry {
  value: unknown;
  expiresAt: number;
}
const globalForTvmaze = globalThis as unknown as {
  __cinedeckTvmazeCache?: Map<string, CacheEntry>;
};
const cache: Map<string, CacheEntry> =
  globalForTvmaze.__cinedeckTvmazeCache ?? new Map<string, CacheEntry>();
globalForTvmaze.__cinedeckTvmazeCache = cache;

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

async function tvmazeFetch<T>(path: string): Promise<T | null> {
  // IPv4-pinned https transport (see httpsJson) — handles the /lookup 301.
  const res = await httpsJson<T>(`${TVMAZE_BASE}${path}`);
  if (!res) return null; // TVmaze unreachable — callers degrade gracefully
  if (res.status === 404) return null; // unknown imdb id — not an error
  if (res.status !== 200) return null;
  return res.body as T;
}

/** Strip HTML tags from TVmaze's summary fields. */
function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

interface TvmazeRawShow {
  id: number;
  name: string;
  type?: string;
  status?: string;
  runtime?: number | null;
  averageRuntime?: number | null;
  premiered?: string | null;
  ended?: string | null;
  officialSite?: string | null;
  schedule?: { time?: string; days?: string[] };
  rating?: { average?: number | null };
  network?: { name?: string; country?: { name?: string } | null } | null;
  webChannel?: { name?: string } | null;
  genres?: string[];
  summary?: string | null;
  image?: { medium?: string; original?: string } | null;
}

interface TvmazeRawEpisode {
  id: number;
  name?: string | null;
  season: number;
  number: number | null;
  type?: string;
  airdate?: string | null;
  runtime?: number | null;
  summary?: string | null;
}

/** Look a show up by its IMDB id ("tt0903747" → Breaking Bad). */
export async function tvmazeShowByImdb(imdbId: string): Promise<TvmazeShow | null> {
  if (!/^tt\d+$/.test(imdbId)) return null;
  const key = `tvmaze:show:${imdbId}`;
  const cached = cacheGet<TvmazeShow | null>(key);
  if (cached !== null || cache.has(key)) return cached;

  const raw = await tvmazeFetch<TvmazeRawShow>(`/lookup/shows?imdb=${imdbId}`);
  if (!raw || typeof raw.id !== 'number' || !raw.name) {
    cacheSet(key, null, 10 * 60 * 1000); // cache misses briefly too
    return null;
  }

  const show: TvmazeShow = {
    tvmazeId: raw.id,
    name: raw.name,
    status: raw.status ?? null,
    network: raw.network?.name ?? raw.webChannel?.name ?? null,
    premiered: raw.premiered ?? null,
    ended: raw.ended ?? null,
    runtime: raw.averageRuntime ?? raw.runtime ?? null,
    rating: raw.rating?.average ?? null,
    genres: (raw.genres ?? []).slice(0, 6),
    // Third-party URLs are validated before they can reach an <a href> sink
    // client-side — a compromised upstream must not be able to hand the UI
    // a javascript: URL (2026-11-03 hardening).
    officialSite: safeHttpUrl(raw.officialSite),
    scheduleDays: raw.schedule?.days ?? [],
    summary: stripHtml(raw.summary),
    imageUrl: safeHttpUrl(raw.image?.original ?? raw.image?.medium),
  };
  cacheSet(key, show, 60 * 60 * 1000);
  return show;
}

/** Pass through http(s) URLs; null for anything else (javascript:, data:, …). */
function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Full episode list for a TVmaze show id (season, number, name, summary…). */
export async function tvmazeEpisodes(tvmazeId: number): Promise<TvmazeEpisode[]> {
  const key = `tvmaze:episodes:${tvmazeId}`;
  const cached = cacheGet<TvmazeEpisode[]>(key);
  if (cached) return cached;

  const raw = await tvmazeFetch<TvmazeRawEpisode[]>(`/shows/${tvmazeId}/episodes`);
  if (!Array.isArray(raw)) return [];

  const episodes: TvmazeEpisode[] = raw
    .filter((e) => Number.isFinite(e.season) && Number.isFinite(e.number))
    .map((e) => ({
      season: e.season,
      number: e.number as number,
      name: e.name?.trim() || `Episode ${e.number}`,
      airdate: e.airdate ?? null,
      runtime: e.runtime ?? null,
      summary: stripHtml(e.summary),
    }));
  cacheSet(key, episodes, 60 * 60 * 1000);
  return episodes;
}

export interface TvmazeFull {
  show: TvmazeShow;
  episodes: TvmazeEpisode[];
}

/**
 * One-call helper used by /api/meta/tvmaze: show facts + full episode list
 * by IMDB id. Returns null when TVmaze doesn't know the id or is unreachable.
 */
export async function tvmazeFullByImdb(imdbId: string): Promise<TvmazeFull | null> {
  const show = await tvmazeShowByImdb(imdbId);
  if (!show) return null;
  const episodes = await tvmazeEpisodes(show.tvmazeId);
  return { show, episodes };
}
