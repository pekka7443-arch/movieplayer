// Database-backed single-use authentication challenges (2026-11-03 hardening).
//
// Replaces the replayable HMAC stateless tokens for:
//   - pending-TOTP login handoffs (purpose 'totp')
//   - password reset links     (PasswordResetToken table)
//   - email verification links (EmailVerificationToken table)
//
// SECURITY CONTRACT
//   * Tokens are 256-bit cryptographically random values (crypto.randomBytes)
//     handed to the client ONCE; only the SHA-256 hash is stored.
//   * Consumption is ATOMIC: a conditional `updateMany WHERE usedAt IS NULL`
//     inside a transaction — two concurrent presentations of the same token
//     race, exactly one wins, the loser gets `null`. No read-then-write gap.
//   * Expiry enforced both by the stored row AND the conditional update.
//   * Replay of an already-consumed token is indistinguishable from an
//     unknown token (single generic `invalid_token` / `pending_expired`).
//
// Server-only. Never import from client components.

import { randomBytes } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { sha256 } from './auth';

const RAW_TOKEN_BYTES = 32; // 256-bit
export const RAW_TOKEN_LENGTH = RAW_TOKEN_BYTES * 2; // hex chars (43 base64url)

export type ChallengePurpose = 'totp' | 'password_reset' | 'email_verify';

/** Mint a one-time challenge: persists the hash, returns the RAW token. */
export async function createAuthChallenge(
  userId: string,
  purpose: ChallengePurpose,
  ttlSeconds: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(RAW_TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await db.authChallenge.create({
    data: { userId, purpose, tokenHash: sha256(token), expiresAt },
  });
  return { token, expiresAt };
}

/** Jittered sleep for contention retries. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run a transaction with one contention retry (SQLite single-writer). */
async function withContentionRetry<T>(run: () => Promise<T>, retries = 1): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (retries <= 0) throw error;
    await sleep(40 + Math.random() * 120);
    return withContentionRetry(run, retries - 1);
  }
}

/**
 * Atomically consume a challenge. Returns the userId on success, null when
 * the token is unknown, expired, already used, or purpose-mismatched.
 * A consumed-but-userless row still burns (no oracle for account existence).
 *
 * Race-free by construction: the CLAIM is a single conditional UPDATE
 * (`WHERE consumedAt IS NULL AND expiresAt > now`) — SQLite serializes
 * statements, so exactly one concurrent presentation can flip consumedAt.
 * The row is read only AFTER the claim succeeds. Write-lock contention
 * (concurrent double-submit) is retried once with jitter.
 */
export async function consumeAuthChallenge(
  token: string,
  purpose: ChallengePurpose,
): Promise<{ userId: string } | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  try {
    return await withContentionRetry(() =>
      db.$transaction(async (tx) => {
        const claimed = await tx.authChallenge.updateMany({
          where: {
            tokenHash: sha256(token),
            purpose,
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { consumedAt: new Date() },
        });
        if (claimed.count !== 1) return null;
        const row = await tx.authChallenge.findUnique({ where: { tokenHash: sha256(token) } });
        return row ? { userId: row.userId } : null;
      }),
    );
  } catch {
    return null; // DB failure → reject (fail closed, no session issued)
  }
}

/** Opportunistic purge of consumed/expired challenges (throttled by caller). */
export async function cleanupAuthChallenges(): Promise<void> {
  try {
    // Expired rows linger 24h for audit value, then go.
    await db.authChallenge.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }] },
    });
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// PasswordResetToken / EmailVerificationToken table wrappers (the tables
// existed but were unused by the stateless-token implementation — now they
// carry the real, single-use flow).
// ---------------------------------------------------------------------------

/** Mint a password-reset token; invalidates the user's outstanding ones. */
export async function createPasswordResetToken(
  userId: string,
  ttlSeconds: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(RAW_TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await db.$transaction([
    db.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
    db.passwordResetToken.create({ data: { userId, tokenHash: sha256(token), expiresAt } }),
  ]);
  return { token, expiresAt };
}

/**
 * Consume a reset token atomically AND apply the password change + revoke
 * sessions in the SAME transaction. `apply` receives the transaction client
 * and MUST only touch the user identified by the token (its userId is passed
 * along). Returns true when the whole operation applied.
 * The token burns even when the user row vanished (no existence oracle).
 * Claim-first: the conditional updateMany decides the winner before any read.
 */
export async function consumePasswordResetToken(
  token: string,
  apply: (tx: Prisma.TransactionClient, userId: string) => Promise<void>,
): Promise<boolean> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return false;
  try {
    return await withContentionRetry(() =>
      db.$transaction(async (tx) => {
        const claimed = await tx.passwordResetToken.updateMany({
          where: { tokenHash: sha256(token), usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) return false;
        const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
        if (!row) return false; // vanished mid-transaction — token burned above
        const user = await tx.user.findUnique({ where: { id: row.userId }, select: { id: true } });
        if (!user) return false; // token burned, nothing to do
        await apply(tx, row.userId);
        await tx.session.deleteMany({ where: { userId: row.userId } });
        return true;
      }),
    );
  } catch {
    return false;
  }
}

/** Mint an email-verification token (single-use, 24h). */
export async function createEmailVerificationToken(
  userId: string,
  ttlSeconds: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(RAW_TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await db.emailVerificationToken.create({ data: { userId, tokenHash: sha256(token), expiresAt } });
  return { token, expiresAt };
}

/** Atomically consume a verification token; returns userId or null. */
export async function consumeEmailVerificationToken(token: string): Promise<{ userId: string } | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  try {
    return await withContentionRetry(() =>
      db.$transaction(async (tx) => {
        const claimed = await tx.emailVerificationToken.updateMany({
          where: { tokenHash: sha256(token), usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) return null;
        const row = await tx.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) } });
        return row ? { userId: row.userId } : null;
      }),
    );
  } catch {
    return null;
  }
}

/** Purge stale reset/verification token rows (best-effort). */
export async function cleanupTokenTables(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
    await db.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  } catch {
    // best-effort
  }
}
