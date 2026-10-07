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
import { signStatelessToken } from '@/lib/server/auth';
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
// { totpRequired: true, pendingToken } — the client posts the code to
// /api/auth/login/totp to finish signing in. Generic `invalid_credentials`
// error for any failure so account existence is never revealed.
//
// Suspension: blocked with 403 account_suspended (reason shown). A suspension
// whose end date has passed lifts automatically on the next attempt.
// Soft-deleted accounts reactivate automatically within the 30-day grace.
export const POST = withApi('auth/login', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const limited = enforceRateLimit(request, 'login');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = loginSchema.safeParse(body);
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
    // Password is right — hand out a 5-minute pending token for the 2FA step.
    const pending = signStatelessToken('totp', user.id, 5 * 60);
    logAttempt(user.id, true, 'totp_pending');
    return Response.json({ totpRequired: true, pendingToken: pending.token });
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
