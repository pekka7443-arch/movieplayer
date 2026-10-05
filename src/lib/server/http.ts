// Shared HTTP guardrails for CineDeck API routes.
// - Origin/CSRF check: every mutating request (POST/PUT/PATCH/DELETE) must
//   come from our own origin. Browsers always send Origin (or Referer) on
//   cross-site requests; a mismatch → 403. This blocks CSRF from foreign
//   pages because our auth is cookie-based (SameSite=Lax already covers the
//   classic cross-site form POST; this closes same-site subdomain and
//   scheme-downgrade gaps).
// - Consistent JSON error shape: { error: CODE, message?: string }.
// - Request id propagation.

import { enforceRateLimit, type RateLimitBucket } from './rate-limit';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function normalizeHost(host: string | null): string {
  if (!host) return '';
  return host.toLowerCase().split(':')[0].replace(/\.$/, '');
}

/**
 * True when the request plausibly originates from this site.
 * - Same-origin fetch sends Origin: <scheme://host[:port]>. We compare the
 *   hostname against the Host header (scheme and port differ behind proxies).
 * - No Origin at all: fall back to Referer. Native tooling that sends
 *   neither (curl) is allowed — cookies still gate the sensitive actions.
 */
export function isSameOrigin(request: Request): boolean {
  if (!MUTATING.has(request.method.toUpperCase())) return true;

  const host = normalizeHost(request.headers.get('host'));
  if (!host) return false;

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return normalizeHost(new URL(origin).host) === host;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return normalizeHost(new URL(referer).host) === host;
    } catch {
      return false;
    }
  }

  // No Origin/Referer (curl, server-to-server). The session cookie is
  // SameSite=Lax + HttpOnly, so browser CSRF is already blocked — allow.
  return true;
}

/** 403 Response when the origin check fails; null when the request is safe. */
export function enforceSameOrigin(request: Request): Response | null {
  if (isSameOrigin(request)) return null;
  return Response.json(
    { error: 'bad_origin', message: 'Request origin is not allowed.' },
    { status: 403 },
  );
}

/** Combined guard for mutating routes: origin check first, then rate limit. */
export function guardMutation(request: Request, bucket: RateLimitBucket): Response | null {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  return enforceRateLimit(request, bucket);
}

// ---------------------------------------------------------------------------
// Consistent JSON error shape
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | 'bad_request'
  | 'bad_origin'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'weak_password'
  | 'server_error';

export function jsonError(
  code: ApiErrorCode,
  status: number,
  message?: string,
): Response {
  return Response.json({ error: code, ...(message ? { message } : {}) }, { status });
}

/** Safe JSON body parse → null on any failure (empty/invalid body). */
export async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
