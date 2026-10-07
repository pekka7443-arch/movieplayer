import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { generateBackupCodes, hashBackupCodes, verifyTotp } from '@/lib/server/totp';
import { writeAudit } from '@/lib/server/audit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ code: z.string().min(6).max(10) });

/**
 * POST /api/account/totp/enable { code } → verify a live code from the
 * authenticator, switch 2FA on and issue 10 one-time backup codes. The
 * plaintext codes are returned EXACTLY ONCE — only SHA-256 hashes are stored.
 */
export const POST = withApi('account/totp/enable', async (request) => {
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
    select: { email: true, totpSecret: true, totpEnabled: true },
  });
  if (!user?.totpSecret) {
    return apiError(400, 'totp_not_setup');
  }
  if (user.totpEnabled) {
    return apiError(409, 'totp_already_enabled');
  }
  if (!verifyTotp(user.totpSecret, parsed.data.code)) {
    return apiError(401, 'invalid_code');
  }

  const backupCodes = generateBackupCodes(10);
  await db.user.update({
    where: { id: owner.userId },
    data: { totpEnabled: true, backupCodes: hashBackupCodes(backupCodes) },
  });
  await writeAudit({
    actorId: owner.userId,
    actorEmail: user.email,
    action: 'twofa.enabled',
    targetType: 'user',
    targetId: owner.userId,
    targetLabel: user.email,
  });
  return Response.json({ ok: true, totpEnabled: true, backupCodes });
});
