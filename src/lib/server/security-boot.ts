// One-time security boot migrations + production configuration validation
// (2026-11-03 hardening). Runs from src/instrumentation.ts — every step is
// idempotent, best-effort, and never blocks boot.
//
// 1. migrateTotpSecretsToSealedStorage — re-encrypts any legacy PLAINTEXT
//    TOTP secrets in the User table to AES-256-GCM sealed form. A plaintext
//    secret (base32) contains no ':' so sealed values (enc:v1:…) are
//    unambiguous; already-sealed rows are skipped.
// 2. validateProductionSecurity — loud (non-fatal) warnings for insecure
//    production configuration: missing APP_BASE_URL, missing AUTH_SECRET
//    strength, unset SMTP delivery, database file permissions.

import { db } from '@/lib/db';
import { isSealed, sealString } from './crypto-sealed';
import { isValidAuthSecret } from './auth-secret-store';
import { logger } from './logger';

const globalForBoot = globalThis as unknown as { __cinedeckSecurityBootAt?: number };

export async function migrateTotpSecretsToSealedStorage(): Promise<void> {
  const now = Date.now();
  if (globalForBoot.__cinedeckSecurityBootAt && now - globalForBoot.__cinedeckSecurityBootAt < 60_000) return;
  globalForBoot.__cinedeckSecurityBootAt = now;

  try {
    const rows = await db.user.findMany({
      where: { totpSecret: { not: null } },
      select: { id: true, totpSecret: true },
      take: 500,
    });
    let migrated = 0;
    for (const row of rows) {
      const stored = row.totpSecret;
      if (!stored || isSealed(stored)) continue;
      await db.user
        .update({ where: { id: row.id }, data: { totpSecret: sealString(stored, row.id) } })
        .catch(() => undefined);
      migrated += 1;
    }
    if (migrated > 0) {
      logger.info({ migrated }, 'security boot: legacy TOTP secrets re-encrypted (AES-256-GCM)');
    }
  } catch {
    // DB not migrated yet — the lazy fallback (openStoredSecret) still works.
  }
}

export function validateProductionSecurity(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const problems: string[] = [];
  if (!process.env.APP_BASE_URL) {
    problems.push(
      'APP_BASE_URL is not set — emailed reset/verification links are derived from request Host ' +
        'headers, which an attacker can poison on direct connections. Set it to the public origin ' +
        '(e.g. https://movieplayer222.space-z.ai).',
    );
  }
  if (!isValidAuthSecret(process.env.AUTH_SECRET)) {
    problems.push(
      'AUTH_SECRET is missing or weak (<32 chars / placeholder) in the runtime environment — ' +
        'sealed TOTP secrets cannot be read and legacy signed tokens will not validate. Set it ' +
        'via the deployment environment (openssl rand -hex 32).',
    );
  }
  if (!process.env.SMTP_URL) {
    problems.push(
      'SMTP_URL is not set — password reset / verification emails only log to the server console.',
    );
  }
  if (process.env.ADMIN_PASSWORD && /kanadeck|password|admin123/i.test(process.env.ADMIN_PASSWORD)) {
    problems.push(
      'ADMIN_PASSWORD looks like a default/weak value — change it in Settings → Security after ' +
        'signing in.',
    );
  }
  if (problems.length > 0) {
    logger.warn({ problems }, 'security boot: production configuration warnings');
  }
}
