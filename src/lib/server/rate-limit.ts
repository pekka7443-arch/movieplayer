// In-memory token-bucket rate limiter.
//
// Storage is behind the `RateLimitStore` interface so a Redis (or other
// distributed) implementation can be dropped in later without touching the
// call sites — every route just calls `enforceRateLimit(request, BUCKET)`.
//
// Buckets are keyed by `<bucket>:<client ip>`. A bucket allows `limit`
// requests per `windowSec`; the token bucket refills continuously, so a
// burst consumer is throttled smoothly instead of cliff-edge windows.
// 429 responses carry `Retry-After` (seconds until the next token).

export interface RateLimitDecision {
  ok: boolean;
  /** Seconds until a retry could succeed (0 when ok). */
  retryAfterSec: number;
  remaining: number;
}

export interface RateLimitStore {
  hit(key: string, limit: number, windowSec: number): RateLimitDecision;
}

interface BucketState {
  tokens: number;
  updatedAt: number;
}

/** Process-local token bucket. Good enough for a single-node deployment. */
export class MemoryTokenBucketStore implements RateLimitStore {
  private buckets = new Map<string, BucketState>();
  private lastSweep = Date.now();

  constructor(private readonly maxBuckets = 20_000) {}

  hit(key: string, limit: number, windowSec: number): RateLimitDecision {
    const now = Date.now();
    this.sweep(now);

    const refillPerMs = limit / (windowSec * 1000);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: limit, updatedAt: now };
      this.buckets.set(key, bucket);
    }
    // Refill continuously, capped at the burst size.
    const elapsed = now - bucket.updatedAt;
    bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillPerMs);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      const deficit = 1 - bucket.tokens;
      return {
        ok: false,
        retryAfterSec: Math.max(1, Math.ceil(deficit / refillPerMs / 1000)),
        remaining: 0,
      };
    }
    bucket.tokens -= 1;
    return { ok: true, retryAfterSec: 0, remaining: Math.floor(bucket.tokens) };
  }

  /** Drop idle buckets so the map cannot grow without bound. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000 && this.buckets.size <= this.maxBuckets) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > 10 * 60_000) this.buckets.delete(key);
    }
    // Hard cap — drop everything (acceptable degradation under abuse).
    if (this.buckets.size > this.maxBuckets) this.buckets.clear();
  }
}

const globalForLimiter = globalThis as unknown as { __cinedeckRateStore?: RateLimitStore };
const store: RateLimitStore =
  globalForLimiter.__cinedeckRateStore ?? new MemoryTokenBucketStore();
globalForLimiter.__cinedeckRateStore = store;

// ---------------------------------------------------------------------------
// Named buckets — central catalog of every limited surface.
// ---------------------------------------------------------------------------

export interface RateLimitSpec {
  limit: number;
  windowSec: number;
}

export const RATE_LIMITS = {
  login: { limit: 10, windowSec: 5 * 60 },
  register: { limit: 5, windowSec: 60 * 60 },
  forgotPassword: { limit: 5, windowSec: 60 * 60 },
  resetPassword: { limit: 10, windowSec: 60 * 60 },
  verifyEmail: { limit: 20, windowSec: 60 * 60 },
  totp: { limit: 10, windowSec: 5 * 60 },
  /** Library mutations — watchlist / history / ratings / lists. */
  library: { limit: 120, windowSec: 60 },
  /** Stream-provider scan (expensive: probes 6 external hosts). */
  scan: { limit: 30, windowSec: 60 },
  /** HLS proxy — media segments arrive in bursts, generous but bounded. */
  stream: { limit: 600, windowSec: 60 },
  /** Embed proxy HTML wrapper. */
  playerProxy: { limit: 120, windowSec: 60 },
  comments: { limit: 8, windowSec: 5 * 60 },
  reactions: { limit: 60, windowSec: 60 },
  reports: { limit: 10, windowSec: 60 * 60 },
  account: { limit: 20, windowSec: 5 * 60 },
} as const satisfies Record<string, RateLimitSpec>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/** Best-effort client IP behind the Caddy gateway (X-Forwarded-For first hop). */
export function clientIpOf(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') ?? 'local';
}

export function checkRateLimit(
  request: Request,
  bucket: RateLimitBucket,
  spec: RateLimitSpec = RATE_LIMITS[bucket],
): RateLimitDecision {
  return store.hit(`${bucket}:${clientIpOf(request)}`, spec.limit, spec.windowSec);
}

/** 429 response with the mandatory Retry-After header (standard error shape). */
export function rateLimitResponse(retryAfterSec: number): Response {
  return Response.json(
    { error: { code: 'rate_limited', message: 'Too many requests — slow down a little.' } },
    { status: 429, headers: { 'retry-after': String(Math.max(1, retryAfterSec)) } },
  );
}

/**
 * One-call guard for route handlers: returns a 429 Response when limited,
 * null when the request may proceed.
 */
export function enforceRateLimit(
  request: Request,
  bucket: RateLimitBucket,
  spec?: RateLimitSpec,
): Response | null {
  const decision = checkRateLimit(request, bucket, spec);
  return decision.ok ? null : rateLimitResponse(decision.retryAfterSec);
}
