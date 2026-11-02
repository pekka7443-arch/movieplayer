import { db } from '@/lib/db';
import { requireRecentAuth, resolveOwner } from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { matchBackupCode, verifyTotp } from '@/lib/server/totp';
import { openStoredSecret } from '@/lib/server/crypto-sealed';
import { writeAudit } from '@/lib/server/audit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ code: z.string().min(6).max(10) });

/**
 * POST /api/account/totp/disable { code } — requires a valid current code
 * (live TOTP **or** a backup code) so a stolen session cannot silently
 * strip 2FA. 2026-11-03 hardening:
 *   * the stored secret is decrypted from sealed storage;
 *   * requires RECENT authentication (≤30 min since sign-in);
 *   * a backup code used here is consumed ATOMICALLY (conditional update) —
 *     on failure the disable does NOT proceed;
 *   * the user gets an in-app notification of the security change.
 */
export const POST = withApi('account/totp/disable', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = await enforceRateLimit(request, 'account');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError(400, 'bad_request');

  const owner = await resolveOwner(request);
  if (!owner.userId) return apiError(401, 'unauthorized');
  const recentAuthError = requireRecentAuth(owner.session);
  if (recentAuthError) return recentAuthError;

  const user = await db.user.findUnique({
    where: { id: owner.userId },
    select: { email: true, totpSecret: true, totpEnabled: true, backupCodes: true },
  });
  if (!user?.totpEnabled || !user.totpSecret) {
    return apiError(400, 'totp_not_enabled');
  }

  const secret = openStoredSecret(user.totpSecret, owner.userId);
  if (!secret) {
    return apiError(400, 'totp_not_enabled');
  }
  const liveCodeOk = verifyTotp(secret, parsed.data.code);
  const backup = liveCodeOk
    ? { matched: false, remaining: null as string[] | null }
    : matchBackupCode(user.backupCodes, parsed.data.code);
  if (!liveCodeOk && !backup.matched) {
    return apiError(401, 'invalid_code');
  }

  // Atomic backup-code consumption: the conditional update only lands when
  // the stored list is unchanged; a concurrent use of the same code makes
  // count = 0 → this attempt fails and 2FA stays ON.
  if (backup.matched && backup.remaining) {
    const storedJson = user.backupCodes as string;
    try {
      const consumed = await db.user.updateMany({
        where: { id: owner.userId, backupCodes: storedJson },
        data: { backupCodes: JSON.stringify(backup.remaining) },
      });
      if (consumed.count !== 1) {
        return apiError(401, 'invalid_code');
      }
    } catch {
      return apiError(500, 'internal_error');
    }
  }

  await db.user.update({
    where: { id: owner.userId },
    data: { totpEnabled: false, totpSecret: null, backupCodes: null },
  });
  await writeAudit({
    actorId: owner.userId,
    actorEmail: user.email,
    action: 'twofa.disabled',
    targetType: 'user',
    targetId: owner.userId,
    targetLabel: user.email,
    details: { via: liveCodeOk ? 'totp' : 'backup_code' },
  });
  // Security-change notification (in-app, best-effort).
  void db.notification
    .create({
      data: {
        userId: owner.userId,
        kind: 'system',
        payload: JSON.stringify({
          title: 'Two-factor authentication disabled',
          text: 'Two-factor authentication was turned off for your account. If this was not you, change your password immediately.',
        }),
      },
    })
    .catch(() => undefined);

  return Response.json({ ok: true, totpEnabled: false });
});
