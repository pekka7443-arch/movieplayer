import { z } from 'zod';

import { apiError, withApi } from '@/lib/server/api';
import { guardMutation, readJsonBody } from '@/lib/server/http';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import { requireAdmin } from '@/lib/server/admin';
import { writeAudit } from '@/lib/server/audit';
import {
  FINNISH_PROVIDERS_STATE_KEY,
  getFinnishDubProviders,
  setFinnishDubProviders,
} from '@/lib/server/finnish-providers';
import { FINNISH_DUB_PROVIDERS } from '@/lib/providers';

export const dynamic = 'force-dynamic';

const isResponse = (value: unknown): value is Response => value instanceof Response;

const providersBody = z.object({
  providers: z
    .array(z.string().trim().toLowerCase().max(60))
    .max(50, 'at most 50 provider ids'),
});

// ---------------------------------------------------------------------------
// GET /api/admin/finnish-providers — current merged allowlist
//   (static FINNISH_DUB_PROVIDERS + the admin-curated runtime list).
// POST { providers: string[] } — REPLACE the runtime list (persisted in the
//   SystemState key "finnish_dub_providers") and hot-reload the in-memory
//   copy the source scan reads — no server restart needed.
// Admin role required + full mutation guard (origin/CSRF/rate-limit/body
//   cap) — same middleware as every other /api/admin route (2026-11-03
//   hardening: this was the one mutating admin route without the guard).
// ---------------------------------------------------------------------------
export const GET = withApi('admin-finnish-providers', async (request) => {
  const limited = await enforceRateLimit(request, 'adminRead');
  if (limited) return limited;
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;

  const providers = await getFinnishDubProviders();
  return Response.json({
    providers,
    static: FINNISH_DUB_PROVIDERS,
    stateKey: FINNISH_PROVIDERS_STATE_KEY,
  });
});

export const POST = withApi('admin-finnish-providers', async (request) => {
  const guard = await guardMutation(request, 'uxProtocol');
  if (guard) return guard;
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;

  const body = await readJsonBody(request);
  const parsed = providersBody.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'bad_request', parsed.error.issues[0]?.message ?? 'invalid body');
  }

  const providers = await setFinnishDubProviders(parsed.data.providers);

  void writeAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'finnish_providers.update',
    targetType: 'system_state',
    targetId: FINNISH_PROVIDERS_STATE_KEY,
    targetLabel: 'Finnish dub provider allowlist',
    details: { providers, count: providers.length },
  });

  return Response.json({ providers, hotReloaded: true });
});
