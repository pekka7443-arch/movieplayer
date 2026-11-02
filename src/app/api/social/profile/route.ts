import { z } from 'zod';

import { db } from '@/lib/db';
import { withApi } from '@/lib/server/api';
import { guardMutation, readJsonBody, jsonError } from '@/lib/server/http';
import { resolveOwner, requireAuthedUser } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET  /api/social/profile?username=<handle>  → public profile card
// POST /api/social/profile                    → update own public profile
// ---------------------------------------------------------------------------

const USERNAME_RE = /^[a-z0-9-]{3,24}$/;

async function publicProfilePayload(username: string, viewerOwnerId: string | null) {
  const user = await db.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      name: true,
      bio: true,
      avatar: true,
      isPublicProfile: true,
      deletedAt: true,
      createdAt: true,
    },
  });
  if (!user || user.deletedAt) return null;
  // Private profiles are visible only to the owner (so they can reach the
  // edit controls); everyone else gets a clean 404.
  if (!user.isPublicProfile && viewerOwnerId !== user.id) return null;

  const [followers, following, historyRows, ratings, lists] = await Promise.all([
    db.follow.count({ where: { followingId: user.id } }),
    db.follow.count({ where: { followerId: user.id } }),
    db.watchHistory.findMany({
      where: { userId: user.id },
      select: { positionSeconds: true, durationSeconds: true, tmdbId: true, title: true, mediaType: true },
    }),
    db.rating.findMany({
      where: { userId: user.id, score: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: 12,
      select: { tmdbId: true, mediaType: true, score: true, updatedAt: true },
    }),
    db.list.findMany({
      where: { userId: user.id, isPublic: true },
      select: {
        id: true,
        name: true,
        shareToken: true,
        description: true,
        _count: { select: { items: true } },
      },
      take: 10,
    }),
  ]);

  // Watch time: sum of positions (clamped to duration when known) → hours.
  const secondsWatched = historyRows.reduce(
    (acc, r) =>
      acc +
      (r.durationSeconds && r.durationSeconds > 0
        ? Math.min(r.positionSeconds, r.durationSeconds)
        : r.positionSeconds),
    0,
  );

  let isFollowing = false;
  if (viewerOwnerId && viewerOwnerId !== user.id) {
    const edge = await db.follow.findUnique({
      where: { followerId_followingId: { followerId: viewerOwnerId, followingId: user.id } },
      select: { id: true },
    });
    isFollowing = Boolean(edge);
  }

  return {
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      bio: user.bio,
      avatar: user.avatar,
      isPublicProfile: user.isPublicProfile,
      joinedAt: user.createdAt.toISOString(),
    },
    stats: {
      hoursWatched: Math.round(secondsWatched / 3600),
      titlesOpened: historyRows.length,
      ratingsCount: ratings.length,
      followers,
      following,
    },
    ratings: ratings.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
    lists: lists.map((l) => ({
      name: l.name,
      description: l.description,
      count: l._count.items,
      shareUrl: `/?share=${l.shareToken}`,
    })),
    isFollowing,
  };
}

export const GET = withApi('social-profile', async (request) => {
  const { searchParams } = new URL(request.url);
  const username = (searchParams.get('username') ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) return jsonError('bad_request', 400, 'invalid username');

  const viewer = await resolveOwner(request);
  const payload = await publicProfilePayload(username, viewer.userId);
  if (!payload) return jsonError('not_found', 404, 'profile not found or private');
  return Response.json(payload);
});

const patchSchema = z.object({
  username: z
    .string()
    .regex(USERNAME_RE, '3–24 chars: a-z, 0-9, hyphen')
    .nullable()
    .optional(),
  bio: z.string().max(280).nullable().optional(),
  isPublicProfile: z.boolean().optional(),
});

export const POST = withApi('social-profile-update', async (request) => {
  const guard = await guardMutation(request, 'account');
  if (guard) return guard;

  const auth = await requireAuthedUser(request);
  if (!auth?.userId) return jsonError('unauthorized', 401);
  const viewerId: string = auth.userId;

  const body = await readJsonBody(request);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400, parsed.error.issues[0]?.message);

  const { username, bio, isPublicProfile } = parsed.data;
  if (username) {
    const taken = await db.user.findFirst({
      where: { username: username.toLowerCase(), id: { not: viewerId } },
      select: { id: true },
    });
    if (taken) return jsonError('conflict', 409, 'username is taken');
  }

  const updated = await db.user.update({
    where: { id: viewerId },
    data: {
      ...(username !== undefined ? { username: username ? username.toLowerCase() : null } : {}),
      ...(bio !== undefined ? { bio } : {}),
      ...(isPublicProfile !== undefined ? { isPublicProfile } : {}),
    },
    select: { username: true, bio: true, isPublicProfile: true },
  });

  return Response.json({ profile: updated });
});
