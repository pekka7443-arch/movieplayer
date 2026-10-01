import type { WatchHistory } from '@prisma/client';
import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner, withOwnerCookies } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

interface HistoryItem {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  season: number | null;
  episode: number | null;
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
    season: row.season,
    episode: row.episode,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const historyPostSchema = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(['movie', 'tv']),
  title: z.string().min(1),
  posterPath: z.string().nullable().optional(),
  backdropPath: z.string().nullable().optional(),
  season: z.number().int().nullable().optional(),
  episode: z.number().int().nullable().optional(),
});

function badRequest(): Response {
  return Response.json({ error: 'bad_request' }, { status: 400 });
}

// GET /api/history → the caller's most recent 24 watch-history entries.
// Works signed-in (session cookie) or as a guest (device cookie, auto-minted).
export async function GET(request: Request) {
  const owner = resolveOwner(request);
  const rows = await db.watchHistory.findMany({
    where: { ownerId: owner.ownerId },
    orderBy: { updatedAt: 'desc' },
    take: 24,
  });
  const response = Response.json({ items: rows.map(serializeHistoryRow) });
  return withOwnerCookies(response, owner);
}

// POST /api/history → upsert on [owner, tmdbId, mediaType].
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }

  const parsed = historyPostSchema.safeParse(body);
  if (!parsed.success) return badRequest();

  const owner = resolveOwner(request);
  const { tmdbId, mediaType, title } = parsed.data;
  const posterPath = parsed.data.posterPath ?? null;
  const backdropPath = parsed.data.backdropPath ?? null;
  const season = parsed.data.season ?? null;
  const episode = parsed.data.episode ?? null;

  const row = await db.watchHistory.upsert({
    where: { ownerId_tmdbId_mediaType: { ownerId: owner.ownerId, tmdbId, mediaType } },
    create: { ownerId: owner.ownerId, tmdbId, mediaType, title, posterPath, backdropPath, season, episode },
    update: { title, posterPath, backdropPath, season, episode },
  });

  return withOwnerCookies(Response.json({ item: serializeHistoryRow(row) }), owner);
}

// DELETE /api/history?id=<rowId> | ?all=1 — scoped to the caller.
export async function DELETE(request: Request) {
  const owner = resolveOwner(request);
  const { searchParams } = new URL(request.url);

  if (searchParams.get('all') === '1') {
    await db.watchHistory.deleteMany({ where: { ownerId: owner.ownerId } });
    return withOwnerCookies(Response.json({ ok: true }), owner);
  }

  const id = searchParams.get('id');
  if (!id) return badRequest();

  await db.watchHistory.deleteMany({ where: { id, ownerId: owner.ownerId } });
  return withOwnerCookies(Response.json({ ok: true }), owner);
}
