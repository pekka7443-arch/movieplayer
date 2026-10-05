// Ranked replay videos for one finished sports event.
// GET /api/sports/replay?sport=Rally&league=WRC&home=WRC%20Rally%20Italia%20Sardegna%20SS1&away=&date=2026-10-01
// → { videos: ReplayVideo[] }  (best first — the player autoplays videos[0])

import { findReplays } from '@/lib/server/replay';
import { apiError } from '@/lib/server/api';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sport = (searchParams.get('sport') ?? '').trim();
  const league = (searchParams.get('league') ?? '').trim();
  const home = (searchParams.get('home') ?? '').trim();
  const away = (searchParams.get('away') ?? '').trim();
  const date = (searchParams.get('date') ?? '').trim();

  if (!home) {
    return apiError(400, 'home_required');
  }

  const videos = await findReplays({ sport, league, home, away, date: date || null });
  return Response.json(
    { videos },
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}
