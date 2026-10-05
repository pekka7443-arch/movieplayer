import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { guardMutation, jsonError, readJsonBody } from '@/lib/server/http';
import { tvmazeFullByImdb } from '@/lib/server/tvmaze';

export const dynamic = 'force-dynamic';

export interface NotificationEntry {
  id: string;
  kind: string;
  title: string;
  text: string;
  tmdbId: number | null;
  mediaType: 'movie' | 'tv' | null;
  season: number | null;
  episode: number | null;
  read: boolean;
  createdAt: string;
}

const globalForChecks = globalThis as unknown as { __cinedeckNotifyCheckAt?: number };

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Lazily create "new episode aired" notifications for followed shows.
 * Followed = TV rows in the account watchlist with an imdbId. TVmaze gives
 * us air dates; anything aired within the last 7 days becomes a
 * notification (deduped by a stable key in the payload). Throttled to one
 * pass per account per 6 hours.
 */
async function checkFollowedShows(userId: string): Promise<void> {
  const throttleKey = `${userId}`;
  const last = (globalForChecks as Record<string, number | undefined>)[throttleKey] ?? 0;
  const now = Date.now();
  if (now - last < 6 * 60 * 60 * 1000) return;
  (globalForChecks as Record<string, number | undefined>)[throttleKey] = now;

  const followed = await db.watchlistItem.findMany({
    where: { ownerId: userId, mediaType: 'tv', imdbId: { not: null } },
    select: { tmdbId: true, title: true, imdbId: true },
    take: 40,
  });
  if (followed.length === 0) return;

  const existing = await db.notification.findMany({
    where: { userId, kind: 'episode' },
    select: { payload: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const seen = new Set(
    existing.map((n) => String(parsePayload(n.payload).key ?? '')),
  );

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const show of followed.slice(0, 10)) {
    if (!show.imdbId) continue;
    const full = await tvmazeFullByImdb(show.imdbId).catch(() => null);
    if (!full?.episodes?.length) continue;
    // Latest aired episode within the last 7 days.
    const fresh = [...full.episodes]
      .filter((e) => e.airdate)
      .map((e) => ({ ...e, ts: new Date(`${e.airdate}T00:00:00Z`).getTime() }))
      .filter((e) => e.ts >= weekAgo && e.ts <= now)
      .sort((a, b) => b.ts - a.ts)[0];
    if (!fresh) continue;
    const key = `ep:${show.tmdbId}:${fresh.season}x${fresh.number}:${fresh.airdate}`;
    if (seen.has(key)) continue;
    await db.notification.create({
      data: {
        userId,
        kind: 'episode',
        payload: JSON.stringify({
          key,
          title: show.title,
          tmdbId: show.tmdbId,
          mediaType: 'tv',
          season: fresh.season,
          episode: fresh.number,
          text: `New episode: S${fresh.season}·E${fresh.number} of ${show.title} just dropped.`,
        }),
      },
    });
  }
}

// GET /api/notifications → unread + recent notifications (runs the episode
// check opportunistically, throttled internally).
export const GET = withApi('notifications', async (request) => {
  const owner = await resolveOwner(request);
  if (!owner.userId) {
    return Response.json({ items: [], unread: 0 });
  }

  void checkFollowedShows(owner.userId);

  const rows = await db.notification.findMany({
    where: { userId: owner.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const items: NotificationEntry[] = rows.map((row) => {
    const payload = parsePayload(row.payload);
    return {
      id: row.id,
      kind: row.kind,
      title: typeof payload.title === 'string' ? payload.title : 'CineDeck',
      text: typeof payload.text === 'string' ? payload.text : '',
      tmdbId: typeof payload.tmdbId === 'number' ? payload.tmdbId : null,
      mediaType: payload.mediaType === 'tv' || payload.mediaType === 'movie' ? payload.mediaType : null,
      season: typeof payload.season === 'number' ? payload.season : null,
      episode: typeof payload.episode === 'number' ? payload.episode : null,
      read: row.readAt !== null,
      createdAt: row.createdAt.toISOString(),
    };
  });

  return Response.json({ items, unread: items.filter((i) => !i.read).length });
});

const markSchema = z.object({ id: z.string().min(1).optional(), all: z.boolean().optional() });

// POST /api/notifications → mark one / all as read.
export const POST = withApi('notifications-read', async (request) => {
  const guard = guardMutation(request, 'account');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  if (!owner.userId) return jsonError('unauthorized', 401);

  const body = await readJsonBody(request);
  const parsed = markSchema.safeParse(body ?? {});
  if (!parsed.success) return jsonError('bad_request', 400);

  if (parsed.data.all) {
    await db.notification.updateMany({
      where: { userId: owner.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return Response.json({ ok: true });
  }
  if (parsed.data.id) {
    await db.notification.updateMany({
      where: { id: parsed.data.id, userId: owner.userId },
      data: { readAt: new Date() },
    });
  }
  return Response.json({ ok: true });
});
