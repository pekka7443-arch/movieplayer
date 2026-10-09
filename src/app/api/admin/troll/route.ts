import { z } from 'zod';

import { db } from '@/lib/db';
import { apiError, withApi } from '@/lib/server/api';
import { guardMutation, readJsonBody } from '@/lib/server/http';
import { requireAdmin } from '@/lib/server/admin';
import { writeAudit } from '@/lib/server/audit';
import {
  TROLL_DURATION_RANGE,
  UX_TOOLS,
  isTrollType,
  recentTrolls,
  revokeTroll,
  toPublicEvent,
  triggerTroll,
  type UxTool,
} from '@/lib/server/troll';

export const dynamic = 'force-dynamic';

const isResponse = (value: unknown): value is Response => value instanceof Response;

const triggerSchema = z.object({
  type: z.string().refine(isTrollType, 'unknown_troll_type'),
  target: z.union([z.literal('all'), z.string().trim().toLowerCase().email().max(120)]),
  message: z.string().trim().max(200).optional(),
  durationSec: z.number().int().min(TROLL_DURATION_RANGE.min).max(TROLL_DURATION_RANGE.max),
});

const revokeSchema = z.object({
  id: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// GET /api/admin/troll — the User Experience toolkit: tool catalog
// (boring internal names) + active overrides for the management table.
// POST /api/admin/troll — apply an override to everyone or one user.
// DELETE /api/admin/troll — revoke a running override.
// Every apply/revoke lands in the audit log as a ux.protocol_* entry so the
// trail reads like normal platform operations.
// ---------------------------------------------------------------------------
export const GET = withApi('admin/troll', async (request) => {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const tools: UxTool[] = UX_TOOLS;
  return Response.json({
    tools,
    events: recentTrolls(30).map((event) => ({
      ...toPublicEvent(event),
      target: event.target,
      createdBy: event.createdBy,
    })),
  });
});

export const POST = withApi('admin/troll', async (request) => {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const originError = guardMutation(request, 'uxProtocol');
  if (originError) return originError;

  const body = await readJsonBody(request);
  const parsed = triggerSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'bad_request', 'Invalid protocol payload.');
  }
  const { type, target, message, durationSec } = parsed.data;

  const tool = UX_TOOLS.find((t) => t.type === type);
  if (tool?.needsMessage && (!message || message.trim().length < 2)) {
    return apiError(400, 'bad_request', 'A notice body is required for this protocol.');
  }

  // Targeted protocols must name an existing account (typo-proofing).
  if (target !== 'all') {
    const user = await db.user.findUnique({ where: { email: target }, select: { id: true } });
    if (!user) return apiError(404, 'not_found', 'No account with that email.');
  }

  const event = triggerTroll({ type, target, message, durationSec, createdBy: admin.email });
  await writeAudit({
    actorEmail: admin.email,
    action: 'ux.protocol_applied',
    targetType: target === 'all' ? 'broadcast' : 'user',
    targetId: target === 'all' ? 'all' : target,
    targetLabel: tool?.label ?? type,
    details: { protocol: tool?.label ?? type, target, durationSec, message: message || null },
  });

  return Response.json({ ok: true, event: toPublicEvent(event) });
});

export const DELETE = withApi('admin/troll', async (request) => {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const originError = guardMutation(request, 'uxProtocol');
  if (originError) return originError;

  const body = await readJsonBody(request);
  const parsed = revokeSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'bad_request', 'Invalid revoke payload.');
  }

  const event = recentTrolls(50).find((e) => e.id === parsed.data.id);
  const revoked = revokeTroll(parsed.data.id);
  if (!revoked) return apiError(404, 'not_found', 'No active override with that id.');

  const tool = UX_TOOLS.find((t) => t.type === event?.type);
  await writeAudit({
    actorEmail: admin.email,
    action: 'ux.protocol_revoked',
    targetType: event?.target === 'all' ? 'broadcast' : 'user',
    targetId: event?.target ?? String(parsed.data.id),
    targetLabel: tool?.label ?? event?.type ?? String(parsed.data.id),
    details: { protocol: tool?.label ?? event?.type ?? null },
  });

  return Response.json({ ok: true });
});
