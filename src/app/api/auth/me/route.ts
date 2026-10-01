import { db } from '@/lib/db';
import { sessionUserId } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export interface AuthUserPayload {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

// GET /api/auth/me → { user | null }
export async function GET(request: Request) {
  const uid = sessionUserId(request);
  if (!uid) return Response.json({ user: null });

  const user = await db.user.findUnique({
    where: { id: uid },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  if (!user) return Response.json({ user: null });

  return Response.json({
    user: { ...user, createdAt: user.createdAt.toISOString() } satisfies AuthUserPayload,
  });
}
