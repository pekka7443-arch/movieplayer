/**
 * Task 46 verification — hard User Experience surfaces in a real browser.
 *
 * 1. Priority alert: preview (target self) → standby hold renders → a click
 *    during the hold does NOT dismiss it → the flash image lands → the
 *    surface self-completes.
 * 2. Legacy media clip: preview (target self) → archive embed iframe mounts
 *    inside the decoder frame with equalizer + lyric captions.
 * Screenshots into test-results/.
 *
 * Run: BASE_URL=http://127.0.0.1:3100 bun scripts/verify-ux-hard-surfaces.ts
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

import { chromium, expect, type Page } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';

function envFromDotEnv(key: string): string | undefined {
  try {
    const line = readFileSync('.env', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return line?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const ADMIN_EMAIL = envFromDotEnv('ADMIN_EMAIL') ?? 'admin@example.com';
const ADMIN_PASSWORD = envFromDotEnv('ADMIN_PASSWORD') ?? '***REMOVED***';
const E2E_BYPASS = envFromDotEnv('E2E_RATELIMIT_BYPASS');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures++;
  console.log(`${mark.padEnd(5)} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(page: Page, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<{ status: number; json: any }> {
  return page.evaluate(
    async ({ method, path, body, bypass }) => {
      const res = await fetch(path, {
        method,
        headers: body
          ? { 'Content-Type': 'application/json', ...(bypass ? { 'x-cinedeck-e2e': bypass } : {}) }
          : bypass
            ? { 'x-cinedeck-e2e': bypass }
            : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        /* empty body */
      }
      return { status: res.status, json };
    },
    { method, path, body, bypass: E2E_BYPASS ?? null },
  );
}

const OVERLAY = '[aria-label^="System overlay"]';

async function main(): Promise<void> {
  try {
    execSync(`bun scripts/clear-admin-sessions.ts ${ADMIN_EMAIL}`, { stdio: 'ignore', timeout: 30_000 });
  } catch {
    /* best effort */
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // --- sign in --------------------------------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const login = await api(page, 'POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check('admin API login', login.status === 200, `status ${login.status}`);

  // --- 1. priority alert choreography ---------------------------------------
  const alertApply = await api(page, 'POST', '/api/admin/user-experience', {
    effect: 'alert-override',
    target: 'self',
    durationSec: 15,
  });
  check('priority alert preview applied (target self)', alertApply.status === 200, `status ${alertApply.status}`);

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

  // Standby hold: calm spinner screen appears first.
  const standby = await page.getByText('Just a moment…').waitFor({ timeout: 12_000 }).then(() => true).catch(() => false);
  check('standby hold renders ("Just a moment…")', standby);
  if (standby) await page.screenshot({ path: 'test-results/ux-alert-standby.png' });

  // Locked dismissal: a click during the hold must NOT end the surface.
  await page.waitForTimeout(600);
  await page.locator(OVERLAY).click({ position: { x: 700, y: 450 }, force: true }).catch(() => undefined);
  await page.waitForTimeout(1_200);
  const stillStanding = await page.getByText('Just a moment…').isVisible().catch(() => false);
  const imageEarly = await page.locator('img[src*="overlay-alert"]').isVisible().catch(() => false);
  check('click during standby does not dismiss (locked)', stillStanding && !imageEarly);
  await page.screenshot({ path: 'test-results/ux-alert-standby-click.png' });

  // The flash: fullscreen alert image lands after the hold.
  const flash = await page
    .locator('img[src*="overlay-alert"]')
    .waitFor({ state: 'visible', timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
  check('alert flash lands (fullscreen image visible)', flash);
  if (flash) await page.screenshot({ path: 'test-results/ux-alert-flash.png' });

  // Self-completion: the surface ends by itself after the choreography.
  const completed = await page
    .locator(OVERLAY)
    .waitFor({ state: 'detached', timeout: 16_000 })
    .then(() => true)
    .catch(() => false);
  check('alert surface self-completes', completed);

  // --- 2. legacy media clip ---------------------------------------------------
  const compatApply = await api(page, 'POST', '/api/admin/user-experience', {
    effect: 'media-compatibility',
    target: 'self',
    durationSec: 30,
  });
  check('reference clip preview applied (target self)', compatApply.status === 200, `status ${compatApply.status}`);

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

  const caption = await page
    .getByText('legacy media compatibility check — reference clip 1987')
    .waitFor({ timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
  check('decoder caption renders', caption);

  const frame = await page
    .locator('iframe[title="Reference clip playback"]')
    .waitFor({ state: 'attached', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  check('archive embed iframe mounts inside the decoder frame', frame);
  const frameSrc = frame
    ? await page.locator('iframe[title="Reference clip playback"]').getAttribute('src')
    : null;
  check('embed points at the allowlisted archive host', Boolean(frameSrc?.includes('youtube-nocookie.com/embed/')), frameSrc ?? 'no src');

  await page.waitForTimeout(2_000);
  await page.screenshot({ path: 'test-results/ux-compat-clip.png' });

  // Revoke the clip to clean up (the alert already self-completed).
  const list = await api(page, 'GET', '/api/admin/user-experience');
  const events = (list.json?.events ?? []) as { id: number; revokedAt: number | null }[];
  const active = events.find((e) => !e.revokedAt);
  if (active) {
    const revoke = await api(page, 'DELETE', '/api/admin/user-experience', { id: active.id });
    check('cleanup: running preview revoked', revoke.status === 200, `status ${revoke.status}`);
  } else {
    check('cleanup: no running previews left', true);
  }

  await browser.close();
  console.log(failures === 0 ? '\nALL HARD-SURFACE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
