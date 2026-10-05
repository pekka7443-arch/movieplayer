import type { WatchHistory } from '@prisma/client';
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

export interface HistoryItem {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  imdbId?: string | null;
  season: number | null;
  episode: number | null;
  /** Seconds actually spent watching (embed players are cross-origin). */
  positionSeconds: number;
  /** Runtime in seconds when known — enables a real progress bar. */
  durationSeconds: number | null;
  updatedAt: string;
}

function serializeHistoryRow(row: WatchHistory): HistoryItem {
  return {
    id: row.id,
    tmdbId: row.tmdbId,
    mediaType: row.mediaType === 'tv' ? 'tv' : 'movie',
    title: row.title,
    posterPath: row.posterPath,
    backdropPath: row.backdropPath,
    imdbId: row.imdbId,
    season: row.season,
    episode: row.episode,
    positionSeconds: row.positionSeconds,
    durationSeconds: row.durationSeconds,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const historyPostSchema = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(['movie', 'tv']),
  title: z.string().min(1).max(300),
  posterPath: z.string().nullable().optional(),
  backdropPath: z.string().nullable().optional(),
  imdbId: z.string().regex(/^tt\d+$/).nullable().optional(),
  season: z.number().int().nullable().optional(),
  episode: z.number().int().nullable().optional(),
  /** Elapsed wall-clock seconds spent on this page (monotonic, client-tracked). */
  positionSeconds: z.number().int().min(0).max(60 * 60 * 24).optional(),
  /** Runtime in seconds when known (TMDB details). */
  durationSeconds: z.number().int().min(0).max(60 * 60 * 12).nullable().optional(),
  profileId: z.string().max(40).optional(),
});

const PROFILE_RE = /^[a-z0-9-]{1,40}$/;

async function safeProfileId(ownerId: string, isUser: boolean, raw: string | undefined): Promise<string> {
  const candidate = raw && PROFILE_RE.test(raw) ? raw : 'main';
  if (!isUser || candidate === 'main') return candidate;
  const profile = await db.profile.findFirst({ where: { userId: ownerId, id: candidate } });
  return profile ? profile.id : 'main';
}

async function finish<T extends Response>(response: T, owner: OwnerContext): Promise<T> {
  await withSessionRefresh(response, owner);
  return withOwnerCookies(response, owner);
}

// GET /api/history → most recent entries (default 60; stats pass ?limit=1000).
export const GET = withApi('history', async (request) => {
  const owner = await resolveOwner(request);
  const requested = Number.parseInt(new URL(request.url).searchParams.get('limit') ?? '', 10);
  const take = Number.isFinite(requested) ? Math.min(1000, Math.max(1, requested)) : 60;
  const rows = await db.watchHistory.findMany({
    where: { ownerId: owner.ownerId },
    orderBy: { updatedAt: 'desc' },
    take,
  });
  return finish(Response.json({ items: rows.map(serializeHistoryRow) }), owner);
});

// POST /api/history → upsert on [owner, tmdbId, mediaType, profile].
// positionSeconds/durationSeconds power the Continue Watching progress bars.
export const POST = withApi('history-post', async (request) => {
  const guard = guardMutation(request, 'library');
  if (guard) return guard;

  const body = await readJsonBody(request);
  const parsed = historyPostSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  const owner = await resolveOwner(request);
  const { tmdbId, mediaType, title } = parsed.data;
  const posterPath = parsed.data.posterPath ?? null;
  const backdropPath = parsed.data.backdropPath ?? null;
  const imdbId = parsed.data.imdbId ?? null;
  const season = parsed.data.season ?? null;
  const episode = parsed.data.episode ?? null;
  const positionSeconds = parsed.data.positionSeconds ?? 0;
  const durationSeconds = parsed.data.durationSeconds ?? null;
  const profileId = await safeProfileId(owner.ownerId, owner.userId !== null, parsed.data.profileId);

  const row = await db.watchHistory.upsert({
    where: {
      ownerId_tmdbId_mediaType_profileId: {
        ownerId: owner.ownerId,
        tmdbId,
        mediaType,
        profileId,
      },
    },
    create: {
      ownerId: owner.ownerId,
      userId: owner.userId,
      profileId,
      tmdbId,
      mediaType,
      title,
      posterPath,
      backdropPath,
      imdbId,
      season,
      episode,
      positionSeconds,
      durationSeconds,
    },
    update: {
      title,
      posterPath,
      backdropPath,
      imdbId,
      season,
      episode,
      positionSeconds,
      durationSeconds: durationSeconds ?? undefined,
    },
  });

  return finish(Response.json({ item: serializeHistoryRow(row) }), owner);
});

// DELETE /api/history?id=<rowId> | ?all=1 — scoped to the caller.
export const DELETE = withApi('history-delete', async (request) => {
  const guard = guardMutation(request, 'library');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  const { searchParams } = new URL(request.url);

  if (searchParams.get('all') === '1') {
    await db.watchHistory.deleteMany({ where: { ownerId: owner.ownerId } });
    return finish(Response.json({ ok: true }), owner);
  }

  const id = searchParams.get('id');
  if (!id) return jsonError('bad_request', 400);

  await db.watchHistory.deleteMany({ where: { id, ownerId: owner.ownerId } });
  return finish(Response.json({ ok: true }), owner);
});
