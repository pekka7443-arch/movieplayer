import { z } from 'zod';

import { db } from '@/lib/db';
import {
  clearGuestCookieValue,
  createSession,
  mergeGuestIntoUser,
  resolveOwner,
  sessionCookieValue,
  verifyPassword,
} from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { enforceSameOrigin, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit, clientIpOf } from '@/lib/server/rate-limit';
import { createAuthChallenge } from '@/lib/server/tokens';
import { geoLookup, truncateIp, classifyUserAgent } from '@/lib/server/geo';
import { writeAudit } from '@/lib/server/audit';
import {
  adminLoginGuard,
  isAdminLoginFromNewDevice,
  notifyAdminNewDeviceLogin,
} from '@/lib/server/admin-security';

export const dynamic = 'force-dynamic';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(1).max(100),
});

/** Soft-deleted accounts recover for 30 days, then the cleanup purges them. */
const DELETE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

// POST /api/auth/login → verify credentials, merge guest data, start session.
// When the account has TOTP enabled the response instead carries
// { totpRequired: true, pendingToken } — the pendingToken is a SINGLE-USE
// DB-backed challenge (createAuthChallenge) consumed atomically by
// /api/auth/login/totp; replaying it after a completed login fails.
// Generic `invalid_credentials` error for any failure so account existence
// is never revealed.
//
// Rate limiting: per-IP bucket AND per-ACCOUNT bucket (email-keyed) — IP
// rotation cannot bypass the credential throttle (2026-11-03 hardening).
//
// Suspension: blocked with 403 account_suspended (reason shown). A suspension
// whose end date has passed lifts automatically on the next attempt.
// Soft-deleted accounts reactivate automatically within the 30-day grace.
export const POST = withApi('auth/login', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  const body = await readJsonBody(request);
  const parsed = loginSchema.safeParse(body);
  // Pre-parse the email so the ACCOUNT bucket applies even on a malformed
  // body (email still enumerable from the raw body when parseable).
  const rawEmail =
    typeof body === 'object' && body !== null && typeof (body as { email?: unknown }).email === 'string'
      ? ((body as { email: string }).email ?? '').trim().toLowerCase()
      : '';
  const limited = await enforceRateLimit(request, 'login', rawEmail || undefined);
  if (limited) return limited;

  if (!parsed.success) {
    return apiError(401, 'invalid_credentials');
  }
  const { email, password } = parsed.data;

  const ip = clientIpOf(request);
  const userAgent = request.headers.get('user-agent');
  const geo = geoLookup(ip);

  const logAttempt = (userId: string | null, success: boolean, reason: string) => {
    void db.loginAttempt
      .create({
        data: {
          email,
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

  const user = await db.user.findUnique({ where: { email } });

  if (user && user.totpEnabled && user.totpSecret && verifyPassword(password, user.passwordHash)) {
    // Password is right — hand out a 5-minute SINGLE-USE challenge for the
    // 2FA step (hash persisted, atomically consumed by the totp route).
    const { token } = await createAuthChallenge(user.id, 'totp', 5 * 60);
    logAttempt(user.id, true, 'totp_pending');
    return Response.json({ totpRequired: true, pendingToken: token });
  }

  if (!user || !verifyPassword(password, user.passwordHash)) {
    logAttempt(user?.id ?? null, false, 'bad_credentials');
    return apiError(401, 'invalid_credentials');
  }

  // --- Soft delete: reactivate within the grace window ------------------
  if (user.deletedAt) {
    if (Date.now() - user.deletedAt.getTime() > DELETE_GRACE_MS) {
      logAttempt(user.id, false, 'deleted');
      return apiError(401, 'invalid_credentials');
    }
    await db.user.update({ where: { id: user.id }, data: { deletedAt: null } });
    await writeAudit({
      actorEmail: user.email,
      action: 'account.reactivated',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      details: { via: 'login' },
    });
  }

  // --- Suspension: block, or auto-lift an expired suspension ------------
  if (user.suspendedAt) {
    const stillSuspended =
      !user.suspensionEndsAt || user.suspensionEndsAt.getTime() > Date.now();
    if (stillSuspended) {
      logAttempt(user.id, false, 'suspended');
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
    // Suspension window elapsed — lift it automatically.
    await db.user.update({
      where: { id: user.id },
      data: { suspendedAt: null, suspensionReason: null, suspensionEndsAt: null },
    });
    await writeAudit({
      actorEmail: user.email,
      action: 'suspension.auto_lifted',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      details: { endedAt: user.suspensionEndsAt?.toISOString() ?? null },
    });
  }

  // --- Admin-only login guards (IP allowlist + device cap) ---------------
  // Applies ONLY to role="admin" accounts: optional ADMIN_IP_ALLOWLIST check,
  // then the 3-active-session cap. Regular members are never limited.
  if (user.role === 'admin') {
    // Optional hard requirement: administrators must have 2FA enrolled
    // (ADMIN_REQUIRE_TOTP=1 — off by default so existing admins are never
    // locked out; documented in .env.example / the security report).
    if (process.env.ADMIN_REQUIRE_TOTP === '1' && !user.totpEnabled) {
      logAttempt(user.id, false, 'admin_totp_required');
      return apiError(
        403,
        'admin_totp_required',
        'Administrators must enable two-factor authentication before signing in. Ask another administrator to send you a password-reset with 2FA enrollment instructions.',
      );
    }
    const blocked = await adminLoginGuard({ user, ip, userAgent, logAttempt });
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
    if (!user.totpEnabled) {
      void writeAudit({
        actorEmail: user.email,
        action: 'admin.login_without_totp',
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        details: { note: 'admin account has no second factor enrolled' },
      }).catch(() => undefined);
    }
  }

  // Carry the guest device's watchlist + history into the account.
  const owner = await resolveOwner(request);
  if (owner.guestId) {
    try {
      await mergeGuestIntoUser(owner.guestId, user.id);
    } catch {
      // Migration is best-effort — never block sign-in.
    }
  }

  const session = await createSession(user.id, {
    userAgent,
    ip,
    country: geo.country,
    city: geo.city,
  });
  logAttempt(user.id, true, 'ok');

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
    ua: classifyUserAgent(userAgent),
  });
  response.headers.append('Set-Cookie', sessionCookieValue(session));
  if (owner.guestId) {
    response.headers.append('Set-Cookie', clearGuestCookieValue());
  }
  return response;
});
