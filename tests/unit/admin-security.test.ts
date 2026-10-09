// Integration tests for the ADMIN login-security guards against an ISOLATED
// SQLite database (temp dir) — the dev database is never touched.
//
// Covers the admin device cap (first 3 logins OK, 4th rejected), the
// optional ADMIN_IP_ALLOWLIST (unset = skip; set = strict), new-device
// detection (userAgent seen before?) and the new-device audit alert.
//
// NOTE: app modules are imported DYNAMICALLY inside beforeAll so that
// `DATABASE_URL` (bound when the singletons instantiate) points at the
// isolated database.

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const TMP_DIR = mkdtempSync(join(tmpdir(), 'cinedeck-adminsec-test-'));
const DB_URL = `file:${join(TMP_DIR, 'test.db')}`;
/** Direct client for assertions — same DB the app singletons will use. */
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

let adminSec: typeof import('@/lib/server/admin-security');
let auth: typeof import('@/lib/server/auth');

const ADMIN_EMAIL = 'admin-sec@test.cinedeck';
const USER_EMAIL = 'member-sec@test.cinedeck';
const PASSWORD = 'Str0ng!Pass1!';

const UA_A = 'Mozilla/5.0 (Windows NT 10.0) CineDeckTest/1.0';
const UA_B = 'Mozilla/5.0 (iPhone) CineDeckTest/2.0';

beforeAll(() => {
  process.env.DATABASE_URL = DB_URL;
  execSync(`bunx prisma migrate deploy`, {
    cwd: '/home/z/my-project',
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'ignore',
  });
  void prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TMP_DIR, { recursive: true, force: true });
});

beforeAll(async () => {
  adminSec = await import('@/lib/server/admin-security');
  auth = await import('@/lib/server/auth');
});

/** Fresh fixtures per test: one admin + one regular member, no sessions. */
beforeEach(async () => {
  await prisma.session.deleteMany({});
  await prisma.loginAttempt.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, USER_EMAIL] } } });
  await prisma.user.create({
    data: { email: ADMIN_EMAIL, passwordHash: auth.hashPassword(PASSWORD), role: 'admin' },
  });
  await prisma.user.create({
    data: { email: USER_EMAIL, passwordHash: auth.hashPassword(PASSWORD), role: 'user' },
  });
});

const adminUser = async () => prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
const memberUser = async () => prisma.user.findUniqueOrThrow({ where: { email: USER_EMAIL } });

// ---------------------------------------------------------------------------
// Device cap: first 3 logins fill the slots, the 4th EVICTS the oldest —
// the authenticated admin is never locked out of their own account.
// ---------------------------------------------------------------------------

describe('admin device cap', () => {
  it('allows logins while fewer than 3 sessions are active', async () => {
    const user = await adminUser();
    const input = { user, ip: '62.78.226.59', userAgent: UA_A };

    for (let i = 1; i <= 3; i++) {
      const blocked = await adminSec.adminLoginGuard(input);
      expect(blocked).toBeNull();
      await auth.createSession(user.id, { userAgent: UA_A, ip: '62.78.226.59' });
    }
    const count = await adminSec.countActiveSessions(user.id);
    expect(count).toBe(3);
  });

  it('evicts the oldest session to admit a 4th login (never locks the admin out)', async () => {
    const user = await adminUser();
    // Distinct createdAt so "oldest" is deterministic (createSession uses now()).
    const base = Date.now() - 60_000;
    for (let i = 0; i < 3; i++) {
      await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: auth.sha256(`cap-${i}`),
          userAgent: i === 0 ? UA_B : UA_A,
          createdAt: new Date(base + i * 1000),
          expiresAt: new Date(base + i * 1000 + 30 * 24 * 3600 * 1000),
        },
      });
    }

    const blocked = await adminSec.adminLoginGuard({ user, ip: '62.78.226.59', userAgent: UA_A });
    expect(blocked).toBeNull(); // admitted, not rejected

    // Exactly one slot freed — and it was the OLDEST session that left.
    expect(await adminSec.countActiveSessions(user.id)).toBe(2);
    const survivorHashes = (
      await prisma.session.findMany({ where: { userId: user.id }, select: { tokenHash: true } })
    ).map((s) => s.tokenHash);
    expect(survivorHashes).toContain(auth.sha256('cap-1'));
    expect(survivorHashes).toContain(auth.sha256('cap-2'));
    expect(survivorHashes).not.toContain(auth.sha256('cap-0'));

    // The eviction is audit-visible for the admin.
    const audit = await prisma.auditLog.findFirst({ where: { action: 'admin.session_evicted' } });
    expect(audit).not.toBeNull();

    // Cap invariant holds: the new session occupies the freed slot.
    await auth.createSession(user.id, { userAgent: UA_A, ip: '62.78.226.59' });
    expect(await adminSec.countActiveSessions(user.id)).toBe(3);
  });

  it('still admits login when no eviction is needed (revoked sessions free slots)', async () => {
    const user = await adminUser();
    for (let i = 0; i < 3; i++) {
      await auth.createSession(user.id, { userAgent: UA_A });
    }
    expect(await adminSec.adminLoginGuard({ user, ip: null, userAgent: UA_A })).toBeNull(); // evicts one and admits…
    expect(await adminSec.countActiveSessions(user.id)).toBe(2); // …freeing exactly one slot
    await auth.revokeAllSessionsForUser(user.id);
    expect(await adminSec.adminLoginGuard({ user, ip: null, userAgent: UA_A })).toBeNull(); // …and revoke-all admits cleanly
  });

  it('expired sessions do not count against the cap', async () => {
    const user = await adminUser();
    for (let i = 0; i < 3; i++) {
      await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: auth.sha256(`expired-${i}`),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
    }
    expect(await adminSec.adminSessionLimitReached(user.id)).toBe(false);
  });

  it('never applies to role="user" accounts', async () => {
    const member = await memberUser();
    for (let i = 0; i < 5; i++) {
      await auth.createSession(member.id, { userAgent: UA_A });
    }
    const blocked = await adminSec.adminLoginGuard({ user: member, ip: null, userAgent: UA_A });
    expect(blocked).toBeNull();
    expect(await adminSec.adminSessionLimitReached(member.id)).toBe(true); // helper is role-agnostic…
    // …but the guard (the only caller on the login path) passes non-admins through.
  });
});

// ---------------------------------------------------------------------------
// Optional IP allowlist
// ---------------------------------------------------------------------------

describe('admin IP allowlist', () => {
  const ENV_KEY = 'ADMIN_IP_ALLOWLIST';

  function setEnv(value: string | undefined) {
    if (value === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = value;
  }

  it('is skipped entirely when the env var is unset or empty', () => {
    setEnv(undefined);
    expect(adminSec.adminIpAllowed('203.0.113.9')).toBe(true);
    expect(adminSec.adminIpAllowed('local')).toBe(true);
    expect(adminSec.adminIpAllowed(null)).toBe(true);
    setEnv('   ');
    expect(adminSec.adminIpAllowed('203.0.113.9')).toBe(true);
    setEnv(undefined);
  });

  it('rejects non-listed IPs and allows listed ones (whitespace tolerated)', () => {
    setEnv('62.78.226.59, 10.20.30.40');
    expect(adminSec.adminIpAllowed('62.78.226.59')).toBe(true);
    expect(adminSec.adminIpAllowed('10.20.30.40')).toBe(true);
    expect(adminSec.adminIpAllowed('62.78.226.60')).toBe(false);
    expect(adminSec.adminIpAllowed('local')).toBe(false);
    expect(adminSec.adminIpAllowed(null)).toBe(false);
    setEnv(undefined);
  });

  it('handles IPv4-mapped IPv6 forms', () => {
    setEnv('62.78.226.59');
    expect(adminSec.adminIpAllowed('::ffff:62.78.226.59')).toBe(true);
    expect(adminSec.adminIpAllowed('::ffff:62.78.226.58')).toBe(false);
    setEnv(undefined);
  });

  it('blocks admin logins from non-allowlisted IPs at the guard level', async () => {
    setEnv('62.78.226.59');
    try {
      const user = await adminUser();
      const blocked = await adminSec.adminLoginGuard({ user, ip: '203.0.113.9', userAgent: UA_A });
      expect(blocked?.status).toBe(403);
      const body = (await blocked?.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('admin_ip_blocked');
      expect(body.error.message).toBe('Login not allowed from this network.');

      const allowed = await adminSec.adminLoginGuard({ user, ip: '62.78.226.59', userAgent: UA_A });
      expect(allowed).toBeNull();
    } finally {
      setEnv(undefined);
    }
  });
});

// ---------------------------------------------------------------------------
// New-device detection + audit alert
// ---------------------------------------------------------------------------

describe('admin new-device detection', () => {
  it('flags the first login from a userAgent, then recognizes it', async () => {
    const user = await adminUser();
    expect(await adminSec.isAdminLoginFromNewDevice(user.id, UA_A)).toBe(true);

    await auth.createSession(user.id, { userAgent: UA_A });
    expect(await adminSec.isAdminLoginFromNewDevice(user.id, UA_A)).toBe(false);
    expect(await adminSec.isAdminLoginFromNewDevice(user.id, UA_B)).toBe(true);
  });

  it('remembers devices through the append-only login ledger (after logout)', async () => {
    const user = await adminUser();
    await prisma.loginAttempt.create({
      data: {
        email: user.email,
        userId: user.id,
        success: true,
        reason: 'ok',
        userAgent: UA_A,
      },
    });
    // Even with zero sessions (logged out), the UA is known.
    expect(await adminSec.isAdminLoginFromNewDevice(user.id, UA_A)).toBe(false);
  });

  it('a totp_pending attempt alone does NOT make a device known', async () => {
    const user = await adminUser();
    await prisma.loginAttempt.create({
      data: {
        email: user.email,
        userId: user.id,
        success: true,
        reason: 'totp_pending',
        userAgent: UA_A,
      },
    });
    expect(await adminSec.isAdminLoginFromNewDevice(user.id, UA_A)).toBe(true);
  });

  it('writes a prominent audit entry with device/browser/country/timestamp', async () => {
    const user = await adminUser();
    await adminSec.notifyAdminNewDeviceLogin({
      userId: user.id,
      email: user.email,
      ip: '62.78.226.59',
      userAgent: UA_B,
      country: 'FI',
      city: 'Helsinki',
    });

    const entry = await prisma.auditLog.findFirst({ where: { action: 'admin.login_new_device' } });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(user.id);
    const details = JSON.parse(entry?.details ?? '{}') as Record<string, unknown>;
    expect(details.browser).toBe('Other'); // synthetic UA has no browser token
    expect(details.device).toBe('Mobile'); // iPhone marker
    expect(details.country).toBe('FI');
    expect(details.ip).toBe('62.78.226.0'); // privacy-truncated
    expect(typeof details.at).toBe('string');
  });
});
