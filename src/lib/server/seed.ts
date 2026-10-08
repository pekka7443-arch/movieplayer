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

import { existsSync, readFileSync } from 'node:fs';
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

/**
 * Resolve bootstrap credentials: env first, then config/bootstrap-admin.json.
 * Returns null when neither source is configured.
 */
function resolveBootstrapAdmin(): { email: string; password: string } | null {
  const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const envPassword = process.env.ADMIN_PASSWORD;
  if (envEmail && envPassword) return { email: envEmail, password: envPassword };

  try {
    const file = path.join(process.cwd(), 'config', 'bootstrap-admin.json');
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as BootstrapAdminFile;
      const email = parsed.email?.trim().toLowerCase();
      const password = parsed.password;
      if (email && password) return { email, password };
    }
  } catch {
    // Unreadable/malformed config file → treat as unconfigured.
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
