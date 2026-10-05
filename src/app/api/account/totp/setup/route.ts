import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { generateTotpSecret } from '@/lib/server/totp';

export const dynamic = 'force-dynamic';

/**
 * POST /api/account/totp/setup → generate a fresh TOTP secret for the
 * account. The secret is stored but NOT active until /totp/enable verifies a
 * live code — re-running setup simply replaces the pending secret.
 * Returns the base32 secret + otpauth:// URL (paste into any authenticator;
 * a QR renderer can consume the URL client-side).
 */
export const POST = withApi('account/totp/setup', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'account');
  if (limited) return limited;

  const owner = await resolveOwner(request);
  if (!owner.userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: owner.userId },
    select: { email: true, totpEnabled: true },
  });
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (user.totpEnabled) {
    return Response.json({ error: 'totp_already_enabled' }, { status: 409 });
  }

  const { secret, otpauthUrl } = generateTotpSecret(user.email);
  await db.user.update({ where: { id: owner.userId }, data: { totpSecret: secret } });

  return Response.json({ secret, otpauthUrl });
});
