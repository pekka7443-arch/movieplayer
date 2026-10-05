import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { verifyTotp } from '@/lib/server/totp';

export const dynamic = 'force-dynamic';

const schema = z.object({ code: z.string().min(6).max(10) });

/**
 * POST /api/account/totp/disable { code } — requires a valid current code so
 * a stolen session cannot silently strip 2FA.
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
    select: { totpSecret: true, totpEnabled: true },
  });
  if (!user?.totpEnabled || !user.totpSecret) {
    return apiError(400, 'totp_not_enabled');
  }
  if (!verifyTotp(user.totpSecret, parsed.data.code)) {
    return apiError(401, 'invalid_code');
  }

  await db.user.update({
    where: { id: owner.userId },
    data: { totpEnabled: false, totpSecret: null },
  });
  return Response.json({ ok: true, totpEnabled: false });
});
