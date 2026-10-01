// Server-only helper for TheSportsDB's free public API (test key "3").
// CineDeck's keyless SPORTS source: live/upcoming events per sport per day +
// next events for major leagues. The free tier caps responses (~3 events per
// sport-day, 1 per league-next) but includes real statuses (NS / 1H / HT /
// FT …) and live scores — enough for a genuinely "live now" sports hub.
// Never import from client components.

import https from 'node:https';

const BASE = 'https://www.thesportsdb.com/api/v1/json/3';
const TIMEOUT_MS = 9_000;

/**
 * Same IPv4-pinned node:https fetch as tvmaze.ts — undici prefers IPv6 which
 * never falls back in this sandbox. Graceful failure everywhere.
 */
function httpsJson<T>(url: string, depth = 0): Promise<{ status: number; body: unknown } | null> {
  return new Promise((resolve) => {
    if (depth > 3) {
      resolve(null);
      return;
    }
    const req = https.get(
      url,
      {
        family: 4,
        headers: {
          accept: 'application/json',
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) CineDeck/1.0',
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          resolve(httpsJson<T>(new URL(location, url).toString(), depth + 1));
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
    req.on('timeout', () => req.destroy(new Error('sportsdb_timeout')));
    req.on('error', () => resolve(null));
  });
}

// In-memory cache (survives dev hot reloads via globalThis).
interface CacheEntry {
  value: unknown;
  expiresAt: number;
}
const globalForSports = globalThis as unknown as {
  __cinedeckSportsCache?: Map<string, CacheEntry>;
};
const cache: Map<string, CacheEntry> =
  globalForSports.__cinedeckSportsCache ?? new Map<string, CacheEntry>();
globalForSports.__cinedeckSportsCache = cache;

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SportsEvent {
  /** TheSportsDB event id — stable key for links/references. */
  id: string;
  sport: string;
  league: string;
  leagueId: string;
  leagueBadge: string | null;
  home: string;
  away: string;
  homeBadge: string | null;
  awayBadge: string | null;
  /** UTC ISO timestamp of kickoff, when known. */
  start: string | null;
  /** Raw TheSportsDB status code: NS, 1H, 2H, HT, FT, AET, AP, AB, CANC, ROT… */
  status: string;
  /** Normalized display state derived from status + kickoff time. */
  state: 'upcoming' | 'live' | 'finished' | 'unknown';
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  round: string | null;
}

/** Sports CineDeck surfaces as filter chips (TheSportsDB sport names). */
export const SPORTS = [
  'Soccer',
  'Ice Hockey',
  'Basketball',
  'American Football',
  'Baseball',
  'Motorsport',
  'Fighting',
] as const;

export type SportName = (typeof SPORTS)[number];

/** Statuses that mean the event has ended (or will never start). */
const FINISHED_STATUSES = new Set([
  'FT', 'AET', 'AP', 'MATCH FINISHED', 'FINISHED', 'AOT', 'PEN',
  'AB', 'ABD', 'SUSP', 'CANC', 'CANCELLED', 'POST', 'POSTP', 'POSTPONED', 'AWD', 'WO',
]);
/** Statuses that mean the event is in play right now. */
const LIVE_STATUSES = new Set([
  '1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'IN PLAY', 'INPLAY', 'Q1', 'Q2', 'Q3', 'Q4',
  'P1', 'P2', 'P3', 'OT', 'S1', 'S2', 'S3', 'S4', 'S5', 'DELAYED', 'RACING',
]);

function parseScore(value: unknown): number | null {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Typical live duration per sport (ms) — used when the status is empty. */
const LIVE_WINDOW_MS: Record<string, number> = {
  Soccer: 2 * 60 * 60 * 1000,
  'Ice Hockey': 3 * 60 * 60 * 1000,
  Basketball: 2.5 * 60 * 60 * 1000,
  'American Football': 3.5 * 60 * 60 * 1000,
  Baseball: 3.5 * 60 * 60 * 1000,
  Motorsport: 3 * 60 * 60 * 1000,
  Fighting: 3 * 60 * 60 * 1000,
};

function deriveState(raw: string, startIso: string | null, sport: string, now: number): SportsEvent['state'] {
  const status = raw.trim().toUpperCase();
  if (LIVE_STATUSES.has(status)) return 'live';
  if (FINISHED_STATUSES.has(status)) return 'finished';
  if (status && status !== 'NS' && status !== 'NOT STARTED' && status !== 'TBD') return 'live';
  // Empty / NS status → fall back to the clock when we know the kickoff.
  if (startIso) {
    const start = Date.parse(`${startIso}Z`);
    if (Number.isFinite(start)) {
      const window = LIVE_WINDOW_MS[sport] ?? 2.5 * 60 * 60 * 1000;
      if (now >= start && now <= start + window) return 'live';
      if (now > start + window) return 'finished';
    }
  }
  return 'upcoming';
}

interface RawEvent {
  idEvent?: string;
  strSport?: string;
  strLeague?: string;
  idLeague?: string;
  strLeagueBadge?: string | null;
  strHomeTeam?: string;
  strAwayTeam?: string;
  strHomeTeamBadge?: string | null;
  strAwayTeamBadge?: string | null;
  strTimestamp?: string | null;
  dateEvent?: string | null;
  strTime?: string | null;
  strStatus?: string | null;
  intHomeScore?: string | null;
  intAwayScore?: string | null;
  strVenue?: string | null;
  intRound?: string | null;
}

function normalizeEvent(raw: RawEvent, now: number): SportsEvent | null {
  if (!raw.idEvent || !raw.strHomeTeam || !raw.strAwayTeam) return null;
  const sport = raw.strSport ?? 'Soccer';
  // strTimestamp is UTC without a zone suffix — treat as UTC.
  const start = raw.strTimestamp ? `${raw.strTimestamp}Z` : null;
  const startIso = start && Number.isFinite(Date.parse(start)) ? raw.strTimestamp! : null;
  const status = raw.strStatus ?? '';
  return {
    id: raw.idEvent,
    sport,
    league: raw.strLeague ?? '',
    leagueId: raw.idLeague ?? '',
    leagueBadge: raw.strLeagueBadge ?? null,
    home: raw.strHomeTeam,
    away: raw.strAwayTeam,
    homeBadge: raw.strHomeTeamBadge ?? null,
    awayBadge: raw.strAwayTeamBadge ?? null,
    start: startIso ? `${startIso}Z` : null,
    status,
    state: deriveState(status, startIso ? new Date(`${startIso}Z`).toISOString() : null, sport, now),
    homeScore: parseScore(raw.intHomeScore),
    awayScore: parseScore(raw.intAwayScore),
    venue: raw.strVenue ?? null,
    round: raw.intRound ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** All events for one sport on one calendar day (YYYY-MM-DD, UTC day used by the API). */
export async function sportsEventsDay(sport: string, date: string): Promise<SportsEvent[]> {
  const key = `day:${sport}:${date}`;
  const cached = cacheGet<SportsEvent[]>(key);
  if (cached) return cached;

  const res = await httpsJson<{ events?: RawEvent[] | null }>(
    `${BASE}/eventsday.php?d=${encodeURIComponent(date)}&s=${encodeURIComponent(sport)}`,
  );
  const rows = res?.status === 200 && res.body && typeof res.body === 'object'
    ? ((res.body as { events?: RawEvent[] | null }).events ?? [])
    : [];
  const now = Date.now();
  const events = rows
    .map((r) => normalizeEvent(r, now))
    .filter((e): e is SportsEvent => e !== null);
  // Live data goes stale fast — cache finished/upcoming days longer.
  const hasLive = events.some((e) => e.state === 'live');
  cacheSet(key, events, hasLive ? 60_000 : 10 * 60_000);
  return events;
}

/** Events for EVERY supported sport on one day — parallel, partial failure ok. */
export async function sportsEventsAllSports(
  date: string,
  sports: readonly string[] = SPORTS,
): Promise<SportsEvent[]> {
  const results = await Promise.allSettled(sports.map((s) => sportsEventsDay(s, date)));
  const merged: SportsEvent[] = [];
  for (const r of results) if (r.status === 'fulfilled') merged.push(...r.value);
  // Live first, then by kickoff.
  const rank = { live: 0, upcoming: 1, unknown: 2, finished: 3 } as const;
  merged.sort((a, b) => {
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    const at = a.start ? Date.parse(a.start) : Number.MAX_SAFE_INTEGER;
    const bt = b.start ? Date.parse(b.start) : Number.MAX_SAFE_INTEGER;
    return at - bt;
  });
  return merged;
}

/** Major league ids for the Upcoming tab (free key returns 1 next event per league). */
export const FEATURED_LEAGUES: { id: string; name: string }[] = [
  { id: '4328', name: 'Premier League' },
  { id: '4480', name: 'UEFA Champions League' },
  { id: '4335', name: 'La Liga' },
  { id: '4331', name: 'Bundesliga' },
  { id: '4332', name: 'Serie A' },
  { id: '4387', name: 'NBA' },
  { id: '4380', name: 'NHL' },
  { id: '4391', name: 'NFL' },
  { id: '4424', name: 'MLB' },
  { id: '4370', name: 'Formula 1' },
];

/** One event by TheSportsDB id (deep-linkable watch pages). */
export async function sportsEventById(id: string): Promise<SportsEvent | null> {
  if (!/^\d{1,12}$/.test(id)) return null;
  const key = `event:${id}`;
  const cached = cacheGet<SportsEvent | null>(key);
  if (cached !== null) return cached;

  const res = await httpsJson<{ events?: RawEvent[] | null }>(
    `${BASE}/lookupevent.php?id=${encodeURIComponent(id)}`,
  );
  const rows = res?.status === 200 && res.body && typeof res.body === 'object'
    ? ((res.body as { events?: RawEvent[] | null }).events ?? [])
    : [];
  const event = rows.length > 0 ? normalizeEvent(rows[0]!, Date.now()) : null;
  // A finished/known event never changes again — cache longer in that case.
  cacheSet(key, event, event?.state === 'live' ? 60_000 : 10 * 60_000);
  return event;
}

/** Next event for each featured league (parallel, deduped, kickoff order). */
export async function sportsUpcomingFeatured(): Promise<SportsEvent[]> {
  const key = 'upcoming:featured';
  const cached = cacheGet<SportsEvent[]>(key);
  if (cached) return cached;

  const results = await Promise.allSettled(
    FEATURED_LEAGUES.map(async (l) => {
      const res = await httpsJson<{ events?: RawEvent[] | null }>(
        `${BASE}/eventsnextleague.php?id=${l.id}`,
      );
      const rows = res?.status === 200 && res.body && typeof res.body === 'object'
        ? ((res.body as { events?: RawEvent[] | null }).events ?? [])
        : [];
      const now = Date.now();
      return rows
        .map((r) => normalizeEvent(r, now))
        .filter((e): e is SportsEvent => e !== null);
    }),
  );
  const seen = new Set<string>();
  const merged: SportsEvent[] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const e of r.value) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      merged.push(e);
    }
  }
  merged.sort((a, b) => {
    const at = a.start ? Date.parse(a.start) : Number.MAX_SAFE_INTEGER;
    const bt = b.start ? Date.parse(b.start) : Number.MAX_SAFE_INTEGER;
    return at - bt;
  });
  cacheSet(key, merged, 15 * 60_000);
  return merged;
}
