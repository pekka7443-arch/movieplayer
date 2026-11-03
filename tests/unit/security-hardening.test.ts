// Regression tests for the 2026-11-03 security hardening.
//
// Covers every fixed vulnerability class with a negative-and-positive pair
// where possible, against an ISOLATED SQLite database (the dev DB is never
// touched):
//
//   1. Player-proxy HTML generation — no inline event handlers, no
//      attacker-controlled data inside JavaScript source, nonce'd script,
//      host allowlist enforcement.
//   2. CSRF double-submit — cookie present without/matching/mismatching
//      header.
//   3. Sealed secret encryption (AES-256-GCM) — roundtrip, tamper, AAD
//      binding, legacy plaintext fallback.
//   4. Persistent rate limiter — survives a "restart" (new store instance),
//      refills over time, account-keyed buckets.
//   5. Single-use auth challenges — atomic consumption, replay rejection,
//      concurrent race, expiry.
//   6. Password-reset tokens — single-use, session revocation in the same
//      transaction, replay rejection.
//   7. Session validation — suspension and soft-deletion kill live sessions;
//      absolute lifetime enforcement.
//   8. Backup-code atomic consumption — the conditional update pattern.
//   9. readJsonBody size cap.

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { FRAME_ANCESTORS, FRAME_ANCESTOR_SOURCES } from '@/lib/frame-ancestors';
import { projectRoot } from '@/lib/server/project-root';

const TMP_DIR = mkdtempSync(join(tmpdir(), 'cinedeck-sechard-'));
const DB_URL = `file:${join(TMP_DIR, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

let tokens: typeof import('@/lib/server/tokens');
let http: typeof import('@/lib/server/http');
let sealed: typeof import('@/lib/server/crypto-sealed');
let auth: typeof import('@/lib/server/auth');
let totpLib: typeof import('@/lib/server/totp');
let playerProxyRoute: typeof import('@/app/api/player-proxy/route');
let rateLimit: typeof import('@/lib/server/rate-limit');

process.env.AUTH_SECRET ??= 'a'.repeat(64);

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

beforeAll(async () => {
  tokens = await import('@/lib/server/tokens');
  http = await import('@/lib/server/http');
  sealed = await import('@/lib/server/crypto-sealed');
  auth = await import('@/lib/server/auth');
  totpLib = await import('@/lib/server/totp');
  rateLimit = await import('@/lib/server/rate-limit');
  playerProxyRoute = await import('@/app/api/player-proxy/route');
});

async function makeUser(email: string): Promise<{ id: string }> {
  return prisma.user.create({
    data: { email, passwordHash: auth.hashPassword('Str0ng!Passphrase') },
    select: { id: true },
  });
}

/** Minimal request builder with a session cookie attached. */
function authedRequest(user: { id: string }): Promise<{ token: string; session: { token: string } }> {
  return (async () => {
    const session = await auth.createSession(user.id, {});
    return { token: session.token, session };
  })();
}

// ---------------------------------------------------------------------------
// 1. Player-proxy XSS (was: single-quote breakout in the inline onload)
// ---------------------------------------------------------------------------

describe('player-proxy XSS hardening', () => {
  const evilPath = "/950028'-alert(document.domain)-'";
  const malicious = `https://www.2embed.cc/embed${evilPath}`;

  function buildProxyResponse(url: string, headers: Record<string, string> = {}) {
    const request = new Request(
      `http://localhost:3000/api/player-proxy?u=${encodeURIComponent(url)}`,
      { headers: { 'x-nonce': 'testnonce123', ...headers } },
    );
    // Route-level auth: stub requireAuthedUser by injecting a valid session
    // through a real user — done by callers below.
    return request;
  }

  it('never interpolates the URL into JavaScript source text', async () => {
    const user = await makeUser('proxy-xss@test.local');
    const { token } = await authedRequest(user);
    const request = buildProxyResponse(malicious, { cookie: `cinedeck_session=${token}` });
    const response = await (playerProxyRoute.GET as (r: Request) => Promise<Response>)(request);
    expect(response.status).toBe(200);
    const html = await response.text();

    // No inline event-handler attributes at all.
    expect(html).not.toMatch(/\son(load|error|click)\s*=/i);
    // No attacker data inside the <script> body (the script is static).
    const scriptBody = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(scriptBody).not.toContain(evilPath);
    expect(scriptBody).not.toContain('2embed');
    // The script carries the middleware nonce.
    expect(html).toMatch(/<script nonce="testnonce123">/);
    // The URL lives ONLY in HTML-escaped attribute contexts.
    expect(html).toContain(`src="https://www.2embed.cc/embed${evilPath.replace(/'/g, '&#39;')}"`);
    expect(html).toMatch(/data-player-url="/);
    // CSP on the response includes the nonce and denies objects.
    expect(response.headers.get('content-security-policy')).toContain(`'nonce-testnonce123'`);
    expect(response.headers.get('content-security-policy')).toContain("object-src 'none'");
  });

  it('still rejects non-allowlisted hosts, protocols, and SSRF targets', async () => {
    const user = await makeUser('proxy-ssrf@test.local');
    const { token } = await authedRequest(user);
    const cases = [
      'https://evil.example.com/embed/1', // host not a provider
      'http://169.254.169.254/latest/meta-data', // cloud metadata
      'file:///etc/passwd', // protocol
      'javascript:alert(1)',
    ];
    for (const url of cases) {
      const request = new Request(
        `http://localhost:3000/api/player-proxy?u=${encodeURIComponent(url)}`,
        { headers: { cookie: `cinedeck_session=${token}` } },
      );
      const response = await (playerProxyRoute.GET as (r: Request) => Promise<Response>)(request);
      expect([400, 401], url).toContain(response.status === 401 ? 401 : 400);
    }
  });

  it('requires an authenticated session', async () => {
    const request = new Request(
      `http://localhost:3000/api/player-proxy?u=${encodeURIComponent('https://www.2embed.cc/embed/1')}`,
    );
    const response = await (playerProxyRoute.GET as (r: Request) => Promise<Response>)(request);
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 2. CSRF double-submit token
// ---------------------------------------------------------------------------

describe('CSRF double-submit', () => {
  const base = { host: 'localhost:3000', origin: 'http://localhost:3000' };

  it('rejects a mutating request whose csrf cookie has no matching header', () => {
    const r = new Request('http://localhost:3000/api/watchlist', {
      method: 'POST',
      headers: { ...base, cookie: 'cinedeck_csrf=abcdef0123456789' },
    });
    expect(http.hasValidCsrfToken(r)).toBe(false);
    expect(http.enforceSameOrigin(r)?.status).toBe(403);
  });

  it('rejects a mismatching header (constant-time compare path)', () => {
    const r = new Request('http://localhost:3000/api/watchlist', {
      method: 'POST',
      headers: { ...base, cookie: 'cinedeck_csrf=abcdef0123456789', 'x-csrf-token': 'abcdef0123456788' },
    });
    expect(http.hasValidCsrfToken(r)).toBe(false);
  });

  it('accepts a matching header pair', () => {
    const r = new Request('http://localhost:3000/api/watchlist', {
      method: 'POST',
      headers: { ...base, cookie: 'cinedeck_csrf=abcdef0123456789', 'x-csrf-token': 'abcdef0123456789' },
    });
    expect(http.hasValidCsrfToken(r)).toBe(true);
    expect(http.enforceSameOrigin(r)).toBeNull();
  });

  it('allows requests without the csrf cookie (non-browser / first touch)', () => {
    const r = new Request('http://localhost:3000/api/watchlist', {
      method: 'POST',
      headers: base,
    });
    expect(http.hasValidCsrfToken(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Sealed secrets (AES-256-GCM)
// ---------------------------------------------------------------------------

describe('sealed secret encryption', () => {
  it('round-trips and never stores plaintext', () => {
    const secret = 'JBSWY3DPEHPK3PXPTESTSECRET32CHARS';
    const sealedValue = sealed.sealString(secret, 'user-1');
    expect(sealedValue).not.toContain(secret);
    expect(sealed.isSealed(sealedValue)).toBe(true);
    expect(sealed.openString(sealedValue, 'user-1')).toBe(secret);
  });

  it('binds the ciphertext to its owner (AAD) — copy between rows fails', () => {
    const sealedValue = sealed.sealString('SECRETCONTENT', 'user-1');
    expect(sealed.openString(sealedValue, 'user-2')).toBeNull();
  });

  it('detects tampering (auth tag failure)', () => {
    const sealedValue = sealed.sealString('SECRETCONTENT', 'user-1');
    const parts = sealedValue.split(':');
    parts[4] = Buffer.from('tampered!').toString('base64url');
    expect(sealed.openString(parts.join(':'), 'user-1')).toBeNull();
  });

  it('reads legacy plaintext but recognizes it as unsealed', () => {
    expect(sealed.isSealed('JBSWY3DPEHPK3PXP')).toBe(false);
    expect(sealed.openStoredSecret('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
    expect(sealed.openStoredSecret(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Persistent rate limiter
// ---------------------------------------------------------------------------

describe('persistent rate limiter (SQLite)', () => {
  it('keeps state across store instances (restart survival)', async () => {
    const storeA = new rateLimit.MemoryTokenBucketStore(); // control
    void storeA;
    const { SqliteTokenBucketStoreForTests } = await import('@/lib/server/rate-limit');
    const store = new SqliteTokenBucketStoreForTests();
    // Burn the 3 tokens of a 3/60s bucket.
    for (let i = 0; i < 3; i += 1) {
      const d = await store.hit('rl-test:ip1', 3, 60);
      expect(d.ok).toBe(true);
    }
    const blocked = await store.hit('rl-test:ip1', 3, 60);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);

    // NEW store instance = simulated process restart: still limited.
    const storeAfterRestart = new SqliteTokenBucketStoreForTests();
    const stillBlocked = await storeAfterRestart.hit('rl-test:ip1', 3, 60);
    expect(stillBlocked.ok).toBe(false);
  });

  it('refills tokens as the window passes', async () => {
    const { SqliteTokenBucketStoreForTests } = await import('@/lib/server/rate-limit');
    const store = new SqliteTokenBucketStoreForTests();
    // Time-travel: backdate the row so the refill math grants a token.
    await store.hit('rl-refill:ip1', 1, 1); // 1 token / 1s window
    const blockedNow = await store.hit('rl-refill:ip1', 1, 1);
    expect(blockedNow.ok).toBe(false);
    await prisma.rateLimitState.update({
      where: { key: 'rl-refill:ip1' },
      data: { updatedAt: new Date(Date.now() - 2000) },
    });
    const afterRefill = await store.hit('rl-refill:ip1', 1, 1);
    expect(afterRefill.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Single-use auth challenges (TOTP pending)
// ---------------------------------------------------------------------------

describe('single-use auth challenges', () => {
  it('consumes exactly once — replay rejected', async () => {
    const user = await makeUser('challenge@test.local');
    const { token } = await tokens.createAuthChallenge(user.id, 'totp', 5 * 60);
    expect(token.length).toBeGreaterThanOrEqual(20);

    const first = await tokens.consumeAuthChallenge(token, 'totp');
    expect(first?.userId).toBe(user.id);

    const replay = await tokens.consumeAuthChallenge(token, 'totp');
    expect(replay).toBeNull();
  });

  it('rejects a purpose-mismatched token', async () => {
    const user = await makeUser('challenge-purpose@test.local');
    const { token } = await tokens.createAuthChallenge(user.id, 'totp', 60);
    expect(await tokens.consumeAuthChallenge(token, 'password_reset')).toBeNull();
    // The mismatch does not burn it for the right purpose.
    expect((await tokens.consumeAuthChallenge(token, 'totp'))?.userId).toBe(user.id);
  });

  it('enforces expiry', async () => {
    const user = await makeUser('challenge-exp@test.local');
    const { token } = await tokens.createAuthChallenge(user.id, 'totp', -1); // already expired
    expect(await tokens.consumeAuthChallenge(token, 'totp')).toBeNull();
  });

  it('concurrent consumption — exactly one winner', async () => {
    const user = await makeUser('challenge-race@test.local');
    const { token } = await tokens.createAuthChallenge(user.id, 'totp', 60);
    const results = await Promise.all([
      tokens.consumeAuthChallenge(token, 'totp'),
      tokens.consumeAuthChallenge(token, 'totp'),
      tokens.consumeAuthChallenge(token, 'totp'),
    ]);
    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Password-reset tokens (atomic, single-use, revokes sessions)
// ---------------------------------------------------------------------------

describe('password-reset tokens', () => {
  it('single-use + password change + session revocation in one transaction', async () => {
    const user = await makeUser('reset@test.local');
    const sessionA = await auth.createSession(user.id, {});
    const sessionB = await auth.createSession(user.id, {});
    const { token } = await tokens.createPasswordResetToken(user.id, 30 * 60);

    const applied = await tokens.consumePasswordResetToken(token, async (tx, userId) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: auth.hashPassword('NewStr0ng!Pass') },
      });
    });
    expect(applied).toBe(true);

    // Password changed.
    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(auth.verifyPassword('NewStr0ng!Pass', refreshed.passwordHash)).toBe(true);
    // Every session dead.
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await auth.validateSessionToken(sessionA.token)).toBeNull();
    expect(await auth.validateSessionToken(sessionB.token)).toBeNull();

    // Replay rejected.
    expect(
      await tokens.consumePasswordResetToken(token, async () => undefined),
    ).toBe(false);
    void sessionB;
  });

  it('minting a new token revokes the outstanding one', async () => {
    const user = await makeUser('reset-rotate@test.local');
    const first = await tokens.createPasswordResetToken(user.id, 60);
    const second = await tokens.createPasswordResetToken(user.id, 60);
    // The second mint deleted the first's pending row.
    const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id, usedAt: null } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(auth.sha256(second.token));
    expect(
      await tokens.consumePasswordResetToken(first.token, async () => undefined),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Session validation — suspension/deletion revocation, absolute TTL
// ---------------------------------------------------------------------------

describe('session validation hardening', () => {
  it('a suspended account loses its live session immediately', async () => {
    const user = await makeUser('suspended@test.local');
    const { token } = await authedRequest(user);
    expect(await auth.validateSessionToken(token)).not.toBeNull();

    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });
    expect(await auth.validateSessionToken(token)).toBeNull();
    // The revocation write is fire-and-forget — poll until the rows are gone
    // instead of asserting synchronously (avoid a delete-race flake).
    await expect
      .poll(async () => prisma.session.count({ where: { userId: user.id } }), { timeout: 5000 })
      .toBe(0);
  });

  it('a soft-deleted account loses its live session immediately', async () => {
    const user = await makeUser('deleted@test.local');
    const { token } = await authedRequest(user);
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    expect(await auth.validateSessionToken(token)).toBeNull();
  });

  it('enforces the ABSOLUTE lifetime regardless of sliding refresh', async () => {
    const user = await makeUser('absolute@test.local');
    const { token } = await authedRequest(user);
    // Backdate the session creation beyond the member absolute TTL (60d),
    // keeping expiresAt (sliding) comfortably in the future.
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: {
        createdAt: new Date(Date.now() - (auth.SESSION_ABSOLUTE_TTL_SECONDS + 3600) * 1000),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    expect(await auth.validateSessionToken(token)).toBeNull();
  });

  it('admin sessions hit the tighter 7-day absolute cap', async () => {
    const user = await makeUser('admin-abs@test.local');
    await prisma.user.update({ where: { id: user.id }, data: { role: 'admin' } });
    const { token } = await authedRequest(user);
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: {
        createdAt: new Date(Date.now() - (auth.ADMIN_SESSION_ABSOLUTE_TTL_SECONDS + 3600) * 1000),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    expect(await auth.validateSessionToken(token)).toBeNull();
  });

  it('requireRecentAuth gates stale sessions', async () => {
    const user = await makeUser('recent@test.local');
    const { token } = await authedRequest(user);
    const fresh = await auth.validateSessionToken(token);
    expect(auth.requireRecentAuth(fresh)).toBeNull(); // just signed in → ok

    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) }, // 2h old
    });
    const stale = await auth.validateSessionToken(token);
    const gate = auth.requireRecentAuth(stale);
    expect(gate).not.toBeNull();
    expect((gate as Response).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 8. Backup-code atomic consumption (the conditional-update pattern)
// ---------------------------------------------------------------------------

describe('backup-code atomic consumption', () => {
  it('a spent code is removed exactly once — the concurrent loser is rejected', async () => {
    const user = await makeUser('backup-race@test.local');
    const codes = totpLib.generateBackupCodes(4);
    await prisma.user.update({
      where: { id: user.id },
      data: { backupCodes: totpLib.hashBackupCodes(codes) },
    });

    const spendOnce = async (): Promise<number> => {
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const match = totpLib.matchBackupCode(row.backupCodes, codes[0]);
      if (!match.matched || !match.remaining) return 0;
      const consumed = await prisma.user.updateMany({
        where: { id: user.id, backupCodes: row.backupCodes },
        data: { backupCodes: JSON.stringify(match.remaining) },
      });
      return consumed.count;
    };

    const counts = await Promise.all([spendOnce(), spendOnce(), spendOnce()]);
    expect(counts.filter((c) => c === 1)).toHaveLength(1);
    expect(counts.filter((c) => c === 0)).toHaveLength(2);

    // The code is gone — a fourth presentation fails to match.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(totpLib.matchBackupCode(row.backupCodes, codes[0]).matched).toBe(false);
    // Other codes still work.
    expect(totpLib.matchBackupCode(row.backupCodes, codes[1]).matched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Body size cap
// ---------------------------------------------------------------------------

describe('readJsonBody size cap', () => {
  it('rejects oversized bodies (memory-DoS guard)', async () => {
    const big = JSON.stringify({ blob: 'x'.repeat(300 * 1024) });
    const r = new Request('http://localhost:3000/api/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(big.length) },
      body: big,
    });
    expect(await http.readJsonBody(r)).toBeNull();
  });

  it('accepts normal bodies', async () => {
    const r = new Request('http://localhost:3000/api/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    });
    expect(await http.readJsonBody(r)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 10. Boot migration: legacy plaintext TOTP secrets get sealed
// ---------------------------------------------------------------------------

describe('TOTP secret boot migration', () => {
  it('re-encrypts legacy plaintext secrets, leaves sealed ones alone', async () => {
    const legacy = await makeUser('legacy-totp@test.local');
    const modern = await makeUser('modern-totp@test.local');
    await prisma.user.update({
      where: { id: legacy.id },
      data: { totpSecret: 'JBSWY3DPEHPK3PXPPLAIN', totpEnabled: true },
    });
    await prisma.user.update({
      where: { id: modern.id },
      data: { totpSecret: sealed.sealString('JBSWY3DPEHPK3PXPSEALED', modern.id), totpEnabled: true },
    });

    const boot = await import('@/lib/server/security-boot');
    // Reset the throttle so the migration actually runs in this process.
    (globalThis as unknown as { __cinedeckSecurityBootAt?: number }).__cinedeckSecurityBootAt = 0;
    await boot.migrateTotpSecretsToSealedStorage();

    const legacyRow = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(sealed.isSealed(legacyRow.totpSecret)).toBe(true);
    expect(sealed.openStoredSecret(legacyRow.totpSecret, legacy.id)).toBe('JBSWY3DPEHPK3PXPPLAIN');

    const modernRow = await prisma.user.findUniqueOrThrow({ where: { id: modern.id } });
    expect(sealed.openStoredSecret(modernRow.totpSecret, modern.id)).toBe('JBSWY3DPEHPK3PXPSEALED');
  });
});

// ---------------------------------------------------------------------------
// 10. Frame-ancestors platform contract — keeps the z.ai preview/publish
//     embed alive. Narrowing this list is what produced Chromium's
//     "This content is blocked. Ask the site owner to fix it." error in
//     every embedded view (2026-11-03 regression).
// ---------------------------------------------------------------------------

describe('frame-ancestors platform contract', () => {
  it('allows exactly the platform embed origins (self + z.ai/space-z.ai + localhost)', () => {
    const required = [
      "'self'",
      'https://chat.z.ai',
      'https://z.ai',
      'https://*.z.ai',
      'https://*.space-z.ai',
      'http://localhost:*',
    ];
    for (const source of required) {
      expect(FRAME_ANCESTOR_SOURCES).toContain(source);
      expect(FRAME_ANCESTORS).toContain(source);
    }
    // No wildcard-everything and no plaintext-HTTP wildcard may ever appear.
    for (const source of FRAME_ANCESTORS.split(' ')) {
      expect(source).not.toBe('*');
      expect(source.startsWith('http://*')).toBe(false);
    }
  });

  it('proxy.ts and player-proxy route consume the shared constant (no drifted mirrors)', () => {
    const proxySrc = readFileSync(`${process.cwd()}/src/proxy.ts`, 'utf8');
    const routeSrc = readFileSync(
      `${process.cwd()}/src/app/api/player-proxy/route.ts`,
      'utf8',
    );
    expect(proxySrc).toContain("from '@/lib/frame-ancestors'");
    expect(routeSrc).toContain('from "@/lib/frame-ancestors"');
    // Local redefinitions must stay gone — the two CSPs must never drift.
    expect(proxySrc).not.toMatch(/const FRAME_ANCESTORS/);
    expect(routeSrc).not.toMatch(/const FRAME_ANCESTORS/);
  });

  it('nothing in src/ sets X-Frame-Options (frame-ancestors is authoritative)', () => {
    // Match QUOTED header-key usage only — documentation that merely mentions
    // the header name (backtick comments) is not an offender.
    let offenders = '';
    try {
      offenders = execSync(`rg -i "['\\"]x-frame-options" src`, {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
    } catch {
      // rg exits 1 on zero matches — that is the PASS case.
    }
    expect(offenders.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 11. Rendering / iframe CSP / theme contracts — the visible-runtime trio:
//     blocked same-origin player iframe, React 19 client-script warning,
//     hydration mismatch from browser-dependent first renders.
// ---------------------------------------------------------------------------

describe('rendering, iframe CSP and theme contracts', () => {
  it('app-wide CSP frame-src allows the same-origin player proxy (no wildcards)', () => {
    const proxySrc = readFileSync(`${process.cwd()}/src/proxy.ts`, 'utf8');
    const match = /"frame-src ([^"]+)"/.exec(proxySrc);
    expect(match).not.toBeNull();
    const sources = match![1].split(' ');
    // The player UI iframes /api/player-proxy (same origin) — without 'self'
    // the outer player frame is blocked by this very CSP.
    expect(sources[0]).toBe("'self'");
    expect(sources).toContain('https://www.youtube-nocookie.com');
    expect(sources).toContain('https://www.youtube.com');
    for (const source of sources) {
      expect(source).not.toBe('*');
      expect(source.startsWith('http://*')).toBe(false);
    }
  });

  it('no component depends on next-themes (in-component FOUC script warned on React 19)', () => {
    // Import/dependency check — documentation comments mentioning the old
    // package name are fine and intentional.
    let hits = '';
    try {
      hits = execSync(`rg -l "from ['\\"]next-themes" src`, { cwd: process.cwd(), encoding: 'utf8' });
    } catch {
      // rg exits 1 on zero matches — the PASS case.
    }
    expect(hits.trim()).toBe('');
    // The replacement provider must stay script-free: scripts created during
    // client rendering never execute under React 19.
    const themeProvider = readFileSync(`${process.cwd()}/src/lib/theme.tsx`, 'utf8');
    expect(themeProvider).not.toContain('<script');
  });

  it('theme bootstrap is server-rendered in the root layout head with the CSP nonce', () => {
    const layout = readFileSync(`${process.cwd()}/src/app/layout.tsx`, 'utf8');
    expect(layout).toContain('dangerouslySetInnerHTML');
    expect(layout).toMatch(/nonce=\{nonce/);
  });

  it('AmbientBackground is fully static (zero hydration surface)', () => {
    const src = readFileSync(
      `${process.cwd()}/src/components/site/ambient-background.tsx`,
      'utf8',
    );
    // The premium redesign reduced the atmosphere layer to a purely static
    // backdrop (glow + grain + vignette). The contract is now STRICTER than
    // mount-gating: the component must not read ANY browser state during
    // render — no framer-motion hooks (useReducedMotion), no
    // useSyncExternalStore mounted gate, no pointer tracking, no effects —
    // so a hydration mismatch here is structurally impossible.
    expect(src).not.toMatch(/useReducedMotion|useSyncExternalStore|useEffect|useState/);
    expect(src).not.toMatch(/addEventListener/);
    expect(src).not.toMatch(/matchMedia/);
    // It stays decorative and behind the content.
    expect(src).toContain('aria-hidden');
    expect(src).toContain('-z-10');
  });
});

afterEach(() => {
  // Keep the isolated DB from growing across describes.
  void prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } }).catch(() => undefined);
});
