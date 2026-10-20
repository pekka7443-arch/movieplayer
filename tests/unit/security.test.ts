import { describe, expect, it } from 'vitest';

import { MemoryTokenBucketStore } from '@/lib/server/rate-limit';
import { checkPassword } from '@/lib/password';
import { containsProfanity, maskProfanity } from '@/lib/profanity';
import { base32Decode, base32Encode, currentTotp, verifyTotp } from '@/lib/server/totp';
import { signStatelessToken, verifyStatelessToken, hashPassword, verifyPassword } from '@/lib/server/auth';

describe('rate limiter (token bucket)', () => {
  it('allows bursts up to the limit then throttles with Retry-After', () => {
    const store = new MemoryTokenBucketStore();
    const key = 'test:1.2.3.4';
    for (let i = 0; i < 5; i += 1) {
      const decision = store.hit(key, 5, 60);
      expect(decision.ok, `request ${i}`).toBe(true);
    }
    const blocked = store.hit(key, 5, 60);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('recovers tokens over time', () => {
    const store = new MemoryTokenBucketStore();
    const key = 'test:recover';
    for (let i = 0; i < 3; i += 1) store.hit(key, 3, 60);
    expect(store.hit(key, 3, 60).ok).toBe(false);
    // Simulate the passage of a full window.
    const bucket = (store as unknown as { buckets: Map<string, { tokens: number; updatedAt: number }> }).buckets.get(key);
    if (bucket) bucket.updatedAt = Date.now() - 60_000;
    expect(store.hit(key, 3, 60).ok).toBe(true);
  });

  it('isolates buckets per key', () => {
    const store = new MemoryTokenBucketStore();
    for (let i = 0; i < 5; i += 1) store.hit('a:x', 5, 60);
    expect(store.hit('a:x', 5, 60).ok).toBe(false);
    expect(store.hit('b:x', 5, 60).ok).toBe(true);
  });
});

describe('password strength', () => {
  it('rejects short, common and single-class passwords', () => {
    expect(checkPassword('short').acceptable).toBe(false);
    expect(checkPassword('password123').acceptable).toBe(false);
    expect(checkPassword('salasanakissa').acceptable).toBe(false); // Finnish common word
    expect(checkPassword('aaaaaaaaaa').acceptable).toBe(false);
    expect(checkPassword('abcdefghijkl').acceptable).toBe(false); // letters only, <16
    expect(checkPassword('longenough123').acceptable).toBe(false); // no special char
  });

  it('accepts solid passphrases and scores them', () => {
    const verdict = checkPassword('Tr0ub4dor&Kettle9');
    expect(verdict.acceptable).toBe(true);
    expect(verdict.score).toBeGreaterThanOrEqual(2);
    // Policy: 8+ chars with a letter, a number AND a special character.
    expect(checkPassword('correct horse battery staple 42!').acceptable).toBe(true);
  });
});

describe('profanity filter', () => {
  it('detects blocked words including leetspeak', () => {
    expect(containsProfanity('this is shit')).toBe(true);
    expect(containsProfanity('v1ttu head')).toBe(true);
    expect(containsProfanity('what a movie')).toBe(false);
  });

  it('masks instead of dropping', () => {
    const masked = maskProfanity('that shit was great');
    expect(masked).not.toContain('shit');
    expect(masked).toContain('was great');
  });
});

describe('TOTP', () => {
  it('round-trips base32', () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 251, 252]);
    expect(base32Decode(base32Encode(Buffer.from(bytes))).equals(Buffer.from(bytes))).toBe(true);
  });

  it('verifies its own current code and rejects wrong ones', () => {
    const { currentTotp: code } = { currentTotp };
    const secret = 'JBSWY3DPEHPK3PXP';
    const now = Date.now();
    expect(verifyTotp(secret, code(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, '000000', now) && code(secret, now) !== '000000').toBe(false);
  });

  it('accepts ±1 step of clock drift', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const now = Date.now();
    const prev = currentTotp(secret, now - 30_000);
    const next = currentTotp(secret, now + 30_000);
    expect(verifyTotp(secret, prev, now)).toBe(true);
    expect(verifyTotp(secret, next, now)).toBe(true);
    expect(verifyTotp(secret, currentTotp(secret, now - 120_000), now)).toBe(false);
  });
});

describe('stateless signed tokens', () => {
  it('round-trips with purpose binding and expiry', () => {
    process.env.AUTH_SECRET ??= 'x'.repeat(40);
    const { token } = signStatelessToken('reset', 'user-1', 60);
    expect(verifyStatelessToken(token, 'reset')?.userId).toBe('user-1');
    // Wrong purpose → rejected.
    expect(verifyStatelessToken(token, 'verify')).toBeNull();
    // Tampered payload → rejected.
    const [body, mac] = token.split('.');
    expect(verifyStatelessToken(`${body}x.${mac}`, 'reset')).toBeNull();
  });

  it('rejects expired tokens', () => {
    process.env.AUTH_SECRET ??= 'x'.repeat(40);
    const expired = signStatelessToken('verify', 'user-2', -10);
    expect(verifyStatelessToken(expired.token, 'verify')).toBeNull();
  });
});

describe('password hashing (scrypt)', () => {
  it('verifies correct passwords and rejects wrong ones', () => {
    const stored = hashPassword('correct horse battery staple 42');
    expect(verifyPassword('correct horse battery staple 42', stored)).toBe(true);
    expect(verifyPassword('wrong password', stored)).toBe(false);
    expect(verifyPassword('anything', 'garbage-input')).toBe(false);
  });
});
