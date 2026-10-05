// Shared HTTP guardrails + outbound retry helper for CineDeck.
//
// REQUEST GUARDRAILS
// - Origin/CSRF check: every mutating request (POST/PUT/PATCH/DELETE) must
//   come from our own origin. Browsers always send Origin (or Referer) on
//   cross-site requests; a mismatch → 403. This blocks CSRF from foreign
//   pages because our auth is cookie-based (SameSite=Lax already covers the
//   classic cross-site form POST; this closes same-site subdomain and
//   scheme-downgrade gaps).
// - Safe JSON body parsing, request id propagation.
//
// OUTBOUND RESILIENCE
// - withRetries: exponential backoff + jitter for upstream GETs (TMDB,
//   Cinemeta, TVmaze, ESPN, TheSportsDB, Yle) — retries transient failures
//   (network, timeout, 5xx, 429), fails fast on deterministic 4xx.
// Never import from client components.

import { enforceRateLimit, type RateLimitBucket } from './rate-limit';
import { apiError } from './api';

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
  return apiError(403, 'bad_origin', 'Request origin is not allowed.');
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
