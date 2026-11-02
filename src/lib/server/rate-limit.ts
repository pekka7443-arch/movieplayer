// Shared persistent rate limiting (2026-11-03 hardening).
//
// STORAGE: SQLite `RateLimitState` table (token bucket per key) via Prisma —
// limits SURVIVE server restarts and are shared across workers. No Redis on
// this platform; SQLite in WAL mode is the secure persistent alternative.
//
// KEYS: `<bucket>:<client-ip>` plus, for credential endpoints, an optional
// second bucket `<bucket>:acct:<sha256(identity)>` (email / token hash) so
// an attacker rotating spoofed IPs still hits the per-ACCOUNT limit, and a
// distributed attack against one account is throttled too.
//
// FAILURE POLICY (never silently unlimited):
//   * auth-family buckets (login/register/forgot/reset/totp) → FAIL CLOSED
//     (503) when the store is unreachable;
//   * hot media buckets (stream/playerProxy/…) → degrade to an in-memory
//     bucket (still limited per process) + error log. Bounded, never open.
//
// IP TRUST: X-Forwarded-For / X-Real-IP are trusted because every external
// request arrives through the platform's Caddy gateway, which REPLACES
// (header_up X-Forwarded-For {remote_host}) rather than appends the header —
// a client cannot smuggle a forged chain through it. Direct connections to
// the app port are only possible from inside the sandbox. TRUST_PROXY=0
// disables forwarded-header trust entirely (single-tenant direct exposure).
//
// E2E escape hatch unchanged (dev + loopback + shared secret header).

import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

import { logger } from './logger';

export interface RateLimitDecision {
  ok: boolean;
  /** Seconds until a retry could succeed (0 when ok). */
  retryAfterSec: number;
  remaining: number;
}

export interface RateLimitStore {
  hit(key: string, limit: number, windowSec: number): Promise<RateLimitDecision> | RateLimitDecision;
}

interface BucketState {
  tokens: number;
  updatedAt: number;
}

/** Process-local fallback store (bounded degradation for hot buckets only). */
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

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000 && this.buckets.size <= this.maxBuckets) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > 10 * 60_000) this.buckets.delete(key);
    }
    if (this.buckets.size > this.maxBuckets) this.buckets.clear();
  }
}

const globalForLimiter = globalThis as unknown as {
  __cinedeckRateStore?: RateLimitStore;
  __cinedeckRateSweepAt?: number;
};

/** Fail-closed buckets — auth surfaces must never degrade to unlimited. */
const FAIL_CLOSED_BUCKETS = new Set<RateLimitBucket>([
  'login',
  'register',
  'forgotPassword',
  'resetPassword',
  'verifyEmail',
  'totp',
  'account',
]);

/**
 * SQLite-backed token bucket. Each hit is one short interactive transaction
 * (read → compute refill → conditional update); SQLite serializes writers,
 * so concurrent requests cannot double-spend tokens. WAL mode + busy timeout
 * are pinned once per process.
 */
class SqliteTokenBucketStore implements RateLimitStore {
  private pragmasReady = false;

  private async ensurePragmas(): Promise<void> {
    if (this.pragmasReady) return;
    try {
      // Every PRAGMA here may return a row on SQLite (journal_mode and
      // busy_timeout both report their new value) → queryRaw, never
      // executeRaw. All are idempotent connection-level settings.
      await db.$queryRawUnsafe('PRAGMA journal_mode=WAL;');
      await db.$queryRawUnsafe('PRAGMA busy_timeout=5000;');
      await db.$queryRawUnsafe('PRAGMA synchronous=NORMAL;');
      this.pragmasReady = true;
    } catch {
      // Non-fatal — defaults still work, just slower under contention.
    }
  }

  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitDecision> {
    await this.ensurePragmas();
    const now = Date.now();
    const refillPerMs = limit / (windowSec * 1000);

    return db.$transaction(
      async (tx) => {
        const row = await tx.rateLimitState.findUnique({ where: { key } });
        if (!row) {
          try {
            await tx.rateLimitState.create({
              data: { key, tokens: limit - 1, updatedAt: new Date(now) },
            });
            return { ok: true, retryAfterSec: 0, remaining: limit - 1 };
          } catch (error) {
            // Concurrent create — the winner exists now; re-read once.
            const raced = await tx.rateLimitState.findUnique({ where: { key } });
            if (!raced) throw error;
            return this.consume(tx, raced, now, limit, refillPerMs);
          }
        }
        return this.consume(tx, row, now, limit, refillPerMs);
      },
      { timeout: 4000 },
    );
  }

  private async consume(
    tx: Prisma.TransactionClient,
    row: { key: string; tokens: number; updatedAt: Date },
    now: number,
    limit: number,
    refillPerMs: number,
  ): Promise<RateLimitDecision> {
    const elapsed = now - row.updatedAt.getTime();
    const tokens = Math.min(limit, row.tokens + elapsed * refillPerMs);
    if (tokens < 1) {
      const deficit = 1 - tokens;
      await tx.rateLimitState.update({
        where: { key: row.key },
        data: { tokens, updatedAt: new Date(now) },
      });
      return {
        ok: false,
        retryAfterSec: Math.max(1, Math.ceil(deficit / refillPerMs / 1000)),
        remaining: 0,
      };
    }
    const after = tokens - 1;
    await tx.rateLimitState.update({
      where: { key: row.key },
      data: { tokens: after, updatedAt: new Date(now) },
    });
    return { ok: true, retryAfterSec: 0, remaining: Math.floor(after) };
  }
}

const sqliteStore = new SqliteTokenBucketStore();
const memoryFallback = new MemoryTokenBucketStore();
const store: RateLimitStore = globalForLimiter.__cinedeckRateStore ?? sqliteStore;
globalForLimiter.__cinedeckRateStore = store;

/** Test seam: direct access to the persistent store class. */
export const SqliteTokenBucketStoreForTests = SqliteTokenBucketStore;

// ---------------------------------------------------------------------------
// Named buckets — central catalog of every limited surface.
// `accountLimit` adds a second, identity-keyed bucket (email / token hash)
// for credential endpoints: IP rotation cannot bypass it.
// ---------------------------------------------------------------------------

export interface RateLimitSpec {
  limit: number;
  windowSec: number;
  /** Optional per-IDENTITY limit (email/token), in the same window. */
  accountLimit?: number;
}

export const RATE_LIMITS = {
  login: { limit: 5, windowSec: 15 * 60, accountLimit: 10 },
  register: { limit: 10, windowSec: 60 * 60, accountLimit: 10 },
  forgotPassword: { limit: 5, windowSec: 60 * 60, accountLimit: 5 },
  resetPassword: { limit: 10, windowSec: 60 * 60 },
  verifyEmail: { limit: 20, windowSec: 60 * 60 },
  totp: { limit: 10, windowSec: 5 * 60, accountLimit: 15 },
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
  /** Client experience poller — clients poll every ~15s, room for retries. */
  uxPoll: { limit: 60, windowSec: 60 },
  /** UX protocol apply/revoke (the admin User Experience endpoints). */
  uxProtocol: { limit: 20, windowSec: 60 },
  /** Troll prank pickup — every open tab polls every ~15s, guests included. */
  trollPoll: { limit: 60, windowSec: 60 },
  /** Admin dashboard reads (aggregation queries — bounded abuse surface). */
  adminRead: { limit: 60, windowSec: 60 },
  /** OG image generator — unauthenticated upstream fetches per hit. */
  og: { limit: 30, windowSec: 60 },
} as const satisfies Record<string, RateLimitSpec>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/** Best-effort client IP behind the platform Caddy gateway (see module docs). */
export function clientIpOf(request: Request): string {
  if (process.env.TRUST_PROXY !== '0') {
    const fwd = request.headers.get('x-forwarded-for');
    if (fwd) {
      const first = fwd.split(',')[0]?.trim();
      if (first) return first;
    }
    const real = request.headers.get('x-real-ip');
    if (real) return real.trim();
  }
  return 'local';
}

const sha256Hex = (input: string): string => createHash('sha256').update(input).digest('hex');

/** Sweep idle rate-limit rows at most once per minute (best-effort). */
async function sweepRows(): Promise<void> {
  const now = Date.now();
  if (globalForLimiter.__cinedeckRateSweepAt && now - globalForLimiter.__cinedeckRateSweepAt < 60_000) return;
  globalForLimiter.__cinedeckRateSweepAt = now;
  try {
    await db.rateLimitState.deleteMany({
      where: { updatedAt: { lt: new Date(now - 10 * 60_000) } },
    });
  } catch {
    // best-effort
  }
}

const globalForFallbackLog = globalThis as unknown as { __cinedeckRateFallbackLogAt?: Map<string, number> };

function throttleFallbackLog(bucket: string): boolean {
  const map = (globalForFallbackLog.__cinedeckRateFallbackLogAt ??= new Map<string, number>());
  const last = map.get(bucket) ?? 0;
  if (Date.now() - last < 60_000) return false;
  map.set(bucket, Date.now());
  return true;
}

export interface RateLimitOutcome {
  limited: boolean;
  retryAfterSec: number;
  /** Store failure (drives fail-open vs fail-closed). */
  storeError: boolean;
}

async function checkBuckets(
  keys: Array<{ key: string; limit: number; windowSec: number }>,
): Promise<RateLimitOutcome> {
  void sweepRows();
  let storeError = false;
  let worst: RateLimitOutcome = { limited: false, retryAfterSec: 0, storeError: false };
  for (const { key, limit, windowSec } of keys) {
    let decision: RateLimitDecision;
    try {
      decision = await store.hit(key, limit, windowSec);
    } catch (error) {
      storeError = true;
      if (throttleFallbackLog(key.split(':')[0])) {
        logger.error(
          { err: error instanceof Error ? { message: error.message } : error, bucket: key.split(':')[0] },
          'rate limit: persistent store unreachable — degrading to memory bucket',
        );
      }
      decision = memoryFallback.hit(key, limit, windowSec);
    }
    if (!decision.ok && decision.retryAfterSec >= worst.retryAfterSec) {
      worst = { limited: true, retryAfterSec: decision.retryAfterSec, storeError };
    }
  }
  return { ...worst, storeError: storeError || worst.storeError };
}

/**
 * Check (and consume) the rate limit for a request. Pure decision-maker:
 * returns the outcome; callers build the response. When `identity` is given
 * (normalized email or token) the account-keyed bucket applies as well.
 */
export async function checkRateLimit(
  request: Request,
  bucket: RateLimitBucket,
  identity?: string,
): Promise<RateLimitOutcome & { remaining: number }> {
  const spec: RateLimitSpec = RATE_LIMITS[bucket];
  const keys: Array<{ key: string; limit: number; windowSec: number }> = [
    { key: `${bucket}:${clientIpOf(request)}`, limit: spec.limit, windowSec: spec.windowSec },
  ];
  if (identity && spec.accountLimit) {
    keys.push({
      key: `${bucket}:acct:${sha256Hex(identity.trim().toLowerCase())}`,
      limit: spec.accountLimit,
      windowSec: spec.windowSec,
    });
  }
  const outcome = await checkBuckets(keys);
  return { ...outcome, remaining: 0 };
}

/** 429 response with the mandatory Retry-After header (standard error shape). */
export function rateLimitResponse(retryAfterSec: number): Response {
  return Response.json(
    { error: { code: 'rate_limited', message: 'Too many requests — slow down a little.' } },
    { status: 429, headers: { 'retry-after': String(Math.max(1, retryAfterSec)) } },
  );
}

/** 503 response for fail-closed buckets when the store is unreachable. */
function storeUnavailableResponse(): Response {
  return Response.json(
    {
      error: {
        code: 'temporarily_unavailable',
        message: 'The service is temporarily unavailable — please retry shortly.',
      },
    },
    { status: 503, headers: { 'retry-after': '5' } },
  );
}

/**
 * One-call guard for route handlers: returns a 429/503 Response when limited,
 * null when the request may proceed. Auth-family buckets fail CLOSED on
 * store errors; hot media buckets degrade to the in-memory limiter.
 */
export async function enforceRateLimit(
  request: Request,
  bucket: RateLimitBucket,
  identity?: string,
): Promise<Response | null> {
  // E2E escape hatch — scoped to ALL of: non-production runtime, a loopback
  // client, and the shared dev-only secret header. Rate limits stay fully
  // intact for the preview panel and any deployed environment.
  if (
    process.env.NODE_ENV !== 'production' &&
    isLoopbackClient(request) &&
    process.env.E2E_RATELIMIT_BYPASS &&
    request.headers.get('x-cinedeck-e2e') === process.env.E2E_RATELIMIT_BYPASS
  ) {
    return null;
  }
  const outcome = await checkRateLimit(request, bucket, identity);
  if (outcome.storeError && FAIL_CLOSED_BUCKETS.has(bucket)) {
    return storeUnavailableResponse();
  }
  if (outcome.limited) return rateLimitResponse(outcome.retryAfterSec);
  return null;
}

/** True when the direct peer (or forwarded chain) is loopback. */
function isLoopbackClient(request: Request): boolean {
  const ip = clientIpOf(request);
  return ip === 'local' || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
