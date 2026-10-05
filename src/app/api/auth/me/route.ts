import { db } from '@/lib/db';
import {
  cleanupStaleGuests,
  resolveOwner,
  sessionCookieValue,
  rotateSession,
  withOwnerCookies,
} from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export interface AuthUserPayload {
  id: string;
  email: string;
  name: string | null;
  role: string;
  emailVerified: boolean;
  totpEnabled: boolean;
  createdAt: string;
}

/**
 * GET /api/auth/me → { user | null }
 *
 * Also slides the 30-day session cookie forward when more than 24h have
 * passed since the last rotation — logged-in users stay logged in on
 * recurring visits without re-authenticating, while the server keeps the
 * window rolling (and revocation stays possible per session row).
 */
export const GET = withApi('auth/me', async (request) => {
  // Opportunistic daily housekeeping (throttled internally).
  void cleanupStaleGuests();

  const owner = await resolveOwner(request);
  if (!owner.userId || !owner.session) {
    return withOwnerCookies(Response.json({ user: null }), owner);
  }

  const user = await db.user.findUnique({
    where: { id: owner.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerified: true,
      totpEnabled: true,
      createdAt: true,
    },
  });
  if (!user) {
    // Session row points at a deleted account — treat as signed out.
    return withOwnerCookies(Response.json({ user: null }), owner);
  }

  const response = Response.json({
    user: {
      ...user,
      emailVerified: user.emailVerified !== null,
      createdAt: user.createdAt.toISOString(),
    } satisfies AuthUserPayload,
  });
  withOwnerCookies(response, owner);
  if (owner.session.needsRotation) {
    const rotated = await rotateSession(owner.session.sessionId);
    if (rotated) response.headers.append('Set-Cookie', sessionCookieValue(rotated));
  }
  return response;
});
