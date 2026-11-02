import { z } from 'zod';

import { db } from '@/lib/db';
import { apiError, withApi } from '@/lib/server/api';
import { guardMutation, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { requireAdmin } from '@/lib/server/admin';
import { writeAudit } from '@/lib/server/audit';
import {
  EFFECT_DURATION_RANGE,
  UX_TOOLS,
  isEffectType,
  recentEffects,
  revokeEffect,
  toPublicEffect,
  triggerEffect,
  type UxTool,
} from '@/lib/server/ux';

export const dynamic = 'force-dynamic';

const isResponse = (value: unknown): value is Response => value instanceof Response;

const applySchema = z.object({
  effect: z.string().refine(isEffectType, 'unknown_effect_type'),
  target: z.union([z.literal('all'), z.literal('self'), z.string().trim().toLowerCase().email().max(120)]),
  message: z.string().trim().max(200).optional(),
  durationSec: z.number().int().min(EFFECT_DURATION_RANGE.min).max(EFFECT_DURATION_RANGE.max),
});

const revokeSchema = z.object({
  id: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// GET /api/admin/user-experience — the User Experience toolkit: tool catalog
// (dry internal names + technical effect notes) and recent overrides for the
// management table.
// POST /api/admin/user-experience — apply an override to everyone, one user,
// or 'self' (operator preview on the admin's own screen only).
// DELETE /api/admin/user-experience — revoke a running override.
// Every apply/revoke lands in the audit log as a ux.protocol_* entry so the
// trail reads like ordinary platform operations.
// ---------------------------------------------------------------------------
export const GET = withApi('admin/user-experience', async (request) => {
  const limited = await enforceRateLimit(request, 'adminRead');
  if (limited) return limited;
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const tools: UxTool[] = UX_TOOLS;
  return Response.json({
    tools,
    events: recentEffects(30).map((event) => ({
      ...toPublicEffect(event),
      target: event.target,
      createdBy: event.createdBy,
    })),
  });
});

export const POST = withApi('admin/user-experience', async (request) => {
  // Origin + CSRF + rate limit FIRST — then authorization.
  const guard = await guardMutation(request, 'uxProtocol');
  if (guard) return guard;
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;

  const body = await readJsonBody(request);
  const parsed = applySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'bad_request', 'Invalid protocol payload.');
  }
  const { effect, target, message, durationSec } = parsed.data;

  const tool = UX_TOOLS.find((t) => t.effect === effect);
  if (tool?.needsMessage && (!message || message.trim().length < 2)) {
    return apiError(400, 'bad_request', 'A notice body is required for this protocol.');
  }

  // 'self' = operator preview: the override plays on the admin's own screen.
  const resolvedTarget = target === 'self' ? admin.email : target;
  const isPreview = target === 'self';

  // Targeted protocols must name an existing account (typo-proofing).
  if (!isPreview && resolvedTarget !== 'all') {
    const user = await db.user.findUnique({ where: { email: resolvedTarget }, select: { id: true } });
    if (!user) return apiError(404, 'not_found', 'No account with that email.');
  }

  const event = triggerEffect({ effect, target: resolvedTarget, message, durationSec, createdBy: admin.email });
  await writeAudit({
    actorEmail: admin.email,
    action: isPreview ? 'ux.protocol_previewed' : 'ux.protocol_applied',
    targetType: resolvedTarget === 'all' ? 'broadcast' : 'user',
    targetId: resolvedTarget === 'all' ? 'all' : resolvedTarget,
    targetLabel: tool?.label ?? effect,
    details: { protocol: tool?.label ?? effect, target: resolvedTarget, durationSec, message: message || null },
  });

  return Response.json({ ok: true, event: toPublicEffect(event) });
});

export const DELETE = withApi('admin/user-experience', async (request) => {
  const guard = await guardMutation(request, 'uxProtocol');
  if (guard) return guard;
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;

  const body = await readJsonBody(request);
  const parsed = revokeSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'bad_request', 'Invalid revoke payload.');
  }

  const event = recentEffects(50).find((e) => e.id === parsed.data.id);
  const revoked = revokeEffect(parsed.data.id);
  if (!revoked) return apiError(404, 'not_found', 'No active override with that id.');

  const tool = UX_TOOLS.find((t) => t.effect === event?.effect);
  await writeAudit({
    actorEmail: admin.email,
    action: 'ux.protocol_revoked',
    targetType: event?.target === 'all' ? 'broadcast' : 'user',
    targetId: event?.target ?? String(parsed.data.id),
    targetLabel: tool?.label ?? event?.effect ?? String(parsed.data.id),
    details: { protocol: tool?.label ?? event?.effect ?? null },
  });

  return Response.json({ ok: true });
});
