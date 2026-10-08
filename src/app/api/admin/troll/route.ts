import { z } from 'zod';

import { db } from '@/lib/db';
import { apiError, withApi } from '@/lib/server/api';
import { guardMutation, readJsonBody } from '@/lib/server/http';
import { requireAdmin } from '@/lib/server/admin';
import { writeAudit } from '@/lib/server/audit';
import {
  TROLL_DURATION_RANGE,
  isTrollType,
  recentTrolls,
  toPublicEvent,
  triggerTroll,
} from '@/lib/server/troll';

export const dynamic = 'force-dynamic';

const isResponse = (value: unknown): value is Response => value instanceof Response;

const triggerSchema = z.object({
  type: z.string().refine(isTrollType, 'unknown_troll_type'),
  target: z.union([z.literal('all'), z.string().trim().toLowerCase().email().max(120)]),
  message: z.string().trim().max(200).optional(),
  durationSec: z.number().int().min(TROLL_DURATION_RANGE.min).max(TROLL_DURATION_RANGE.max),
});

// ---------------------------------------------------------------------------
// GET /api/admin/troll — recent prank history for the Troll tab.
// POST /api/admin/troll — fire a prank at everyone or one user (admin only).
// Every trigger lands in the audit log (action=troll.triggered) so the fun
// stays transparent.
// ---------------------------------------------------------------------------
export const GET = withApi('admin/troll', async (request) => {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  return Response.json({
    events: recentTrolls(20).map((event) => ({
      ...toPublicEvent(event),
      target: event.target,
      createdBy: event.createdBy,
    })),
  });
});

export const POST = withApi('admin/troll', async (request) => {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const originError = guardMutation(request, 'trollTrigger');
  if (originError) return originError;

  const body = await readJsonBody(request);
  const parsed = triggerSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'bad_request', 'Invalid troll payload.');
  }
  const { type, target, message, durationSec } = parsed.data;

  // Targeted pranks must name an existing account (typo-proofing the fun).
  if (target !== 'all') {
    const user = await db.user.findUnique({ where: { email: target }, select: { id: true } });
    if (!user) return apiError(404, 'not_found', 'No account with that email.');
  }

  const event = triggerTroll({ type, target, message, durationSec, createdBy: admin.email });
  await writeAudit({
    actorEmail: admin.email,
    action: 'troll.triggered',
    targetType: target === 'all' ? 'broadcast' : 'user',
    targetId: target === 'all' ? 'all' : target,
    targetLabel: target === 'all' ? 'Everyone' : target,
    details: { type, durationSec, message: message || null },
  });

  return Response.json({ ok: true, event: toPublicEvent(event) });
});
