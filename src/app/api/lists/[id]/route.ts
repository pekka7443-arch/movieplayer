import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner, withOwnerCookies } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { guardMutation, jsonError, readJsonBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

interface MemberRow {
  id: string;
  tmdbId: number;
  mediaType: string;
  title: string;
  posterPath: string | null;
  position: number;
  addedAt: Date;
}

function serializeMember(row: MemberRow) {
  return {
    id: row.id,
    tmdbId: row.tmdbId,
    mediaType: row.mediaType === 'tv' ? 'tv' : 'movie',
    title: row.title,
    posterPath: row.posterPath,
    position: row.position,
    addedAt: row.addedAt.toISOString(),
  };
}

/** Load the list scoped to the caller (or public-shared token). */
async function loadOwnedList(listId: string, ownerId: string) {
  return db.list.findFirst({
    where: { id: listId, ownerId },
    select: { id: true, name: true, isPublic: true },
  });
}

// GET /api/lists/:id → the list's items (ordered for drag-and-drop).
export const GET = withApi('list-items', async (request, { }) => {
  const listId = new URL(request.url).pathname.split('/').pop() ?? '';
  const owner = await resolveOwner(request);
  const list = await loadOwnedList(listId, owner.ownerId);
  if (!list) return jsonError('not_found', 404);

  const items = await db.listMember.findMany({
    where: { listId },
    orderBy: { position: 'asc' },
  });
  return withOwnerCookies(
    Response.json({
      list: { id: list.id, name: list.name, isPublic: list.isPublic },
      items: items.map(serializeMember),
    }),
    owner,
  );
});

const addSchema = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(['movie', 'tv']),
  title: z.string().min(1).max(300),
  posterPath: z.string().nullable().optional(),
});

// POST /api/lists/:id → add a title (idempotent on [list, tmdbId, mediaType]).
export const POST = withApi('list-add', async (request) => {
  const guard = guardMutation(request, 'library');
  if (guard) return guard;

  const listId = new URL(request.url).pathname.split('/').pop() ?? '';
  const owner = await resolveOwner(request);
  const list = await loadOwnedList(listId, owner.ownerId);
  if (!list) return jsonError('not_found', 404);

  const body = await readJsonBody(request);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  const maxPosition = await db.listMember.aggregate({
    where: { listId },
    _max: { position: true },
  });

  const row = await db.listMember.upsert({
    where: {
      listId_tmdbId_mediaType: {
        listId,
        tmdbId: parsed.data.tmdbId,
        mediaType: parsed.data.mediaType,
      },
    },
    create: {
      listId,
      tmdbId: parsed.data.tmdbId,
      mediaType: parsed.data.mediaType,
      title: parsed.data.title,
      posterPath: parsed.data.posterPath ?? null,
      position: (maxPosition._max.position ?? -1) + 1,
    },
    update: {},
  });

  return withOwnerCookies(Response.json({ item: serializeMember(row) }), owner);
});

const patchSchema = z.object({
  order: z.array(z.string().min(1)).max(500),
});

// PATCH /api/lists/:id { order: [memberId, …] } → persist dnd reorder.
export const PATCH = withApi('list-reorder', async (request) => {
  const guard = guardMutation(request, 'library');
  if (guard) return guard;

  const listId = new URL(request.url).pathname.split('/').pop() ?? '';
  const owner = await resolveOwner(request);
  const list = await loadOwnedList(listId, owner.ownerId);
  if (!list) return jsonError('not_found', 404);

  const body = await readJsonBody(request);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  await db.$transaction(
    parsed.data.order.map((memberId, index) =>
      db.listMember.updateMany({
        where: { id: memberId, listId },
        data: { position: index },
      }),
    ),
  );
  return withOwnerCookies(Response.json({ ok: true }), owner);
});

// DELETE /api/lists/:id?tmdbId=&mediaType= → remove one title from the list.
export const DELETE = withApi('list-remove', async (request) => {
  const guard = guardMutation(request, 'library');
  if (guard) return guard;

  const listId = new URL(request.url).pathname.split('/').pop() ?? '';
  const owner = await resolveOwner(request);
  const list = await loadOwnedList(listId, owner.ownerId);
  if (!list) return jsonError('not_found', 404);

  const { searchParams } = new URL(request.url);
  const tmdbId = Number(searchParams.get('tmdbId'));
  const mediaType = searchParams.get('mediaType') === 'tv' ? 'tv' : 'movie';
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return jsonError('bad_request', 400);

  await db.listMember.deleteMany({ where: { listId, tmdbId, mediaType } });
  return withOwnerCookies(Response.json({ ok: true }), owner);
});
