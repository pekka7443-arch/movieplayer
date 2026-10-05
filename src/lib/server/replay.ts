// Server-only helper: find REPLAY videos for a finished sports event.
//
// "Watch replay" must actually play something with a seek bar — so instead of
// live TV channels we search YouTube for event replays (full matches, extended
// highlights) and play them through an embedded player. Keyless: YouTube is
// queried through public Piped API instances (community YouTube mirrors). The
// instances are community-run and individually flaky, so three are raced in
// parallel and the first clean response wins; every request carries an
// absolute deadline.
//
// Results are ranked so the best replay autoplays: full-match titles, official
// uploaders (league/broadcaster/club names), recency, healthy duration.
// Never import from client components.

import https from 'node:https';
import { withRetries } from '@/lib/server/http';

const INSTANCES = [
  'https://api.piped.private.coffee',
  'https://pipedapi.ducks.party',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.reallyaweso.me',
  'https://pipedapi.drgns.space',
];
/** How many instances are raced in parallel (first valid answer wins). */
const RACE_N = 3;
const TIMEOUT_MS = 7_000;
const MAX_RESULTS = 30;
const CACHE_TTL_MS = 30 * 60_000;

// Retry transient failures (null soft-fails) with backoff.
function httpsJson<T>(url: string): Promise<T | null> {
  return withRetries(() => httpsJsonOnce<T>(url), { attempts: 2, retryIf: (v) => v === null });
}

function httpsJsonOnce<T>(url: string, depth = 0): Promise<T | null> {
  return new Promise((resolve) => {
    if (depth > 2) {
      resolve(null);
      return;
    }
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    let req: ReturnType<typeof https.get> | null = null;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      resolve(value);
    };
    req = https.get(
      url,
      {
        family: 4,
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) CineDeck/1.0' },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          settled = true;
          if (deadline) clearTimeout(deadline);
          httpsJsonOnce<T>(new URL(location, url).toString(), depth + 1).then(resolve);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          finish(null);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            finish(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
          } catch {
            finish(null);
          }
        });
        res.on('error', () => finish(null));
      },
    );
    req.on('timeout', () => req?.destroy(new Error('replay_timeout')));
    req.on('error', () => finish(null));
    // Absolute deadline for the whole request (DNS + connect + body).
    deadline = setTimeout(() => {
      req?.destroy();
      finish(null);
    }, TIMEOUT_MS);
  });
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

export interface ReplaySeed {
  sport: string;
  league: string;
  /** Team name — or, for team-less events (WRC stage / F1 GP), the title. */
  home: string;
  /** Empty string for team-less events. */
  away: string;
  /** Event date (YYYY-MM-DD) when known — anchors "2026" in the queries. */
  date?: string | null;
}

/**
 * Two complementary searches per event: the generic one finds club/broadcaster
 * highlight uploads within minutes of the whistle; the explicit one hunts full
 * matches and extended replays. Team-less events drop the "vs" shape and strip
 * stage codes ("… SS1" → "Rally Italia Sardegna").
 */
function buildQueries(seed: ReplaySeed): string[] {
  const home = seed.home.trim();
  const away = seed.away.trim();
  const year = seed.date ? seed.date.slice(0, 4) : '';

  if (away) {
    const title = `${home} vs ${away}`;
    return [`(${title}) highlights`, `(${title}) (${year}) full match highlights`].map((q) =>
      q.replace(/(\(\s*\))+/g, '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim(),
    );
  }

  // Team-less: "WRC Rally Italia Sardegna SS1" → "WRC Rally Italia Sardegna"
  const base = home.replace(/\bSS\s*\d+\b/gi, '').replace(/\s+/g, ' ').trim();
  return [`${base} highlights`, `${seed.league} ${base} ${year} full replay highlights`]
    .map((q) => q.replace(/\s+/g, ' ').trim())
    .filter((q) => q.length > 2);
}

// ---------------------------------------------------------------------------
// Search + rank
// ---------------------------------------------------------------------------

interface PipedItem {
  url?: string;
  title?: string;
  thumbnail?: string;
  uploaderName?: string;
  duration?: number;
  views?: number;
  uploaded?: number;
  uploadedDate?: string;
  uploadedYear?: number;
}

export interface ReplayVideo {
  videoId: string;
  title: string;
  channel: string;
  thumb: string;
  durationSec: number;
  views: number | null;
  /** Raw upstream label ("2025-10-01" or "2 years ago"). */
  published: string | null;
  kind: 'full' | 'highlights' | 'other';
  score: number;
}

/** Race N instances — the first one that returns a real items array wins. */
async function pipedSearch(query: string): Promise<PipedItem[]> {
  const tasks = INSTANCES.slice(0, RACE_N).map(async (base) => {
    const url = `${base}/search?q=${encodeURIComponent(query)}&filter=videos`;
    const data = await httpsJson<{ items?: PipedItem[] | null }>(url);
    return data && Array.isArray(data.items) ? data.items : null;
  });
  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }
  return [];
}

function videoIdOf(item: PipedItem): string | null {
  const url = item.url ?? '';
  const m = /[?&]v=([\w-]{11})/.exec(url) ?? /youtu\.be\/([\w-]{11})/.exec(url);
  return m ? m[1]! : null;
}

/** Broadcaster / league / club channel names that reliably post replays. */
const OFFICIAL_PATTERNS = [
  'premier league', 'la liga', 'laliga', 'serie a', 'bundesliga', 'ligue 1',
  'uefa', 'fifa', 'bein', 'sky sport', 'sky sports', 'tnt sports', 'dazn',
  'espn', 'eurosport', 'fox sports', 'cbs sports', 'nbcsport', 'nbc sports',
  'wrc', 'fia', 'f1', 'formula', 'motogp', 'nascar', 'imsa', 'wec',
  'nhl', 'nba', 'nfl', 'mlb', 'wnba', 'ufc', 'wwe',
  'full match', 'fullmatch', 'full replay', 'classic match', 'resumen',
];

/**
 * Relative-age parsing ("2 years ago", "4 months ago") → age in ms.
 * ISO strings parse directly with Date.parse.
 */
function ageMsOf(published: string | null, uploaded: number | undefined): number | null {
  if (typeof uploaded === 'number' && uploaded > 0) {
    // Piped "uploaded" is a unix-ms timestamp in newer instances.
    const ms = uploaded > 1e12 ? uploaded : uploaded * 1000;
    if (ms > 0 && ms < Date.now() + 86_400_000) return Date.now() - ms;
  }
  if (!published) return null;
  const iso = Date.parse(published);
  if (Number.isFinite(iso)) return Date.now() - iso;
  const m = /(\d+)\s+(second|minute|hour|day|week|month|year)/i.exec(published);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  const unitMs: Record<string, number> = {
    second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000,
    week: 7 * 86_400_000, month: 30 * 86_400_000, year: 365 * 86_400_000,
  };
  return n * (unitMs[m[2]!.toLowerCase()] ?? 86_400_000);
}

function kindOf(title: string): ReplayVideo['kind'] {
  const t = title.toLowerCase();
  if (/full (match|replay|race|game|session|show|qualifying)|extended (highlights|race)/.test(t)) return 'full';
  if (/highlight|summary|goals?|best bits|condensed/.test(t)) return 'highlights';
  return 'other';
}

function scoreVideo(item: PipedItem, seed: ReplaySeed, homeKey: string, awayKey: string, officialHay: string): { score: number; kind: ReplayVideo['kind'] } {
  const title = (item.title ?? '').trim();
  const lower = `${title} ${item.uploaderName ?? ''}`.toLowerCase();
  const kind = kindOf(title);

  let score = kind === 'full' ? 40 : kind === 'highlights' ? 16 : 4;

  // Official league/broadcaster/club channels rank above fan uploads.
  if (OFFICIAL_PATTERNS.some((p) => lower.includes(p))) score += 14;
  if (officialHay && (item.uploaderName ?? '').toLowerCase().includes(officialHay)) score += 10;

  // Team mentions (team events) — both beats one.
  const hasHome = homeKey.length > 2 && lower.includes(homeKey);
  const hasAway = awayKey.length > 2 && lower.includes(awayKey);
  if (hasHome && hasAway) score += 12;
  else if (hasHome || hasAway) score += 4;

  // Recency — fresh replays are exactly what "watch it again" wants.
  const age = ageMsOf(item.uploadedDate ?? null, item.uploaded);
  if (age !== null) {
    const days = age / 86_400_000;
    if (days <= 2) score += 32;
    else if (days <= 7) score += 26;
    else if (days <= 30) score += 18;
    else if (days <= 180) score += 10;
    else if (days <= 730) score += 4;
  }

  // Duration — Shorts and 30-second teasers are not a replay.
  const dur = item.duration ?? 0;
  if (dur >= 1200) score += 18;
  else if (dur >= 420) score += 10;
  else if (dur >= 150) score += 4;
  else if (dur > 0 && dur < 100) score -= 14;

  // Mild popularity bonus (log scale, capped).
  if (item.views && item.views > 0) score += Math.min(8, Math.floor(Math.log10(item.views) * 2));

  return { score, kind };
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const globalForReplay = globalThis as unknown as {
  __cinedeckReplayCache?: Map<string, { videos: ReplayVideo[]; expiresAt: number }>;
};
const cache: Map<string, { videos: ReplayVideo[]; expiresAt: number }> =
  globalForReplay.__cinedeckReplayCache ?? new Map();
globalForReplay.__cinedeckReplayCache = cache;

/**
 * Ranked replay videos for one event. Both queries run under one 30-minute
 * cache; empty results are cached too (5 min) so a "nothing yet" event can be
 * retried cheaply a little later instead of hammering the Piped instances.
 */
export async function findReplays(seed: ReplaySeed): Promise<ReplayVideo[]> {
  const key = `replay:${seed.sport}|${seed.league}|${seed.home}|${seed.away}|${seed.date ?? ''}`.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.videos;

  const queries = buildQueries(seed);
  const results = await Promise.all(queries.map((q) => pipedSearch(q)));

  // Official-haystack: the league's own name token ("WRC", "Premier League"…)
  // — uploads from the league's channel are the most trustworthy replays.
  const leagueKey = nameKey(seed.league);
  const officialHay = leagueKey.length > 2 ? seed.league.toLowerCase() : '';

  const homeKey = nameKey(seed.home);
  const awayKey = nameKey(seed.away);
  const byId = new Map<string, ReplayVideo>();
  for (const items of results) {
    for (const item of items) {
      const videoId = videoIdOf(item);
      const title = (item.title ?? '').trim();
      const duration = item.duration ?? 0;
      if (!videoId || !title || duration <= 0) continue; // live teasers / broken rows
      const { score, kind } = scoreVideo(item, seed, homeKey, awayKey, officialHay);
      const prev = byId.get(videoId);
      if (!prev || prev.score < score) {
        byId.set(videoId, {
          videoId,
          title,
          channel: (item.uploaderName ?? 'YouTube').trim(),
          thumb: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          durationSec: duration,
          views: typeof item.views === 'number' && item.views > 0 ? item.views : null,
          published: item.uploadedDate?.trim() || null,
          kind,
          score,
        });
      }
    }
  }

  const videos = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  cache.set(key, { videos, expiresAt: Date.now() + (videos.length > 0 ? CACHE_TTL_MS : 5 * 60_000) });
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return videos;
}
