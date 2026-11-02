import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

import { expect, test, type Page } from '@playwright/test';

/**
 * PHASE 3 + 6 — admin console flow (redesigned /admin route tree):
 *  admin signs in → opens /admin → sees overview + users table →
 *  suspends a fresh user with a reason → that user cannot sign in again
 *  (suspension message shown) → unsuspend restores access.
 */

const ADMIN_EMAIL = envFromDotEnv('ADMIN_EMAIL') ?? 'admin@example.com';
const ADMIN_PASSWORD = envFromDotEnv('ADMIN_PASSWORD');
if (!ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD missing — add it to .env so admin e2e can log in');
}

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
 * Admin logins are capped at 3 active sessions; a 4th login now evicts the
 * oldest session automatically (the admin is never locked out). Clearing
 * sessions here keeps the suite deterministic anyway — tests assert exact
 * session counts and must not inherit leftovers from previous runs.
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


/** API login for the admin account → session cookie string. */
async function adminCookieOf(
  request: import('@playwright/test').APIRequestContext,
): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const setCookie = res.headers()['set-cookie'] ?? '';
  const match = setCookie.match(/cinedeck_session=[^;]+/);
  if (!match) throw new Error('admin login failed');
  return match[0];
}

/**
 * Open a users-table row menu and activate an item KEYBOARD-driven.
 * Radix dropdowns dismiss themselves when focus never reaches the menu
 * content (an automation-only quirk with the dev overlay): explicitly
 * focusing the item and pressing Enter is the reliable activation path and
 * mirrors how keyboard users operate the console.
 */
async function openRowMenuAndActivate(
  page: import('@playwright/test').Page,
  victimEmail: string,
  menuItemName: string,
): Promise<void> {
  await page.getByRole('button', { name: `Row actions for ${victimEmail}` }).click();
  const item = page.getByRole('menuitem', { name: menuItemName });
  await item.waitFor({ state: 'visible', timeout: 10_000 });
  await item.focus();
  await page.keyboard.press('Enter');
  await item.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
}

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
    // (Conditional: a deployment whose admin already rotated the password —
    // mustChangePassword=false, e.g. after an operator reset — shows no nag.)
    const meRes = await request.get('/api/auth/me', {
      headers: { cookie: await adminCookieOf(request) },
    });
    const meBody = (await meRes.json()) as { user: { mustChangePassword?: boolean } | null };
    if (meBody.user?.mustChangePassword) {
      await expect(page.getByText(/default admin password/i)).toBeVisible();
    }

    // 3. Admin console: overview renders, then the Users section.
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Total Users')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('link', { name: 'Users' }).click();
    await page.getByPlaceholder('Search name or email…').fill(victimEmail);
    await expect(page.getByText(victimEmail).first()).toBeVisible({ timeout: 15_000 });
    // Wait for the FILTERED query to settle: the footer flips to "1 users"
    // only after the q= response lands. Opening the row menu while the
    // filtered refetch is still in flight re-renders the table and Radix
    // dismisses the menu (dev-mode compile latency amplifies this).
    await expect(page.getByText(/^1 users · page 1\/1$/)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);

    // 4. Suspend with a reason via the row actions menu.
    page.once('dialog', (dialog) => dialog.accept('E2E suspension reason'));
    await openRowMenuAndActivate(page, victimEmail, `Suspend ${victimEmail}`);

    // 5. The suspended user cannot log in — the reason is shown.
    const blocked = await request.post('/api/auth/login', {
      data: { email: victimEmail, password: victimPassword },
    });
    expect(blocked.status()).toBe(403);
    const body = (await blocked.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain('E2E suspension reason');

    // 6. Unsuspend from the same row menu, and the account works again.
    page.once('dialog', (dialog) => dialog.accept('E2E suspension reason'));
    await openRowMenuAndActivate(page, victimEmail, `Unsuspend ${victimEmail}`);
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
