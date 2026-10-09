import { db } from '@/lib/db';
import { withApi } from '@/lib/server/api';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { resolveOwner } from '@/lib/server/auth';
import { latestEffectFor, toPublicEffect } from '@/lib/server/ux';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/ux/poll?after=<id> — client experience pickup for EVERY open
// browser tab (guests included: 'all' overrides hit the party too). Clients
// poll every ~15s while the tab is visible; ?after= dedupes so an override
// plays once per tab. Rate limited by IP.
// ---------------------------------------------------------------------------
export const GET = withApi('ux/poll', async (request) => {
  const limited = enforceRateLimit(request, 'uxPoll');
  if (limited) return limited;

  const afterRaw = new URL(request.url).searchParams.get('after') ?? '0';
  const after = /^\d+$/.test(afterRaw) ? Number(afterRaw) : 0;

  // Resolve the signed-in email so targeted overrides find their audience.
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
      // The operator who fires an 'all' override never triggers their own screen.
      if (user.role === 'admin') excludeAdminEmail = user.email;
    }
  }

  const event = latestEffectFor({ email, after, excludeCreatedBy: excludeAdminEmail });
  return Response.json({ event: event ? toPublicEffect(event) : null });
});
