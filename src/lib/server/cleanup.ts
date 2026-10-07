// Scheduled-cleanup helpers invoked opportunistically from /api/health.
// Every function throttles itself (once per day per process) and is
// best-effort — a failure never breaks the health check.

import { db } from '@/lib/db';
import { logger } from '@/lib/server/logger';

const globalForCleanup = globalThis as unknown as { __cinedeckDeletePurgeAt?: number };

/**
 * Hard-delete accounts whose 30-day soft-delete grace window has elapsed.
 * Prisma cascade rules remove their sessions, profiles, library rows, lists,
 * comments and notifications with the user row.
 */
export async function purgeExpiredDeletedUsers(): Promise<void> {
  const now = Date.now();
  const last = globalForCleanup.__cinedeckDeletePurgeAt ?? 0;
  if (now - last < 24 * 60 * 60 * 1000) return; // at most once a day
  globalForCleanup.__cinedeckDeletePurgeAt = now;
  try {
    const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const result = await db.user.deleteMany({ where: { deletedAt: { lt: cutoff } } });
    if (result.count > 0) {
      logger.info({ count: result.count }, 'purged accounts past the 30-day delete grace');
    }
    // AuditLog rows older than a year roll off (immutability only applies
    // within the retention window).
    const auditCutoff = new Date(now - 365 * 24 * 60 * 60 * 1000);
    await db.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } });
    // Login-attempt ledger keeps 90 days (admin login-history window).
    const loginCutoff = new Date(now - 90 * 24 * 60 * 60 * 1000);
    await db.loginAttempt.deleteMany({ where: { createdAt: { lt: loginCutoff } } });
  } catch {
    // best-effort
  }
}
