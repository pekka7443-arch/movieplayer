import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { guardMutation, jsonError, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { containsProfanity, maskProfanity } from '@/lib/profanity';

export const dynamic = 'force-dynamic';

export interface CommentEntry {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  score: number;
  reactions: { kind: string; count: number; mine: boolean }[];
  mine: boolean;
}

const REACTION_KINDS = ['like', 'love', 'funny', 'info'] as const;

// GET /api/comments?tmdbId=&mediaType= → visible comments + reaction tallies.
export const GET = withApi('comments', async (request) => {
  const { searchParams } = new URL(request.url);
  const tmdbId = Number(searchParams.get('tmdbId'));
  const mediaType = searchParams.get('mediaType') === 'tv' ? 'tv' : 'movie';
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return jsonError('bad_request', 400);
  }

  const owner = await resolveOwner(request);
  const rows = await db.comment.findMany({
    where: { tmdbId, mediaType, status: 'visible' },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { reactions: { select: { ownerId: true, kind: true } } },
  });

  const items: CommentEntry[] = rows.map((row) => {
    const tallies = new Map<string, { count: number; mine: boolean }>();
    for (const reaction of row.reactions) {
      const entry = tallies.get(reaction.kind) ?? { count: 0, mine: false };
      entry.count += 1;
      if (owner.userId && reaction.ownerId === owner.userId) entry.mine = true;
      tallies.set(reaction.kind, entry);
    }
    return {
      id: row.id,
      author: row.authorName ?? 'CineDeck member',
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      score: row.reactions.length,
      reactions: [...tallies.entries()].map(([kind, v]) => ({ kind, ...v })),
      mine: Boolean(owner.userId && row.userId === owner.userId),
    };
  });

  return Response.json({ items });
});

const postSchema = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(['movie', 'tv']),
  body: z.string().trim().min(2).max(1000),
});

// POST /api/comments → post a comment (signed-in users only; profanity is
// masked, rate limited, audit-friendly).
export const POST = withApi('comments-post', async (request) => {
  const guard = await guardMutation(request, 'comments');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  if (!owner.userId) {
    return jsonError('unauthorized', 401, 'Sign in to join the discussion.');
  }

  const body = await readJsonBody(request);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  const user = await db.user.findUnique({
    where: { id: owner.userId },
    select: { name: true, email: true },
  });
  if (!user) return jsonError('unauthorized', 401);

  const clean = maskProfanity(parsed.data.body);
  const row = await db.comment.create({
    data: {
      userId: owner.userId,
      authorName: user.name ?? user.email.split('@')[0],
      tmdbId: parsed.data.tmdbId,
      mediaType: parsed.data.mediaType,
      body: clean,
    },
  });

  return Response.json({
    item: {
      id: row.id,
      author: row.authorName ?? 'CineDeck member',
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      score: 0,
      reactions: [],
      mine: true,
    } satisfies CommentEntry,
  });
});

const mutationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('react'),
    id: z.string().min(1),
    kind: z.enum(REACTION_KINDS),
  }),
  z.object({
    action: z.literal('report'),
    id: z.string().min(1),
    reason: z.string().max(200).optional(),
  }),
  z.object({ action: z.literal('delete'), id: z.string().min(1) }),
]);

// PUT /api/comments → react / report / delete (own or admin).
export const PUT = withApi('comments-mutate', async (request) => {
  const guard = await guardMutation(request, 'reactions');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  if (!owner.userId) return jsonError('unauthorized', 401);

  const body = await readJsonBody(request);
  const parsed = mutationSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);
  const input = parsed.data;

  const comment = await db.comment.findUnique({
    where: { id: input.id },
    select: { id: true, userId: true, status: true },
  });
  if (!comment || comment.status === 'removed') return jsonError('not_found', 404);

  if (input.action === 'react') {
    const existing = await db.reaction.findUnique({
      where: { commentId_ownerId: { commentId: comment.id, ownerId: owner.userId } },
    });
    if (existing && existing.kind === input.kind) {
      await db.reaction.delete({ where: { id: existing.id } });
      return Response.json({ ok: true, reacted: false });
    }
    await db.reaction.upsert({
      where: { commentId_ownerId: { commentId: comment.id, ownerId: owner.userId } },
      create: { commentId: comment.id, ownerId: owner.userId, kind: input.kind },
      update: { kind: input.kind },
    });
    return Response.json({ ok: true, reacted: true });
  }

  if (input.action === 'report') {
    const limited = await enforceRateLimit(request, 'reports');
    if (limited) return limited;
    await db.report.create({
      data: { commentId: comment.id, ownerId: owner.userId, reason: input.reason ?? null },
    });
    // Auto-flag after community escalation — admin reviews from the dashboard.
    const reports = await db.report.count({ where: { commentId: comment.id } });
    if (reports >= 2) {
      await db.comment.update({
        where: { id: comment.id },
        data: { status: 'flagged' },
      });
    }
    return Response.json({ ok: true, reported: true });
  }

  // delete — author or admin only
  const user = await db.user.findUnique({ where: { id: owner.userId }, select: { role: true } });
  const isOwner = comment.userId === owner.userId;
  if (!isOwner && user?.role !== 'admin') return jsonError('forbidden', 403);
  await db.comment.update({ where: { id: comment.id }, data: { status: 'removed' } });
  return Response.json({ ok: true, deleted: true });
});
