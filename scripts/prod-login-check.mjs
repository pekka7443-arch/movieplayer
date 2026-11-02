import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 150)));

let loginRequestHeaders = null;
page.on('request', (r) => {
  if (r.url().includes('/api/auth/login') && r.method() === 'POST') {
    loginRequestHeaders = r.headers();
  }
});

await page.goto('http://localhost:3100/', { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(2000);

try { await page.locator('button', { hasText: 'Accept all' }).first().click({ timeout: 3000 }); } catch {}
try { await page.locator('button', { hasText: 'Skip' }).first().click({ timeout: 3000 }); } catch {}
try { await page.locator('button', { hasText: 'Close' }).first().click({ timeout: 2000 }); } catch {}
await page.waitForTimeout(1500);

// Now the header Sign in button is clickable.
await page.locator('button[aria-label="Sign in"]').first().click({ timeout: 10000 });
await page.waitForTimeout(1200);

const email = page.locator('input[type="email"]').first();
await email.waitFor({ state: 'visible', timeout: 10000 });
await email.fill('admin@kana.com');
await page.locator('input[type="password"]').first().fill('KanaDeck2026!');
await page.locator('[role="dialog"] button', { hasText: "Sign in" }).last().click();
await page.waitForTimeout(5000);

const state = await page.evaluate(() => ({
  headerSignInGone: ![...document.querySelectorAll('header button')].some((b) => b.getAttribute('aria-label') === 'Sign in'),
  localStorageUser: (localStorage.getItem('cinedeck.user.last') || '').slice(0, 110),
}));

const sessionCookie = (await page.context().cookies()).find((c) => c.name === 'cinedeck_session');
console.log('login request csrf header:', loginRequestHeaders ? (loginRequestHeaders['x-csrf-token'] ? 'YES' : 'NO') : 'NOT SEEN');
console.log('session cookie issued:', sessionCookie ? `YES (httpOnly=${sessionCookie.httpOnly}, secure=${sessionCookie.secure})` : 'NO');
console.log('post-login state:', JSON.stringify(state, null, 2));
console.log('console errors:', errors.length ? errors.slice(0, 4) : 'none');
await browser.close();
