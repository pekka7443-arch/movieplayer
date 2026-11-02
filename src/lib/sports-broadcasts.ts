// Curated "where to watch" layer for Live Sports — Finland region.
//
// The schedule (TheSportsDB + ESPN) tells us WHAT is playing; this module maps
// each league to the streaming services that actually carry it in Finland, so
// the UI can point people at the official home of a broadcast instead of (or
// ahead of) the free-channel fallbacks.
//
// Hand-curated for the 2025–26 season from the services' own pages:
//   mtv.fi/urheilu, mtv.fi/ohjelmat/liiga (Liiga, Mestarien liiga, La Liga,
//   Serie A, WRC), hbomax.com/fi/fi/sports (Eurosport: NBA, tennis, snooker,
//   IIHF World Championship), viaplay.fi (NHL, Valioliiga, Bundesliga, F1),
//   ruutu.fi (Veikkausliiga), areena.yle.fi (free MM-kisat/maajoukkueet),
//   veikkaus.fi → VeikkausTV (free selected games). All URLs probed 200 (or
//   bot-shielded-but-real for viaplay.fi / veikkaus.fi).
// Rights move between seasons — the UI carries a "confirm the exact game"
// disclaimer alongside these badges.
//
// Pure data + regex — no node/network imports, safe in client components.

export type ServiceKind = 'subscription' | 'free';

export interface StreamingService {
  id: string;
  name: string;
  /** Compact label for row-level pills. */
  shortName: string;
  /** Tiny brand mark shown inside the colored chip. */
  monogram: string;
  /** Brand-ish accent for the monogram chip / pill dot (UI hint, not official). */
  color: string;
  kind: ServiceKind;
  /** Service entry point opened by the buttons. */
  url: string;
  /** Leagues the service is known for (proper nouns — language-neutral). */
  coverage: string[];
}

export const STREAMING_SERVICES: StreamingService[] = [
  {
    id: 'mtv',
    name: 'MTV Katsomo (mtv+)',
    shortName: 'mtv+',
    monogram: 'mtv',
    color: '#e42022',
    kind: 'subscription',
    url: 'https://www.mtv.fi/urheilu',
    coverage: ['Liiga', 'Champions League', 'La Liga', 'Serie A', 'WRC rally', 'Athletics'],
  },
  {
    id: 'hbomax',
    name: 'HBO Max',
    shortName: 'Max',
    monogram: 'Max',
    color: '#991eeb',
    kind: 'subscription',
    url: 'https://www.hbomax.com/fi/fi/sports',
    coverage: ['NBA', 'Tennis', 'Snooker', 'IIHF Worlds', 'Cycling', 'Winter sports'],
  },
  {
    id: 'viaplay',
    name: 'Viaplay',
    shortName: 'Viaplay',
    monogram: 'V',
    color: '#ec0c40',
    kind: 'subscription',
    url: 'https://viaplay.fi',
    coverage: ['NHL', 'Premier League', 'Bundesliga', 'Formula 1'],
  },
  {
    id: 'ruutu',
    name: 'Ruutu+',
    shortName: 'Ruutu+',
    monogram: 'R+',
    color: '#1d4ed8',
    kind: 'subscription',
    url: 'https://www.ruutu.fi',
    coverage: ['Veikkausliiga'],
  },
  {
    id: 'yle',
    name: 'Yle Areena',
    shortName: 'Yle',
    monogram: 'Yle',
    color: '#007fb0',
    kind: 'free',
    url: 'https://areena.yle.fi',
    coverage: ['IIHF Worlds', 'National teams', 'Athletics'],
  },
  {
    id: 'veikkaustv',
    name: 'VeikkausTV',
    shortName: 'VeikkausTV',
    monogram: 'VT',
    color: '#00914c',
    kind: 'free',
    url: 'https://www.veikkaus.fi/fi/edut-ja-arvonnat/etu/veikkaustv',
    coverage: ['Veikkausliiga', 'Selected games'],
  },
];

export function serviceById(id: string): StreamingService | undefined {
  return STREAMING_SERVICES.find((s) => s.id === id);
}

// ---------------------------------------------------------------------------
// League → service matching
// ---------------------------------------------------------------------------

interface MatchRule {
  serviceId: string;
  /** TheSportsDB sport names this rule applies to (empty = any). */
  sports: readonly string[];
  re: RegExp;
  /** League-specific landing page when we have one, else the service home. */
  url?: string;
  /** Lower sorts earlier in the UI (primary service first). */
  prio: number;
}

/**
 * Notes on the trickier patterns:
 *  - `liiga` must not match "Veikkausliiga" (football) → preceded-by-non-letter
 *    check; "Finnish Liiga" / "SM-liiga" both match, sport gate does the rest.
 *  - Premier/Bundesliga/La Liga/Serie A are anchored (^…$) because TheSportsDB
 *    carries many national "X Premier League"-style names that nobody shows on
 *    these services in Finland.
 */
const RULES: MatchRule[] = [
  // MTV Katsomo (mtv+)
  { serviceId: 'mtv', sports: ['Ice Hockey'], re: /(^|[^a-z])liiga\b/i, url: 'https://www.mtv.fi/ohjelmat/liiga', prio: 1 },
  { serviceId: 'mtv', sports: ['Soccer'], re: /uefa champions league|mestarien liiga/i, prio: 1 },
  { serviceId: 'mtv', sports: ['Soccer'], re: /^spanish la liga$|^la liga$|laliga/i, prio: 1 },
  { serviceId: 'mtv', sports: ['Soccer'], re: /^italian serie a$|^serie a$/i, prio: 1 },
  { serviceId: 'mtv', sports: ['Rally', 'Motorsport'], re: /wrc|rally|rallycross|\berc\b/i, prio: 1 },
  // HBO Max (Eurosport content)
  { serviceId: 'hbomax', sports: ['Basketball'], re: /\bnba\b|national basketball/i, prio: 1 },
  { serviceId: 'hbomax', sports: ['Ice Hockey'], re: /iihf|world championship|maailmanmestaru/i, prio: 2 },
  // Viaplay
  { serviceId: 'viaplay', sports: ['Ice Hockey'], re: /\bnhl\b|national hockey/i, prio: 1 },
  // MTV shares the NHL window (selostetut sunnuntai- ja prime time -pelit).
  { serviceId: 'mtv', sports: ['Ice Hockey'], re: /\bnhl\b|national hockey/i, prio: 2 },
  { serviceId: 'viaplay', sports: ['Soccer'], re: /^english premier league$|^premier league$|valioliiga/i, prio: 1 },
  { serviceId: 'viaplay', sports: ['Soccer'], re: /^german bundesliga$|^bundesliga$/i, prio: 1 },
  { serviceId: 'viaplay', sports: ['Motorsport'], re: /formula (1|one)|\bf1\b/i, prio: 1 },
  // Ruutu+
  { serviceId: 'ruutu', sports: ['Soccer'], re: /veikkausliiga/i, prio: 1 },
  // Yle Areena (free)
  { serviceId: 'yle', sports: ['Ice Hockey'], re: /iihf|world championship|maailmanmestaru/i, prio: 1 },
  // VeikkausTV (free with a Veikkaus account)
  { serviceId: 'veikkaustv', sports: ['Soccer'], re: /veikkausliiga/i, prio: 2 },
];

export interface ServiceBroadcast {
  serviceId: string;
  /** League-specific landing page when available, else the service home. */
  url: string;
}

/**
 * Streaming services that carry this league in Finland, best match first.
 * Never throws and never fetches — a missed mapping simply yields [] and the
 * UI falls back to the existing free-channel / stream-finder links.
 */
export function broadcastsForEvent(seed: { sport: string; league: string }): ServiceBroadcast[] {
  const league = (seed.league ?? '').trim();
  if (!league) return [];
  const sport = seed.sport ?? '';
  const hits: (ServiceBroadcast & { prio: number })[] = [];
  for (const rule of RULES) {
    if (rule.sports.length > 0 && !rule.sports.includes(sport)) continue;
    if (!rule.re.test(league)) continue;
    if (hits.some((h) => h.serviceId === rule.serviceId)) continue;
    const svc = serviceById(rule.serviceId);
    if (!svc) continue;
    hits.push({ serviceId: rule.serviceId, url: rule.url ?? svc.url, prio: rule.prio });
  }
  hits.sort((a, b) => a.prio - b.prio);
  return hits.map(({ serviceId, url }) => ({ serviceId, url }));
}
