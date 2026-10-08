// Visual verification: admin → My sessions tab renders with the session
// table, limit notice and no console errors. Screenshot → tool-results/.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@kinedeck.invalid';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// Pre-dismiss the onboarding tour (same trick the e2e suite uses) so it can
// never re-render the header mid-click.
await page.addInitScript(() => {
  try {
    window.localStorage.setItem('cinedeck.onboarding.v1', 'done');
  } catch {
    /* ignore */
  }
});
const consoleErrors: string[] = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.locator('header').getByRole('button', { name: 'Sign in', exact: true }).click();
await page.locator('#auth-email').fill(ADMIN_EMAIL);
await page.locator('#auth-password').fill(ADMIN_PASSWORD);
await page.getByRole('dialog').getByRole('button', { name: 'Sign in' }).click();
await page.waitForSelector('header [aria-label^="Account menu"]', { timeout: 20_000 });

await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('tab', { name: 'My sessions' }).click();
await page.waitForSelector('text=3 active devices', { timeout: 15_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'tool-results/my-sessions-tab.png', fullPage: false });

const hasTable = await page.locator('table').first().isVisible();
const hasRevokeAll = await page.getByRole('button', { name: 'Revoke all' }).isVisible();
console.log(JSON.stringify({ hasTable, hasRevokeAll, consoleErrors }, null, 2));

// Leave the admin account with zero sessions so real logins start fresh.
const cookies = await page.context().cookies();
const sessionCookie = cookies.find((c) => c.name === 'cinedeck_session');
if (sessionCookie) {
  await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie: `cinedeck_session=${sessionCookie.value}` } });
}
await browser.close();
