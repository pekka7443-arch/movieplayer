// Server-only helper: match a sports event to the most relevant live TV
// channels AND verify they actually respond before the browser tries them.
//
// Why probing matters: iptv-org's free-to-air sports playlist contains many
// streams that are geo-blocked or offline at any given moment. Without a
// pre-check the player would burn through dead candidates one watchdog
// timeout at a time. Probing the top-ranked candidates server-side (2.5s
// cap each, fully parallel) means "Watch" starts playing something real
// within seconds — which is the whole point of the flow.
// Never import from client components.

import https from 'node:https';
import http from 'node:http';
import { sportsChannels, type SportsChannel } from '@/lib/server/iptv';

const PROBE_TIMEOUT_MS = 2_500;
/** Absolute per-probe deadline (covers DNS + connect + first bytes). */
const PROBE_DEADLINE_MS = 4_000;
/** Hard ceiling for the whole probe round — the match API must always answer fast. */
const PROBE_ROUND_DEADLINE_MS = 8_000;
const PROBE_TOP_N = 20;
const MAX_CANDIDATES = 16;
const FALLBACK_UNPROBED = 8;
const CACHE_TTL_MS = 5 * 60_000;

/** Same guard as the HLS proxy — never probe private/loopback targets. */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  if (h === '::1' || h === '[::1]') return true;
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

/**
 * Check that a stream URL answers with a real HLS playlist (or a raw .ts
 * segment stream) within the timeout. Follows up to 2 redirects. Carries an
 * absolute deadline across redirects — a probe can never outlive it.
 */
function probePlaylist(url: string, deadlineAt: number, depth = 0): Promise<boolean> {
  return new Promise((resolve) => {
    if (depth > 2 || Date.now() >= deadlineAt) {
      resolve(false);
      return;
    }
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || isPrivateHost(u.hostname)) {
      resolve(false);
      return;
    }
    const mod = u.protocol === 'https:' ? https : http;
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      resolve(ok);
    };
    const req = mod.get(
      u,
      {
        family: 4,
        headers: { accept: '*/*', 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) CineDeck/1.0' },
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          const next = new URL(location, u).toString();
          res.resume();
          settled = true;
          if (deadline) clearTimeout(deadline);
          probePlaylist(next, deadlineAt, depth + 1).then(resolve);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          finish(false);
          return;
        }
        const path = u.pathname.toLowerCase();
        const rawTs = path.endsWith('.ts') || path.endsWith('.mpegts');
        let got = '';
        res.on('data', (c: Buffer) => {
          if (settled) return;
          got += c.toString('utf8');
          // HLS playlists start with #EXTM3U (allow a BOM); raw TS streams
          // start with the MPEG-TS sync byte 0x47.
          if (got.replace(/^\uFEFF/, '').startsWith('#EXTM3U')) finish(true);
          else if (rawTs) finish(true);
          else if (got.length > 2048) finish(false);
        });
        res.on('error', () => finish(false));
        // If the server sends nothing at all, the deadline fires.
      },
    );
    req.on('timeout', () => req.destroy(new Error('probe_timeout')));
    req.on('error', () => finish(false));
    deadline = setTimeout(() => {
      req.destroy();
      finish(false);
    }, Math.max(250, deadlineAt - Date.now()));
  });
}

// ---------------------------------------------------------------------------
// Relevance ranking
// ---------------------------------------------------------------------------

/** Channel-name keywords per sport (lowercased substring matches). */
const SPORT_KEYWORDS: Record<string, string[]> = {
  Soccer: ['soccer', 'football', 'fifa', 'uefa', 'premier', 'laliga', 'bundesliga', 'serie', 'ligue', 'mls', 'bein', 'calcio', 'futbol'],
  'Ice Hockey': ['hockey', 'nhl', 'shl', 'liiga', 'khl', 'ice'],
  Basketball: ['basketball', 'nba', 'euroleague', 'fiba', 'wnba'],
  'American Football': ['nfl', 'football', 'gridiron', 'cbs sports', 'fox sports', 'espn'],
  Baseball: ['baseball', 'mlb'],
  Motorsport: ['f1', 'formula', 'motorsport', 'motor', 'racing', 'nascar', 'motogp', 'eurosport', 'speed'],
  Fighting: ['fight', 'ufc', 'wwe', 'boxing', 'mma', 'wrestling'],
};

function tokensOf(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

export interface EventSeed {
  sport: string;
  league: string;
  home: string;
  away: string;
}

/** Sort channels by relevance to the event — strongest match first. */
export function rankChannelsForEvent(event: EventSeed, channels: SportsChannel[]): SportsChannel[] {
  const teamTokens = new Set([...tokensOf(event.home), ...tokensOf(event.away)]);
  const leagueTokens = new Set(tokensOf(event.league));
  const keywords = SPORT_KEYWORDS[event.sport] ?? [];

  const scored = channels.map((c) => {
    const hay = `${c.name} ${c.group}`.toLowerCase();
    let score = 0;
    for (const t of teamTokens) if (hay.includes(t)) score += 4;
    for (const t of leagueTokens) if (hay.includes(t)) score += 3;
    for (const k of keywords) if (hay.includes(k)) score += 1;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.c);
}

// ---------------------------------------------------------------------------
// Match + probe, cached per event
// ---------------------------------------------------------------------------

const globalForMatch = globalThis as unknown as {
  __cinedeckSportsMatchCache?: Map<string, { candidates: SportsChannel[]; expiresAt: number }>;
};
const matchCache: Map<string, { candidates: SportsChannel[]; expiresAt: number }> =
  globalForMatch.__cinedeckSportsMatchCache ?? new Map();
globalForMatch.__cinedeckSportsMatchCache = matchCache;

function cacheKey(event: EventSeed): string {
  return `${event.sport}|${event.league}|${event.home}|${event.away}`.toLowerCase();
}

/**
 * Ranked, probed live channels for an event. The returned order is exactly
 * what the player should try: probed-OK first (relevance order), then a
 * small unprobed tail as a safety net (the client watchdog skips dead ones).
 * Returns null when the channel list itself is unavailable.
 *
 * The probe round runs under a hard race deadline: if probing stalls (hung
 * sockets, slow DNS…), the API still answers within a few seconds with the
 * top-ranked unprobed channels and lets the player's watchdog sort them out.
 */
export async function matchChannelsForEvent(event: EventSeed): Promise<SportsChannel[] | null> {
  const key = cacheKey(event);
  const cached = matchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.candidates;

  const all = await sportsChannels();
  if (!all) return null;

  const ranked = rankChannelsForEvent(event, all);
  const top = ranked.slice(0, PROBE_TOP_N);
  const deadlineAt = Date.now() + PROBE_DEADLINE_MS;

  let roundTimer: ReturnType<typeof setTimeout> | undefined;
  const probed = await Promise.race([
    Promise.all(top.map(async (c) => ({ c, ok: await probePlaylist(c.url, deadlineAt) }))),
    new Promise<null>((resolve) => {
      roundTimer = setTimeout(() => resolve(null), PROBE_ROUND_DEADLINE_MS);
    }),
  ]).finally(() => {
    if (roundTimer) clearTimeout(roundTimer);
  });

  let candidates: SportsChannel[];
  if (!probed) {
    // Probe round blew the deadline — ship the top-ranked feeds unprobed.
    candidates = ranked.slice(0, FALLBACK_UNPROBED);
  } else {
    const alive = probed.filter((p) => p.ok).map((p) => p.c).slice(0, MAX_CANDIDATES);
    if (alive.length >= 3) {
      candidates = alive;
    } else {
      // Almost nothing responded (maybe a network blip) — fall back to the
      // top-ranked channels unprobed and let the player's watchdog decide.
      const aliveUrls = new Set(alive.map((c) => c.url));
      const tail = ranked.filter((c) => !aliveUrls.has(c.url)).slice(0, FALLBACK_UNPROBED);
      candidates = [...alive, ...tail];
    }
  }

  if (matchCache.size > 120) {
    const oldest = matchCache.keys().next().value;
    if (oldest) matchCache.delete(oldest);
  }
  matchCache.set(key, { candidates, expiresAt: Date.now() + CACHE_TTL_MS });
  return candidates;
}
