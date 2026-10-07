import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { matchBackupCode, verifyTotp } from '@/lib/server/totp';
import { writeAudit } from '@/lib/server/audit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ code: z.string().min(6).max(10) });

/**
 * POST /api/account/totp/disable { code } — requires a valid current code
 * (live TOTP **or** a backup code) so a stolen session cannot silently
 * strip 2FA.
 */
export const POST = withApi('account/totp/disable', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'account');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError(400, 'bad_request');

  const owner = await resolveOwner(request);
  if (!owner.userId) return apiError(401, 'unauthorized');

  const user = await db.user.findUnique({
    where: { id: owner.userId },
    select: { email: true, totpSecret: true, totpEnabled: true, backupCodes: true },
  });
  if (!user?.totpEnabled || !user.totpSecret) {
    return apiError(400, 'totp_not_enabled');
  }
  const liveCodeOk = verifyTotp(user.totpSecret, parsed.data.code);
  const backup = liveCodeOk ? { matched: false, remaining: null as string[] | null } : matchBackupCode(user.backupCodes, parsed.data.code);
  if (!liveCodeOk && !backup.matched) {
    return apiError(401, 'invalid_code');
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
  return Response.json({ ok: true, totpEnabled: false });
});
