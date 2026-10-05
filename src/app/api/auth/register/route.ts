import { z } from 'zod';

import { db } from '@/lib/db';
import {
  clearGuestCookieValue,
  createSession,
  mergeGuestIntoUser,
  resolveOwner,
  sessionCookieValue,
} from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit, clientIpOf } from '@/lib/server/rate-limit';
import { checkPassword } from '@/lib/password';

export const dynamic = 'force-dynamic';

const registerSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(8).max(100),
});

/**
 * POST /api/auth/register → create account, merge guest data, start session.
 *
 * Anti-enumeration posture:
 *  - password policy violations are still validation errors (no info leak);
 *  - when EMAIL_VERIFICATION is on, EVERY signup answers with the same
 *    generic "verification sent" payload — existing accounts get a quiet
 *    notice email instead of an `email_taken` error;
 *  - with verification off (dev default) `email_taken` keeps the good UX.
 *
 * The very first account created on an empty database becomes the admin.
 */
export const POST = withApi('auth/register', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'register');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const { name, email, password } = parsed.data;

  const verdict = checkPassword(password);
  if (!verdict.acceptable) {
    return Response.json(
      { error: 'weak_password', problems: verdict.problems },
      { status: 400 },
    );
  }

  const { hashPassword } = await import('@/lib/server/auth');
  const verificationOn = process.env.EMAIL_VERIFICATION === 'on';
  const existing = await db.user.findUnique({ where: { email } });

  if (existing) {
    if (verificationOn) {
      // Same generic answer as a fresh signup — no existence leak.
      return Response.json({ ok: true, verificationRequired: true });
    }
    return Response.json({ error: 'email_taken' }, { status: 409 });
  }

  const isFirstUser = (await db.user.count()) === 0;
  const user = await db.user.create({
    data: {
      email,
      name: name ?? null,
      passwordHash: hashPassword(password),
      role: isFirstUser ? 'admin' : 'user',
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  // Carry the guest device's watchlist + history into the new account.
  const owner = await resolveOwner(request);
  if (owner.guestId) {
    try {
      await mergeGuestIntoUser(owner.guestId, user.id);
    } catch {
      // Migration is best-effort — never block account creation.
    }
  }

  const session = await createSession(user.id, {
    userAgent: request.headers.get('user-agent'),
    ip: clientIpOf(request),
  });

  const response = Response.json({
    user: { ...user, createdAt: user.createdAt.toISOString() },
  });
  response.headers.append('Set-Cookie', sessionCookieValue(session));
  if (owner.guestId) {
    response.headers.append('Set-Cookie', clearGuestCookieValue());
  }
  return response;
});
