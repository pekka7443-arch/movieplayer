import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

import { expect, test, type Page } from '@playwright/test';

/**
 * PHASE 3 + 6 — admin console flow (redesigned /admin route tree):
 *  admin signs in → opens /admin → sees overview + users table →
 *  suspends a fresh user with a reason → that user cannot sign in again
 *  (suspension message shown) → unsuspend restores access.
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '***REMOVED***';

function envFromDotEnv(key: string): string | undefined {
  try {
    const line = readFileSync('.env', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return line?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@cinedeck.test`;

/**
 * Admin logins are capped at 3 active sessions (admin device-limit rule).
 * The suite runs repeatedly against the same dev DB, so clear the admin's
 * sessions directly before signing in — otherwise run #4 would hit
 * "Maximum device limit reached" and fail for the right reason.
 */
function clearAdminSessions(email: string): void {
  try {
    const dbUrl = envFromDotEnv('DATABASE_URL') ?? 'file:./db/custom.db';
    execSync(`bun scripts/clear-admin-sessions.ts ${email}`, {
    cwd: process.cwd(),
    stdio: 'ignore',
    timeout: 30_000,
  });
  } catch {
    // Best effort — a cold DB or missing binary must not block the suite.
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

test.describe('admin dashboard', () => {
  let victimEmail = '';
  let victimPassword = '';

  test.beforeEach(() => {
    victimEmail = uniqueEmail();
    victimPassword = 'quartz-meadow-88-drift!';
  });

  test('suspend → blocked login → unsuspend → login works', async ({ page, request }) => {
    await dismissTour(page);
    clearAdminSessions(ADMIN_EMAIL);

    // 0. Seed a victim account through the public API.
    const reg = await request.post('/api/auth/register', {
      data: { email: victimEmail, password: victimPassword },
    });
    expect(reg.status()).toBe(200);

    // 1. Admin signs in (wait for hydration: the guest banner is client-only).
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Sign in call to action' })).toBeVisible({ timeout: 20_000 });
    await page.locator('header').getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('#auth-email').fill(ADMIN_EMAIL);
    await page.locator('#auth-password').fill(ADMIN_PASSWORD);
    await page.getByRole('dialog').getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('header [aria-label^="Account menu"]')).toBeVisible({ timeout: 20_000 });

    // 2. The default-password nag is present until the password changes.
    await expect(page.getByText(/default admin password/i)).toBeVisible();

    // 3. Admin console: overview renders, then the Users section.
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Total Users')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('link', { name: 'Users' }).click();
    await page.getByPlaceholder('Search name or email…').fill(victimEmail);
    await expect(page.getByText(victimEmail).first()).toBeVisible({ timeout: 15_000 });

    // 4. Suspend with a reason via the row actions menu.
    page.once('dialog', (dialog) => dialog.accept('E2E suspension reason'));
    await page.getByRole('button', { name: `Row actions for ${victimEmail}` }).click();
    await page.getByRole('menuitem', { name: `Suspend ${victimEmail}` }).click();

    // 5. The suspended user cannot log in — the reason is shown.
    const blocked = await request.post('/api/auth/login', {
      data: { email: victimEmail, password: victimPassword },
    });
    expect(blocked.status()).toBe(403);
    const body = (await blocked.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain('E2E suspension reason');

    // 6. Unsuspend from the same row menu, and the account works again.
    page.once('dialog', (dialog) => dialog.accept('E2E suspension reason'));
    await page.getByRole('button', { name: `Row actions for ${victimEmail}` }).click();
    await page.getByRole('menuitem', { name: `Unsuspend ${victimEmail}` }).click();
    await expect
      .poll(
        async () =>
          (await request.post('/api/auth/login', { data: { email: victimEmail, password: victimPassword } }))
            .status(),
        { timeout: 15_000 },
      )
      .toBe(200);
  });
});
