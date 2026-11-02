import { z } from 'zod';

import { db } from '@/lib/db';
import { withApi } from '@/lib/server/api';
import { guardMutation, readJsonBody, jsonError } from '@/lib/server/http';
import { requireAuthedUser } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET  /api/social/follow → ids of everyone the caller follows
// POST /api/social/follow { userId } → toggle follow / unfollow
// ---------------------------------------------------------------------------

export const GET = withApi('social-following', async (request) => {
  const auth = await requireAuthedUser(request);
  if (!auth?.userId) return jsonError('unauthorized', 401);
  const viewerId: string = auth.userId;

  const rows = await db.follow.findMany({
    where: { followerId: viewerId },
    select: { followingId: true, createdAt: true },
  });
  return Response.json({
    following: rows.map((r) => ({ userId: r.followingId, since: r.createdAt.toISOString() })),
  });
});

const followSchema = z.object({ userId: z.string().min(1).max(64) });

export const POST = withApi('social-follow-toggle', async (request) => {
  const guard = await guardMutation(request, 'account');
  if (guard) return guard;

  const auth = await requireAuthedUser(request);
  if (!auth?.userId) return jsonError('unauthorized', 401);
  const viewerId: string = auth.userId;

  const body = await readJsonBody(request);
  const parsed = followSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  const targetId = parsed.data.userId;
  if (targetId === viewerId) return jsonError('bad_request', 400, 'cannot follow yourself');

  const target = await db.user.findFirst({
    where: { id: targetId, deletedAt: null },
    select: { id: true },
  });
  if (!target) return jsonError('not_found', 404, 'user not found');

  const existing = await db.follow.findUnique({
    where: { followerId_followingId: { followerId: viewerId, followingId: targetId } },
    select: { id: true },
  });

  if (existing) {
    await db.follow.delete({ where: { id: existing.id } });
    return Response.json({ following: false });
  }
  await db.follow.create({ data: { followerId: viewerId, followingId: targetId } });
  return Response.json({ following: true });
});
