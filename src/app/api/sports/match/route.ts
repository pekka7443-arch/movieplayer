// Ranked + probed live-stream candidates for one sports event.
// GET /api/sports/match?sport=Soccer&league=English%20Premier%20League&home=Arsenal&away=Chelsea
// → { candidates: SportsChannel[] }  (best candidate first — the sports
// player auto-plays candidates[0] and watchdogs through the rest.)

import { matchChannelsForEvent } from '@/lib/server/sports-match';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sport = (searchParams.get('sport') ?? '').trim();
  const league = (searchParams.get('league') ?? '').trim();
  const home = (searchParams.get('home') ?? '').trim();
  const away = (searchParams.get('away') ?? '').trim();

  if (!sport || !home || !away) {
    return Response.json({ error: 'sport_home_away_required' }, { status: 400 });
  }

  const candidates = await matchChannelsForEvent({ sport, league, home, away });
  if (candidates === null) {
    return Response.json({ error: 'channels_unreachable' }, { status: 502 });
  }

  return Response.json(
    { candidates },
    { headers: { 'cache-control': 'no-store' } },
  );
}
