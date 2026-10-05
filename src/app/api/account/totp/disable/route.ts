import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
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
  if (!parsed.success) return Response.json({ error: 'bad_request' }, { status: 400 });

  const owner = await resolveOwner(request);
  if (!owner.userId) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const user = await db.user.findUnique({
    where: { id: owner.userId },
    select: { totpSecret: true, totpEnabled: true },
  });
  if (!user?.totpEnabled || !user.totpSecret) {
    return Response.json({ error: 'totp_not_enabled' }, { status: 400 });
  }
  if (!verifyTotp(user.totpSecret, parsed.data.code)) {
    return Response.json({ error: 'invalid_code' }, { status: 401 });
  }

  await db.user.update({
    where: { id: owner.userId },
    data: { totpEnabled: false, totpSecret: null },
  });
  return Response.json({ ok: true, totpEnabled: false });
});
