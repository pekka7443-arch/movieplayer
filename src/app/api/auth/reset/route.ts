import { z } from 'zod';

import { db } from '@/lib/db';
import { hashPassword, revokeAllSessionsForUser, verifyStatelessToken } from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { checkPassword } from '@/lib/password';

export const dynamic = 'force-dynamic';

const schema = z.object({
  token: z.string().min(20).max(400),
  password: z.string().min(8).max(100),
});

/**
 * POST /api/auth/reset → consume the signed reset token, update the password
 * and revoke every existing session (a stolen session dies with the reset).
 */
export const POST = withApi('auth/reset', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'resetPassword');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'bad_request');
  }

  const payload = verifyStatelessToken(parsed.data.token, 'reset');
  if (!payload) {
    return apiError(400, 'invalid_token');
  }

  const verdict = checkPassword(parsed.data.password);
  if (!verdict.acceptable) {
    return Response.json(
      { error: 'weak_password', problems: verdict.problems },
      { status: 400 },
    );
  }

  const user = await db.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    return apiError(400, 'invalid_token');
  }

  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(parsed.data.password) },
    }),
    // Every device signs in again after a reset.
    db.session.deleteMany({ where: { userId: user.id } }),
  ]);
  void revokeAllSessionsForUser; // covered by the deleteMany above

  return Response.json({ ok: true });
});
