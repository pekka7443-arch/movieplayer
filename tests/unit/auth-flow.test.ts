// Integration tests for the auth/account system against an ISOLATED SQLite
// database (temp dir) — the dev database is never touched.
//
// Covers: scrypt password hashing, session create/validate/expiry/sliding
// rotation, logout-all, suspension semantics, reset-token expiry, 2FA backup
// codes, admin seed idempotency, and IP-privacy helpers.
//
// NOTE: app modules are imported DYNAMICALLY inside beforeAll so that
// `DATABASE_URL` (bound when the singletons instantiate) points at the
// isolated database.

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { projectRoot } from '@/lib/server/project-root';

const TMP_DIR = mkdtempSync(join(tmpdir(), 'cinedeck-auth-test-'));
const DB_URL = `file:${join(TMP_DIR, 'test.db')}`;
/** Direct client for assertions — same DB the app singletons will use. */
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

let auth: typeof import('@/lib/server/auth');
let seed: typeof import('@/lib/server/seed');
let totp: typeof import('@/lib/server/totp');
let geo: typeof import('@/lib/server/geo');

beforeAll(() => {
  process.env.DATABASE_URL = DB_URL;
  execSync(`bunx prisma migrate deploy`, {
    cwd: projectRoot(),
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'ignore',
  });
  void prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// Late-bound module handles (initialized in the first beforeAll hook below).
beforeAll(async () => {
  auth = await import('@/lib/server/auth');
  seed = await import('@/lib/server/seed');
  totp = await import('@/lib/server/totp');
  geo = await import('@/lib/server/geo');
});

// ---------------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------------

describe('password hashing (scrypt)', () => {
  it('round-trips and never stores plaintext', () => {
    const hash = auth.hashPassword('Str0ng!Passphrase');
    expect(hash).not.toContain('Str0ng!Passphrase');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(auth.verifyPassword('Str0ng!Passphrase', hash)).toBe(true);
    expect(auth.verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces a unique salt per hash', () => {
    const a = auth.hashPassword('Same-Passw0rd!');
    const b = auth.hashPassword('Same-Passw0rd!');
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Sessions: creation, validation, expiry, sliding rotation, logout-all
// ---------------------------------------------------------------------------

describe('sessions', () => {
  it('creates a session, validates the cookie, and stores a truncated IP', async () => {
    const user = await prisma.user.create({
      data: { email: 'sess@example.com', passwordHash: auth.hashPassword('Str0ng!Pass1!') },
    });
    const ctx = await auth.createSession(user.id, { userAgent: 'VitestBot/1.0', ip: '203.0.113.7' });

    const parsed = auth.parseCookies(
      new Request('http://localhost/', { headers: { cookie: auth.sessionCookieValue(ctx) } }),
    );
    expect(parsed.cinedeck_session).toBe(ctx.token);

    const validated = await auth.validateSessionToken(ctx.token);
    expect(validated).not.toBeNull();
    expect(validated!.userId).toBe(user.id);

    const row = await prisma.session.findUnique({ where: { tokenHash: auth.sha256(ctx.token) } });
    expect(row).not.toBeNull();
    expect(row!.ip).toBe('203.0.113.0'); // last octet zeroed — privacy invariant
    expect(row!.userAgent).toBe('VitestBot/1.0');
  });

  it('rejects unknown and expired tokens', async () => {
    expect(await auth.validateSessionToken('nope-not-a-real-token-value!!')).toBeNull();

    const user = await prisma.user.create({
      data: { email: 'expired@example.com', passwordHash: auth.hashPassword('Str0ng!Pass2!') },
    });
    const ctx = await auth.createSession(user.id, {});
    await prisma.session.update({
      where: { tokenHash: auth.sha256(ctx.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await auth.validateSessionToken(ctx.token)).toBeNull();
  });

  it('slides: rotation re-issues the token and pushes expiry a full TTL', async () => {
    const user = await prisma.user.create({
      data: { email: 'slide@example.com', passwordHash: auth.hashPassword('Str0ng!Pass3!') },
    });
    const first = await auth.createSession(user.id, {});
    const rowBefore = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: auth.sha256(first.token) },
    });

    const second = await auth.rotateSession(rowBefore.id);
    expect(second).not.toBeNull();
    expect(second!.token).not.toBe(first.token);

    const rowAfter = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: auth.sha256(second!.token) },
    });
    expect(rowAfter.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + (auth.SESSION_TTL_SECONDS - 60) * 1000,
    );
    // The old token is dead after rotation.
    expect(await auth.validateSessionToken(first.token)).toBeNull();
  });

  it('"log out of all devices" deletes every session row', async () => {
    const user = await prisma.user.create({
      data: { email: 'logout-all@example.com', passwordHash: auth.hashPassword('Str0ng!Pass4!') },
    });
    const a = await auth.createSession(user.id, {});
    const b = await auth.createSession(user.id, {});
    await auth.revokeAllSessionsForUser(user.id);
    expect(await auth.validateSessionToken(a.token)).toBeNull();
    expect(await auth.validateSessionToken(b.token)).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suspension semantics
// ---------------------------------------------------------------------------

describe('suspension', () => {
  it('an active suspension is detectable the way the login route checks it', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'banned@example.com',
        passwordHash: auth.hashPassword('Str0ng!Pass5!'),
        suspendedAt: new Date(),
        suspensionReason: 'Test violation',
      },
    });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const blocked =
      row.suspendedAt !== null && (!row.suspensionEndsAt || row.suspensionEndsAt.getTime() > Date.now());
    expect(blocked).toBe(true);

    // An expired suspension auto-lifts: the same check must be false.
    const lifted = await prisma.user.create({
      data: {
        email: 'banned-then-free@example.com',
        passwordHash: auth.hashPassword('Str0ng!Pass5!'),
        suspendedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        suspensionEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        suspensionReason: 'had an end date',
      },
    });
    const row2 = await prisma.user.findUniqueOrThrow({ where: { id: lifted.id } });
    const blocked2 =
      row2.suspendedAt !== null && (!row2.suspensionEndsAt || row2.suspensionEndsAt.getTime() > Date.now());
    expect(blocked2).toBe(false);
  });

  it('revoking sessions on suspension leaves zero active sessions', async () => {
    const user = await prisma.user.create({
      data: { email: 'suspend-sessions@example.com', passwordHash: auth.hashPassword('Str0ng!Pass6!') },
    });
    const s1 = await auth.createSession(user.id, {});
    const s2 = await auth.createSession(user.id, {});
    await prisma.user.update({
      where: { id: user.id },
      data: { suspendedAt: new Date(), suspensionReason: 'bad' },
    });
    await auth.revokeAllSessionsForUser(user.id); // what the admin suspend action does
    expect(await auth.validateSessionToken(s1.token)).toBeNull();
    expect(await auth.validateSessionToken(s2.token)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Password reset tokens expire
// ---------------------------------------------------------------------------

describe('password reset token expiry', () => {
  it('a token past its exp is rejected; purposes are binding', () => {
    const expired = auth.signStatelessToken('reset', 'some-user', -60);
    expect(auth.verifyStatelessToken(expired.token, 'reset')).toBeNull();

    const live = auth.signStatelessToken('reset', 'some-user', 60);
    expect(auth.verifyStatelessToken(live.token, 'reset')).toEqual({ userId: 'some-user' });
    expect(auth.verifyStatelessToken(live.token, 'verify')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2FA backup codes
// ---------------------------------------------------------------------------

describe('2FA backup codes', () => {
  it('generates 10 single-use codes that match only once', () => {
    const codes = totp.generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const stored = totp.hashBackupCodes(codes);
    expect(stored).not.toContain(codes[0]); // hashes only, never plaintext

    const first = totp.matchBackupCode(stored, codes[0]);
    expect(first.matched).toBe(true);
    expect(first.remaining).toHaveLength(9);

    // The same code cannot be reused.
    const reused = totp.matchBackupCode(JSON.stringify(first.remaining), codes[0]);
    expect(reused.matched).toBe(false);

    // Case/whitespace insensitive.
    const lazy = totp.matchBackupCode(stored, ` ${codes[1].toLowerCase()} `);
    expect(lazy.matched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Admin seed — idempotent, never overwrites, scrypt-hashed
// ---------------------------------------------------------------------------

describe('admin seed', () => {
  it('creates the env admin once and never overwrites the password', async () => {
    process.env.ADMIN_EMAIL = 'seed-admin@test.local';
    process.env.ADMIN_PASSWORD = 'Seed-P4ssw0rd!';

    const first = await seed.ensureAdminSeed({ force: true });
    expect(first.created).toBe(true);

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'seed-admin@test.local' } });
    expect(admin.role).toBe('admin');
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.emailVerified).not.toBeNull();
    expect(admin.passwordHash.startsWith('scrypt:')).toBe(true);
    expect(admin.passwordHash).not.toContain('Seed-P4ssw0rd!');

    // Change the password behind the seed's back…
    const newHash = auth.hashPassword('Changed-P4ss!');
    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash: newHash, mustChangePassword: false },
    });

    // …run the seed again — it must NOT reset anything.
    const second = await seed.ensureAdminSeed({ force: true });
    expect(second.created).toBe(false);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after.passwordHash).toBe(newHash);
    expect(after.mustChangePassword).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// IP truncation + UA classification (privacy invariants)
// ---------------------------------------------------------------------------

describe('IP privacy', () => {
  it('truncates IPv4, IPv6 and leaves locals alone', () => {
    expect(geo.truncateIp('1.2.3.4')).toBe('1.2.3.0');
    expect(geo.truncateIp('::ffff:8.8.4.4')).toBe('::ffff:8.8.4.0');
    expect(geo.truncateIp('2001:0db8:1a2b:3c4d:5e6f:789a:bcde:f01')).toBe('2001:0db8:1a2b:3c4d::');
    expect(geo.truncateIp('local')).toBe('local');
    expect(geo.truncateIp(null)).toBeNull();
  });

  it('geo lookup never crashes and returns nulls for unroutable/local IPs', () => {
    expect(geo.geoLookup('127.0.0.1').country).toBeNull();
    expect(geo.geoLookup(null)).toEqual({ country: null, city: null });
  });

  it('classifies user agents into coarse buckets', () => {
    expect(geo.classifyUserAgent('Mozilla/5.0 (iPhone) Mobile Safari').device).toBe('Mobile');
    expect(geo.classifyUserAgent('Mozilla/5.0 Windows Chrome/120').browser).toBe('Chrome');
    expect(geo.classifyUserAgent('Googlebot/2.1').device).toBe('Bot');
    expect(geo.classifyUserAgent(null).browser).toBe('Unknown');
  });
});
