import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

interface Achievement {
  key: string;
  title: string;
  hint: string;
  earned: boolean;
  progress: number;
  goal: number;
}

// GET /api/achievements → server-computed badges (watch counts, streaks,
// ratings, lists). Works for guests too (device-scoped data).
export const GET = withApi('achievements', async (request) => {
  const owner = await resolveOwner(request);

  const [history, ratings, listCount] = await Promise.all([
    db.watchHistory.findMany({
      where: { ownerId: owner.ownerId },
      select: { updatedAt: true, mediaType: true, positionSeconds: true, durationSeconds: true },
      take: 1000,
      orderBy: { updatedAt: 'desc' },
    }),
    db.rating.findMany({
      where: { ownerId: owner.ownerId },
      select: { score: true, watched: true },
      take: 1000,
    }),
    db.list.count({ where: { ownerId: owner.ownerId } }),
  ]);

  const movies = history.filter((h) => h.mediaType === 'movie').length;
  const seconds = history.reduce(
    (sum, h) => sum + Math.min(h.positionSeconds, h.durationSeconds ?? h.positionSeconds),
    0,
  );
  const hours = Math.round(seconds / 3600);

  const days = new Set(history.map((h) => h.updatedAt.toISOString().slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
  for (let guard = 0; guard < 400; guard += 1) {
    const iso = cursor.toISOString().slice(0, 10);
    if (!days.has(iso)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const rated = ratings.filter((r) => r.score != null).length;
  const watched = ratings.filter((r) => r.watched).length;

  const achievements: Achievement[] = [
    { key: 'first-play', title: 'First play', hint: 'Open any title', earned: history.length >= 1, progress: Math.min(history.length, 1), goal: 1 },
    { key: 'ten-movies', title: '10 movies', hint: `${movies}/10 movies watched`, earned: movies >= 10, progress: Math.min(movies, 10), goal: 10 },
    { key: 'streak-7', title: '7-day streak', hint: `${streak}/7 days in a row`, earned: streak >= 7, progress: Math.min(streak, 7), goal: 7 },
    { key: 'critic', title: 'Critic', hint: `${rated}/10 titles rated`, earned: rated >= 10, progress: Math.min(rated, 10), goal: 10 },
    { key: 'curator', title: 'Curator', hint: `${listCount}/3 custom lists`, earned: listCount >= 3, progress: Math.min(listCount, 3), goal: 3 },
    { key: 'marathon', title: 'Marathon', hint: `${hours}/10 hours watched`, earned: hours >= 10, progress: Math.min(hours, 10), goal: 10 },
    { key: 'binge', title: 'Binger', hint: `${Math.min(history.filter((h) => h.mediaType === 'tv').length, 25)}/25 episodes opened`, earned: history.filter((h) => h.mediaType === 'tv').length >= 25, progress: Math.min(history.filter((h) => h.mediaType === 'tv').length, 25), goal: 25 },
    { key: 'collector', title: 'Collector', hint: `${watched}/25 marked watched`, earned: watched >= 25, progress: Math.min(watched, 25), goal: 25 },
  ];

  return Response.json({ achievements });
});
