import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { db } from '@/lib/db';
import {
  resolveOwner,
  withOwnerCookies,
  withSessionRefresh,
  type OwnerContext,
} from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { guardMutation, jsonError, readJsonBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export interface ListSummary {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  shareToken: string;
  position: number;
  itemCount: number;
  updatedAt: string;
}

async function finish<T extends Response>(response: T, owner: OwnerContext): Promise<T> {
  await withSessionRefresh(response, owner);
  return withOwnerCookies(response, owner);
}

// GET /api/lists → the caller's custom lists (with item counts).
export const GET = withApi('lists', async (request) => {
  const owner = await resolveOwner(request);
  const rows = await db.list.findMany({
    where: { ownerId: owner.ownerId },
    orderBy: { position: 'asc' },
    include: { items: { select: { id: true } } },
  });
  const lists: ListSummary[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isPublic: row.isPublic,
    shareToken: row.shareToken,
    position: row.position,
    itemCount: row.items.length,
    updatedAt: row.updatedAt.toISOString(),
  }));
  return finish(Response.json({ lists }), owner);
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).optional(),
  isPublic: z.boolean().optional(),
});

// POST /api/lists → create a custom list.
export const POST = withApi('lists-post', async (request) => {
  const guard = await guardMutation(request, 'library');
  if (guard) return guard;

  const body = await readJsonBody(request);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  const owner = await resolveOwner(request);
  const count = await db.list.count({ where: { ownerId: owner.ownerId } });
  if (count >= 20) return jsonError('conflict', 409, 'List limit reached (20).');

  const maxPosition = await db.list.aggregate({
    where: { ownerId: owner.ownerId },
    _max: { position: true },
  });

  const row = await db.list.create({
    data: {
      ownerId: owner.ownerId,
      userId: owner.userId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      isPublic: parsed.data.isPublic ?? false,
      shareToken: randomBytes(12).toString('base64url'),
      position: (maxPosition._max.position ?? -1) + 1,
    },
  });

  return finish(
    Response.json({
      list: {
        id: row.id,
        name: row.name,
        description: row.description,
        isPublic: row.isPublic,
        shareToken: row.shareToken,
        position: row.position,
        itemCount: 0,
        updatedAt: row.updatedAt.toISOString(),
      } satisfies ListSummary,
    }),
    owner,
  );
});

const patchSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  isPublic: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

// PATCH /api/lists → rename / share toggle / reorder.
export const PATCH = withApi('lists-patch', async (request) => {
  const guard = await guardMutation(request, 'library');
  if (guard) return guard;

  const body = await readJsonBody(request);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  const owner = await resolveOwner(request);
  const { id, ...updates } = parsed.data;
  const row = await db.list.updateMany({
    where: { id, ownerId: owner.ownerId },
    data: updates,
  });
  if (row.count === 0) return jsonError('not_found', 404);
  return finish(Response.json({ ok: true }), owner);
});

// DELETE /api/lists?id= → delete a list (items cascade).
export const DELETE = withApi('lists-delete', async (request) => {
  const guard = await guardMutation(request, 'library');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return jsonError('bad_request', 400);

  await db.list.deleteMany({ where: { id, ownerId: owner.ownerId } });
  return finish(Response.json({ ok: true }), owner);
});
