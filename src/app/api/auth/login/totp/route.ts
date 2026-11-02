import { z } from 'zod';

import { db } from '@/lib/db';
import {
  clearGuestCookieValue,
  createSession,
  mergeGuestIntoUser,
  resolveOwner,
  sessionCookieValue,
} from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit, clientIpOf } from '@/lib/server/rate-limit';
import { matchBackupCode, verifyTotp } from '@/lib/server/totp';
import { openStoredSecret } from '@/lib/server/crypto-sealed';
import { consumeAuthChallenge } from '@/lib/server/tokens';
import { geoLookup, truncateIp } from '@/lib/server/geo';
import {
  adminLoginGuard,
  isAdminLoginFromNewDevice,
  notifyAdminNewDeviceLogin,
} from '@/lib/server/admin-security';

export const dynamic = 'force-dynamic';

const schema = z.object({
  pendingToken: z.string().min(20).max(400),
  code: z.string().min(6).max(10),
});

/** Soft-deleted accounts recover for 30 days (mirrors /api/auth/login). */
const DELETE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

// POST /api/auth/login/totp → complete a 2FA login. The pendingToken comes
// from /api/auth/login and only exists after a correct password; it is a
// SINGLE-USE DB-backed challenge — consumption is atomic, so the same token
// can complete exactly ONE login (replay → 401, 2026-11-03 hardening).
// The code is either a live authenticator value or a one-time backup code.
// A backup code is consumed via a conditional UPDATE inside a transaction:
// if consumption fails (DB error or concurrent race), NO session is issued.
export const POST = withApi('auth/login/totp', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = await enforceRateLimit(request, 'totp');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'invalid_code');
  }

  // Atomic single-use consumption — a second presentation of the same
  // pendingToken (replay) is rejected here.
  const payload = await consumeAuthChallenge(parsed.data.pendingToken, 'totp');
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

  // Decrypt the stored secret (AES-256-GCM; legacy plaintext tolerated for
  // pre-hardening accounts and re-sealed lazily below).
  const secret = openStoredSecret(user.totpSecret, user.id);
  if (!secret) {
    return apiError(401, 'invalid_code');
  }

  const liveCodeOk = verifyTotp(secret, parsed.data.code);
  const backup = liveCodeOk
    ? { matched: false, remaining: null as string[] | null, stored: null as string | null }
    : matchBackupCode(user.backupCodes, parsed.data.code);
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

  // A used backup code is consumed ATOMICALLY: the conditional update only
  // lands when the stored hash list is still the one we matched against. A
  // concurrent login that spent the same code makes count = 0 → this
  // attempt is rejected. A DB failure → 500, NO session issued.
  if (backup.matched && backup.remaining) {
    const storedJson = user.backupCodes as string;
    try {
      const consumed = await db.user.updateMany({
        where: { id: user.id, backupCodes: storedJson },
        data: { backupCodes: JSON.stringify(backup.remaining) },
      });
      if (consumed.count !== 1) {
        // Lost the race — the code was just spent by another request.
        return apiError(401, 'invalid_code');
      }
    } catch {
      return apiError(500, 'internal_error');
    }
  }

  const ip = clientIpOf(request);
  const userAgent = request.headers.get('user-agent');
  const geo = geoLookup(ip);
  const logAttempt = (userId: string | null, success: boolean, reason: string) => {
    void db.loginAttempt
      .create({
        data: {
          email: user.email,
          userId,
          success,
          reason,
          ip: truncateIp(ip),
          userAgent: userAgent?.slice(0, 200) ?? null,
          country: geo.country,
          city: geo.city,
        },
      })
      .catch(() => undefined);
  };

  // --- Admin-only login guards (IP allowlist + device cap) — mirrors login.
  if (user.role === 'admin') {
    const blocked = await adminLoginGuard({
      user: { id: user.id, email: user.email, role: user.role },
      ip,
      userAgent,
      logAttempt,
    });
    if (blocked) return blocked;
    if (await isAdminLoginFromNewDevice(user.id, userAgent)) {
      await notifyAdminNewDeviceLogin({
        userId: user.id,
        email: user.email,
        ip,
        userAgent,
        country: geo.country,
        city: geo.city,
      });
    }
  }

  const owner = await resolveOwner(request);
  if (owner.guestId) {
    try {
      await mergeGuestIntoUser(owner.guestId, user.id);
    } catch {
      // best-effort — never block sign-in
    }
  }

  const session = await createSession(user.id, {
    userAgent,
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
        userAgent: userAgent?.slice(0, 200) ?? null,
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
