import { z } from 'zod';

import { db } from '@/lib/db';
import { signStatelessToken, verifyStatelessToken } from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { appBaseUrl, mailer } from '@/lib/server/mailer';

export const dynamic = 'force-dynamic';

const schema = z.object({ token: z.string().min(20).max(400) });

/**
 * POST /api/auth/verify → confirm an email-verification token (24h validity).
 * Successful verification is permanent on the account.
 */
export const POST = withApi('auth/verify', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'verifyEmail');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'invalid_token');
  }

  const payload = verifyStatelessToken(parsed.data.token, 'verify');
  if (!payload) {
    return apiError(400, 'invalid_token');
  }

  const user = await db.user.update({
    where: { id: payload.userId },
    data: { emailVerified: new Date() },
    select: { email: true, name: true },
  }).catch(() => null);

  if (!user) {
    return apiError(400, 'invalid_token');
  }

  return Response.json({ ok: true, email: user.email });
});

/**
 * GET variant for plain links (emails): /api/auth/verify?token=…
 * Bounces to the /verify-email page, which confirms via the POST endpoint
 * and renders a proper result screen.
 */
export const GET = withApi('auth/verify-get', async (request) => {
  const limited = enforceRateLimit(request, 'verifyEmail');
  if (limited) return limited;

  const token = new URL(request.url).searchParams.get('token') ?? '';
  return Response.redirect(
    `${appBaseUrl(request)}/verify-email${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    302,
  );
});

/** Re-send a verification link (authenticated, throttled). */
export const PUT = withApi('auth/verify-resend', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'verifyEmail');
  if (limited) return limited;

  const body = (await readJsonBody(request)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email) return apiError(400, 'bad_request');

  const user = await db.user.findUnique({ where: { email } });
  if (user && user.emailVerified === null) {
    const { token } = signStatelessToken('verify', user.id, 24 * 60 * 60);
    const url = `${appBaseUrl(request)}/verify-email?token=${encodeURIComponent(token)}`;
    await mailer().send({
      to: user.email,
      subject: 'Verify your CineDeck email',
      text: `Confirm your email address:\n${url}\n\nThe link works for 24 hours.`,
      actionUrl: url,
    });
  }
  return Response.json({ ok: true });
});
