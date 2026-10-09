import { db } from '@/lib/db';
import { cleanupStaleGuests } from '@/lib/server/auth';
import { ensureStableAuthSecret } from '@/lib/server/auth-secret-store';
import { withApi } from '@/lib/server/api';
import { ensureAdminSeed } from '@/lib/server/seed';
import { purgeExpiredDeletedUsers } from '@/lib/server/cleanup';

export const dynamic = 'force-dynamic';

// GET /api/health → liveness + dependency snapshot (used by uptime checks
// and the admin dashboard). Never leaks internals beyond counts.
export const GET = withApi('health', async () => {
  // Opportunistic housekeeping (all throttled internally):
  // - AUTH_SECRET stability (restore from DB when the env was wiped — the
  //   boot hook already ran it; this is the belt-and-suspenders re-check)
  // - admin seed from .env (first boot / idempotent re-checks)
  // - guest rows older than a year
  // - accounts soft-deleted more than 30 days ago
  void ensureStableAuthSecret();
  void ensureAdminSeed();
  void cleanupStaleGuests();
  void purgeExpiredDeletedUsers();

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
