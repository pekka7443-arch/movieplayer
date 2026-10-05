import { expect, test, type Page } from '@playwright/test';

/**
 * LOGIN PERSISTENCE — the bulletproof contract:
 *  1. signing up keeps you signed in,
 *  2. a reload keeps you signed in,
 *  3. a "came back days later" context (new browser with the same storage)
 *     keeps you signed in (30-day sliding cookie),
 *  4. a network/API failure NEVER renders you as logged out.
 */

const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@cinedeck.test`;
const STRONG_PASSWORD = 'glacier-harbor-42-vault';

async function signUp(page: Page, email: string): Promise<void> {
  // Returning-user state: skip the first-visit onboarding tour so it never
  // overlaps the auth dialog.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('cinedeck.onboarding.v1', 'done');
    } catch {
      /* ignore */
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.locator('#auth-name').fill('E2E Persistence');
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill(STRONG_PASSWORD);
  await page.locator('form button[type="submit"]').first().click();
  // Signed-in header replaces the Sign up button.
  await expect(page.getByRole('button', { name: 'Sign up' })).toBeHidden({ timeout: 15_000 });
}

async function expectSignedIn(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Sign up' })).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('header [aria-label^="Account menu"]')).toBeVisible();
}

test.describe('login persistence', () => {
  test('survives reload, browser restart, and API outage', async ({ page, context }) => {
    const email = uniqueEmail();
    await signUp(page, email);

    // 2. Reload — session cookie + cached user survive.
    await page.reload();
    await expectSignedIn(page);

    // 3. Simulate "closed the browser, came back days later": same storage,
    //    fresh browser context. The 30-day cookie and the last-known-user
    //    cache must both come along.
    const state = await context.storageState();
    const browser = page.context().browser()!;
    const freshContext = await browser.newContext({ storageState: state });
    const freshPage = await freshContext.newPage();
    await freshPage.goto('/');
    await expectSignedIn(freshPage);
    await freshContext.close();

    // 4. API outage after reload — the user must STAY visible. The cached
    //    user paints instantly and a failing /api/auth/me never clears it.
    await context.route('**/api/auth/me', (route) => route.fulfill({ status: 500, body: '{}' }));
    await page.reload();
    await expectSignedIn(page);
    // Give the (retrying) query time to fail — still signed in.
    await page.waitForTimeout(2_000);
    await expectSignedIn(page);

    // Sanity: with the API healthy again, state still intact.
    await context.unroute('**/api/auth/me');
    await page.reload();
    await expectSignedIn(page);
  });

  test('explicit logout still works', async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, email);

    await page.locator('header [aria-label^="Account menu"]').click();
    await page.getByRole('menuitem', { name: /sign out|log out/i }).click();
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible({ timeout: 15_000 });

    // And it sticks across reloads.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
  });
});
