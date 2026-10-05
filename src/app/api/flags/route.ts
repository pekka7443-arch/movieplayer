import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { guardMutation, jsonError, readJsonBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

// GET /api/flags → public feature flags + active announcement banner.
export const GET = withApi('flags', async () => {
  const [flags, announcement] = await Promise.all([
    db.featureFlag.findMany({ select: { key: true, enabled: true } }),
    db.announcement.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, message: true, createdAt: true },
    }),
  ]);
  return Response.json({
    flags: Object.fromEntries(flags.map((f) => [f.key, f.enabled])),
    announcement: announcement
      ? { id: announcement.id, message: announcement.message, createdAt: announcement.createdAt.toISOString() }
      : null,
  }, {
    // Global, cookie-independent payload — safe to share-cache briefly;
    // admin publishes invalidate it within a minute via the short TTL.
    headers: { 'cache-control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=60' },
  });
});

const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('flag'), key: z.string().min(1).max(60), enabled: z.boolean() }),
  z.object({ action: z.literal('announce'), message: z.string().min(1).max(300) }),
  z.object({ action: z.literal('announce-off') }),
]);

// POST /api/flags → admin-only toggles + announcement publishing.
export const POST = withApi('flags-post', async (request) => {
  const guard = guardMutation(request, 'account');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  if (!owner.userId) return jsonError('unauthorized', 401);
  const user = await db.user.findUnique({
    where: { id: owner.userId },
    select: { role: true },
  });
  if (user?.role !== 'admin') return jsonError('forbidden', 403);

  const body = await readJsonBody(request);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return jsonError('bad_request', 400);

  if (parsed.data.action === 'flag') {
    await db.featureFlag.upsert({
      where: { key: parsed.data.key },
      create: { key: parsed.data.key, enabled: parsed.data.enabled },
      update: { enabled: parsed.data.enabled },
    });
    return Response.json({ ok: true });
  }
  if (parsed.data.action === 'announce') {
    await db.announcement.updateMany({ data: { active: false } });
    await db.announcement.create({ data: { message: parsed.data.message, active: true } });
    return Response.json({ ok: true });
  }
  await db.announcement.updateMany({ data: { active: false } });
  return Response.json({ ok: true });
});
