// AUTH_SECRET stability across restarts and redeploys — the permanent fix
// for "every redeploy logs everyone out".
//
// The secret is managed in layers, in order of authority:
//
//   1. Process environment (AUTH_SECRET) — the primary, operator-managed
//      store for hardened deployments.
//   2. Project .env — the default store. Once it holds a VALID secret it is
//      NEVER regenerated. Only a missing/empty/placeholder value is filled.
//   3. Protected volume file — /tmp/my-project/config/auth-secret (mode
//      0600). The PolarFS volume survives platform recycles that wipe .env;
//      the file carries the same trust level as .env itself (same disk, same
//      operator) and is RESTORED from when .env lost the line.
//   4. SystemState DB row `auth_secret_hash` — SHA-256 FINGERPRINT ONLY
//      (drift detection for `bun run doctor` and boot warnings). The
//      plaintext database copy was REMOVED (2026-11-03 hardening): the DB
//      file is the most exfiltrated artifact, and a signing secret in it
//      defeats its purpose. One-time migration: an existing plaintext row
//      is adopted, then deleted.
//   5. Fresh generation — only when NO layer has anything valid (the literal
//      first boot). Persisted to .env + the volume file.
//
// Consequences of a changed secret: sessions are NOT affected (they are
// random tokens hashed in the Session table), but outstanding sealed TOTP
// secrets and stateless legacy links stop validating. That is exactly why
// the secret must never churn.
//
// Server-only. Called from the boot hook (src/instrumentation.ts), the
// health route, `bun run seed` and `bun run deploy`. Never throws. The
// secret value is never logged and never returned by any API.

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '@/lib/db';
import { envFileGet, upsertEnvValue } from './env-file';
import { logger } from './logger';

const KEY_SECRET = 'auth_secret'; // LEGACY plaintext row — deleted on sight
const KEY_HASH = 'auth_secret_hash';
const MIN_LENGTH = 32;
const PLACEHOLDER_RE = /replace[-_]?me|change[-_]?me|placeholder|example|dummy/i;

/** Protected persistent-volume secret file (survives platform recycles). */
const VOLUME_SECRET_FILE = '/tmp/my-project/config/auth-secret';

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

async function writeFingerprint(secret: string): Promise<void> {
  await db.systemState.upsert({
    where: { key: KEY_HASH },
    update: { value: fingerprint(secret) },
    create: { key: KEY_HASH, value: fingerprint(secret) },
  });
}

/** Delete the legacy plaintext row — the fingerprint stays for drift detection. */
async function purgePlaintextRow(): Promise<void> {
  try {
    await db.systemState.delete({ where: { key: KEY_SECRET } });
  } catch {
    // row absent — already clean
  }
}

function readVolumeSecret(): string | null {
  try {
    if (!existsSync(VOLUME_SECRET_FILE)) return null;
    const value = readFileSync(VOLUME_SECRET_FILE, 'utf8').trim();
    return isValidAuthSecret(value) ? value : null;
  } catch {
    return null;
  }
}

function writeVolumeSecret(secret: string): void {
  try {
    mkdirSync(path.dirname(VOLUME_SECRET_FILE), { recursive: true });
    writeFileSync(VOLUME_SECRET_FILE, `${secret}\n`, { mode: 0o600 });
    chmodSync(VOLUME_SECRET_FILE, 0o600);
  } catch {
    // Read-only volume → the .env layer still holds the secret.
  }
}

async function stabilize(): Promise<string | null> {
  // Effective secret: process env first (loaded from .env by bun/Next),
  // then the project .env file (covers runtimes whose env was not hydrated),
  // then the protected volume file (platform recycle recovery).
  const fromEnv = process.env.AUTH_SECRET;
  const fromFile = envFileGet('AUTH_SECRET');
  const fromVolume = readVolumeSecret();
  const effective = isValidAuthSecret(fromEnv)
    ? fromEnv
    : isValidAuthSecret(fromFile)
      ? fromFile
      : isValidAuthSecret(fromVolume)
        ? fromVolume
        : null;

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

  // --- Case A: a valid secret exists → keep it, sync the other layers. -----
  if (effective) {
    if (!stored.hash) {
      await writeFingerprint(effective).catch(() => undefined);
      logger.info('auth secret: fingerprint stored (first boot)');
    } else if (stored.hash !== fingerprint(effective)) {
      await writeFingerprint(effective).catch(() => undefined);
      logger.warn(
        'auth secret: CHANGED since last boot — outstanding legacy links and ' +
          'sealed TOTP secrets no longer validate (sessions are unaffected). ' +
          'If this was not intentional, restore the previous secret.',
      );
    }
    // Heal the project .env when it lost the line but the secret survives
    // elsewhere (env var / volume file) — .env must always hold the effective
    // secret so the NEXT boot resolves the same value no matter the layer.
    if (!isValidAuthSecret(fromFile) || fromFile !== effective) {
      upsertEnvValue('AUTH_SECRET', effective);
    }
    // Mirror onto the protected volume (recycle recovery).
    if (fromVolume !== effective) writeVolumeSecret(effective);
    // Keep process.env coherent even when the value came from a file.
    if (process.env.AUTH_SECRET !== effective) process.env.AUTH_SECRET = effective;
    // Never keep the plaintext DB row around.
    if (stored.secret) await purgePlaintextRow().catch(() => undefined);
    return effective;
  }

  // --- Case B: no valid secret in env/.env/volume → one-time migration
  // from the LEGACY plaintext database row (adopt + delete), else nothing. --
  if (isValidAuthSecret(stored.secret)) {
    const restored = stored.secret;
    upsertEnvValue('AUTH_SECRET', restored);
    writeVolumeSecret(restored);
    process.env.AUTH_SECRET = restored;
    logger.warn(
      'auth secret: adopted the legacy database copy ONCE and removed it — ' +
        'the secret now lives only in .env + the protected volume file.',
    );
    if (!stored.hash) await writeFingerprint(restored).catch(() => undefined);
    await purgePlaintextRow().catch(() => undefined);
    return restored;
  }

  // --- Case C: literal first boot → generate once, persist everywhere. -----
  const generated = randomBytes(32).toString('hex');
  upsertEnvValue('AUTH_SECRET', generated);
  writeVolumeSecret(generated);
  process.env.AUTH_SECRET = generated;
  await writeFingerprint(generated).catch(() => undefined);
  logger.info('auth secret: generated for the first time and persisted to .env + protected volume');
  return generated;
}

/**
 * Ensure the process has a stable AUTH_SECRET. Runs at most once per minute
 * per process (repeated calls — boot hook + health route — reuse the result).
 * Never throws; on total failure it still guarantees a usable secret via the
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
