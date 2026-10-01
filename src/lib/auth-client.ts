'use client';

// Client-side helpers for the CineDeck account system.
// All endpoints are same-origin /api/auth/* — cookies are httpOnly, so the
// client only ever sees the sanitized user payload.

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export class AuthError extends Error {
  code: 'email_taken' | 'invalid_credentials' | 'bad_request' | 'network' | 'unknown';

  constructor(code: AuthError['code'], message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export const AUTH_ERROR_TEXT: Record<AuthError['code'], string> = {
  email_taken: 'That email already has an account — sign in instead.',
  invalid_credentials: 'Wrong email or password.',
  bad_request: 'Check the highlighted fields and try again.',
  network: 'Network error — check your connection.',
  unknown: 'Something went wrong. Try again.',
};

interface AuthResponsePayload {
  user?: AuthUser | null;
  error?: string;
}

async function authFetch(path: string, body: unknown): Promise<AuthUser> {
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

  if (!response.ok || !payload.user) {
    const known = ['email_taken', 'invalid_credentials', 'bad_request'] as const;
    const code = (known as readonly string[]).includes(payload.error ?? '')
      ? (payload.error as AuthError['code'])
      : 'unknown';
    throw new AuthError(code, AUTH_ERROR_TEXT[code]);
  }
  return payload.user;
}

export async function registerAccount(
  name: string,
  email: string,
  password: string,
): Promise<AuthUser> {
  return authFetch('/api/auth/register', { name: name.trim() || undefined, email, password });
}

export async function loginAccount(email: string, password: string): Promise<AuthUser> {
  return authFetch('/api/auth/login', { email, password });
}

export async function logoutAccount(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Best-effort — the cookie is httpOnly; network failures are non-fatal.
  }
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const response = await fetch('/api/auth/me', { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const data = (await response.json()) as { user: AuthUser | null };
    return data.user ?? null;
  } catch {
    return null;
  }
}
