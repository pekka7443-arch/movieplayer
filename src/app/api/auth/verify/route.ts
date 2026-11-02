import { z } from 'zod';

import { db } from '@/lib/db';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { createEmailVerificationToken, consumeEmailVerificationToken } from '@/lib/server/tokens';
import { appBaseUrl, mailer } from '@/lib/server/mailer';
import { logger } from '@/lib/server/logger';

export const dynamic = 'force-dynamic';

const schema = z.object({ token: z.string().min(20).max(400) });

/**
 * POST /api/auth/verify → confirm an email-verification token (24h validity,
 * single-use — the token is a 256-bit random value stored as a hash and
 * consumed atomically; 2026-11-03 hardening). Successful verification is
 * permanent on the account. Replay of a used token → the same generic
 * invalid_token as an unknown one.
 */
export const POST = withApi('auth/verify', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = await enforceRateLimit(request, 'verifyEmail');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'invalid_token');
  }

  const payload = await consumeEmailVerificationToken(parsed.data.token);
  if (!payload) {
    return apiError(400, 'invalid_token');
  }

  const user = await db.user
    .update({
      where: { id: payload.userId },
      data: { emailVerified: new Date() },
      select: { email: true, name: true },
    })
    .catch(() => null);

  if (!user) {
    return apiError(400, 'invalid_token');
  }

  return Response.json({ ok: true, email: user.email });
});

/**
 * GET variant for plain links (emails): /api/auth/verify?token=…
 * Bounces to the /verify-email page, which confirms via the POST endpoint
 * and renders a proper result screen.
 *
 * The redirect target is RELATIVE — an absolute URL built from request
 * headers is a host-header-poisoning / open-redirect vector, and relative
 * Location headers are honored by every browser (RFC 7231).
 */
export const GET = withApi('auth/verify-get', async (request) => {
  const limited = await enforceRateLimit(request, 'verifyEmail');
  if (limited) return limited;

  const token = new URL(request.url).searchParams.get('token') ?? '';
  const location = `/verify-email${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
});

/** Re-send a verification link (authenticated or email-shaped, throttled). */
export const PUT = withApi('auth/verify-resend', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = await enforceRateLimit(request, 'verifyEmail');
  if (limited) return limited;

  const body = (await readJsonBody(request)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email) return apiError(400, 'bad_request');

  const user = await db.user.findUnique({ where: { email } }).catch(() => null);
  if (user && user.emailVerified === null && !user.deletedAt) {
    try {
      const { token } = await createEmailVerificationToken(user.id, 24 * 60 * 60);
      const url = `${appBaseUrl(request)}/verify-email?token=${encodeURIComponent(token)}`;
      await mailer().send({
        to: user.email,
        subject: 'Verify your CineDeck email',
        text: `Confirm your email address:\n${url}\n\nThe link works for 24 hours.`,
        actionUrl: url,
      });
    } catch (error) {
      // Delivery failure must not distinguish existing accounts.
      logger.error(
        { err: error instanceof Error ? { message: error.message } : error },
        'verification email could not be delivered',
      );
    }
  }
  return Response.json({ ok: true });
});
