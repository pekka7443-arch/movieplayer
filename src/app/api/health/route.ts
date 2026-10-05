import { db } from '@/lib/db';
import { cleanupStaleGuests } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

// GET /api/health → liveness + dependency snapshot (used by uptime checks
// and the admin dashboard). Never leaks internals beyond counts.
export const GET = withApi('health', async () => {
  // Opportunistic daily housekeeping: purge guest rows older than a year.
  void cleanupStaleGuests();

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
