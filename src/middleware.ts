// CineDeck edge middleware — security headers that must be dynamic.
//
// 1. CONTENT SECURITY POLICY (2026-11-03 hardening)
//    Production uses a per-request NONCE for script-src with 'strict-dynamic':
//    no 'unsafe-inline', no 'unsafe-eval'. Next.js reads the nonce from the
//    Content-Security-Policy REQUEST header (set below) and applies it to its
//    own bootstrap + hydration scripts automatically. Development keeps
//    'unsafe-eval'/'unsafe-inline' (React Refresh / Turbopack require them).
//    style-src keeps 'unsafe-inline' (React style attributes need it — CSP
//    has no story for them short of full hashing).
//    The /api/player-proxy route is EXCLUDED: it emits its own tight CSP
//    (with this middleware's nonce via the x-nonce request header).
//
// 2. CSRF DOUBLE-SUBMIT COOKIE — `cinedeck_csrf` is issued here (readable by
//    JS on purpose: the client echoes it in the x-csrf-token header on every
//    mutating fetch — see src/lib/csrf-client.ts; the server compares in
//    src/lib/server/http.ts). Cross-site attackers cannot read our cookie nor
//    set custom headers, so the pair is unforgeable.
//
// 3. HSTS in production (the platform serves the app over HTTPS).
//
// 4. Clickjacking: frame-ancestors allows 'self', the platform chat embed
//    (chat.z.ai), the published preview domains (*.space-z.ai) and localhost
//    for development. Arbitrary *.z.ai sibling subdomains are NOT allowed to
//    frame the app (2026-11-03 hardening) — the platform preview embed lives
//    on chat.z.ai, and top-level visits need no frame permission at all.

import { NextRequest, NextResponse } from 'next/server';

const CSRF_COOKIE = 'cinedeck_csrf';
const PLAYER_PROXY_PATH = '/api/player-proxy';

const isProd = process.env.NODE_ENV === 'production';

/** Trusted frame ancestors — kept in sync with src/app/api/player-proxy CSP. */
const FRAME_ANCESTORS = [
  "'self'",
  'https://chat.z.ai',
  'https://z.ai',
  'https://*.space-z.ai',
  'http://localhost:*',
].join(' ');

function buildCsp(nonce: string): string {
  const scriptSrc = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' https://www.youtube.com`
    : // Dev: Next dev tooling + React Refresh inject non-nonce'd, eval-using
      // bootstrap code; hardening applies to production builds only.
      "'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com";
  const connectSrc = isProd ? "'self'" : "'self' ws: wss:";
  return [
    'default-src \'self\'',
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    // Player frames are nested same-origin through /api/player-proxy; the
    // provider host list lives in the proxy route + next.config frame-src.
    'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
    // hls.js spins up blob: workers for some transmuxing paths; the service
    // worker shell is same-origin.
    "worker-src 'self' blob:",
    `frame-ancestors ${FRAME_ANCESTORS}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Per-request nonce (122 bits of randomness — unguessable).
  const nonce = crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  // The player-proxy route emits its own specialized CSP (frame-src provider
  // allowlist + the same nonce). Setting ours too would stack two policies —
  // browsers enforce the INTERSECTION, which would break the player page.
  if (pathname === PLAYER_PROXY_PATH) {
    const bare = NextResponse.next({ request: { headers: requestHeaders } });
    return finalizeCookies(request, bare);
  }

  const csp = buildCsp(nonce);
  // Set on the REQUEST headers so Next's script renderer picks up the nonce,
  // and on the RESPONSE so browsers enforce it.
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  if (isProd) {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  }

  return finalizeCookies(request, response);
}

/** Issue the CSRF double-submit cookie when the caller does not have one. */
function finalizeCookies(request: NextRequest, response: NextResponse): NextResponse {
  if (!request.cookies.get(CSRF_COOKIE)?.value) {
    const token = crypto.randomUUID().replace(/-/g, '');
    const cookie = [
      `${CSRF_COOKIE}=${token}`,
      'Path=/',
      'SameSite=Lax',
      `Max-Age=${60 * 60 * 24 * 30}`,
    ];
    if (isProd) cookie.push('Secure');
    response.headers.append('Set-Cookie', cookie.join('; '));
  }
  return response;
}

export const config = {
  matcher: {
    source: '/((?!_next/static|_next/image|favicon.ico).*)',
  },
};
