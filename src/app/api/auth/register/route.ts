import { z } from 'zod';

import { db } from '@/lib/db';
import {
  clearGuestCookieValue,
  createSession,
  mergeGuestIntoUser,
  resolveOwner,
  sessionCookieValue,
} from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit, clientIpOf } from '@/lib/server/rate-limit';
import { checkPassword } from '@/lib/password';
import { geoLookup, truncateIp } from '@/lib/server/geo';
import { appBaseUrl, mailer } from '@/lib/server/mailer';
import { signStatelessToken } from '@/lib/server/auth';
import { isFlagEnabled } from '@/lib/server/flags';

export const dynamic = 'force-dynamic';

const registerSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(8).max(100),
});

/**
 * POST /api/auth/register → create account, merge guest data, start session,
 * and send a verification email (console adapter in dev). The user can use
 * the app immediately — verification is not a gate for anything.
 *
 * Anti-enumeration posture:
 *  - password policy violations are still validation errors (no info leak);
 *  - when EMAIL_VERIFICATION is on, EVERY signup answers with the same
 *    generic "verification sent" payload — existing accounts get a quiet
 *    notice email instead of an `email_taken` error;
 *  - with verification off (dev default) `email_taken` keeps the good UX.
 *
 * Admin comes from the env seed (ensureAdminSeed) — normal signups are
 * always role=user. When ADMIN_EMAIL is unset the first account on an empty
 * database still becomes admin (small self-hosted fallback).
 */
export const POST = withApi('auth/register', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'register');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'bad_request');
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
  // Admin feature flag: close signups entirely.
  if (await isFlagEnabled('registration')) {
    return apiError(403, 'registration_closed', 'Registration is temporarily closed. Please come back later.');
  }
  const existing = await db.user.findUnique({ where: { email } });

  if (existing) {
    if (verificationOn) {
      // Same generic answer as a fresh signup — no existence leak.
      return Response.json({ ok: true, verificationRequired: true });
    }
    return apiError(409, 'email_taken');
  }

  const isFirstUser = (await db.user.count()) === 0 && !process.env.ADMIN_EMAIL;
  const ip = clientIpOf(request);
  const geo = geoLookup(ip);
  const user = await db.user.create({
    data: {
      email,
      name: name ?? null,
      passwordHash: hashPassword(password),
      role: isFirstUser ? 'admin' : 'user',
      signupIp: truncateIp(ip),
      country: geo.country,
      city: geo.city,
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  // Verification email — always attempted; the console adapter prints it in
  // dev. The account works immediately regardless of verification state.
  let verificationSent = false;
  try {
    const { token } = signStatelessToken('verify', user.id, 24 * 60 * 60);
    const url = `${appBaseUrl(request)}/verify-email?token=${encodeURIComponent(token)}`;
    await mailer().send({
      to: user.email,
      subject: 'Verify your CineDeck email',
      text: `Welcome to CineDeck${name ? `, ${name}` : ''}!\n\nConfirm your email address:\n${url}\n\nThe link works for 24 hours. You can keep using the app right away.`,
      actionUrl: url,
    });
    verificationSent = true;
  } catch {
    // Non-fatal — the app is fully usable without verification.
  }

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
    ip,
    country: geo.country,
    city: geo.city,
  });

  const response = Response.json({
    user: { ...user, createdAt: user.createdAt.toISOString() },
    verificationSent,
  });
  response.headers.append('Set-Cookie', sessionCookieValue(session));
  if (owner.guestId) {
    response.headers.append('Set-Cookie', clearGuestCookieValue());
  }
  return response;
});
