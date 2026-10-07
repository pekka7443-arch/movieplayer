import { z } from 'zod';

import { db } from '@/lib/db';
import {
  clearGuestCookieValue,
  createSession,
  mergeGuestIntoUser,
  resolveOwner,
  sessionCookieValue,
  verifyStatelessToken,
} from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit, clientIpOf } from '@/lib/server/rate-limit';
import { matchBackupCode, verifyTotp } from '@/lib/server/totp';
import { geoLookup, truncateIp } from '@/lib/server/geo';

export const dynamic = 'force-dynamic';

const schema = z.object({
  pendingToken: z.string().min(20).max(400),
  code: z.string().min(6).max(10),
});

/** Soft-deleted accounts recover for 30 days (mirrors /api/auth/login). */
const DELETE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

// POST /api/auth/login/totp → complete a 2FA login. The pendingToken comes
// from /api/auth/login and only exists after a correct password. The code is
// either a live authenticator value or a one-time backup code.
export const POST = withApi('auth/login/totp', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'totp');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'invalid_code');
  }

  const payload = verifyStatelessToken(parsed.data.pendingToken, 'totp');
  if (!payload) {
    return apiError(401, 'pending_expired');
  }

  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      avatar: true,
      mustChangePassword: true,
      createdAt: true,
      deletedAt: true,
      suspendedAt: true,
      suspensionReason: true,
      suspensionEndsAt: true,
      totpSecret: true,
      totpEnabled: true,
      backupCodes: true,
    },
  });
  if (!user || !user.totpEnabled || !user.totpSecret) {
    return apiError(401, 'invalid_code');
  }

  const liveCodeOk = verifyTotp(user.totpSecret, parsed.data.code);
  const backup = liveCodeOk ? { matched: false, remaining: null as string[] | null } : matchBackupCode(user.backupCodes, parsed.data.code);
  if (!liveCodeOk && !backup.matched) {
    return apiError(401, 'invalid_code');
  }

  // Soft-deleted accounts: reactivate within the grace window.
  if (user.deletedAt && Date.now() - user.deletedAt.getTime() > DELETE_GRACE_MS) {
    return apiError(401, 'invalid_credentials');
  }
  if (user.deletedAt) {
    await db.user.update({ where: { id: user.id }, data: { deletedAt: null } });
  }

  // Suspension blocks the login even with a valid code.
  if (user.suspendedAt && (!user.suspensionEndsAt || user.suspensionEndsAt.getTime() > Date.now())) {
    const reason = user.suspensionReason?.slice(0, 200) ?? 'Policy violation';
    return Response.json(
      {
        error: {
          code: 'account_suspended',
          message: `Your account has been suspended. Reason: ${reason}. Contact support if you think this is a mistake.`,
        },
      },
      { status: 403 },
    );
  }

  // A used backup code is consumed permanently.
  if (backup.matched && backup.remaining) {
    await db.user
      .update({ where: { id: user.id }, data: { backupCodes: JSON.stringify(backup.remaining) } })
      .catch(() => undefined);
  }

  const owner = await resolveOwner(request);
  if (owner.guestId) {
    try {
      await mergeGuestIntoUser(owner.guestId, user.id);
    } catch {
      // best-effort — never block sign-in
    }
  }

  const ip = clientIpOf(request);
  const geo = geoLookup(ip);
  const session = await createSession(user.id, {
    userAgent: request.headers.get('user-agent'),
    ip,
    country: geo.country,
    city: geo.city,
  });
  void db.loginAttempt
    .create({
      data: {
        email: user.email,
        userId: user.id,
        success: true,
        reason: backup.matched ? 'totp_backup' : 'totp_ok',
        ip: truncateIp(ip),
        userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null,
        country: geo.country,
        city: geo.city,
      },
    })
    .catch(() => undefined);

  const response = Response.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatar: user.avatar,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt.toISOString(),
    },
  });
  response.headers.append('Set-Cookie', sessionCookieValue(session));
  if (owner.guestId) {
    response.headers.append('Set-Cookie', clearGuestCookieValue());
  }
  return response;
});
