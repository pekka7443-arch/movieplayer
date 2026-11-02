import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner, verifyPassword } from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { guardMutation, readJsonBody } from '@/lib/server/http';
import { appBaseUrl, mailer } from '@/lib/server/mailer';
import { createEmailVerificationToken } from '@/lib/server/tokens';
import { writeAudit } from '@/lib/server/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  password: z.string().min(1).max(100),
  newEmail: z.string().trim().toLowerCase().email().max(120),
});

/**
 * POST /api/account/email { password, newEmail } → change the account email.
 * Requires the CURRENT password (anti-hijack). The new address must be free;
 * the change applies immediately and the account re-enters the unverified
 * state — a fresh verification link goes to the NEW address.
 */
export const POST = withApi('account/email', async (request) => {
  const guard = await guardMutation(request, 'account');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  if (!owner.userId) return apiError(401, 'unauthorized');

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError(400, 'bad_request');
  const { password, newEmail } = parsed.data;

  const user = await db.user.findUnique({ where: { id: owner.userId } });
  if (!user) return apiError(401, 'unauthorized');
  if (!verifyPassword(password, user.passwordHash)) {
    return apiError(401, 'invalid_credentials');
  }
  if (newEmail === user.email) {
    return apiError(400, 'bad_request', 'That is already your email.');
  }
  const taken = await db.user.findUnique({ where: { email: newEmail }, select: { id: true } });
  if (taken) return apiError(409, 'email_taken');

  await db.user.update({
    where: { id: user.id },
    data: { email: newEmail, emailVerified: null },
  });

  let verificationSent = false;
  try {
    const { token } = await createEmailVerificationToken(user.id, 24 * 60 * 60);
    const url = `${appBaseUrl(request)}/verify-email?token=${encodeURIComponent(token)}`;
    await mailer().send({
      to: newEmail,
      subject: 'Verify your new CineDeck email',
      text: `Your CineDeck email was changed to this address. Confirm it:\n${url}\n\nThe link works for 24 hours. If this wasn't you, sign in with your password and change the email back immediately.`,
      actionUrl: url,
    });
    verificationSent = true;
  } catch {
    // Non-fatal — the change itself already applied.
  }

  await writeAudit({
    actorId: user.id,
    actorEmail: newEmail,
    action: 'account.email_changed',
    targetType: 'user',
    targetId: user.id,
    targetLabel: newEmail,
    details: { previousEmailDomain: user.email.split('@')[1] ?? null, verificationSent },
  });

  return Response.json({ ok: true, email: newEmail, verificationSent });
});
