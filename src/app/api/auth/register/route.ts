import { z } from 'zod';

import { db } from '@/lib/db';
import {
  hashPassword,
  mergeGuestIntoUser,
  resolveOwner,
  sessionCookieValue,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const registerSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(8).max(100),
});

// POST /api/auth/register → create account, merge guest data, start session.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const { name, email, password } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json({ error: 'email_taken' }, { status: 409 });
  }

  const user = await db.user.create({
    data: { email, name: name ?? null, passwordHash: hashPassword(password) },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  // Carry the guest device's watchlist + history into the new account.
  const owner = resolveOwner(request);
  if (owner.guestId) {
    try {
      await mergeGuestIntoUser(owner.guestId, user.id);
    } catch {
      // Migration is best-effort — never block account creation.
    }
  }

  const response = Response.json({
    user: { ...user, createdAt: user.createdAt.toISOString() },
  });
  response.headers.append('Set-Cookie', sessionCookieValue(user.id));
  // The guest identity is now merged into the account — drop the guest cookie
  // so future "guest" rows can never re-migrate a second time.
  if (owner.guestId) {
    response.headers.append(
      'Set-Cookie',
      `cinedeck_guest=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  }
  return response;
}
