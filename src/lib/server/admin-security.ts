// Admin-specific login security (spec: admin device/session limits).
//
// 1. DEVICE CAP — role="admin" accounts may hold at most ADMIN_SESSION_LIMIT
//    active sessions. A login that would exceed the cap is rejected with a
//    clear, actionable message. Regular (role="user") accounts are unlimited.
// 2. IP ALLOWLIST — when ADMIN_IP_ALLOWLIST is set (comma-separated), admin
//    logins from any other IP are rejected. When the variable is unset or
//    empty the check is skipped entirely (dev + z.ai previews keep working).
// 3. NEW-DEVICE ALERT — a successful admin login from a userAgent that has
//    never signed in before is written to the audit log (prominently, with
//    device/browser/country/timestamp) and — when SMTP_URL is configured —
//    an email alert is sent to the admin's address.
//
// Server-only. Never import from client components.

import { db } from '@/lib/db';
import { apiError } from '@/lib/server/api';
import { writeAudit } from '@/lib/server/audit';
import { classifyUserAgent, truncateIp } from '@/lib/server/geo';
import { logger } from '@/lib/server/logger';
import { mailer } from '@/lib/server/mailer';

/** Maximum concurrent active sessions for role="admin" accounts. */
export const ADMIN_SESSION_LIMIT = 3;

/** Exact copy required by the spec — surfaced verbatim in the auth dialog. */
export const ADMIN_DEVICE_LIMIT_MESSAGE =
  "Maximum device limit reached. Log out from another device first or use 'Log out all devices' in settings.";
export const ADMIN_IP_BLOCKED_MESSAGE = 'Login not allowed from this network.';

// ---------------------------------------------------------------------------
// Device cap
// ---------------------------------------------------------------------------

/** Count the admin's currently active (unexpired) sessions. */
export async function countActiveSessions(userId: string): Promise<number> {
  return db.session.count({ where: { userId, expiresAt: { gt: new Date() } } });
}

/**
 * True when the account already holds >= limit active sessions, i.e. a new
 * login must be rejected. Only meaningful for admin accounts.
 */
export async function adminSessionLimitReached(
  userId: string,
  limit: number = ADMIN_SESSION_LIMIT,
): Promise<boolean> {
  const count = await countActiveSessions(userId);
  return count >= limit;
}

// ---------------------------------------------------------------------------
// IP allowlist (optional, env-driven)
// ---------------------------------------------------------------------------

/**
 * Parse ADMIN_IP_ALLOWLIST. Empty/whitespace entries are dropped.
 * Returns an empty list when the variable is unset or blank — the caller
 * treats that as "allowlist disabled".
 */
export function parseAdminIpAllowlist(raw?: string): string[] {
  const value = (raw ?? process.env.ADMIN_IP_ALLOWLIST ?? '').trim();
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Canonicalize an IP for comparison (handles ::ffff: IPv4-mapped forms). */
function normalizeIp(value: string): string | null {
  let v = value.trim().toLowerCase();
  if (!v) return null;
  v = v.split('%')[0] ?? v; // drop IPv6 zone index (fe80::1%eth0)
  const mapped = v.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1]) v = mapped[1];
  return v || null;
}

/**
 * Allowlist check. An unset/empty allowlist allows everything (check
 * skipped). With an allowlist configured, only exact (normalized) matches
 * pass — including the dev placeholder "local", which is rejected like any
 * other unknown IP so a misconfigured allowlist never silently widens.
 */
export function adminIpAllowed(ip: string | null | undefined, list?: string[]): boolean {
  const allow = list ?? parseAdminIpAllowlist();
  if (allow.length === 0) return true; // not configured → skip the check
  if (!ip) return false;
  const candidate = normalizeIp(ip);
  if (!candidate) return false;
  return allow.some((entry) => normalizeIp(entry) === candidate);
}

// ---------------------------------------------------------------------------
// New-device detection + notification
// ---------------------------------------------------------------------------

/** LoginAttempt reasons that prove this exact browser signed in before. */
const SEEN_DEVICE_REASONS = ['ok', 'totp_ok', 'totp_backup'] as const;

/**
 * True when NO prior session row and NO prior successful login attempt
 * exists for this exact userAgent — i.e. this browser has never signed in.
 * (Both tables are append-only, so a logged-out or expired device still
 * counts as "known".)
 */
export async function isAdminLoginFromNewDevice(
  userId: string,
  userAgent: string | null | undefined,
): Promise<boolean> {
  const ua = userAgent?.slice(0, 200) ?? null;
  const [priorSession, priorAttempt] = await Promise.all([
    db.session.findFirst({ where: { userId, userAgent: ua }, select: { id: true } }),
    db.loginAttempt.findFirst({
      where: { userId, success: true, userAgent: ua, reason: { in: [...SEEN_DEVICE_REASONS] } },
      select: { id: true },
    }),
  ]);
  return !priorSession && !priorAttempt;
}

export interface AdminLoginEvent {
  userId: string;
  email: string;
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  city: string | null;
}

/**
 * Record a successful admin login from a new device: audit-log entry (shows
 * in the admin Audit tab), a warning line in the live Logs panel, and — when
 * SMTP_URL is configured — an email alert to the admin's own address.
 * Never throws: a failed notification must not break the login.
 */
export async function notifyAdminNewDeviceLogin(event: AdminLoginEvent): Promise<void> {
  const { browser, device } = classifyUserAgent(event.userAgent);
  const at = new Date().toISOString();
  const where = [event.city, event.country].filter(Boolean).join(', ') || 'unknown location';

  await writeAudit({
    actorId: event.userId,
    actorEmail: event.email,
    action: 'admin.login_new_device',
    targetType: 'user',
    targetId: event.userId,
    targetLabel: event.email,
    details: {
      device,
      browser,
      country: event.country,
      city: event.city,
      ip: truncateIp(event.ip),
      userAgent: event.userAgent?.slice(0, 200) ?? null,
      at,
    },
  });
  logger.warn(
    {
      email: event.email,
      device,
      browser,
      country: event.country,
      city: event.city,
      ip: truncateIp(event.ip),
      at,
    },
    `ADMIN LOGIN from a new device — ${browser} on ${device} (${where})`,
  );

  if (process.env.SMTP_URL) {
    try {
      await mailer().send({
        to: event.email,
        subject: 'New login to your admin account',
        text:
          `New login to your admin account from ${event.country ?? where} using ${browser} ` +
          `at ${at}. Device class: ${device}. If this wasn't you, revoke the session in ` +
          `Admin → My sessions (or Settings → Security) and change your password.`,
      });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? { message: error.message } : error },
        'admin new-device email alert failed (non-fatal)',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The guard itself — shared by /api/auth/login and /api/auth/login/totp
// ---------------------------------------------------------------------------

export interface AdminLoginGuardInput {
  user: { id: string; email: string; role: string };
  ip: string | null;
  userAgent: string | null;
  /** Mirrors the login route's attempt ledger (reason: admin_ip_blocked / admin_device_limit). */
  logAttempt?: (userId: string | null, success: boolean, reason: string) => void;
}

/**
 * Pre-session checks for an admin login. Returns a 403 Response when the
 * login must be blocked, or null when it may proceed. Non-admin accounts
 * always pass through untouched.
 *
 * Order matters: the network-level allowlist rejects before anything else,
 * then the device cap. A rejected attempt is recorded in the LoginAttempt
 * ledger (shows up in the admin overview's failed-login chart).
 */
export async function adminLoginGuard(input: AdminLoginGuardInput): Promise<Response | null> {
  if (input.user.role !== 'admin') return null;

  if (!adminIpAllowed(input.ip)) {
    input.logAttempt?.(input.user.id, false, 'admin_ip_blocked');
    logger.warn(
      { email: input.user.email, ip: truncateIp(input.ip) },
      'admin login rejected: IP not on ADMIN_IP_ALLOWLIST',
    );
    return apiError(403, 'admin_ip_blocked', ADMIN_IP_BLOCKED_MESSAGE);
  }

  if (await adminSessionLimitReached(input.user.id)) {
    input.logAttempt?.(input.user.id, false, 'admin_device_limit');
    logger.warn(
      { email: input.user.email, active: await countActiveSessions(input.user.id), limit: ADMIN_SESSION_LIMIT },
      'admin login rejected: device limit reached',
    );
    return apiError(403, 'admin_device_limit', ADMIN_DEVICE_LIMIT_MESSAGE);
  }

  return null;
}
