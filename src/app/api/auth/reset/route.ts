import { z } from 'zod';

import { hashPassword } from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { consumePasswordResetToken } from '@/lib/server/tokens';
import { checkPassword } from '@/lib/password';
import { writeAudit } from '@/lib/server/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  token: z.string().min(20).max(400),
  password: z.string().min(8).max(100),
});

/**
 * POST /api/auth/reset → consume the reset token, update the password and
 * revoke every existing session (a stolen session dies with the reset).
 *
 * Token contract (2026-11-03 hardening):
 *   * 256-bit cryptographically random, stored as SHA-256 hash only;
 *   * single-use — the `usedAt` claim, the password update and the session
 *     revocation all happen in ONE transaction whose first statement is a
 *     conditional `updateMany WHERE usedAt IS NULL`, so concurrent
 *     presentations of the same token race and exactly one wins;
 *   * 30-minute expiry enforced at consumption;
 *   * replay after use → the same generic invalid_token as an unknown token.
 */
export const POST = withApi('auth/reset', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = await enforceRateLimit(request, 'resetPassword');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'bad_request');
  }

  const verdict = checkPassword(parsed.data.password);
  if (!verdict.acceptable) {
    return Response.json(
      { error: 'weak_password', problems: verdict.problems },
      { status: 400 },
    );
  }

  const applied = await consumePasswordResetToken(parsed.data.token, async (tx, userId) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(parsed.data.password), mustChangePassword: false },
    });
    // Sessions are revoked by the shared transaction (see tokens.ts).
    void writeAudit({
      actorEmail: null,
      action: 'account.password_reset',
      targetType: 'user',
      targetId: userId,
      targetLabel: null,
      details: { via: 'reset_token', sessionsRevoked: true },
    }).catch(() => undefined);
  });

  if (!applied) {
    return apiError(400, 'invalid_token');
  }

  return Response.json({ ok: true });
});
