// Server-only auth helpers for CineDeck accounts.
// - Password hashing: node:crypto scrypt (salted, timing-safe compare)
// - Sessions: random 256-bit tokens; only the SHA-256 hash is stored in the
//   Session table, so sessions can be revoked individually or all at once.
//   The 30-day cookie is SLIDING — re-issued (token rotated) whenever more
//   than 24h have passed since the last rotation, on any authenticated call.
// - AUTH_SECRET signs stateless tokens (password reset, email verification,
//   pending-TOTP logins). REQUIRED in production — the process refuses to
//   boot without it.
// - Guests: separate `cinedeck_guest` UUID cookie identifies the device so
//   watchlists / history work without an account and migrate into the
//   account on register/login.
// Never import from client components.

import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';

export const SESSION_COOKIE = 'cinedeck_session';
export const GUEST_COOKIE = 'cinedeck_guest';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const GUEST_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year
/** Sliding-window rotation threshold: re-issue cookies after 24h. */
export const SESSION_ROTATE_AFTER_SECONDS = 60 * 60 * 24;

// ---------------------------------------------------------------------------
// AUTH_SECRET — required only under PUBLISH_STRICT; otherwise self-healed:
// a stable random secret is generated and persisted into .env on first run
// (best effort — read-only filesystems fall back to a per-process secret).
// ---------------------------------------------------------------------------

let devSecret: string | null = null;

/**
 * Persist a freshly generated AUTH_SECRET into .env so it survives restarts.
 * Replaces an existing invalid (too-short/placeholder) line if present.
 * Returns the secret that should be used for this process.
 */
function persistAuthSecret(): string {
  const generated = randomBytes(32).toString('hex');
  try {
    const envPath = path.join(process.cwd(), '.env');
    let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
    const line = new RegExp(`^AUTH_SECRET=.*$`, 'm');
    if (line.test(content)) {
      content = content.replace(line, `AUTH_SECRET=${generated}`);
      writeFileSync(envPath, content);
    } else {
      if (content.length > 0 && !content.endsWith('\n')) content += '\n';
      appendFileSync(envPath, `${content}AUTH_SECRET=${generated}\n`);
    }
    console.warn(
      '[auth] AUTH_SECRET was missing — generated a stable random secret and wrote it to .env. ' +
        'Set an explicit AUTH_SECRET via `openssl rand -hex 32` for production.',
    );
  } catch {
    console.warn(
      '[auth] AUTH_SECRET was missing and .env is not writable — using an ephemeral ' +
        'per-process secret (stateless auth links reset on restart).',
    );
  }
  return generated;
}

/**
 * Stateful-token signing secret. Hard-fails ONLY when NODE_ENV=production AND
 * PUBLISH_STRICT=1 (explicit operator opt-in) — a missing secret must never
 * crash the platform's publish/preview flow, so every other environment
 * self-heals: the secret is generated and persisted to .env on first use.
 */
export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === 'production' && process.env.PUBLISH_STRICT === '1') {
    throw new Error(
      'AUTH_SECRET is missing or too short (PUBLISH_STRICT=1). Generate one with `openssl rand -hex 32` and set it in the environment.',
    );
  }
  if (!devSecret) {
    devSecret = persistAuthSecret();
    process.env.AUTH_SECRET = devSecret;
  }
  return devSecret;
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const [scheme, salt, hash] = parts;
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ---------------------------------------------------------------------------
// Stateless signed tokens (reset / verification / pending TOTP)
// Format: base64url(payload).base64url(HMAC-SHA256)
// ---------------------------------------------------------------------------

interface SignedPayload {
  purpose: 'reset' | 'verify' | 'totp';
  sub: string;
  exp: number;
  /** Random nonce — makes every token unique even for the same user. */
  jti: string;
}

export interface SignedToken {
  token: string;
  expiresAt: Date;
}

export function signStatelessToken(
  purpose: SignedPayload['purpose'],
  userId: string,
  ttlSeconds: number,
): SignedToken {
  const payload: SignedPayload = {
    purpose,
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    jti: randomBytes(12).toString('hex'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', authSecret()).update(body).digest('base64url');
  return {
    token: `${body}.${mac}`,
    expiresAt: new Date(payload.exp * 1000),
  };
}

export function verifyStatelessToken(
  token: string,
  purpose: SignedPayload['purpose'],
): { userId: string } | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac('sha256', authSecret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SignedPayload;
    if (payload.purpose !== purpose) return null;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Database-backed sessions (revocable, sliding)
// ---------------------------------------------------------------------------

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export interface SessionCookieContext {
  /** The raw cookie value — store only its hash server-side. */
  token: string;
  expiresAt: Date;
}

export interface ValidatedSession {
  userId: string;
  sessionId: string;
  /** True when the cookie should be re-issued (24h since last rotation). */
  needsRotation: boolean;
}

/** Create a fresh session row + cookie value for a user. */
export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null },
): Promise<SessionCookieContext> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await db.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 200) ?? null,
      ip: meta.ip?.slice(0, 64) ?? null,
    },
  });
  return { token, expiresAt };
}

/**
 * Validate a session cookie. Returns null when the token is unknown, expired
 * or the account is gone. Bumps lastSeenAt (throttled to once per hour).
 */
export async function validateSessionToken(token: string): Promise<ValidatedSession | null> {
  const tokenHash = sha256(token);
  const session = await db.session.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, lastSeenAt: true, rotatedAt: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    // Lazy cleanup of an expired row — the cookie is dead either way.
    void db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const needsRotation =
    Date.now() - session.rotatedAt.getTime() > SESSION_ROTATE_AFTER_SECONDS * 1000;
  const sinceSeen = Date.now() - session.lastSeenAt.getTime();
  if (sinceSeen > 60 * 60 * 1000) {
    void db.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }
  return { userId: session.userId, sessionId: session.id, needsRotation };
}

/**
 * Slide the session forward: rotate the token hash, push expiry out another
 * 30 days and return a fresh cookie value for the response.
 */
export async function rotateSession(sessionId: string): Promise<SessionCookieContext | null> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  try {
    await db.session.update({
      where: { id: sessionId },
      data: { tokenHash: sha256(token), expiresAt, rotatedAt: new Date(), lastSeenAt: new Date() },
    });
  } catch {
    return null; // row vanished (logged out concurrently) — nothing to slide
  }
  return { token, expiresAt };
}

export async function revokeSessionByToken(token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}

// ---------------------------------------------------------------------------
// Cookie parsing / serialization (pure Request/Response — no next/headers)
// ---------------------------------------------------------------------------

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('cookie');
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

const isProd = process.env.NODE_ENV === 'production';

export function sessionCookieValue(ctx: SessionCookieContext): string {
  const maxAge = Math.max(0, Math.floor((ctx.expiresAt.getTime() - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${ctx.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd ? '; Secure' : ''}`;
}

export function clearSessionCookieValue(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? '; Secure' : ''}`;
}

export function guestCookieValue(guestId: string): string {
  return `${GUEST_COOKIE}=${guestId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${GUEST_TTL_SECONDS}`;
}

export function clearGuestCookieValue(): string {
  return `${GUEST_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ---------------------------------------------------------------------------
// Owner resolution — user session first, else guest device cookie
// ---------------------------------------------------------------------------

export interface OwnerContext {
  /** Row scope: user id when signed in, else guest device UUID. */
  ownerId: string;
  /** Signed-in user id, or null for guests. */
  userId: string | null;
  /** Guest device UUID, or null when signed in. */
  guestId: string | null;
  /** True when the request had no guest cookie and a fresh one was minted. */
  newGuest: boolean;
  /** Validated session — present only for authenticated callers. */
  session: ValidatedSession | null;
}

/**
 * Resolve the caller identity AND validate/refresh the session in one step.
 * Never throws for auth reasons — missing/invalid auth degrades to guest.
 */
export async function resolveOwner(request: Request): Promise<OwnerContext> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) {
    const session = await validateSessionToken(token).catch(() => null);
    if (session) {
      return {
        ownerId: session.userId,
        userId: session.userId,
        guestId: null,
        newGuest: false,
        session,
      };
    }
  }
  const existing = parseCookies(request)[GUEST_COOKIE] ?? null;
  const guestId = existing && /^[\w-]{8,64}$/.test(existing) ? existing : randomUUID();
  return { ownerId: guestId, userId: null, guestId, newGuest: !existing, session: null };
}

/** Append pending Set-Cookie headers (fresh guest identity) to a response. */
export function withOwnerCookies<T extends Response>(response: T, ctx: OwnerContext): T {
  if (ctx.newGuest && ctx.guestId) {
    response.headers.append('Set-Cookie', guestCookieValue(ctx.guestId));
  }
  return response;
}

/**
 * Slide the session cookie forward on an authenticated API response when the
 * 24h rotation threshold has passed. Call on every authenticated route's
 * response (mirrors the "re-issue on any authenticated API call" rule).
 */
export async function withSessionRefresh<T extends Response>(
  response: T,
  ctx: OwnerContext,
): Promise<T> {
  if (!ctx.session?.needsRotation || !ctx.userId) return response;
  const rotated = await rotateSession(ctx.session.sessionId);
  if (rotated) response.headers.append('Set-Cookie', sessionCookieValue(rotated));
  return response;
}

/** Read the session cookie directly (for routes that only need the token). */
export function sessionTokenOf(request: Request): string | null {
  return parseCookies(request)[SESSION_COOKIE] ?? null;
}

// ---------------------------------------------------------------------------
// Guest → account migration (runs on register and login)
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

/**
 * Move every watchlist row and history entry from the guest device identity
 * to the freshly authenticated user, inside ONE transaction with batched
 * queries (bulk statements for the common case, row-level ops only for real
 * conflicts). Conflicts keep the account's own row — except history, where
 * the most recently updated copy wins.
 */
export async function mergeGuestIntoUser(guestId: string, userId: string, tx?: Tx): Promise<void> {
  if (!guestId || guestId === userId) return;
  const run = async (txc: Tx) => {
    await Promise.all([
      mergeWatchlist(txc, guestId, userId),
      mergeHistory(txc, guestId, userId),
      mergeRatings(txc, guestId, userId),
      mergeEpisodeWatches(txc, guestId, userId),
    ]);
    // Custom lists move wholesale — they have no user-side counterparts.
    await txc.list.updateMany({ where: { ownerId: guestId }, data: { ownerId: userId, userId } });
  };
  if (tx) {
    await run(tx);
  } else {
    await db.$transaction(run);
  }
}

async function mergeWatchlist(tx: Tx, guestId: string, userId: string): Promise<void> {
  const [guestItems, userItems] = await Promise.all([
    tx.watchlistItem.findMany({ where: { ownerId: guestId } }),
    tx.watchlistItem.findMany({ where: { ownerId: userId } }),
  ]);
  if (guestItems.length === 0) return;
  const userKeys = new Set(userItems.map((u) => `${u.tmdbId}:${u.mediaType}`));
  const dupIds: string[] = [];
  const moveIds: string[] = [];
  for (const gi of guestItems) {
    (userKeys.has(`${gi.tmdbId}:${gi.mediaType}`) ? dupIds : moveIds).push(gi.id);
  }
  if (dupIds.length > 0) {
    await tx.watchlistItem.deleteMany({ where: { id: { in: dupIds } } });
  }
  if (moveIds.length > 0) {
    await tx.watchlistItem.updateMany({
      where: { id: { in: moveIds } },
      data: { ownerId: userId, userId },
    });
  }
}

async function mergeHistory(tx: Tx, guestId: string, userId: string): Promise<void> {
  const [guestHistory, userHistory] = await Promise.all([
    tx.watchHistory.findMany({ where: { ownerId: guestId } }),
    tx.watchHistory.findMany({ where: { ownerId: userId } }),
  ]);
  if (guestHistory.length === 0) return;
  const userByKey = new Map(userHistory.map((u) => [`${u.tmdbId}:${u.mediaType}`, u]));
  const dupGuestIds: string[] = [];
  const stealUserIds: string[] = [];
  const moveIds: string[] = [];
  for (const gh of guestHistory) {
    const dup = userByKey.get(`${gh.tmdbId}:${gh.mediaType}`);
    if (!dup) {
      moveIds.push(gh.id);
    } else if (gh.updatedAt > dup.updatedAt) {
      // Guest device watched this more recently — the guest copy wins.
      dupGuestIds.push(gh.id);
      stealUserIds.push(dup.id);
    } else {
      dupGuestIds.push(gh.id);
    }
  }
  if (stealUserIds.length > 0) {
    await tx.watchHistory.deleteMany({ where: { id: { in: stealUserIds } } });
  }
  if (dupGuestIds.length > 0) {
    await tx.watchHistory.deleteMany({ where: { id: { in: dupGuestIds } } });
  }
  if (moveIds.length > 0) {
    await tx.watchHistory.updateMany({
      where: { id: { in: moveIds } },
      data: { ownerId: userId, userId },
    });
  }
}

async function mergeRatings(tx: Tx, guestId: string, userId: string): Promise<void> {
  const [guestRows, userRows] = await Promise.all([
    tx.rating.findMany({ where: { ownerId: guestId } }),
    tx.rating.findMany({ where: { ownerId: userId } }),
  ]);
  if (guestRows.length === 0) return;
  const userKeys = new Set(userRows.map((u) => `${u.tmdbId}:${u.mediaType}`));
  const dupIds: string[] = [];
  const moveIds: string[] = [];
  for (const row of guestRows) {
    (userKeys.has(`${row.tmdbId}:${row.mediaType}`) ? dupIds : moveIds).push(row.id);
  }
  if (dupIds.length > 0) await tx.rating.deleteMany({ where: { id: { in: dupIds } } });
  if (moveIds.length > 0) {
    await tx.rating.updateMany({ where: { id: { in: moveIds } }, data: { ownerId: userId, userId } });
  }
}

async function mergeEpisodeWatches(tx: Tx, guestId: string, userId: string): Promise<void> {
  const [guestRows, userRows] = await Promise.all([
    tx.episodeWatch.findMany({ where: { ownerId: guestId } }),
    tx.episodeWatch.findMany({ where: { ownerId: userId } }),
  ]);
  if (guestRows.length === 0) return;
  const userKeys = new Set(userRows.map((u) => `${u.tmdbId}:${u.season}:${u.episode}`));
  const dupIds: string[] = [];
  const moveIds: string[] = [];
  for (const row of guestRows) {
    (userKeys.has(`${row.tmdbId}:${row.season}:${row.episode}`) ? dupIds : moveIds).push(row.id);
  }
  if (dupIds.length > 0) await tx.episodeWatch.deleteMany({ where: { id: { in: dupIds } } });
  if (moveIds.length > 0) {
    await tx.episodeWatch.updateMany({ where: { id: { in: moveIds } }, data: { ownerId: userId, userId } });
  }
}

// ---------------------------------------------------------------------------
// Guest data cleanup — guests untouched for over a year are purged.
// Called opportunistically (throttled) from /api/health.
// ---------------------------------------------------------------------------

const globalForCleanup = globalThis as unknown as { __cinedeckGuestCleanupAt?: number };

export async function cleanupStaleGuests(): Promise<void> {
  const now = Date.now();
  const last = globalForCleanup.__cinedeckGuestCleanupAt ?? 0;
  if (now - last < 24 * 60 * 60 * 1000) return; // at most once a day
  globalForCleanup.__cinedeckGuestCleanupAt = now;
  try {
    const cutoff = new Date(now - GUEST_TTL_SECONDS * 1000);
    const stale = await db.guest.findMany({
      where: { lastSeenAt: { lt: cutoff } },
      select: { id: true },
      take: 200,
    });
    if (stale.length === 0) return;
    const ids = stale.map((g) => g.id);
    await db.$transaction([
      db.watchlistItem.deleteMany({ where: { ownerId: { in: ids }, userId: null } }),
      db.watchHistory.deleteMany({ where: { ownerId: { in: ids }, userId: null } }),
      db.rating.deleteMany({ where: { ownerId: { in: ids }, userId: null } }),
      db.episodeWatch.deleteMany({ where: { ownerId: { in: ids }, userId: null } }),
      db.list.deleteMany({ where: { ownerId: { in: ids }, userId: null } }),
      db.guest.deleteMany({ where: { id: { in: ids } } }),
    ]);
  } catch {
    // Cleanup is best-effort — never break the caller.
  }
}
