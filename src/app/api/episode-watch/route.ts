import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner, withOwnerCookies } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { guardMutation, jsonError, readJsonBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

const markSchema = z.object({
  tmdbId: z.number().int().positive(),
  season: z.number().int().min(0),
  episode: z.number().int().min(0),
});

// GET /api/episode-watch?tmdbId=&season= → watched episode numbers.
export const GET = withApi('episode-watch', async (request) => {
  const owner = await resolveOwner(request);
  const { searchParams } = new URL(request.url);
  const tmdbId = Number(searchParams.get('tmdbId'));
  const season = Number(searchParams.get('season'));
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return jsonError('bad_request', 400);

  const rows = await db.episodeWatch.findMany({
    where: {
      ownerId: owner.ownerId,
      tmdbId,
      ...(Number.isInteger(season) ? { season } : {}),
    },
    select: { season: true, episode: true },
  });
  return withOwnerCookies(
    Response.json({ watched: rows.map((r) => ({ s: r.season, e: r.episode })) }),
    owner,
  );
});

// POST /api/episode-watch → mark an episode watched (idempotent).
export const POST = withApi('episode-watch-post', async (request) => {
  const guard = guardMutation(request, 'library');
  if (guard) return guard;

  const body = await readJsonBody(request);
  const parsed = markSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);
  const { tmdbId, season, episode } = parsed.data;

  const owner = await resolveOwner(request);
  const existing = await db.episodeWatch.findUnique({
    where: { ownerId_tmdbId_season_episode: { ownerId: owner.ownerId, tmdbId, season, episode } },
  });
  if (existing) return withOwnerCookies(Response.json({ ok: true }), owner);

  const row = await db.episodeWatch.create({
    data: { ownerId: owner.ownerId, userId: owner.userId, tmdbId, season, episode },
  });
  return withOwnerCookies(Response.json({ ok: true, id: row.id }), owner);
});

// DELETE /api/episode-watch → unmark (undo mis-mark).
export const DELETE = withApi('episode-watch-delete', async (request) => {
  const guard = guardMutation(request, 'library');
  if (guard) return guard;

  const body = await readJsonBody(request);
  const parsed = markSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  const owner = await resolveOwner(request);
  await db.episodeWatch.deleteMany({
    where: {
      ownerId: owner.ownerId,
      tmdbId: parsed.data.tmdbId,
      season: parsed.data.season,
      episode: parsed.data.episode,
    },
  });
  return withOwnerCookies(Response.json({ ok: true }), owner);
});
