// Shared HTTP guardrails + outbound retry helper for CineDeck.
//
// REQUEST GUARDRAILS (mutating methods POST/PUT/PATCH/DELETE)
// - ORIGIN check: Sec-Fetch-Site first (browser-asserted, proxy-proof), then
//   the Origin/Referer hostname must match the request's OWN Host /
//   X-Forwarded-Host (first hop) or the explicit ALLOWED_ORIGINS allowlist.
//   Platform sibling subdomains (*.z.ai / *.space-z.ai at large) are NOT
//   trusted as request origins — only the deployment's own host is. A page
//   on another tenant's subdomain is same-site (SameSite=Lax does not stop
//   it) so it must NOT pass this check (2026-11-03 hardening).
// - CSRF double-submit: when the browser holds the `cinedeck_csrf` cookie
//   (set by middleware on every page load), every mutating request must
//   carry `x-csrf-token` equal to that cookie. Cross-site attackers cannot
//   set custom headers (CORS preflight), so header+cookie+origin checks are
//   three independent CSRF defenses. Non-browser clients without the cookie
//   are governed by the origin check alone.
// - Request bodies are capped (JSON 256KB default) in readJsonBody.
//
// OUTBOUND RESILIENCE
// - withRetries: exponential backoff + jitter for upstream GETs (TMDB,
//   Cinemeta, TVmaze, ESPN, TheSportsDB, Yle) — retries transient failures
//   (network, timeout, 5xx, 429), fails fast on deterministic 4xx.
// Never import from client components.

import { timingSafeEqual } from 'node:crypto';

import { enforceRateLimit, type RateLimitBucket } from './rate-limit';
import { apiError } from './api';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Default maximum accepted JSON body size (bytes). */
const MAX_JSON_BODY_BYTES = 256 * 1024;

function normalizeHost(host: string | null): string {
  if (!host) return '';
  return host.trim().toLowerCase().split(':')[0].replace(/\.$/, '');
}

/**
 * Extra origins explicitly trusted for mutating requests, on top of the
 * request's own Host / first-hop X-Forwarded-Host. Comma-separated hostnames
 * (no scheme/port) via the ALLOWED_ORIGINS env — the escape hatch for custom
 * domains and exotic reverse proxies. Sibling platform subdomains are
 * deliberately NOT trusted implicitly (2026-11-03 hardening): the platform
 * preview gateway preserves the deployment's own Host, so same-origin
 * matching already covers it.
 */
function allowedOriginHosts(request: Request): Set<string> {
  const allowed = new Set<string>();
  const push = (value: string | null | undefined) => {
    const host = normalizeHost(value ?? null);
    if (host) allowed.add(host);
  };
  push(request.headers.get('host'));
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) push(forwardedHost.split(',')[0]?.trim());
  const extraOrigins = process.env.ALLOWED_ORIGINS;
  if (extraOrigins) {
    for (const entry of extraOrigins.split(',')) push(entry.trim());
  }
  return allowed;
}

/**
 * True when the request plausibly originates from this site.
 *
 * Checked in layers, most-trusted first:
 * 1. `Sec-Fetch-Site` — asserted BY THE BROWSER from the actual page origin,
 *    so it is immune to reverse proxies rewriting Host. `same-origin`/`none`
 *    allow, `cross-site` rejects, `same-site` falls through to the header
 *    comparison (a sibling subdomain must still prove it is THIS host).
 * 2. Header comparison — the Origin (or legacy Referer) hostname against
 *    Host, first-hop X-Forwarded-Host, and ALLOWED_ORIGINS.
 * 3. No Origin/Referer at all (curl, server-to-server) → allow; the session
 *    cookie is SameSite=Lax + HttpOnly, and the CSRF token check below still
 *    applies when a csrf cookie rides along.
 */
export function isSameOrigin(request: Request): boolean {
  if (!MUTATING.has(request.method.toUpperCase())) return true;

  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite === 'same-origin' || fetchSite === 'none') return true;
  if (fetchSite === 'cross-site') return false;

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (!origin && !referer) return true;

  const allowed = allowedOriginHosts(request);

  const claimHostOf = (value: string): string | null => {
    try {
      return normalizeHost(new URL(value).host);
    } catch {
      return null;
    }
  };

  const claimAllowed = (claim: string | null): boolean => {
    if (!claim) return false;
    return allowed.has(claim);
  };

  // Origin decides when present (browsers always send it on cross-site
  // POSTs); Referer is the legacy fallback when Origin was stripped.
  if (origin) return claimAllowed(claimHostOf(origin));
  return claimAllowed(claimHostOf(referer as string));
}

/** Constant-time string comparison (both must be non-empty and equal length). */
function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export const CSRF_COOKIE = 'cinedeck_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/**
 * Double-submit CSRF check. When the request carries the `cinedeck_csrf`
 * cookie, the `x-csrf-token` header must match it byte-for-byte. Requests
 * without the cookie (non-browser clients, first-touch) pass — the origin
 * check remains their gate.
 */
export function hasValidCsrfToken(request: Request): boolean {
  const match = request.headers.get('cookie')?.match(/(?:^|;\s*)cinedeck_csrf=([^;]+)/);
  if (!match) return true;
  const cookieValue = decodeURIComponent(match[1]);
  const headerValue = request.headers.get(CSRF_HEADER);
  if (!headerValue) return false;
  return constantTimeEqual(headerValue, cookieValue);
}

/** 403 Response when the origin/CSRF check fails; null when safe. */
export function enforceSameOrigin(request: Request): Response | null {
  if (isSameOrigin(request)) {
    if (MUTATING.has(request.method.toUpperCase()) && !hasValidCsrfToken(request)) {
      return apiError(403, 'csrf_failed', 'Request could not be verified. Reload the page and try again.');
    }
    return null;
  }
  return apiError(403, 'bad_origin', 'Request origin is not allowed.');
}

/** Combined guard for mutating routes: origin + CSRF, then rate limit. */
export async function guardMutation(
  request: Request,
  bucket: RateLimitBucket,
  identity?: string,
): Promise<Response | null> {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  return enforceRateLimit(request, bucket, identity);
}

// ---------------------------------------------------------------------------
// Consistent JSON error shape
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | 'bad_request'
  | 'bad_origin'
  | 'csrf_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'weak_password'
  | 'server_error';

/**
 * Standard-shape error response — kept as an alias of apiError for existing
 * callers. Produces `{ error: { code, message } }`.
 */
export function jsonError(
  code: ApiErrorCode,
  status: number,
  message?: string,
): Response {
  return apiError(status, code, message);
}

/**
 * Safe JSON body parse → null on any failure (empty/invalid/oversized body).
 * Enforces a hard size cap so no route can be memory-DoS'd through an
 * unbounded `request.text()` read (2026-11-03 hardening).
 */
export async function readJsonBody(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown | null> {
  try {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const text = await request.text();
    if (text.length > maxBytes) return null;
    if (!text) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Outbound retries with exponential backoff
// ---------------------------------------------------------------------------

export interface RetryOptions<T> {
  /** Total attempts including the first (default 3). */
  attempts?: number;
  /** Base backoff delay in ms (default 250 → 250, 500, 1000… + jitter). */
  baseDelayMs?: number;
  /** Return true to treat the resolved value as a transient failure and
   *  retry (e.g. null from a soft-failing request helper). */
  retryIf?: (value: T) => boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class UpstreamError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

/**
 * Run `fn` with exponential backoff. Retries thrown errors (network /
 * timeout / 5xx / 429 UpstreamError) and, when `retryIf` is set, resolved
 * values it flags as transient. The last failure propagates.
 * Idempotent GETs only.
 */
export async function withRetries<T>(
  fn: () => Promise<T>,
  options: RetryOptions<T> = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const base = options.baseDelayMs ?? 250;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const delay = base * 2 ** (attempt - 1) + Math.random() * base;
      await sleep(delay);
    }
    try {
      const value = await fn();
      if (options.retryIf?.(value) && attempt < attempts - 1) {
        lastError = new UpstreamError('upstream_transient_null');
        continue;
      }
      return value;
    } catch (error) {
      lastError = error;
      // Any error carrying a numeric `status` (UpstreamError, TmdbApiError,
      // …) informs retryability: 4xx except 429 is deterministic — fail fast.
      const status = error instanceof UpstreamError
        ? error.status
        : typeof (error as { status?: unknown }).status === 'number'
          ? (error as { status: number }).status
          : undefined;
      if (status !== undefined && status < 500 && status !== 429) break;
      if (attempt === attempts - 1) break;
    }
  }
  throw lastError instanceof Error ? lastError : new UpstreamError('upstream_failed');
}
