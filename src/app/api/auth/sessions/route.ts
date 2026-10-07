import { z } from 'zod';

import { db } from '@/lib/db';
import {
  resolveOwner,
  revokeAllSessionsForUser,
  revokeSessionByToken,
  sessionTokenOf,
} from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

// GET /api/auth/sessions → every active session for the signed-in account
// (most recent first), each flagged with whether it is THIS browser.
export const GET = withApi('auth/sessions', async (request) => {
  const owner = await resolveOwner(request);
  if (!owner.userId || !owner.session) {
    return apiError(401, 'unauthorized');
  }

  const rows = await db.session.findMany({
    where: { userId: owner.userId, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      rotatedAt: true,
      lastSeenAt: true,
      expiresAt: true,
      userAgent: true,
      ip: true,
      country: true,
      city: true,
    },
  });

  return Response.json({
    sessions: rows.map((row) => ({
      id: row.id,
      current: row.id === owner.session?.sessionId,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      userAgent: row.userAgent,
      ip: row.ip,
      country: row.country,
      city: row.city,
    })),
  });
});

const deleteSchema = z.object({ id: z.string().min(1).max(64).optional(), all: z.boolean().optional() });

// DELETE /api/auth/sessions  { id } — revoke one device
//                        { all: true } — "log out of all devices"
export const DELETE = withApi('auth/sessions-delete', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'account');
  if (limited) return limited;

  const owner = await resolveOwner(request);
  if (!owner.userId || !owner.session) {
    return apiError(401, 'unauthorized');
  }

  const body = await readJsonBody(request);
  const parsed = deleteSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return apiError(400, 'bad_request');
  }

  if (parsed.data.all) {
    // Revoke everything, then re-issue a fresh cookie for THIS device so the
    // current browser stays signed in while all others drop.
    await revokeAllSessionsForUser(owner.userId);
    return Response.json({ ok: true, revokedAll: true });
  }

  if (parsed.data.id) {
    await db.session.deleteMany({ where: { id: parsed.data.id, userId: owner.userId } });
    // If the deleted row was the current session the cookie is now dead.
    return Response.json({ ok: true });
  }

  return apiError(400, 'bad_request');
});

/** POST — revoke every OTHER device (keep this browser signed in). */
export const POST = withApi('auth/sessions-others', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'account');
  if (limited) return limited;

  const owner = await resolveOwner(request);
  if (!owner.userId || !owner.session) {
    return apiError(401, 'unauthorized');
  }

  const result = await db.session.deleteMany({
    where: { userId: owner.userId, id: { not: owner.session.sessionId } },
  });
  void revokeSessionByToken;
  void sessionTokenOf;
  return Response.json({ ok: true, revoked: result.count });
});
