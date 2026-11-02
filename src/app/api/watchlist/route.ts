import type { WatchlistItem } from '@prisma/client';
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

export interface WatchlistEntry {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  imdbId?: string | null;
  addedAt: string;
}

function serializeWatchlistRow(row: WatchlistItem): WatchlistEntry {
  return {
    id: row.id,
    tmdbId: row.tmdbId,
    mediaType: row.mediaType === 'tv' ? 'tv' : 'movie',
    title: row.title,
    posterPath: row.posterPath,
    backdropPath: row.backdropPath,
    imdbId: row.imdbId,
    addedAt: row.addedAt.toISOString(),
  };
}

const watchlistPostSchema = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(['movie', 'tv']),
  title: z.string().min(1).max(300),
  posterPath: z.string().nullable().optional(),
  backdropPath: z.string().nullable().optional(),
  imdbId: z.string().regex(/^tt\d+$/).nullable().optional(),
  /** Profile scope — validated against the account's profiles when signed in. */
  profileId: z.string().max(40).optional(),
});

const PROFILE_RE = /^[a-z0-9-]{1,40}$/;

/** Profile ids come from the client — constrain + validate against the owner. */
async function safeProfileId(ownerId: string, isUser: boolean, raw: string | undefined): Promise<string> {
  const candidate = raw && PROFILE_RE.test(raw) ? raw : 'main';
  if (!isUser || candidate === 'main') return candidate;
  const profile = await db.profile.findFirst({ where: { userId: ownerId, id: candidate } });
  return profile ? profile.id : 'main';
}

/** Attach owner cookies + slide the session cookie when rotation is due. */
async function finish<T extends Response>(response: T, owner: OwnerContext): Promise<T> {
  await withSessionRefresh(response, owner);
  return withOwnerCookies(response, owner);
}

// GET /api/watchlist → the caller's saved titles (newest 200).
// Works signed-in (session cookie) or as a guest (device cookie, auto-minted).
// ?profileId= scopes the read to one profile (validated server-side).
export const GET = withApi('watchlist', async (request) => {
  const owner = await resolveOwner(request);
  const { searchParams } = new URL(request.url);
  const profileId = await safeProfileId(owner.ownerId, owner.userId !== null, searchParams.get('profileId') ?? undefined);
  const rows = await db.watchlistItem.findMany({
    where: { ownerId: owner.ownerId, profileId },
    orderBy: { addedAt: 'desc' },
    take: 200,
  });
  return finish(Response.json({ items: rows.map(serializeWatchlistRow) }), owner);
});

// POST /api/watchlist → idempotent create on [owner, tmdbId, mediaType, profile].
export const POST = withApi('watchlist-post', async (request) => {
  const guard = await guardMutation(request, 'library');
  if (guard) return guard;

  const body = await readJsonBody(request);
  const parsed = watchlistPostSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  const owner = await resolveOwner(request);
  const { tmdbId, mediaType, title } = parsed.data;
  const posterPath = parsed.data.posterPath ?? null;
  const backdropPath = parsed.data.backdropPath ?? null;
  const imdbId = parsed.data.imdbId ?? null;
  const profileId = await safeProfileId(owner.ownerId, owner.userId !== null, parsed.data.profileId);

  const existing = await db.watchlistItem.findUnique({
    where: {
      ownerId_tmdbId_mediaType_profileId: {
        ownerId: owner.ownerId,
        tmdbId,
        mediaType,
        profileId,
      },
    },
  });
  if (existing) {
    return finish(Response.json({ item: serializeWatchlistRow(existing) }), owner);
  }

  const row = await db.watchlistItem.create({
    data: {
      ownerId: owner.ownerId,
      userId: owner.userId,
      profileId,
      tmdbId,
      mediaType,
      title,
      posterPath,
      backdropPath,
      imdbId,
    },
  });
  return finish(Response.json({ item: serializeWatchlistRow(row) }), owner);
});

// DELETE /api/watchlist?id=<rowId> | ?all=1 — scoped to the caller.
export const DELETE = withApi('watchlist-delete', async (request) => {
  const guard = await guardMutation(request, 'library');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  const { searchParams } = new URL(request.url);

  if (searchParams.get('all') === '1') {
    await db.watchlistItem.deleteMany({ where: { ownerId: owner.ownerId } });
    return finish(Response.json({ ok: true }), owner);
  }

  const id = searchParams.get('id');
  if (!id) return jsonError('bad_request', 400);

  await db.watchlistItem.deleteMany({ where: { id, ownerId: owner.ownerId } });
  return finish(Response.json({ ok: true }), owner);
});
