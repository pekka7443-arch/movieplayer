import QRCode from 'qrcode';

import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { generateTotpSecret } from '@/lib/server/totp';

export const dynamic = 'force-dynamic';

/**
 * POST /api/account/totp/setup → generate a fresh TOTP secret for the
 * account. The secret is stored but NOT active until /totp/enable verifies a
 * live code — re-running setup simply replaces the pending secret.
 * Returns the base32 secret, the otpauth:// URL AND a QR code data URL so
 * the settings UI can render a scannable code without any client-side
 * QR library.
 */
export const POST = withApi('account/totp/setup', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'account');
  if (limited) return limited;

  const owner = await resolveOwner(request);
  if (!owner.userId) {
    return apiError(401, 'unauthorized');
  }

  const user = await db.user.findUnique({
    where: { id: owner.userId },
    select: { email: true, totpEnabled: true },
  });
  if (!user) return apiError(401, 'unauthorized');
  if (user.totpEnabled) {
    return apiError(409, 'totp_already_enabled');
  }

  const { secret, otpauthUrl } = generateTotpSecret(user.email);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
    width: 256,
    margin: 1,
    color: { dark: '#18181b', light: '#ffffff' },
  });
  await db.user.update({ where: { id: owner.userId }, data: { totpSecret: secret } });

  return Response.json({ secret, otpauthUrl, qrDataUrl });
});
