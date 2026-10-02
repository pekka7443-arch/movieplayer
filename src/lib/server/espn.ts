// Server-only helper for ESPN's public site API (site.api.espn.com) — a
// KEYLESS scoreboard source with the full day's slate for every major league.
// TheSportsDB's free tier caps responses (~3 events per sport-day), so ESPN
// is the primary schedule source: Europa League alone lists 18 events on a
// matchday where TheSportsDB shows 3. Never import from client components.
//
// Endpoints used (no key, generous CORS/limits):
//   /apis/site/v2/sports/{path}/scoreboard          → full day slate
//   /apis/site/v2/sports/{path}/scoreboard?dates=YYYYMMDD → any day
//   /apis/site/v2/sports/{path}/summary?event=<id>  → single event (deep links)

import https from 'node:https';
import type { SportsEvent } from '@/lib/server/thesportsdb';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const TIMEOUT_MS = 8_000;

function httpsJson<T>(url: string, depth = 0): Promise<T | null> {
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
          httpsJson<T>(new URL(location, url).toString(), depth + 1).then(resolve);
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
    req.on('timeout', () => req?.destroy(new Error('espn_timeout')));
    req.on('error', () => finish(null));
    // Absolute deadline for the whole request (DNS + connect + body).
    deadline = setTimeout(() => {
      req?.destroy();
      finish(null);
    }, TIMEOUT_MS);
  });
}

// ---------------------------------------------------------------------------
// League catalog — path (ESPN) + sport (CineDeck chip names)
// ---------------------------------------------------------------------------

export interface EspnLeague {
  path: string;
  sport: string;
}

export const ESPN_LEAGUES: EspnLeague[] = [
  // Soccer — top 5 + Europe + North America + Nordics (incl. Veikkausliiga)
  { path: 'soccer/eng.1', sport: 'Soccer' },
  { path: 'soccer/esp.1', sport: 'Soccer' },
  { path: 'soccer/ita.1', sport: 'Soccer' },
  { path: 'soccer/ger.1', sport: 'Soccer' },
  { path: 'soccer/fra.1', sport: 'Soccer' },
  { path: 'soccer/ned.1', sport: 'Soccer' },
  { path: 'soccer/por.1', sport: 'Soccer' },
  { path: 'soccer/usa.1', sport: 'Soccer' },
  { path: 'soccer/mex.1', sport: 'Soccer' },
  { path: 'soccer/uefa.champions', sport: 'Soccer' },
  { path: 'soccer/uefa.europa', sport: 'Soccer' },
  { path: 'soccer/uefa.europa.conf', sport: 'Soccer' },
  { path: 'soccer/fin.1', sport: 'Soccer' },
  { path: 'soccer/swe.1', sport: 'Soccer' },
  { path: 'soccer/nor.1', sport: 'Soccer' },
  { path: 'soccer/den.1', sport: 'Soccer' },
  // US majors
  { path: 'football/nfl', sport: 'American Football' },
  { path: 'football/college-football', sport: 'American Football' },
  { path: 'basketball/nba', sport: 'Basketball' },
  { path: 'basketball/wnba', sport: 'Basketball' },
  { path: 'basketball/mens-college-basketball', sport: 'Basketball' },
  { path: 'hockey/nhl', sport: 'Ice Hockey' },
  { path: 'baseball/mlb', sport: 'Baseball' },
  // Individual
  { path: 'mma/ufc', sport: 'Fighting' },
  { path: 'racing/f1', sport: 'Motorsport' },
];

/** Leagues queried for the Upcoming tab (next matchday slates). */
const UPCOMING_PATHS = [
  'soccer/eng.1',
  'soccer/esp.1',
  'soccer/ita.1',
  'soccer/ger.1',
  'soccer/fra.1',
  'soccer/usa.1',
  'soccer/mex.1',
  'soccer/uefa.champions',
  'soccer/uefa.europa',
  'soccer/uefa.europa.conf',
  'soccer/fin.1',
  'football/nfl',
  'football/college-football',
  'basketball/nba',
  'hockey/nhl',
  'baseball/mlb',
];

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

interface EspnCompetitor {
  homeAway?: string;
  score?: string | number;
  team?: { displayName?: string; logo?: string };
}

interface EspnEvent {
  id?: string;
  name?: string;
  date?: string;
  status?: {
    displayClock?: string;
    period?: number;
    type?: { state?: string; shortDetail?: string; description?: string };
  };
  competitions?: {
    venue?: { fullName?: string };
    competitors?: EspnCompetitor[];
  }[];
}

interface EspnScoreboard {
  leagues?: { id?: string; name?: string; logos?: { href?: string }[] }[];
  events?: EspnEvent[];
}

function parseScore(value: string | number | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeEspnEvent(ev: EspnEvent, league: EspnLeague, meta: { name: string; badge: string | null }, now: number): SportsEvent | null {
  if (!ev.id) return null;
  const comp = ev.competitions?.[0];
  const homeComp = comp?.competitors?.find((c) => c.homeAway === 'home');
  const awayComp = comp?.competitors?.find((c) => c.homeAway === 'away');
  // Racing events (F1 GP) have no team competitors — the event NAME is the
  // title ("Gulf Air Bahrain Grand Prix"). Keep them as team-less events:
  // home = title, away = empty string.
  const home = homeComp?.team?.displayName ?? ev.name?.trim() ?? '';
  const away = awayComp?.team?.displayName ?? '';
  if (!home) return null;

  const stateRaw = ev.status?.type?.state;
  const state: SportsEvent['state'] =
    stateRaw === 'in' ? 'live' : stateRaw === 'post' ? 'finished' : 'upcoming';
  // Live: shortDetail reads best ("34'", "8:12 3rd", "Top 8th"); finished rows
  // render as the plain FT badge, upcoming shows the kickoff clock.
  const status =
    state === 'live'
      ? (ev.status?.type?.shortDetail || ev.status?.displayClock || 'LIVE')
      : state === 'finished'
        ? 'FT'
        : 'NS';

  const start = ev.date && Number.isFinite(Date.parse(ev.date)) ? ev.date : null;

  return {
    id: `espn-${league.path.replace('/', '_')}-${ev.id}`,
    sport: league.sport,
    league: meta.name,
    leagueId: league.path,
    leagueBadge: meta.badge,
    home,
    away,
    homeBadge: homeComp?.team?.logo ?? null,
    awayBadge: awayComp?.team?.logo ?? null,
    start,
    status,
    state,
    homeScore: parseScore(homeComp?.score),
    awayScore: parseScore(awayComp?.score),
    venue: comp?.venue?.fullName ?? null,
    round: null,
  };
}

function sortEvents(events: SportsEvent[]): SportsEvent[] {
  const rank = { live: 0, upcoming: 1, unknown: 2, finished: 3 } as const;
  return [...events].sort((a, b) => {
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    const at = a.start ? Date.parse(a.start) : Number.MAX_SAFE_INTEGER;
    const bt = b.start ? Date.parse(b.start) : Number.MAX_SAFE_INTEGER;
    return at - bt;
  });
}

// ---------------------------------------------------------------------------
// Cache (same pattern as thesportsdb.ts — survives dev hot reloads)
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}
const globalForEspn = globalThis as unknown as {
  __cinedeckEspnCache?: Map<string, CacheEntry>;
};
const cache: Map<string, CacheEntry> = globalForEspn.__cinedeckEspnCache ?? new Map();
globalForEspn.__cinedeckEspnCache = cache;

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
// Public API
// ---------------------------------------------------------------------------

/** One league's slate for one calendar day (YYYY-MM-DD). */
async function espnLeagueDay(league: EspnLeague, date: string): Promise<SportsEvent[]> {
  const key = `espn-day:${league.path}:${date}`;
  const cached = cacheGet<SportsEvent[]>(key);
  if (cached) return cached;

  const ymd = date.replace(/-/g, '');
  const board = await httpsJson<EspnScoreboard>(`${BASE}/${league.path}/scoreboard?dates=${ymd}`);
  const events = parseBoard(board, league);
  cacheSet(key, events, events.some((e) => e.state === 'live') ? 60_000 : 10 * 60_000);
  return events;
}

/**
 * A league's CURRENT/NEXT MATCHDAY slate (default scoreboard, no dates
 * filter). ESPN widens the window to the ongoing or upcoming round — exactly
 * what the Upcoming tab wants: real fixtures for the next matchday, however
 * far out it is.
 */
async function espnLeagueNext(league: EspnLeague): Promise<SportsEvent[]> {
  const key = `espn-next:${league.path}`;
  const cached = cacheGet<SportsEvent[]>(key);
  if (cached) return cached;

  const board = await httpsJson<EspnScoreboard>(`${BASE}/${league.path}/scoreboard`);
  const events = parseBoard(board, league);
  cacheSet(key, events, 15 * 60_000);
  return events;
}

function parseBoard(board: EspnScoreboard | null, league: EspnLeague): SportsEvent[] {
  const leagueMeta = {
    name: board?.leagues?.[0]?.name ?? league.path,
    badge: board?.leagues?.[0]?.logos?.[0]?.href ?? null,
  };
  const now = Date.now();
  return (board?.events ?? [])
    .map((e) => normalizeEspnEvent(e, league, leagueMeta, now))
    .filter((e): e is SportsEvent => e !== null);
}

/** Every ESPN league's slate for one day — parallel, partial failure OK. */
export async function espnEventsDay(date: string, sport?: string): Promise<SportsEvent[]> {
  const key = `espn-all:${date}:${sport ?? 'all'}`;
  const cached = cacheGet<SportsEvent[]>(key);
  if (cached) return cached;

  const leagues = sport ? ESPN_LEAGUES.filter((l) => l.sport === sport) : ESPN_LEAGUES;
  const results = await Promise.allSettled(leagues.map((l) => espnLeagueDay(l, date)));
  const merged: SportsEvent[] = [];
  for (const r of results) if (r.status === 'fulfilled') merged.push(...r.value);
  const sorted = sortEvents(merged);
  cacheSet(key, sorted, 30_000);
  return sorted;
}

/** Upcoming fixtures — next matchday per featured league, kickoff order. */
export async function espnUpcoming(): Promise<SportsEvent[]> {
  const key = 'espn-upcoming';
  const cached = cacheGet<SportsEvent[]>(key);
  if (cached) return cached;

  const leagues = ESPN_LEAGUES.filter((l) => UPCOMING_PATHS.includes(l.path));
  const results = await Promise.allSettled(leagues.map((l) => espnLeagueNext(l)));
  // Fair per-league share (earliest 4 each): otherwise NFL/NCAA slates of 16+
  // crowd out every other competition and the tab turns single-sport.
  const perLeague = new Map<string, SportsEvent[]>();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const e of r.value) {
      if (e.state !== 'upcoming') continue;
      const list = perLeague.get(e.leagueId);
      if (list) list.push(e);
      else perLeague.set(e.leagueId, [e]);
    }
  }
  const merged: SportsEvent[] = [];
  const seen = new Set<string>();
  for (const list of perLeague.values()) {
    for (const e of sortEvents(list).slice(0, 4)) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      merged.push(e);
    }
  }
  const sorted = sortEvents(merged);
  cacheSet(key, sorted, 15 * 60_000);
  return sorted;
}

/** One ESPN event by CineDeck id (`espn-<path>_<slug>-<eventId>`) — deep links. */
export async function espnEventById(id: string): Promise<SportsEvent | null> {
  if (!id.startsWith('espn-')) return null;
  const rest = id.slice(5);
  const dash = rest.lastIndexOf('-');
  if (dash <= 0) return null;
  const path = rest.slice(0, dash).replace('_', '/');
  const eventId = rest.slice(dash + 1);
  if (!/^\d{5,12}$/.test(eventId) || !/^[a-z]+\/[a-z0-9.-]+$/.test(path)) return null;

  const key = `espn-event:${id}`;
  const cached = cacheGet<SportsEvent | null>(key);
  if (cached !== null) return cached;

  const league = ESPN_LEAGUES.find((l) => l.path === path) ?? { path, sport: 'Soccer' };
  const summary = await httpsJson<{
    header?: {
      league?: { name?: string; logos?: { href?: string }[] };
      competitions?: {
        date?: string;
        status?: EspnEvent['status'];
        competitors?: EspnCompetitor[];
      }[];
    };
    gameInfo?: { venue?: { fullName?: string } };
  }>(`${BASE}/${path}/summary?event=${eventId}`);

  const headerComp = summary?.header?.competitions?.[0];
  const event: SportsEvent | null = normalizeEspnEvent(
    {
      id: eventId,
      date: headerComp?.date,
      status: headerComp?.status,
      competitions: [{ competitors: headerComp?.competitors, venue: summary?.gameInfo?.venue }],
    },
    league,
    {
      name: summary?.header?.league?.name ?? path,
      badge: summary?.header?.league?.logos?.[0]?.href ?? null,
    },
    Date.now(),
  );
  cacheSet(key, event, event?.state === 'live' ? 60_000 : 10 * 60_000);
  return event;
}
