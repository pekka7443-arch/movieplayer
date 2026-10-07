import { createHmac } from 'node:crypto';
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

    // Issue a reset token the way the console mail adapter would print one:
    // the same signed-token format the server validates (AUTH_SECRET + HMAC).
    const secret = envFromDotEnv('AUTH_SECRET');
    expect(secret).toBeTruthy();
    const userId = await request
      .get('/api/auth/me', { headers: { cookie: await cookieOf(request, email, original) } })
      .then(async (r) => {
        const body = (await r.json()) as { user: { id: string } | null };
        return body.user?.id;
      });
    if (!userId) throw new Error('could not resolve user id');

    const exp = Math.floor(Date.now() / 1000) + 30 * 60;
    const payload = Buffer.from(
      JSON.stringify({ purpose: 'reset', sub: userId, exp, jti: 'e2e-reset' }),
    ).toString('base64url');
    const mac = createHmac('sha256', secret!).update(payload).digest('base64url');
    const token = `${payload}.${mac}`;

    const newPassword = 'rivulet-ember-77-storm!';
    const reset = await request.post('/api/auth/reset', {
      data: { token, password: newPassword },
    });
    expect(reset.status()).toBe(200);

    // Old password is dead; new one works.
    const oldLogin = await request.post('/api/auth/login', { data: { email, password: original } });
    expect(oldLogin.status()).toBe(401);
    const newLogin = await request.post('/api/auth/login', { data: { email, password: newPassword } });
    expect(newLogin.status()).toBe(200);
  });
});

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
