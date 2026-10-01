import { NextResponse } from 'next/server';
import {
  SPORTS,
  sportsEventsAllSports,
  sportsEventsDay,
  sportsUpcomingFeatured,
} from '@/lib/server/thesportsdb';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/sports/events?date=YYYY-MM-DD&sport=Soccer
 *   → { date, sports: string[], events: SportsEvent[] }  (sport omitted = all)
 * GET /api/sports/events?upcoming=1
 *   → { upcoming: SportsEvent[] }  (next featured-league fixtures)
 *
 * Keyless — powered by TheSportsDB's free public API (test key 3).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get('upcoming')) {
    const upcoming = await sportsUpcomingFeatured();
    return NextResponse.json({ upcoming });
  }

  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const sport = searchParams.get('sport');
  if (sport && !SPORTS.includes(sport as (typeof SPORTS)[number])) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const events = sport
    ? await sportsEventsDay(sport, date)
    : await sportsEventsAllSports(date);

  return NextResponse.json({ date, sports: SPORTS, events });
}
