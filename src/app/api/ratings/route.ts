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

export interface RatingEntry {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  score: number | null;
  note: string | null;
  watched: boolean;
  updatedAt: string;
}

function serialize(row: {
  id: string;
  tmdbId: number;
  mediaType: string;
  score: number | null;
  note: string | null;
  watched: boolean;
  updatedAt: Date;
}): RatingEntry {
  return {
    id: row.id,
    tmdbId: row.tmdbId,
    mediaType: row.mediaType === 'tv' ? 'tv' : 'movie',
    score: row.score,
    note: row.note,
    watched: row.watched,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const upsertSchema = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(['movie', 'tv']),
  score: z.number().int().min(1).max(10).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  watched: z.boolean().optional(),
});

async function finish<T extends Response>(response: T, owner: OwnerContext): Promise<T> {
  await withSessionRefresh(response, owner);
  return withOwnerCookies(response, owner);
}

// GET /api/ratings → the caller's ratings (scored, noted, watched).
export const GET = withApi('ratings', async (request) => {
  const owner = await resolveOwner(request);
  const rows = await db.rating.findMany({
    where: { ownerId: owner.ownerId },
    orderBy: { updatedAt: 'desc' },
    take: 1000,
  });
  return finish(Response.json({ items: rows.map(serialize) }), owner);
});

// POST /api/ratings → upsert score / note / watched for one title.
export const POST = withApi('ratings-post', async (request) => {
  const guard = guardMutation(request, 'library');
  if (guard) return guard;

  const body = await readJsonBody(request);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);
  const { tmdbId, mediaType, score, note, watched } = parsed.data;

  const owner = await resolveOwner(request);

  const row = await db.rating.upsert({
    where: {
      ownerId_tmdbId_mediaType_profileId: {
        ownerId: owner.ownerId,
        tmdbId,
        mediaType,
        profileId: 'main',
      },
    },
    create: {
      ownerId: owner.ownerId,
      userId: owner.userId,
      tmdbId,
      mediaType,
      score: score ?? null,
      note: note ?? null,
      watched: watched ?? false,
    },
    update: {
      score: score === undefined ? undefined : score,
      note: note === undefined ? undefined : note,
      watched,
    },
  });

  return finish(Response.json({ item: serialize(row) }), owner);
});

// DELETE /api/ratings?tmdbId=&mediaType= — forget a title's rating/watched.
export const DELETE = withApi('ratings-delete', async (request) => {
  const guard = guardMutation(request, 'library');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  const { searchParams } = new URL(request.url);
  const tmdbId = Number(searchParams.get('tmdbId'));
  const mediaType = searchParams.get('mediaType') === 'tv' ? 'tv' : 'movie';
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return jsonError('bad_request', 400);

  await db.rating.deleteMany({
    where: { ownerId: owner.ownerId, tmdbId, mediaType },
  });
  return finish(Response.json({ ok: true }), owner);
});
