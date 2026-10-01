import { clearGuestCookieValue, clearSessionCookieValue } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

// POST /api/auth/logout → end the session (guest mode continues on a fresh
// device identity so lists start clean).
export async function POST() {
  const response = Response.json({ ok: true });
  response.headers.append('Set-Cookie', clearSessionCookieValue());
  response.headers.append('Set-Cookie', clearGuestCookieValue());
  return response;
}
