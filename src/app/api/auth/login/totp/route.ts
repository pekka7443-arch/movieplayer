import { z } from 'zod';

import { db } from '@/lib/db';
import {
  clearGuestCookieValue,
  createSession,
  mergeGuestIntoUser,
  resolveOwner,
  sessionCookieValue,
  verifyStatelessToken,
} from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit, clientIpOf } from '@/lib/server/rate-limit';
import { verifyTotp } from '@/lib/server/totp';

export const dynamic = 'force-dynamic';

const schema = z.object({
  pendingToken: z.string().min(20).max(400),
  code: z.string().min(6).max(10),
});

// POST /api/auth/login/totp → complete a 2FA login. The pendingToken comes
// from /api/auth/login and only exists after a correct password.
export const POST = withApi('auth/login/totp', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'totp');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_code' }, { status: 400 });
  }

  const payload = verifyStatelessToken(parsed.data.pendingToken, 'totp');
  if (!payload) {
    return Response.json({ error: 'pending_expired' }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      totpSecret: true,
      totpEnabled: true,
    },
  });
  if (!user || !user.totpEnabled || !user.totpSecret) {
    return Response.json({ error: 'invalid_code' }, { status: 401 });
  }

  if (!verifyTotp(user.totpSecret, parsed.data.code)) {
    return Response.json({ error: 'invalid_code' }, { status: 401 });
  }

  const owner = await resolveOwner(request);
  if (owner.guestId) {
    try {
      await mergeGuestIntoUser(owner.guestId, user.id);
    } catch {
      // best-effort — never block sign-in
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
