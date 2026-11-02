import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

/**
 * PHASE 2 — playback requires an account:
 *  1. guests see the lock panel + animated "Sign in to watch" modal,
 *  2. playback APIs answer 401 for guests,
 *  3. signing in unlocks the same view without a redirect to another page.
 * PHASE 6 — password reset flow via a locally-issued console-style token.
 */

const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@cinedeck.test`;
const STRONG_PASSWORD = 'harbor-glacier-42-vault!';

function envFromDotEnv(key: string): string | undefined {
  try {
    const line = readFileSync('.env', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return line?.[1]?.trim();
  } catch {
    return undefined;
  }
}

async function dismissTour(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('cinedeck.onboarding.v1', 'done');
    } catch {
      /* ignore */
    }
  });
}

test.describe('guest playback gate', () => {
  test('playback APIs are 401 for guests and the watch view shows the gate', async ({ page }) => {
    await dismissTour(page);
    await page.goto('/');

    // Server-side: the scan endpoint (playback URLs) must refuse guests.
    const res = await page.request.get('/api/scan?type=movie&tmdb=550');
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('unauthorized');

    // Guest opens any title → the lock panel + modal appear (no redirect).
    await page.goto('/?id=550&type=movie');
    await expect(page.getByText(/Sign in to watch/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Sign in', exact: true }).first()).toBeVisible();

    // The guest banner lives on the home view.
    await page.goto('/');
    await expect(page.getByText(/Sign in to watch thousands of titles free/i)).toBeVisible();
  });

  test('signing in from the gate unlocks playback on the same view', async ({ page }) => {
    await dismissTour(page);
    const email = uniqueEmail();
    await page.goto('/?id=550&type=movie');
    await expect(page.getByText(/Sign in to watch/i).first()).toBeVisible({ timeout: 15_000 });

    // Create the account right from the gate (via its animated modal).
    await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).first().click();
    const dialog = page.getByRole('dialog').last();
    await dialog.getByRole('tab', { name: 'Sign up' }).click();
    await page.locator('#auth-name').fill('E2E Unlock');
    await page.locator('#auth-email').fill(email);
    await page.locator('#auth-password').fill(STRONG_PASSWORD);
    await page.locator('#auth-confirm').fill(STRONG_PASSWORD);
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('header [aria-label^="Account menu"]')).toBeVisible({ timeout: 15_000 });

    // Back on the watch view (returnTo) — the lock is gone, the player mounts.
    await page.waitForTimeout(1_000);
    const scanRes = await page.request.get('/api/scan?type=movie&tmdb=550');
    expect(scanRes.status()).toBe(200);
  });
});

test.describe('password reset', () => {
  test('a reset token sets a new password and revokes old sessions', async ({ request }) => {
    const email = uniqueEmail();
    const original = 'harbor-glacier-42-vault!';

    // Create the account directly through the API.
    const registered = await request.post('/api/auth/register', {
      data: { email, password: original },
    });
    expect(registered.status()).toBe(200);

    // A live session that the reset must revoke.
    const oldSession = await cookieOf(request, email, original);
    expect(oldSession).toBeTruthy();

    // 2026-11-03 hardening: reset tokens are single-use, hash-stored DB rows —
    // they can no longer be forged from AUTH_SECRET. The dev console mailer
    // delivers the real link into dev.log; this test harvests it the same way
    // a developer would.
    const forgot = await request.post('/api/auth/forgot', { data: { email } });
    expect(forgot.status()).toBe(200);
    const token = await resetTokenFromDevLog(email);
    expect(token, 'reset token logged by the console mailer').toBeTruthy();

    const newPassword = 'rivulet-ember-77-storm!';
    const reset = await request.post('/api/auth/reset', {
      data: { token, password: newPassword },
    });
    expect(reset.status()).toBe(200);

    // Single-use: replaying the same token is rejected.
    const replay = await request.post('/api/auth/reset', {
      data: { token, password: 'another-pass-99-lagoon!' },
    });
    expect(replay.status()).toBe(400);

    // Every prior session died with the reset (the me endpoint answers 200
    // with a null user for signed-out callers by contract — check the body).
    const meWithOld = await request.get('/api/auth/me', { headers: { cookie: oldSession } });
    expect(meWithOld.status()).toBe(200);
    const meBody = (await meWithOld.json()) as { user: { id: string } | null };
    expect(meBody.user).toBeNull();

    // Old password is dead; new one works.
    const oldLogin = await request.post('/api/auth/login', { data: { email, password: original } });
    expect(oldLogin.status()).toBe(401);
    const newLogin = await request.post('/api/auth/login', { data: { email, password: newPassword } });
    expect(newLogin.status()).toBe(200);
  });
});


/**
 * Harvest the newest reset token for `email` from the dev server's console
 * mailer output (dev.log). The console adapter is the dev delivery channel —
 * production redacts tokens from logs, so this helper is dev-only by design.
 */
async function resetTokenFromDevLog(email: string, timeoutMs = 15000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  const tokenRe = new RegExp(
    `"to":"${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}".*?"actionUrl":"([^"]+)"`,
  );
  while (Date.now() < deadline) {
    try {
      const log = readFileSync('dev.log', 'utf8');
      const matches = log.match(new RegExp(tokenRe.source, 'g')) ?? [];
      const last = matches[matches.length - 1];
      const url = last?.match(tokenRe)?.[1];
      const token = url?.match(/token=([^"&\\]+)/)?.[1];
      if (token) return decodeURIComponent(token);
    } catch {
      // log not readable yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** Log in via the API and return the session cookie string. */
async function cookieOf(
  request: import('@playwright/test').APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post('/api/auth/login', { data: { email, password } });
  expect(res.status()).toBe(200);
  const setCookie = res.headers()['set-cookie'] ?? '';
  const match = setCookie.match(/cinedeck_session=[^;]+/);
  if (!match) throw new Error('no session cookie returned');
  return match[0];
}
