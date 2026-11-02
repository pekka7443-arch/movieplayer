import { db } from '@/lib/db';
import { cleanupStaleGuests } from '@/lib/server/auth';
import { ensureStableAuthSecret } from '@/lib/server/auth-secret-store';
import { withApi } from '@/lib/server/api';
import { ensureAdminSeed } from '@/lib/server/seed';
import { purgeExpiredDeletedUsers } from '@/lib/server/cleanup';
import { cleanupAuthChallenges, cleanupTokenTables } from '@/lib/server/tokens';

export const dynamic = 'force-dynamic';

// GET /api/health → liveness + dependency snapshot (used by uptime checks
// and the admin dashboard). Never leaks internals beyond counts.
export const GET = withApi('health', async () => {
  // Opportunistic housekeeping (all throttled internally):
  // - AUTH_SECRET stability (restore from the protected volume / heal .env
  //   when the env was wiped — the boot hook already ran it; belt+suspenders)
  // - admin seed from .env/config/volume (first boot / idempotent re-checks)
  // - guest rows older than a year
  // - accounts soft-deleted more than 30 days ago
  // - consumed/expired auth challenge + reset/verification tokens
  void ensureStableAuthSecret();
  void ensureAdminSeed();
  void cleanupStaleGuests();
  void purgeExpiredDeletedUsers();
  void cleanupAuthChallenges();
  void cleanupTokenTables();

  const startedAt = Date.now();
  let dbOk = true;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  const dbLatencyMs = Date.now() - startedAt;

  const body = {
    ok: dbOk,
    service: 'cinedeck',
    time: new Date().toISOString(),
    db: { ok: dbOk, latencyMs: dbLatencyMs },
    uptimeSeconds: Math.round(process.uptime()),
  };
  return Response.json(body, { status: dbOk ? 200 : 503 });
});
