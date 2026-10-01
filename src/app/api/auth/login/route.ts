import { z } from 'zod';

import { db } from '@/lib/db';
import {
  mergeGuestIntoUser,
  resolveOwner,
  sessionCookieValue,
  verifyPassword,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(1).max(100),
});

// POST /api/auth/login → verify credentials, merge guest data, start session.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return Response.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  // Carry the guest device's watchlist + history into the account.
  const owner = resolveOwner(request);
  if (owner.guestId) {
    try {
      await mergeGuestIntoUser(owner.guestId, user.id);
    } catch {
      // Migration is best-effort — never block sign-in.
    }
  }

  const response = Response.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
    },
  });
  response.headers.append('Set-Cookie', sessionCookieValue(user.id));
  if (owner.guestId) {
    response.headers.append(
      'Set-Cookie',
      `cinedeck_guest=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  }
  return response;
}
