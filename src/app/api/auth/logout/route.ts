import {
  clearGuestCookieValue,
  clearSessionCookieValue,
  sessionTokenOf,
  revokeSessionByToken,
} from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { enforceSameOrigin } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

// POST /api/auth/logout → revoke the session row (so the token can never be
// reused on another device) and clear the cookies. Guest mode continues on a
// fresh device identity so lists start clean.
export const POST = withApi('auth/logout', async (request) => {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  const token = sessionTokenOf(request);
  if (token) {
    try {
      await revokeSessionByToken(token);
    } catch {
      // The cookie is cleared regardless — best-effort row deletion.
    }
  }

  const response = Response.json({ ok: true });
  response.headers.append('Set-Cookie', clearSessionCookieValue());
  response.headers.append('Set-Cookie', clearGuestCookieValue());
  return response;
});
