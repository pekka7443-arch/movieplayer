// Admin account seeding — driven ONLY by .env (never hardcoded).
//
// ADMIN_EMAIL / ADMIN_PASSWORD: when both are set and no account with that
// email exists, one is created with role=admin, email verified and
// mustChangePassword=true (the UI nags until the password is changed).
//
// IDEMPOTENCE CONTRACT: if the account already exists the seed NEVER
// overwrites it and NEVER resets the password — a second boot (or a second
// `bun run seed`) is a no-op.

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

/**
 * Create the env-configured admin account when it does not exist yet.
 * Safe to call on every boot — throttled to once per minute per process
 * when invoked opportunistically (the CLI path bypasses the throttle).
 */
export async function ensureAdminSeed(options: { force?: boolean } = {}): Promise<SeedResult> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return { ran: false, created: false, skipped: 'missing_env' };

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
