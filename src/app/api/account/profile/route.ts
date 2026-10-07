import { z } from 'zod';

import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi, apiError } from '@/lib/server/api';
import { guardMutation, readJsonBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

// Emoji glyph avatars only — never file uploads, so nothing user-controlled
// can ever reach an <img src>. Max 8 chars covers every multi-codepoint emoji.
const schema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  avatar: z.string().max(8).nullable().optional(),
});

/** PATCH /api/account/profile { name?, avatar? } → update display identity. */
export const PATCH = withApi('account/profile', async (request) => {
  const guard = guardMutation(request, 'account');
  if (guard) return guard;

  const owner = await resolveOwner(request);
  if (!owner.userId) return apiError(401, 'unauthorized');

  const body = await readJsonBody(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError(400, 'bad_request');

  const data: { name?: string | null; avatar?: string | null } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name || null;
  if (parsed.data.avatar !== undefined) data.avatar = parsed.data.avatar || null;

  const user = await db.user.update({
    where: { id: owner.userId },
    data,
    select: { id: true, email: true, name: true, role: true, avatar: true },
  });

  return Response.json({ user });
});

/** GET /api/account/profile → the signed-in account's public profile. */
export const GET = withApi('account/profile-get', async (request) => {
  const owner = await resolveOwner(request);
  if (!owner.userId) return apiError(401, 'unauthorized');

  const user = await db.user.findUnique({
    where: { id: owner.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      avatar: true,
      emailVerified: true,
      totpEnabled: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });
  if (!user) return apiError(401, 'unauthorized');
  return Response.json({
    user: {
      ...user,
      emailVerified: user.emailVerified?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    },
  });
});
