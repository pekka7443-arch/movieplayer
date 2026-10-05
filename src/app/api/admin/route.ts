import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { guardMutation, jsonError, readJsonBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

interface TopTitle {
  tmdbId: number;
  mediaType: string;
  title: string;
  watchers: number;
}

// GET /api/admin → dashboard data. Admin role required (401 for guests,
// 403 for members without the role).
export const GET = withApi('admin', async (request) => {
  const owner = await resolveOwner(request);
  if (!owner.userId) return jsonError('unauthorized', 401);
  const user = await db.user.findUnique({
    where: { id: owner.userId },
    select: { role: true },
  });
  if (user?.role !== 'admin') return jsonError('forbidden', 403);

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [userCount, activeSessions, commentCount, pendingComments, watchlistCount, historyCount, recentUsers] =
    await Promise.all([
      db.user.count(),
      db.session.count({ where: { expiresAt: { gt: new Date() }, lastSeenAt: { gt: dayAgo } } }),
      db.comment.count({ where: { status: 'visible' } }),
      db.comment.count({ where: { status: 'flagged' } }),
      db.watchlistItem.count(),
      db.watchHistory.count(),
      db.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, email: true, name: true, role: true, createdAt: true },
      }),
    ]);

  // Top titles by number of distinct viewers in history.
  const historyRows = await db.watchHistory.findMany({
    select: { ownerId: true, tmdbId: true, mediaType: true, title: true, posterPath: true },
  });
  const byTitle = new Map<string, { tmdbId: number; mediaType: string; title: string; posterPath: string | null; viewers: Set<string> }>();
  for (const row of historyRows) {
    const key = `${row.tmdbId}:${row.mediaType}`;
    const entry =
      byTitle.get(key) ??
      { tmdbId: row.tmdbId, mediaType: row.mediaType, title: row.title, posterPath: row.posterPath, viewers: new Set<string>() };
    entry.viewers.add(row.ownerId);
    byTitle.set(key, entry);
  }
  const topTitles: TopTitle[] = [...byTitle.values()]
    .sort((a, b) => b.viewers.size - a.viewers.size)
    .slice(0, 10)
    .map((entry) => ({
      tmdbId: entry.tmdbId,
      mediaType: entry.mediaType,
      title: entry.title,
      watchers: entry.viewers.size,
    }));

  const [providerStats, flaggedComments] = await Promise.all([
    db.providerStat.findMany({ orderBy: { id: 'asc' } }),
    db.comment.findMany({
      where: { status: 'flagged' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, authorName: true, body: true, createdAt: true },
    }),
  ]);

  return Response.json({
    stats: {
      userCount,
      activeSessions,
      commentCount,
      pendingComments,
      watchlistCount,
      historyCount,
    },
    recentUsers: recentUsers.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
    })),
    topTitles,
    providerStats,
    flaggedComments: flaggedComments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
  });
});

const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('deleteComment'), id: z.string().min(1) }),
  z.object({ action: z.literal('approveComment'), id: z.string().min(1) }),
  z.object({ action: z.literal('promoteUser'), id: z.string().min(1), admin: z.boolean() }),
]);

// POST /api/admin → moderation + role actions.
export const POST = withApi('admin-post', async (request) => {
  const guard = guardMutation(request, 'account');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  if (!owner.userId) return jsonError('unauthorized', 401);
  const user = await db.user.findUnique({ where: { id: owner.userId }, select: { role: true } });
  if (user?.role !== 'admin') return jsonError('forbidden', 403);

  const body = await readJsonBody(request);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  if (parsed.data.action === 'deleteComment') {
    await db.comment.update({
      where: { id: parsed.data.id },
      data: { status: 'removed' },
    });
    return Response.json({ ok: true });
  }
  if (parsed.data.action === 'approveComment') {
    await db.comment.update({
      where: { id: parsed.data.id },
      data: { status: 'visible' },
    });
    return Response.json({ ok: true });
  }
  await db.user.update({
    where: { id: parsed.data.id },
    data: { role: parsed.data.admin ? 'admin' : 'user' },
  });
  return Response.json({ ok: true });
});
