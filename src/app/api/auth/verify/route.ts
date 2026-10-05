import { z } from 'zod';

import { db } from '@/lib/db';
import { signStatelessToken, verifyStatelessToken } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
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
    return Response.json({ error: 'invalid_token' }, { status: 400 });
  }

  const payload = verifyStatelessToken(parsed.data.token, 'verify');
  if (!payload) {
    return Response.json({ error: 'invalid_token' }, { status: 400 });
  }

  const user = await db.user.update({
    where: { id: payload.userId },
    data: { emailVerified: new Date() },
    select: { email: true, name: true },
  }).catch(() => null);

  if (!user) {
    return Response.json({ error: 'invalid_token' }, { status: 400 });
  }

  return Response.json({ ok: true, email: user.email });
});

/**
 * GET variant for plain links (emails): /api/auth/verify?token=…
 * Redirects to the app with a result flag.
 */
export const GET = withApi('auth/verify-get', async (request) => {
  const limited = enforceRateLimit(request, 'verifyEmail');
  if (limited) return limited;

  const token = new URL(request.url).searchParams.get('token') ?? '';
  const payload = token ? verifyStatelessToken(token, 'verify') : null;
  if (!payload) {
    return Response.redirect(`${appBaseUrl(request)}/?verified=0`, 302);
  }
  await db.user
    .update({ where: { id: payload.userId }, data: { emailVerified: new Date() } })
    .catch(() => null);
  return Response.redirect(`${appBaseUrl(request)}/?verified=1`, 302);
});

/** Re-send a verification link (authenticated, throttled). */
export const PUT = withApi('auth/verify-resend', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'verifyEmail');
  if (limited) return limited;

  const body = (await readJsonBody(request)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email) return Response.json({ error: 'bad_request' }, { status: 400 });

  const user = await db.user.findUnique({ where: { email } });
  if (user && user.emailVerified === null) {
    const { token } = signStatelessToken('verify', user.id, 24 * 60 * 60);
    const url = `${appBaseUrl(request)}/?verified-token=${encodeURIComponent(token)}`;
    await mailer().send({
      to: user.email,
      subject: 'Verify your CineDeck email',
      text: `Confirm your email address:\n${url}\n\nThe link works for 24 hours.`,
      actionUrl: url,
    });
  }
  return Response.json({ ok: true });
});
