import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner, withOwnerCookies } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { guardMutation, jsonError, readJsonBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export const MAX_PROFILES = 5;

// GET /api/profiles → the account's profiles (max 5).
export const GET = withApi('profiles', async (request) => {
  const owner = await resolveOwner(request);
  if (!owner.userId) return Response.json({ profiles: [] });

  const rows = await db.profile.findMany({
    where: { userId: owner.userId },
    orderBy: { position: 'asc' },
  });
  return withOwnerCookies(
    Response.json({
      profiles: rows.map((row) => ({
        id: row.id,
        name: row.name,
        avatar: row.avatar,
        isKids: row.isKids,
        language: row.language,
        position: row.position,
      })),
    }),
    owner,
  );
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(30),
  avatar: z.string().trim().max(4).optional(),
  isKids: z.boolean().optional(),
});

// POST /api/profiles → create (≤5 per account).
export const POST = withApi('profiles-post', async (request) => {
  const guard = await guardMutation(request, 'account');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  if (!owner.userId) return jsonError('unauthorized', 401);

  const body = await readJsonBody(request);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  const count = await db.profile.count({ where: { userId: owner.userId } });
  if (count >= MAX_PROFILES) {
    return jsonError('conflict', 409, 'Profile limit reached (5).');
  }
  const maxPosition = await db.profile.aggregate({
    where: { userId: owner.userId },
    _max: { position: true },
  });

  const row = await db.profile.create({
    data: {
      userId: owner.userId,
      name: parsed.data.name,
      avatar: parsed.data.avatar ?? null,
      isKids: parsed.data.isKids ?? false,
      position: (maxPosition._max.position ?? -1) + 1,
    },
  });
  return withOwnerCookies(
    Response.json({
      profile: {
        id: row.id,
        name: row.name,
        avatar: row.avatar,
        isKids: row.isKids,
        position: row.position,
      },
    }),
    owner,
  );
});

const patchSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(30).optional(),
  avatar: z.string().trim().max(4).nullable().optional(),
  isKids: z.boolean().optional(),
  /** Per-profile preferred content language (BCP-47 tag, e.g. fi-FI). */
  language: z.string().trim().max(20).nullable().optional(),
});

// PATCH /api/profiles → rename / avatar / kids flag.
export const PATCH = withApi('profiles-patch', async (request) => {
  const guard = await guardMutation(request, 'account');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  if (!owner.userId) return jsonError('unauthorized', 401);

  const body = await readJsonBody(request);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  const { id, ...updates } = parsed.data;
  const row = await db.profile.updateMany({
    where: { id, userId: owner.userId },
    data: updates,
  });
  if (row.count === 0) return jsonError('not_found', 404);
  return withOwnerCookies(Response.json({ ok: true }), owner);
});

// DELETE /api/profiles?id= — deletes the profile (its scoped rows stay on the
// account's "main" bucket only if they were there; profile rows are keyed by
// profileId and simply become unreachable, so we delete them too).
export const DELETE = withApi('profiles-delete', async (request) => {
  const guard = await guardMutation(request, 'account');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  if (!owner.userId) return jsonError('unauthorized', 401);

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return jsonError('bad_request', 400);
  if (id === 'main') return jsonError('bad_request', 400, 'The default profile cannot be deleted.');

  const owned = await db.profile.findFirst({ where: { id, userId: owner.userId } });
  if (!owned) return jsonError('not_found', 404);

  await db.$transaction([
    db.watchlistItem.deleteMany({ where: { ownerId: owner.userId, profileId: id } }),
    db.watchHistory.deleteMany({ where: { ownerId: owner.userId, profileId: id } }),
    db.rating.deleteMany({ where: { ownerId: owner.userId, profileId: id } }),
    db.profile.delete({ where: { id } }),
  ]);
  return withOwnerCookies(Response.json({ ok: true }), owner);
});
