import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner, verifyPassword } from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { guardMutation, readJsonBody } from '@/lib/server/http';
import { revokeAllSessionsForUser } from '@/lib/server/auth';
import { writeAudit } from '@/lib/server/audit';

export const dynamic = 'force-dynamic';

/** Accounts past this age in the deleted state are purged by the cleanup job. */
export const DELETE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

const schema = z.object({
  password: z.string().min(1).max(100),
  /** Typed confirmation word — must be exactly DELETE. */
  confirm: z.literal('DELETE'),
});

/**
 * POST /api/account/delete { password, confirm: "DELETE" } → soft delete.
 * The account keeps a 30-day grace window: signing in again during it
 * reactivates the account automatically. After the window the cleanup job
 * (health route) hard-deletes the row; all cascade rules remove its data.
 * Every session is revoked immediately.
 */
export const POST = withApi('account/delete', async (request) => {
  const guard = await guardMutation(request, 'account');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  if (!owner.userId) return apiError(401, 'unauthorized');

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError(400, 'bad_request');

  const user = await db.user.findUnique({ where: { id: owner.userId } });
  if (!user) return apiError(401, 'unauthorized');
  if (user.deletedAt) return apiError(409, 'conflict', 'The account is already deleted.');
  if (!verifyPassword(parsed.data.password, user.passwordHash)) {
    return apiError(401, 'invalid_credentials');
  }

  await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
  await revokeAllSessionsForUser(user.id);
  await writeAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'account.soft_deleted',
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.email,
    details: { graceDays: 30 },
  });

  return Response.json({ ok: true, graceDays: 30 });
});
