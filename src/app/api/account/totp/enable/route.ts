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
 * POST /api/account/totp/enable { code } → verify a live code from the
 * authenticator and switch 2FA on for the account.
 */
export const POST = withApi('account/totp/enable', async (request) => {
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
  if (!user?.totpSecret) {
    return Response.json({ error: 'totp_not_setup' }, { status: 400 });
  }
  if (user.totpEnabled) {
    return Response.json({ error: 'totp_already_enabled' }, { status: 409 });
  }
  if (!verifyTotp(user.totpSecret, parsed.data.code)) {
    return Response.json({ error: 'invalid_code' }, { status: 401 });
  }

  await db.user.update({ where: { id: owner.userId }, data: { totpEnabled: true } });
  return Response.json({ ok: true, totpEnabled: true });
});
