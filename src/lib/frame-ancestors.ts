// Single source of truth for who may frame CineDeck — CSP `frame-ancestors`.
//
// Consumed by BOTH src/proxy.ts (the app-wide middleware CSP) and the
// /api/player-proxy route (the player shell CSP). They must never drift:
// a drifted copy is exactly what broke the platform embed on 2026-11-03,
// when the app-wide allowlist was narrowed to chat.z.ai only while the
// platform actually renders CineDeck inside iframes whose parent origins
// span the z.ai / space-z.ai domains. Chromium (Chrome AND Edge — both are
// Chromium) showed its blocked-frame page — "This content is blocked. Ask
// the site owner to fix it." — for every embedded view.
//
// PLATFORM CONTRACT (README deploy checklist, enforced by `bun run doctor`):
//   'self' https://chat.z.ai https://z.ai https://*.z.ai
//   https://*.space-z.ai http://localhost:*
//
// SECURITY MODEL — what this list does and does not grant:
//   * `frame-ancestors` governs EMBEDDING only. It grants no request
//     privileges and no credential access. Mutating-request origin trust is
//     separate and strict (src/lib/server/http.ts): POST/PUT/PATCH/DELETE
//     must match the deployment's own Host / first-hop X-Forwarded-Host /
//     ALLOWED_ORIGINS and carry the double-submit CSRF token. A sibling
//     tenant that frames the app still cannot forge authenticated requests.
//   * Arbitrary third-party websites remain unable to embed CineDeck
//     (clickjacking protection preserved) — only the z.ai platform's own
//     domains, this deployment's own origin, and localhost for development.
//   * NEVER add a bare `*` or an `http://*` wildcard here, and NEVER add
//     `X-Frame-Options` anywhere (it cannot express the platform list and
//     conflicts with frame-ancestors — README: "Never add X-Frame-Options").
export const FRAME_ANCESTOR_SOURCES = [
  "'self'",
  'https://chat.z.ai',
  'https://z.ai',
  'https://*.z.ai',
  'https://*.space-z.ai',
  'http://localhost:*',
] as const;

/** Serialized CSP source list for `frame-ancestors <list>`. */
export const FRAME_ANCESTORS = FRAME_ANCESTOR_SOURCES.join(' ');
