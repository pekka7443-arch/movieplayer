// Server-only auth helpers for CineDeck accounts.
// - Password hashing: node:crypto scrypt (salted, timing-safe compare)
// - Session: HMAC-SHA256 signed {uid, exp} token in an httpOnly cookie
// - Guests: separate `cinedeck_guest` UUID cookie identifies the device so
//   watchlists / history work without an account and migrate into the
//   account on register/login.
// Never import from client components.

import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { db } from '@/lib/db';

export const SESSION_COOKIE = 'cinedeck_session';
export const GUEST_COOKIE = 'cinedeck_guest';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const GUEST_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

const SECRET =
  process.env.AUTH_SECRET ?? 'cinedeck-local-dev-secret-do-not-ship-to-prod';

// ---------------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ---------------------------------------------------------------------------
// Session token (HMAC-signed)
// ---------------------------------------------------------------------------

interface SessionPayload {
  uid: string;
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signToken(uid: string): string {
  const payload: SessionPayload = {
    uid,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = base64url(JSON.stringify(payload));
  const mac = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifyToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
    if (typeof payload.uid !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload.uid;
  } catch {
    return null;
  }
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

/** Extract the signed-in user id from the request cookies, or null. */
export function sessionUserId(request: Request): string | null {
  const token = parseCookies(request)[SESSION_COOKIE];
  return token ? verifyToken(token) : null;
}

export function sessionCookieValue(uid: string): string {
  return `${SESSION_COOKIE}=${signToken(uid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookieValue(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
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
}

export function resolveOwner(request: Request): OwnerContext {
  const userId = sessionUserId(request);
  if (userId) {
    return { ownerId: userId, userId, guestId: null, newGuest: false };
  }
  const existing = parseCookies(request)[GUEST_COOKIE] ?? null;
  const guestId = existing && /^[\w-]{8,64}$/.test(existing) ? existing : randomUUID();
  return { ownerId: guestId, userId: null, guestId, newGuest: !existing };
}

/** Append pending Set-Cookie headers (fresh guest identity) to a response. */
export function withOwnerCookies<T extends Response>(response: T, ctx: OwnerContext): T {
  if (ctx.newGuest && ctx.guestId) {
    response.headers.append('Set-Cookie', guestCookieValue(ctx.guestId));
  }
  return response;
}

// ---------------------------------------------------------------------------
// Guest → account migration (runs on register and login)
// ---------------------------------------------------------------------------

/**
 * Move every watchlist row and history entry from the guest device identity
 * to the freshly authenticated user. Conflicts keep the account's own row
 * (history prefers whichever was updated more recently).
 */
export async function mergeGuestIntoUser(guestId: string, userId: string): Promise<void> {
  if (!guestId || guestId === userId) return;

  const guestItems = await db.watchlistItem.findMany({ where: { ownerId: guestId } });
  for (const gi of guestItems) {
    const dup = await db.watchlistItem.findUnique({
      where: {
        ownerId_tmdbId_mediaType: { ownerId: userId, tmdbId: gi.tmdbId, mediaType: gi.mediaType },
      },
    });
    if (dup) {
      await db.watchlistItem.delete({ where: { id: gi.id } });
    } else {
      await db.watchlistItem.update({ where: { id: gi.id }, data: { ownerId: userId } });
    }
  }

  const guestHistory = await db.watchHistory.findMany({ where: { ownerId: guestId } });
  for (const gh of guestHistory) {
    const dup = await db.watchHistory.findUnique({
      where: {
        ownerId_tmdbId_mediaType: { ownerId: userId, tmdbId: gh.tmdbId, mediaType: gh.mediaType },
      },
    });
    if (!dup) {
      await db.watchHistory.update({ where: { id: gh.id }, data: { ownerId: userId } });
    } else if (gh.updatedAt > dup.updatedAt) {
      await db.watchHistory.delete({ where: { id: dup.id } });
      await db.watchHistory.update({ where: { id: gh.id }, data: { ownerId: userId } });
    } else {
      await db.watchHistory.delete({ where: { id: gh.id } });
    }
  }
}
