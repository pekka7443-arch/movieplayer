import { z } from 'zod';

import { db } from '@/lib/db';
import {
  clearGuestCookieValue,
  createSession,
  mergeGuestIntoUser,
  resolveOwner,
  sessionCookieValue,
  verifyPassword,
} from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit, clientIpOf } from '@/lib/server/rate-limit';
import { signStatelessToken } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(1).max(100),
});

// POST /api/auth/login → verify credentials, merge guest data, start session.
// When the account has TOTP enabled the response instead carries
// { totpRequired: true, pendingToken } — the client posts the code to
// /api/auth/login/totp to finish signing in. Generic `invalid_credentials`
// error for any failure so account existence is never revealed.
export const POST = withApi('auth/login', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'login');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(401, 'invalid_credentials');
  }
  const { email, password } = parsed.data;

  const user = await db.user.findUnique({ where: { email } });

  if (user && user.totpEnabled && user.totpSecret && verifyPassword(password, user.passwordHash)) {
    // Password is right — hand out a 5-minute pending token for the 2FA step.
    const pending = signStatelessToken('totp', user.id, 5 * 60);
    return Response.json({ totpRequired: true, pendingToken: pending.token });
  }

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return apiError(401, 'invalid_credentials');
  }

  // Carry the guest device's watchlist + history into the account.
  const owner = await resolveOwner(request);
  if (owner.guestId) {
    try {
      await mergeGuestIntoUser(owner.guestId, user.id);
    } catch {
      // Migration is best-effort — never block sign-in.
    }
  }

  const session = await createSession(user.id, {
    userAgent: request.headers.get('user-agent'),
    ip: clientIpOf(request),
  });

  const response = Response.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    },
  });
  response.headers.append('Set-Cookie', sessionCookieValue(session));
  if (owner.guestId) {
    response.headers.append('Set-Cookie', clearGuestCookieValue());
  }
  return response;
});
