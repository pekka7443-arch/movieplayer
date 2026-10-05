'use client';

// Client-side helpers for the CineDeck account system.
// All endpoints are same-origin /api/auth/* — cookies are httpOnly, so the
// client only ever sees the sanitized user payload.

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  emailVerified?: boolean;
  totpEnabled?: boolean;
}

export type AuthErrorCode =
  | 'email_taken'
  | 'invalid_credentials'
  | 'invalid_code'
  | 'pending_expired'
  | 'bad_request'
  | 'weak_password'
  | 'rate_limited'
  | 'network'
  | 'unknown';

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
  pending_expired: 'The sign-in attempt expired — start again.',
  bad_request: 'Check the highlighted fields and try again.',
  weak_password: 'That password is too weak.',
  rate_limited: 'Too many attempts — wait a minute and try again.',
  network: 'Network error — check your connection.',
  unknown: 'Something went wrong. Try again.',
};

interface AuthResponsePayload {
  user?: AuthUser | null;
  error?: string;
  problems?: string[];
  totpRequired?: boolean;
  pendingToken?: string;
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
    throw new AuthError('network', AUTH_ERROR_TEXT.network);
  }

  let payload: AuthResponsePayload = {};
  try {
    payload = (await response.json()) as AuthResponsePayload;
  } catch {
    payload = {};
  }

  if (response.status === 429) {
    throw new AuthError('rate_limited', AUTH_ERROR_TEXT.rate_limited);
  }

  if (payload.totpRequired && payload.pendingToken) {
    return { totpRequired: true, pendingToken: payload.pendingToken };
  }

  if (!response.ok || !payload.user) {
    const known: readonly AuthErrorCode[] = [
      'email_taken',
      'invalid_credentials',
      'invalid_code',
      'pending_expired',
      'bad_request',
      'weak_password',
    ];
    const code = (known as readonly string[]).includes(payload.error ?? '')
      ? (payload.error as AuthErrorCode)
      : 'unknown';
    throw new AuthError(code, AUTH_ERROR_TEXT[code], payload.problems);
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
): Promise<AuthUser> {
  const result = await authFetch('/api/auth/register', {
    name: name.trim() || undefined,
    email,
    password,
  });
  if (isTotpPending(result)) throw new AuthError('unknown', AUTH_ERROR_TEXT.unknown);
  return result;
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
export async function fetchMe(): Promise<AuthUser | null> {
  let response: Response;
  try {
    response = await fetch('/api/auth/me', { headers: { accept: 'application/json' } });
  } catch {
    throw new AuthError('network', AUTH_ERROR_TEXT.network);
  }
  if (response.status >= 500) {
    throw new AuthError('unknown', AUTH_ERROR_TEXT.unknown);
  }
  if (response.status === 429) {
    throw new AuthError('rate_limited', AUTH_ERROR_TEXT.rate_limited);
  }
  if (!response.ok) {
    // Unexpected 4xx — treat as signed out rather than wedging the app.
    return null;
  }
  const data = (await response.json()) as { user: AuthUser | null };
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
  const data = (await res.json().catch(() => ({}))) as { error?: string; problems?: string[] };
  if (!res.ok) {
    const code = (data.error ?? 'unknown') as AuthErrorCode;
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
  const data = (await res.json().catch(() => ({}))) as { error?: string; problems?: string[] };
  if (!res.ok) {
    const code = (data.error ?? 'unknown') as AuthErrorCode;
    throw new AuthError(code, AUTH_ERROR_TEXT[code] ?? AUTH_ERROR_TEXT.unknown, data.problems);
  }
}

// ---------------------------------------------------------------------------
// Two-factor auth
// ---------------------------------------------------------------------------

export async function totpSetup(): Promise<{ secret: string; otpauthUrl: string }> {
  const res = await fetch('/api/account/totp/setup', { method: 'POST' });
  const data = (await res.json().catch(() => ({}))) as { secret?: string; otpauthUrl?: string };
  if (!res.ok || !data.secret || !data.otpauthUrl) {
    throw new AuthError('unknown', AUTH_ERROR_TEXT.unknown);
  }
  return { secret: data.secret, otpauthUrl: data.otpauthUrl };
}

export async function totpEnable(code: string): Promise<void> {
  const res = await fetch('/api/account/totp/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new AuthError('invalid_code', AUTH_ERROR_TEXT.invalid_code);
}

export async function totpDisable(code: string): Promise<void> {
  const res = await fetch('/api/account/totp/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new AuthError('invalid_code', AUTH_ERROR_TEXT.invalid_code);
}
