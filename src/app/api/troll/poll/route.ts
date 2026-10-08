import { db } from '@/lib/db';
import { withApi } from '@/lib/server/api';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { resolveOwner } from '@/lib/server/auth';
import { latestTrollFor, toPublicEvent } from '@/lib/server/troll';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/troll/poll?after=<id> — prank pickup for EVERY open browser tab
// (guests included: 'all' pranks hit the party too). Clients poll every
// ~15s while the tab is visible; ?after= dedupes so a prank plays once per
// tab. Rate limited by IP.
// ---------------------------------------------------------------------------
export const GET = withApi('troll/poll', async (request) => {
  const limited = enforceRateLimit(request, 'trollPoll');
  if (limited) return limited;

  const afterRaw = new URL(request.url).searchParams.get('after') ?? '0';
  const after = /^\d+$/.test(afterRaw) ? Number(afterRaw) : 0;

  // Resolve the signed-in email so targeted pranks find their victim.
  // Guests (and any session failure) simply get 'all'-targeted events.
  let email: string | null = null;
  let excludeAdminEmail: string | undefined;
  const owner = await resolveOwner(request).catch(() => null);
  if (owner?.userId) {
    const user = await db.user.findUnique({
      where: { id: owner.userId },
      select: { email: true, role: true },
    });
    if (user) {
      email = user.email;
      // The admin who fires an 'all' prank never pranks their own screen.
      if (user.role === 'admin') excludeAdminEmail = user.email;
    }
  }

  const event = latestTrollFor({ email, after, excludeCreatedBy: excludeAdminEmail });
  return Response.json({ event: event ? toPublicEvent(event) : null });
});
