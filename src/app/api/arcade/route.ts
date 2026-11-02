import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner, withOwnerCookies } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { guardMutation, jsonError, readJsonBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

const GAMES = ['emoji-quiz', 'year-quiz', 'daily'] as const;

/**
 * GET /api/arcade?game=emoji-quiz&period=all|today|week|month
 *   → { rows: [{ name, score, total, createdAt }], mine: { score, rank } | null }
 * Leaderboard = personal bests (one row per owner per game), so the board
 * stays readable instead of filling up with one player's retries. Rolling
 * week (7d) and month (30d) windows rank recent form; 'today' resets daily.
 */
export const GET = withApi('arcade', async (request) => {
  const { searchParams } = new URL(request.url);
  const game = searchParams.get('game') ?? '';
  const periodParam = searchParams.get('period') ?? 'all';
  const period = ['today', 'week', 'month'].includes(periodParam) ? periodParam : 'all';
  if (!GAMES.includes(game as (typeof GAMES)[number])) return jsonError('bad_request', 400, 'unknown game');

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const since =
    period === 'today'
      ? startOfDay
      : period === 'week'
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        : period === 'month'
          ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          : null;

  const rows = await db.arcadeScore.findMany({
    where: {
      game,
      ...(since ? { updatedAt: { gte: since } } : {}),
    },
    orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
    take: 10,
    select: { name: true, score: true, total: true, updatedAt: true },
  });

  const owner = await resolveOwner(request);
  const mine = await db.arcadeScore.findUnique({
    where: { ownerId_game: { ownerId: owner.ownerId, game } },
    select: { score: true },
  });

  let rank: number | null = null;
  if (mine) {
    const better = await db.arcadeScore.count({
      where: {
        game,
        score: { gt: mine.score },
        ...(since ? { updatedAt: { gte: since } } : {}),
      },
    });
    rank = better + 1;
  }

  return withOwnerCookies(
    Response.json({
      rows: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
      mine: mine ? { score: mine.score, rank } : null,
    }),
    owner,
  );
});

const postSchema = z.object({
  game: z.enum(GAMES),
  score: z.number().int().min(0).max(1000),
  total: z.number().int().min(1).max(1000).nullable().optional(),
});

/**
 * POST /api/arcade → submit a finished run. Only writes when it beats the
 * caller's existing personal best for that game (idempotent, retry-safe).
 * Works signed-in or as a guest — the owner cookie carries the identity.
 */
export const POST = withApi('arcade-post', async (request) => {
  const guard = await guardMutation(request, 'library');
  if (guard) return guard;

  const body = await readJsonBody(request);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  const owner = await resolveOwner(request);
  const existing = await db.arcadeScore.findUnique({
    where: { ownerId_game: { ownerId: owner.ownerId, game: parsed.data.game } },
    select: { score: true },
  });
  if (existing && existing.score >= parsed.data.score) {
    return withOwnerCookies(Response.json({ ok: true, best: existing.score, improved: false }), owner);
  }

  // Display name: the user's profile name (email prefix fallback) — guests
  // stay on the board as their device identity ("Guest ####").
  let name = 'Guest';
  if (owner.userId) {
    const user = await db.user.findUnique({
      where: { id: owner.userId },
      select: { name: true, email: true },
    });
    name = user?.name ?? user?.email.split('@')[0] ?? 'Player';
  } else {
    name = `Guest ${owner.ownerId.slice(-4)}`;
  }

  const row = await db.arcadeScore.upsert({
    where: { ownerId_game: { ownerId: owner.ownerId, game: parsed.data.game } },
    create: {
      ownerId: owner.ownerId,
      userId: owner.userId,
      name,
      game: parsed.data.game,
      score: parsed.data.score,
      total: parsed.data.total ?? null,
    },
    update: {
      name,
      score: parsed.data.score,
      total: parsed.data.total ?? null,
    },
  });
  return withOwnerCookies(
    Response.json({ ok: true, best: row.score, improved: true, createdAt: row.createdAt.toISOString() }),
    owner,
  );
});
