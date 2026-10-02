import { NextResponse } from 'next/server';
import {
  SPORTS,
  sportsEventById,
  sportsEventsAllSports,
  sportsEventsDay,
  sportsUpcomingFeatured,
  type SportsEvent,
} from '@/lib/server/thesportsdb';
import { espnEventById, espnEventsDay, espnUpcoming } from '@/lib/server/espn';

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
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const sport = searchParams.get('sport');
  if (sport && !SPORTS.includes(sport as (typeof SPORTS)[number])) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const [espn, tsdb] = await Promise.all([
    espnEventsDay(date, sport ?? undefined),
    sport ? sportsEventsDay(sport, date) : sportsEventsAllSports(date),
  ]);
  const events = mergeAndDedupe(espn, tsdb);

  return NextResponse.json({ date, sports: SPORTS, events });
}
