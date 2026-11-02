'use client';

// Client-side helpers for the CineDeck account system.
// All endpoints are same-origin /api/auth/* — cookies are httpOnly, so the
// client only ever sees the sanitized user payload.

import { beginReconnectPolling } from '@/lib/reconnect';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  avatar?: string | null;
  emailVerified?: boolean;
  totpEnabled?: boolean;
  mustChangePassword?: boolean;
}

export type AuthErrorCode =
  | 'email_taken'
  | 'invalid_credentials'
  | 'invalid_code'
  | 'invalid_token'
  | 'pending_expired'
  | 'bad_request'
  | 'weak_password'
  | 'rate_limited'
  | 'account_suspended'
  | 'admin_device_limit'
  | 'admin_ip_blocked'
  | 'network'
  | 'unknown';

/** Human-readable 429 text using the server's Retry-After when present.
 *  The login bucket refills slowly (5 per 15 min) — "wait a minute" was a
 *  lie that sent users into a retry loop; show the real wait instead. */
function rateLimitMessage(response: Response): string {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (!Number.isFinite(retryAfter) || retryAfter <= 0) return AUTH_ERROR_TEXT.rate_limited;
  if (retryAfter >= 90) return `Too many attempts — try again in about ${Math.ceil(retryAfter / 60)} minutes.`;
  return `Too many attempts — try again in ${Math.ceil(retryAfter)} seconds.`;
}

export class AuthError extends Error {
  code: AuthErrorCode;
  problems?: string[];

  constructor(code: AuthErrorCode, message: string, problems?: string[]) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.problems = problems;
  }
}

export const AUTH_ERROR_TEXT: Record<AuthErrorCode, string> = {
  email_taken: 'That email already has an account — sign in instead.',
  invalid_credentials: 'Wrong email or password.',
  invalid_code: 'That code didn’t match — check your authenticator and try again.',
  invalid_token: 'That link is no longer valid — request a fresh one.',
  pending_expired: 'The sign-in attempt expired — start again.',
  bad_request: 'Check the highlighted fields and try again.',
  weak_password: 'That password is too weak.',
  rate_limited: 'Too many attempts — wait a minute and try again.',
  account_suspended: 'Your account has been suspended. Contact support.',
  admin_device_limit:
    "Maximum device limit reached. Log out from another device first or use 'Log out all devices' in settings.",
  admin_ip_blocked: 'Login not allowed from this network.',
  network: 'Network error — check your connection.',
  unknown: 'Something went wrong. Try again.',
};

interface AuthResponsePayload {
  user?: AuthUser | null;
  // Standard API error shape: { error: { code, message }, problems? }
  error?: { code?: string; message?: string } | string;
  problems?: string[];
  totpRequired?: boolean;
  pendingToken?: string;
  verificationSent?: boolean;
}

/** Read the machine error code out of an API response body — accepts the
 *  standard nested shape ({ error: { code } }) and tolerates flat strings. */
function payloadErrorCode(payload: AuthResponsePayload): string | undefined {
  const err = payload.error;
  if (!err) return undefined;
  return typeof err === 'string' ? err : err.code;
}

async function authFetch(path: string, body: unknown): Promise<AuthUser | AuthTotpPending> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Origin unreachable — start the wake-up poll (auto-heal on return).
    beginReconnectPolling();
    throw new AuthError('network', AUTH_ERROR_TEXT.network);
  }

  let payload: AuthResponsePayload = {};
  try {
    payload = (await response.json()) as AuthResponsePayload;
  } catch {
    payload = {};
  }

  if (response.status === 429) {
    throw new AuthError('rate_limited', rateLimitMessage(response));
  }

  if (payload.totpRequired && payload.pendingToken) {
    return { totpRequired: true, pendingToken: payload.pendingToken };
  }

  if (!response.ok || !payload.user) {
    const known: readonly AuthErrorCode[] = [
      'email_taken',
      'invalid_credentials',
      'invalid_code',
      'invalid_token',
      'pending_expired',
      'bad_request',
      'weak_password',
      'account_suspended',
      'admin_device_limit',
      'admin_ip_blocked',
    ];
    const code = (known as readonly string[]).includes(payloadErrorCode(payload) ?? '')
      ? (payloadErrorCode(payload) as AuthErrorCode)
      : 'unknown';
    // Server-supplied messages (suspension reason, etc.) win over static text.
    const serverMessage =
      payload.error && typeof payload.error !== 'string' ? payload.error.message : undefined;
    throw new AuthError(code, serverMessage ?? AUTH_ERROR_TEXT[code], payload.problems);
  }
  return payload.user;
}

export interface AuthTotpPending {
  totpRequired: true;
  pendingToken: string;
}

export function isTotpPending(value: AuthUser | AuthTotpPending): value is AuthTotpPending {
  return (value as AuthTotpPending).totpRequired === true;
}

export async function registerAccount(
  name: string,
  email: string,
  password: string,
): Promise<{ user: AuthUser; verificationSent: boolean }> {
  const result = await authFetch('/api/auth/register', {
    name: name.trim() || undefined,
    email,
    password,
  });
  if (isTotpPending(result)) throw new AuthError('unknown', AUTH_ERROR_TEXT.unknown);
  const user = result as AuthUser & { verificationSent?: boolean };
  return { user, verificationSent: user.verificationSent === true };
}

export async function loginAccount(
  email: string,
  password: string,
): Promise<AuthUser | AuthTotpPending> {
  return authFetch('/api/auth/login', { email, password });
}

/** Complete a 2FA login with the authenticator code. */
export async function verifyTotpLogin(pendingToken: string, code: string): Promise<AuthUser> {
  const result = await authFetch('/api/auth/login/totp', { pendingToken, code });
  if (isTotpPending(result)) throw new AuthError('unknown', AUTH_ERROR_TEXT.unknown);
  return result;
}

export async function logoutAccount(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Best-effort — the cookie is httpOnly; network failures are non-fatal.
  }
}

/**
 * GET /api/auth/me → AuthUser | null.
 *
 * Contract with React Query:
 *  - a real 200 with { user: null } → null (genuinely signed out);
 *  - network failure or 5xx → THROWS, so `retry: 2` can kick in and a
 *    transient blip is never cached as "logged out";
 *  - 429 also throws (retryable) but is not a server bug.
 */
// Last-known-user cache — a network error must never render the app as
// "logged out", so the last successfully fetched user is persisted here and
// used as optimistic initial data on the next page load. Only a real
// 200-with-null response (or explicit logout) clears it.
const CACHED_USER_KEY = 'cinedeck.user.last';

export function readCachedUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHED_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser | null;
    return parsed && typeof parsed.id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: AuthUser | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (user) window.localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(CACHED_USER_KEY);
  } catch {
    /* storage unavailable — optimistic cache is best-effort */
  }
}

/**
 * Optimistically adopt a freshly authenticated user: called by the auth
 * dialog right after login/register so the UI flips to signed-in instantly
 * WITHOUT waiting on a refetch of /api/auth/me (whose response can race and
 * — landing later — would momentarily repaint guest state).
 */
export function adoptAuthenticatedUser(
  queryClient: { cancelQueries: (f: { queryKey: unknown[] }) => Promise<void>; setQueryData: (k: unknown[], v: unknown) => void },
  user: AuthUser,
): void {
  void queryClient.cancelQueries({ queryKey: ['session'] });
  writeCachedUser(user);
  queryClient.setQueryData(['session'], user);
}

export async function fetchMe(): Promise<AuthUser | null> {
  let response: Response;
  try {
    response = await fetch('/api/auth/me', { headers: { accept: 'application/json' } });
  } catch {
    // Network failure: throw so React Query retries — the cached user above
    // keeps the UI signed in. Never resolve to "logged out" on an error.
    beginReconnectPolling();
    throw new AuthError('network', AUTH_ERROR_TEXT.network);
  }
  if (response.status >= 500) {
    throw new AuthError('unknown', AUTH_ERROR_TEXT.unknown);
  }
  if (response.status === 429) {
    throw new AuthError('rate_limited', rateLimitMessage(response));
  }
  if (!response.ok) {
    // Unexpected 4xx — treat as signed out rather than wedging the app.
    writeCachedUser(null);
    return null;
  }
  const data = (await response.json()) as { user: AuthUser | null };
  writeCachedUser(data.user ?? null);
  return data.user ?? null;
}

// ---------------------------------------------------------------------------
// Sessions (device list)
// ---------------------------------------------------------------------------

export interface SessionInfo {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  ip: string | null;
  country?: string | null;
  city?: string | null;
}

export async function fetchSessions(): Promise<SessionInfo[]> {
  const res = await fetch('/api/auth/sessions');
  if (!res.ok) return [];
  const data = (await res.json()) as { sessions: SessionInfo[] };
  return data.sessions ?? [];
}

export async function revokeOtherSessions(): Promise<number> {
  const res = await fetch('/api/auth/sessions', { method: 'POST' });
  if (!res.ok) return 0;
  const data = (await res.json()) as { revoked: number };
  return data.revoked ?? 0;
}

/** Revoke ONE session by id (DELETE { id }) — used by per-device lists. */
export async function revokeOneSession(id: string): Promise<boolean> {
  const res = await fetch('/api/auth/sessions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  return res.ok;
}

/** "Log out all devices" (DELETE { all: true }) — revokes the caller too. */
export async function revokeAllMySessions(): Promise<boolean> {
  const res = await fetch('/api/auth/sessions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ all: true }),
  });
  return res.ok;
}

// ---------------------------------------------------------------------------
// Password management
// ---------------------------------------------------------------------------

export async function requestPasswordReset(email: string): Promise<void> {
  await fetch('/api/auth/forgot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export async function submitPasswordReset(token: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string } | string; problems?: string[] };
  if (!res.ok) {
    const raw = typeof data.error === 'string' ? data.error : data.error?.code;
    const code = (raw ?? 'unknown') as AuthErrorCode;
    throw new AuthError(code, AUTH_ERROR_TEXT[code] ?? AUTH_ERROR_TEXT.unknown, data.problems);
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  totpCode?: string,
): Promise<void> {
  const res = await fetch('/api/account/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword, totpCode }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string } | string; problems?: string[] };
  if (!res.ok) {
    const raw = typeof data.error === 'string' ? data.error : data.error?.code;
    const code = (raw ?? 'unknown') as AuthErrorCode;
    throw new AuthError(code, AUTH_ERROR_TEXT[code] ?? AUTH_ERROR_TEXT.unknown, data.problems);
  }
}

// ---------------------------------------------------------------------------
// Two-factor auth
// ---------------------------------------------------------------------------

export async function totpSetup(): Promise<{ secret: string; otpauthUrl: string; qrDataUrl?: string }> {
  const res = await fetch('/api/account/totp/setup', { method: 'POST' });
  const data = (await res.json().catch(() => ({}))) as { secret?: string; otpauthUrl?: string; qrDataUrl?: string };
  if (!res.ok || !data.secret || !data.otpauthUrl) {
    throw new AuthError('unknown', AUTH_ERROR_TEXT.unknown);
  }
  return { secret: data.secret, otpauthUrl: data.otpauthUrl, qrDataUrl: data.qrDataUrl };
}

export async function totpEnable(code: string): Promise<{ backupCodes?: string[] }> {
  const res = await fetch('/api/account/totp/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = (await res.json().catch(() => ({}))) as { backupCodes?: string[] };
  if (!res.ok) throw new AuthError('invalid_code', AUTH_ERROR_TEXT.invalid_code);
  return { backupCodes: data.backupCodes };
}

export async function totpDisable(code: string): Promise<void> {
  const res = await fetch('/api/account/totp/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new AuthError('invalid_code', AUTH_ERROR_TEXT.invalid_code);
}

// ---------------------------------------------------------------------------
// Account management (profile / email / export / delete)
// ---------------------------------------------------------------------------

export async function updateProfile(
  patch: { name?: string; avatar?: string | null },
): Promise<AuthUser> {
  const res = await fetch('/api/account/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = (await res.json().catch(() => ({}))) as { user?: AuthUser; error?: { code?: string } };
  if (!res.ok || !data.user) throw new AuthError('bad_request', AUTH_ERROR_TEXT.bad_request);
  return data.user;
}

export async function changeEmail(
  password: string,
  newEmail: string,
): Promise<{ email: string; verificationSent: boolean }> {
  const res = await fetch('/api/account/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, newEmail }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    email?: string;
    verificationSent?: boolean;
    error?: { code?: string; message?: string };
  };
  if (!res.ok || !data.email) {
    const code = (data.error?.code ?? 'bad_request') as AuthErrorCode;
    throw new AuthError(code, data.error?.message ?? AUTH_ERROR_TEXT[code] ?? AUTH_ERROR_TEXT.unknown);
  }
  return { email: data.email, verificationSent: data.verificationSent ?? false };
}

export async function deleteAccount(password: string): Promise<void> {
  const res = await fetch('/api/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, confirm: 'DELETE' }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) {
    const code = (data.error?.code ?? 'unknown') as AuthErrorCode;
    throw new AuthError(code, data.error?.message ?? AUTH_ERROR_TEXT[code] ?? AUTH_ERROR_TEXT.unknown);
  }
}

/** URL that streams the signed-in user's JSON data export. */
export const ACCOUNT_EXPORT_URL = '/api/account/export';

/** Ask the server to re-send the email-verification link. */
export async function resendVerification(email: string): Promise<void> {
  const res = await fetch('/api/auth/verify', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new AuthError('unknown', AUTH_ERROR_TEXT.unknown);
}
