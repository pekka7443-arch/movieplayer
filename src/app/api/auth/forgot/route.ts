import { z } from 'zod';

import { db } from '@/lib/db';
import { signStatelessToken } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { appBaseUrl, mailer } from '@/lib/server/mailer';

export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(120) });

/**
 * POST /api/auth/forgot → always answers 200 with a generic body, whether or
 * not the address exists. Real users receive a 30-minute reset link through
 * the mailer adapter (console logger in dev).
 */
export const POST = withApi('auth/forgot', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'forgotPassword');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Same generic answer — do not confirm address validity either.
    return Response.json({ ok: true });
  }

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (user) {
    const { token, expiresAt } = signStatelessToken('reset', user.id, 30 * 60);
    const url = `${appBaseUrl(request)}/?view=reset&token=${encodeURIComponent(token)}`;
    await mailer().send({
      to: user.email,
      subject: 'CineDeck password reset',
      text: `Hi${user.name ? ` ${user.name}` : ''}!\n\nReset your CineDeck password within 30 minutes:\n${url}\n\nIf you didn't ask for this, ignore the message — your password stays unchanged.`,
      actionUrl: url,
    });
    void expiresAt;
  }

  return Response.json({ ok: true });
});
