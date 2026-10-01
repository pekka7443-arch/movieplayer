import type { WatchlistItem } from '@prisma/client';
import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner, withOwnerCookies } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

interface WatchlistEntry {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
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
    addedAt: row.addedAt.toISOString(),
  };
}

const watchlistPostSchema = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(['movie', 'tv']),
  title: z.string().min(1),
  posterPath: z.string().nullable().optional(),
  backdropPath: z.string().nullable().optional(),
});

function badRequest(): Response {
  return Response.json({ error: 'bad_request' }, { status: 400 });
}

// GET /api/watchlist → the caller's most recent 24 saved titles.
// Works signed-in (session cookie) or as a guest (device cookie, auto-minted).
export async function GET(request: Request) {
  const owner = resolveOwner(request);
  const rows = await db.watchlistItem.findMany({
    where: { ownerId: owner.ownerId },
    orderBy: { addedAt: 'desc' },
    take: 24,
  });
  const response = Response.json({ items: rows.map(serializeWatchlistRow) });
  return withOwnerCookies(response, owner);
}

// POST /api/watchlist → idempotent create on [owner, tmdbId, mediaType].
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }

  const parsed = watchlistPostSchema.safeParse(body);
  if (!parsed.success) return badRequest();

  const owner = resolveOwner(request);
  const { tmdbId, mediaType, title } = parsed.data;
  const posterPath = parsed.data.posterPath ?? null;
  const backdropPath = parsed.data.backdropPath ?? null;

  const existing = await db.watchlistItem.findUnique({
    where: { ownerId_tmdbId_mediaType: { ownerId: owner.ownerId, tmdbId, mediaType } },
  });
  if (existing) {
    return withOwnerCookies(Response.json({ item: serializeWatchlistRow(existing) }), owner);
  }

  const row = await db.watchlistItem.create({
    data: { ownerId: owner.ownerId, tmdbId, mediaType, title, posterPath, backdropPath },
  });
  return withOwnerCookies(Response.json({ item: serializeWatchlistRow(row) }), owner);
}

// DELETE /api/watchlist?id=<rowId> | ?all=1 — scoped to the caller.
export async function DELETE(request: Request) {
  const owner = resolveOwner(request);
  const { searchParams } = new URL(request.url);

  if (searchParams.get('all') === '1') {
    await db.watchlistItem.deleteMany({ where: { ownerId: owner.ownerId } });
    return withOwnerCookies(Response.json({ ok: true }), owner);
  }

  const id = searchParams.get('id');
  if (!id) return badRequest();

  await db.watchlistItem.deleteMany({ where: { id, ownerId: owner.ownerId } });
  return withOwnerCookies(Response.json({ ok: true }), owner);
}
