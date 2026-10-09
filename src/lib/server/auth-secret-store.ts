// AUTH_SECRET stability across restarts and redeploys — the permanent fix
// for "every redeploy logs everyone out".
//
// The secret is managed in three layers, in order of authority:
//
//   1. Project .env — the primary store. Once it holds a VALID secret it is
//      NEVER regenerated. Only a missing/empty/placeholder value is filled.
//   2. SystemState DB rows — written on first boot:
//        - auth_secret       the secret itself (plaintext restore copy; the
//                            DB file lives on the same disk under the same
//                            trust domain as .env itself). Used to RESTORE
//                            the secret when a platform reset wipes .env.
//        - auth_secret_hash  SHA-256 fingerprint. Compared on every boot and
//                            by `bun run doctor` — a change is reported once.
//   3. Fresh generation — only when BOTH .env and the DB have nothing valid
//      (the literal first boot, or a first boot after a full sandbox reset).
//
// Consequences of a changed secret: sessions are NOT affected (they are
// random tokens hashed in the Session table), but outstanding stateless
// links (password reset / email verification / pending 2FA logins) stop
// validating. That is exactly why the secret must never churn.
//
// Server-only. Called from the boot hook (src/instrumentation.ts), the
// health route, `bun run seed` and `bun run deploy`. Never throws.

import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { envFileGet, upsertEnvValue } from './env-file';
import { logger } from './logger';

const KEY_SECRET = 'auth_secret';
const KEY_HASH = 'auth_secret_hash';
const MIN_LENGTH = 32;
const PLACEHOLDER_RE = /replace[-_]?me|change[-_]?me|placeholder|example|dummy/i;

export function isValidAuthSecret(value: string | null | undefined): value is string {
  return (
    typeof value === 'string' && value.length >= MIN_LENGTH && !PLACEHOLDER_RE.test(value)
  );
}

export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const globalForStabilize = globalThis as unknown as {
  __cinedeckSecretStabilizeAt?: number;
  __cinedeckSecretStabilizePromise?: Promise<string | null>;
};

async function readStored(): Promise<{ secret: string | null; hash: string | null }> {
  const rows = await db.systemState.findMany({
    where: { key: { in: [KEY_SECRET, KEY_HASH] } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return { secret: map.get(KEY_SECRET) ?? null, hash: map.get(KEY_HASH) ?? null };
}

async function writeStored(secret: string): Promise<void> {
  const hash = fingerprint(secret);
  await db.$transaction([
    db.systemState.upsert({
      where: { key: KEY_SECRET },
      update: { value: secret },
      create: { key: KEY_SECRET, value: secret },
    }),
    db.systemState.upsert({
      where: { key: KEY_HASH },
      update: { value: hash },
      create: { key: KEY_HASH, value: hash },
    }),
  ]);
}

async function stabilize(): Promise<string | null> {
  // Effective secret: process env first (loaded from .env by bun/Next),
  // then the project .env file (covers runtimes whose env was not hydrated).
  const fromEnv = process.env.AUTH_SECRET;
  const effective = isValidAuthSecret(fromEnv) ? fromEnv : envFileGet('AUTH_SECRET');

  let stored: { secret: string | null; hash: string | null } = {
    secret: null,
    hash: null,
  };
  try {
    stored = await readStored();
  } catch {
    // SystemState table not migrated yet (very first boot before
    // `prisma migrate deploy`) — fall through; layers below still work.
  }

  // --- Case A: a valid secret exists → keep it, sync the DB records. -------
  if (isValidAuthSecret(effective)) {
    const hash = fingerprint(effective);
    if (!stored.hash) {
      await writeStored(effective).catch(() => undefined);
      logger.info('auth secret: fingerprint stored (first boot)');
    } else if (stored.hash !== hash) {
      await writeStored(effective).catch(() => undefined);
      logger.warn(
        'auth secret: CHANGED since last boot — outstanding reset/verification ' +
          'links no longer validate (sessions are unaffected). If this was not ' +
          'intentional, the previous secret was recovered from neither .env nor ' +
          'the database.',
      );
    }
    // Heal the project .env when it lost the line but the secret survives
    // elsewhere (e.g. the standalone bundle copy or exported env vars) — the
    // project .env must always end up holding the effective secret so the
    // NEXT boot resolves the same value no matter which layer wins.
    const fromFile = envFileGet('AUTH_SECRET');
    if (!isValidAuthSecret(fromFile) || fromFile !== effective) {
      upsertEnvValue('AUTH_SECRET', effective);
      logger.info('auth secret: project .env healed to match the effective secret');
    }
    // Keep process.env coherent even when the value came from the file.
    if (process.env.AUTH_SECRET !== effective) process.env.AUTH_SECRET = effective;
    return effective;
  }

  // --- Case B: no valid secret anywhere in env → restore from DB. ----------
  if (isValidAuthSecret(stored.secret)) {
    const restored = stored.secret;
    upsertEnvValue('AUTH_SECRET', restored);
    process.env.AUTH_SECRET = restored;
    logger.warn(
      'auth secret: was missing from the environment — RESTORED from the ' +
        'database fingerprint store. Stable across redeploys; nothing was lost.',
    );
    if (!stored.hash) await writeStored(restored).catch(() => undefined);
    return restored;
  }

  // --- Case C: literal first boot → generate once, persist everywhere. -----
  const generated = randomBytes(32).toString('hex');
  upsertEnvValue('AUTH_SECRET', generated);
  process.env.AUTH_SECRET = generated;
  await writeStored(generated).catch(() => undefined);
  logger.info('auth secret: generated for the first time and persisted to .env + database');
  return generated;
}

/**
 * Ensure the process has a stable AUTH_SECRET. Runs at most once per minute
 * per process (repeated calls — boot hook + health route — reuse the result).
 * Never throws; on DB failure it still guarantees a usable secret via the
 * .env layer. Returns the effective secret, or null when even the fallback
 * could not produce one (read-only filesystem with no stored secret).
 */
export async function ensureStableAuthSecret(): Promise<string | null> {
  const cached = globalForStabilize.__cinedeckSecretStabilizePromise;
  if (cached) return cached;
  const promise = stabilize()
    .catch((error) => {
      logger.error(
        { err: error instanceof Error ? { message: error.message } : error },
        'auth secret stabilization failed (non-fatal)',
      );
      return isValidAuthSecret(process.env.AUTH_SECRET) ? process.env.AUTH_SECRET : null;
    })
    .finally(() => {
      globalForStabilize.__cinedeckSecretStabilizeAt = Date.now();
      // Allow a re-run after a minute (e.g. DB came up late).
      setTimeout(() => {
        globalForStabilize.__cinedeckSecretStabilizePromise = undefined;
      }, 60_000).unref?.();
    });
  globalForStabilize.__cinedeckSecretStabilizePromise = promise;
  return promise;
}
