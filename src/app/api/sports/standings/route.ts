import { espnStandings } from '@/lib/server/espn';
import { apiError } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

/** Leagues whose ESPN standings table is meaningful (team sports only). */
const STANDINGS_LEAGUES = new Set([
  'soccer/eng.1',
  'soccer/esp.1',
  'soccer/ita.1',
  'soccer/ger.1',
  'soccer/fra.1',
  'soccer/ned.1',
  'soccer/por.1',
  'soccer/usa.1',
  'soccer/mex.1',
  'soccer/uefa.champions',
  'soccer/fin.1',
  'soccer/swe.1',
  'soccer/nor.1',
  'soccer/den.1',
  'football/nfl',
  'basketball/nba',
  'basketball/wnba',
  'hockey/nhl',
  'baseball/mlb',
]);

// GET /api/sports/standings?league=soccer/eng.1 → { rows }
export async function GET(request: Request) {
  const league = (new URL(request.url).searchParams.get('league') ?? '').trim();
  if (!STANDINGS_LEAGUES.has(league)) return apiError(400, 'bad_request', 'unknown league');

  try {
    const rows = await espnStandings(league);
    return Response.json({ rows }, {
      headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' },
    });
  } catch {
    return apiError(502, 'upstream_unreachable');
  }
}
