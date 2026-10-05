import { NextResponse } from 'next/server';
import {
  SPORTS,
  isRallyEvent,
  sportsEventById,
  sportsEventsAllSports,
  sportsEventsDay,
  sportsUpcomingFeatured,
  type SportsEvent,
} from '@/lib/server/thesportsdb';
import { espnEventById, espnEventsDay, espnUpcoming } from '@/lib/server/espn';
import { apiError } from '@/lib/server/api';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lowercase alphanumeric team name — the dedupe comparison key. */
function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Merge ESPN + TheSportsDB schedules, dropping the same fixture listed twice
 * (same normalized teams, kickoff within 4 h). ESPN rows come first, so they
 * win: they carry live clocks, logos and venue more reliably.
 */
function mergeAndDedupe(primary: SportsEvent[], secondary: SportsEvent[]): SportsEvent[] {
  const seen = new Set<string>();
  const out: SportsEvent[] = [];
  for (const e of [...primary, ...secondary]) {
    const softKey = `${nameKey(e.home)}|${nameKey(e.away)}|${e.start ? Math.floor(Date.parse(e.start) / (4 * 60 * 60 * 1000)) : 'tbd'}`;
    if (seen.has(e.id) || seen.has(softKey)) continue;
    seen.add(e.id);
    seen.add(softKey);
    out.push(e);
  }
  return out;
}

/**
 * TheSportsDB has no "Rally" sport — its WRC/ERC rows arrive inside the
 * Motorsport day list (tagged 'Rally' by the normalizer). Chip filtering:
 *   Rally      → Motorsport list, rally leagues only
 *   Motorsport → Motorsport list, rally leagues excluded (circuit racing)
 *   others     → straight pass-through
 */
async function tsdbEventsForChip(sport: string | null, date: string): Promise<SportsEvent[]> {
  if (sport === 'Rally') {
    const list = await sportsEventsDay('Motorsport', date);
    return list.filter(isRallyEvent);
  }
  if (sport === 'Motorsport') {
    const list = await sportsEventsDay('Motorsport', date);
    return list.filter((e) => !isRallyEvent(e));
  }
  return sport ? sportsEventsDay(sport, date) : sportsEventsAllSports(date);
}

/**
 * GET /api/sports/events?id=<eventId>
 *   → { event: SportsEvent | null }  (TheSportsDB numeric ids + ESPN ids)
 * GET /api/sports/events?date=YYYY-MM-DD&sport=Soccer
 *   → { date, sports: string[], events: SportsEvent[] }  (sport omitted = all)
 * GET /api/sports/events?upcoming=1
 *   → { upcoming: SportsEvent[] }
 *
 * Keyless — ESPN's public site API (full day slates) merged with TheSportsDB's
 * free API (wider sports coverage as a safety net).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get('upcoming')) {
    const [espn, tsdb] = await Promise.all([espnUpcoming(), sportsUpcomingFeatured()]);
    const upcoming = mergeAndDedupe(espn, tsdb).filter((e) => e.state === 'upcoming');
    return NextResponse.json({ upcoming });
  }

  const id = searchParams.get('id');
  if (id) {
    const event = id.startsWith('espn-') ? await espnEventById(id) : await sportsEventById(id);
    return NextResponse.json(
      { event },
      { headers: { 'cache-control': event ? 'public, max-age=30' : 'no-store' } },
    );
  }

  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(date)) {
    return apiError(400, 'bad_request');
  }

  const sport = searchParams.get('sport');
  if (sport && !SPORTS.includes(sport as (typeof SPORTS)[number])) {
    return apiError(400, 'bad_request');
  }

  const [espn, tsdb] = await Promise.all([
    // ESPN covers no rally series — skip the network entirely for that chip.
    sport === 'Rally'
      ? Promise.resolve([] as SportsEvent[])
      : espnEventsDay(date, sport ?? undefined),
    tsdbEventsForChip(sport ?? null, date),
  ]);
  const events = mergeAndDedupe(espn, tsdb);

  return NextResponse.json({ date, sports: SPORTS, events });
}
