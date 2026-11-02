import { z } from 'zod';

import { db } from '@/lib/db';
import { withApi } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { createPasswordResetToken } from '@/lib/server/tokens';
import { appBaseUrl, mailer } from '@/lib/server/mailer';
import { logger } from '@/lib/server/logger';

export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(120) });

/**
 * POST /api/auth/forgot → always answers 200 with a generic body, whether or
 * not the address exists. Real users receive a 30-minute reset link through
 * the mailer adapter (console logger in dev). The reset token is a 256-bit
 * random value; only its SHA-256 hash is stored, outstanding tokens for the
 * account are revoked when a new one is minted, and consumption is atomic +
 * single-use in /api/auth/reset (2026-11-03 hardening).
 *
 * Rate limiting: per-IP AND per-account (email) buckets.
 * Email-delivery failures are logged server-side but NEVER change the public
 * response — a throwing SMTP transport must not become an account-existence
 * oracle (same request shape for existing and nonexistent addresses).
 */
export const POST = withApi('auth/forgot', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  const rawEmail =
    typeof body === 'object' && body !== null && typeof (body as { email?: unknown }).email === 'string'
      ? ((body as { email: string }).email ?? '').trim().toLowerCase()
      : '';
  const limited = await enforceRateLimit(request, 'forgotPassword', rawEmail || undefined);
  if (limited) return limited;

  if (!parsed.success) {
    // Same generic answer — do not confirm address validity either.
    return Response.json({ ok: true });
  }

  const user = await db.user.findUnique({ where: { email: parsed.data.email } }).catch(() => null);
  if (user && !user.deletedAt) {
    try {
      const { token } = await createPasswordResetToken(user.id, 30 * 60);
      const url = `${appBaseUrl(request)}/reset-password?token=${encodeURIComponent(token)}`;
      await mailer().send({
        to: user.email,
        subject: 'CineDeck password reset',
        text: `Hi${user.name ? ` ${user.name}` : ''}!\n\nReset your CineDeck password within 30 minutes:\n${url}\n\nIf you didn't ask for this, ignore the message — your password stays unchanged.`,
        actionUrl: url,
      });
    } catch (error) {
      // Delivery failure is an operational problem, not a signal to the
      // caller — the response stays identical to the no-account case.
      logger.error(
        { err: error instanceof Error ? { message: error.message } : error },
        'password reset email could not be delivered',
      );
    }
  }

  return Response.json({ ok: true });
});
