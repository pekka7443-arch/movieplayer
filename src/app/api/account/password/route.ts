import { z } from 'zod';

import { db } from '@/lib/db';
import {
  hashPassword,
  resolveOwner,
  revokeAllSessionsForUser,
  sessionCookieValue,
  createSession,
  verifyPassword,
} from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit, clientIpOf } from '@/lib/server/rate-limit';
import { checkPassword } from '@/lib/password';

export const dynamic = 'force-dynamic';

const schema = z.object({
  currentPassword: z.string().min(1).max(100),
  newPassword: z.string().min(8).max(100),
});

/**
 * POST /api/account/password — change password. Requires the CURRENT password
 * (2FA users additionally pass totpCode). All other sessions are revoked and
 * this browser gets a fresh cookie.
 */
export const POST = withApi('account/password', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'account');
  if (limited) return limited;

  const owner = await resolveOwner(request);
  if (!owner.userId) return apiError(401, 'unauthorized');

  const body = await readJsonBody(request);
  const parsed = schema.extend({ totpCode: z.string().min(6).max(10).optional() }).safeParse(body);
  if (!parsed.success) return apiError(400, 'bad_request');
  const { currentPassword, newPassword, totpCode } = parsed.data;

  const user = await db.user.findUnique({ where: { id: owner.userId } });
  if (!user) return apiError(401, 'unauthorized');

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    return apiError(401, 'invalid_credentials');
  }

  if (user.totpEnabled) {
    const { verifyTotp } = await import('@/lib/server/totp');
    if (!user.totpSecret || !totpCode || !verifyTotp(user.totpSecret, totpCode)) {
      return apiError(401, 'invalid_code');
    }
  }

  const verdict = checkPassword(newPassword);
  if (!verdict.acceptable) {
    return apiError(400, 'weak_password', undefined, { problems: verdict.problems });
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(newPassword), mustChangePassword: false },
  });

  // Kill every other session; keep this device signed in with a fresh cookie.
  await revokeAllSessionsForUser(user.id);
  const session = await createSession(user.id, {
    userAgent: request.headers.get('user-agent'),
    ip: clientIpOf(request),
  });
  const response = Response.json({ ok: true });
  response.headers.append('Set-Cookie', sessionCookieValue(session));
  return response;
});
