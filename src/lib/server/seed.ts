// Admin account seeding — the ONLY way an admin account is ever created.
//
// Credential resolution order:
//   1. ADMIN_EMAIL / ADMIN_PASSWORD from .env (documented primary source).
//   2. config/bootstrap-admin.json fallback — survives platform sandbox
//      restarts that regenerate .env from a template (both were observed
//      being wiped while project files persisted). Keep this file in sync
//      with the deployment's intended bootstrap credentials.
//
// IDEMPOTENCE CONTRACT: if an account with that email already exists the
// seed NEVER overwrites it and NEVER resets the password — a second boot
// (or a second `bun run seed`) is a no-op. Change the password in
// Settings → Security after signing in, not by editing this file.

import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/server/auth';
import { logger } from '@/lib/server/logger';

const globalForSeed = globalThis as unknown as { __cinedeckSeedAt?: number };

export interface SeedResult {
  ran: boolean;
  created: boolean;
  email?: string;
  skipped?: 'missing_env' | 'exists' | 'throttled';
}

interface BootstrapAdminFile {
  email?: string;
  password?: string;
}

/** PolarFS volume that survives platform recycles (repo.tar excludes config/
 *  and .env, and the platform rewrites .env each boot — see resolveBootstrapAdmin). */
const PERSISTENT_VOLUME_BOOTSTRAP = '/tmp/my-project/config/bootstrap-admin.json';

/**
 * Resolve bootstrap credentials, in priority order:
 *   1. ADMIN_EMAIL / ADMIN_PASSWORD from .env
 *   2. config/bootstrap-admin.json in the project tree
 *   3. config/bootstrap-admin.json on the persistent volume
 *      (/tmp/my-project — PolarFS, survives platform recycles)
 *
 * Source 3 exists because platform recycles rebuild the live tree from
 * repo.tar (gitignore excludes config/ and .env) AND regenerate .env with
 * only DATABASE_URL — without the volume copy every fresh boot lost all
 * credential sources, the seed skipped, and login 401'd (2026-11-03
 * incident). When found on the volume it is copied back into the live
 * config/ (best-effort) so the whole session sees a consistent file.
 * Returns null when no source is configured.
 */
function resolveBootstrapAdmin(): { email: string; password: string } | null {
  const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const envPassword = process.env.ADMIN_PASSWORD;
  if (envEmail && envPassword) return { email: envEmail, password: envPassword };

  const candidates = [
    path.join(process.cwd(), 'config', 'bootstrap-admin.json'),
    PERSISTENT_VOLUME_BOOTSTRAP,
  ];
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as BootstrapAdminFile;
      const email = parsed.email?.trim().toLowerCase();
      const password = parsed.password;
      if (!email || !password) continue;
      // Write-through: keep the live config/ in sync with the volume copy.
      if (file === PERSISTENT_VOLUME_BOOTSTRAP) {
        try {
          const live = path.join(process.cwd(), 'config', 'bootstrap-admin.json');
          if (!existsSync(live)) {
            mkdirSync(path.dirname(live), { recursive: true });
            copyFileSync(file, live);
          }
        } catch {
          // Best-effort only — the credentials still resolve.
        }
      }
      return { email, password };
    } catch {
      // Unreadable/malformed config file → try the next source.
    }
  }
  return null;
}

/**
 * Create the configured admin account when it does not exist yet.
 * Safe to call on every boot — throttled to once per minute per process
 * when invoked opportunistically (the CLI path bypasses the throttle).
 */
export async function ensureAdminSeed(options: { force?: boolean } = {}): Promise<SeedResult> {
  const boot = resolveBootstrapAdmin();
  if (!boot) return { ran: false, created: false, skipped: 'missing_env' };
  const { email, password } = boot;

  if (!options.force) {
    const last = globalForSeed.__cinedeckSeedAt ?? 0;
    if (Date.now() - last < 60_000) return { ran: false, created: false, skipped: 'throttled' };
    globalForSeed.__cinedeckSeedAt = Date.now();
  }

  try {
    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) return { ran: true, created: false, email, skipped: 'exists' };

    await db.user.create({
      data: {
        email,
        passwordHash: hashPassword(password),
        role: 'admin',
        emailVerified: new Date(),
        mustChangePassword: true,
      },
      select: { id: true },
    });
    logger.info({ email }, 'admin seed: created env admin account');
    return { ran: true, created: true, email };
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? { message: error.message } : error },
      'admin seed failed (non-fatal)',
    );
    return { ran: false, created: false, email };
  }
}
