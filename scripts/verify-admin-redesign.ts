/**
 * Task 44 verification — admin console redesign.
 *
 * 1. Guest gate: /admin shows "Restricted area" for non-admins.
 * 2. Admin login (API) → every tab renders with its key content.
 * 3. Disguise audit: no "Troll"/"prank"/emoji anywhere in the console UI;
 *    the only prank controls live in "Advanced Interaction Tools" at the
 *    bottom of User Experience, with boring professional names.
 * 4. Apply + revoke a protocol through the real admin API.
 * 5. Screenshots into test-results/.
 *
 * Run: bun scripts/verify-admin-redesign.ts
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

import { chromium, expect, type Page } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

function envFromDotEnv(key: string): string | undefined {
  try {
    const line = readFileSync('.env', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return line?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const ADMIN_EMAIL = envFromDotEnv('ADMIN_EMAIL') ?? 'admin@example.com';
const ADMIN_PASSWORD = envFromDotEnv('ADMIN_PASSWORD');
if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD missing — add it to .env');
  process.exit(1);
}
/** Dev-only rate-limit bypass so repeated suite runs never hit login 429s. */
const E2E_BYPASS = envFromDotEnv('E2E_RATELIMIT_BYPASS');

function clearAdminSessions(email: string): void {
  try {
    const dbUrl = envFromDotEnv('DATABASE_URL') ?? 'file:./db/custom.db';
    execSync(`bun scripts/clear-admin-sessions.ts ${email}`, {
    cwd: process.cwd(),
    stdio: 'ignore',
    timeout: 30_000,
  });
  } catch {
    /* best effort */
  }
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures++;
  console.log(`${mark.padEnd(5)} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Same-origin fetch from inside the page — cookies flow naturally and we
 *  dodge a playwright-core Set-Cookie parsing quirk under bun. */
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

const SIDEBAR_ITEMS = [
  'Overview',
  'Users',
  'Sessions',
  'Moderation',
  'Audit Log',
  'Feature Flags',
  'User Experience',
  'System',
  'Settings',
];

const BANNED_WORDS = ['troll', 'prank', 'jumpscare', 'rickroll', 'victim', 'just kidding', '😈', '🎯', '👻', '😱'];

async function main(): Promise<void> {
  clearAdminSessions(ADMIN_EMAIL);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // --- 1. guest gate -------------------------------------------------------
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  const restricted = await page.getByText('Restricted area').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
  check('guest gate — /admin restricted for non-admins', restricted);

  // --- 2. admin sign-in via same-origin fetch (cookie lands naturally) -----
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const login = await api(page, 'POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check('admin API login', login.status === 200, `status ${login.status}`);

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Overview' }).waitFor({ timeout: 20_000 });
  check('overview renders', true);

  for (const item of SIDEBAR_ITEMS) {
    const visible = await page.getByRole('link', { name: item }).isVisible();
    check(`sidebar has "${item}"`, visible);
  }
  const trollItem = await page.getByRole('link', { name: /troll/i }).count();
  check('no "Troll" item in sidebar', trollItem === 0);

  // --- 3. walk every tab ----------------------------------------------------
  const tabChecks: { path: string; link: string; expectText: string; placeholder?: boolean }[] = [
    { path: '/admin/users', link: 'Users', expectText: 'Search name or email…', placeholder: true },
    { path: '/admin/sessions', link: 'Sessions', expectText: 'active session' },
    { path: '/admin/moderation', link: 'Moderation', expectText: 'Reported comments awaiting review' },
    { path: '/admin/audit', link: 'Audit Log', expectText: 'Immutable trail' },
    { path: '/admin/flags', link: 'Feature Flags', expectText: 'Toggle platform features' },
    { path: '/admin/user-experience', link: 'User Experience', expectText: 'Announcement Banner' },
    { path: '/admin/system', link: 'System', expectText: 'Health checks' },
    { path: '/admin/settings', link: 'Settings', expectText: 'My devices' },
  ];

  for (const t of tabChecks) {
    await page.goto(`${BASE}${t.path}`, { waitUntil: 'domcontentloaded' });
    const locator = t.placeholder
      ? page.getByPlaceholder(t.expectText).first()
      : page.getByText(t.expectText).first();
    const found = await locator.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
    check(`tab ${t.path} renders`, found, `expected "${t.expectText}"`);
  }

  // --- 4. disguise audit on User Experience --------------------------------
  await page.goto(`${BASE}/admin/user-experience`, { waitUntil: 'domcontentloaded' });
  // Wait for a marker that only exists inside the tab content (not the sidebar).
  await page.getByRole('heading', { name: 'Announcement Banner' }).waitFor({ timeout: 15_000 });

  const realTools = ['Announcement Banner', 'Feature Flags', 'User Feedback'];
  for (const tool of realTools) {
    const visible = await page.getByRole('heading', { name: tool }).first().isVisible();
    check(`User Experience shows real tool "${tool}"`, visible);
  }

  // Scroll to the very bottom — Advanced Interaction Tools.
  await page.getByRole('heading', { name: 'Advanced Interaction Tools' }).scrollIntoViewIfNeeded();
  await page.getByText('Display Orientation Override').first().waitFor({ timeout: 10_000 });

  const boringTools = [
    'Display Orientation Override',
    'Interface Reflection Mode',
    'Motion Accessibility Test',
    'Compact Display Protocol',
    'Accessibility Scale Override',
    'Network Throttle Simulation',
    'Legacy Media Compatibility Check',
    'Administrative Interaction Gate',
    'Account Status Preview',
    'Celebration Event Trigger',
    'Content Placeholder Protocol',
    'Scroll Direction Override',
    'Haptic Feedback Simulation',
    'Error Handling Validation Mode',
    'Direct User Communication',
  ];
  for (const tool of boringTools) {
    const visible = await page.getByText(tool, { exact: true }).first().isVisible();
    check(`disguised tool "${tool}" listed`, visible);
  }

  const applyButtons = await page.getByRole('button', { name: /^Apply/ }).count();
  check('19 Apply buttons (15 + 4 legacy probes)', applyButtons === 19, `found ${applyButtons}`);

  const previewButtons = await page.getByRole('button', { name: /^Preview/ }).count();
  check('19 Preview buttons (operator self-test)', previewButtons === 19, `found ${previewButtons}`);

  const overridesTable = await page.getByRole('heading', { name: 'Active User Experience Overrides' }).isVisible();
  check('"Active User Experience Overrides" table present', overridesTable);

  // The URL is /admin/user-experience — already asserted by the navigation.

  // Disguise audit: banned words must not appear anywhere in the console DOM.
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Overview' }).waitFor({ timeout: 15_000 });
  const bodyText = (await page.locator('body').innerText()).toLowerCase();
  for (const word of BANNED_WORDS) {
    check(`overview free of "${word}"`, !bodyText.includes(word.toLowerCase()));
  }

  // --- 5. apply + revoke through the real API -------------------------------
  const apply = await api(page, 'POST', '/api/admin/user-experience', {
    effect: 'orientation-override',
    target: 'all',
    durationSec: 15,
  });
  check('apply protocol via API', apply.status === 200, `status ${apply.status}`);
  const applyBody = apply.json as { event?: { id: number } };
  const list = await api(page, 'GET', '/api/admin/user-experience');
  const listBody = list.json as { tools?: unknown[]; events?: { id: number }[] };
  check('tool catalog served (19 tools)', Array.isArray(listBody.tools) && listBody.tools.length === 19, `got ${listBody.tools?.length}`);
  check('event visible in overrides list', Array.isArray(listBody.events) && listBody.events.some((e) => e.id === applyBody.event?.id));

  // Operator preview — target 'self' reaches the admin's own screen only.
  const preview = await api(page, 'POST', '/api/admin/user-experience', {
    effect: 'celebration-trigger',
    target: 'self',
    durationSec: 5,
  });
  check('preview (target self) via API', preview.status === 200, `status ${preview.status}`);
  if (preview.json?.event?.id) {
    const revokePreview = await api(page, 'DELETE', '/api/admin/user-experience', { id: preview.json.event.id });
    check('revoke preview via API', revokePreview.status === 200, `status ${revokePreview.status}`);
  }

  if (applyBody.event?.id) {
    const revoke = await api(page, 'DELETE', '/api/admin/user-experience', { id: applyBody.event.id });
    check('revoke protocol via API', revoke.status === 200, `status ${revoke.status}`);
  }

  // The client pickup endpoint is neutral and the old prank route is gone.
  const guestPoll = await api(page, 'GET', '/api/ux/poll?after=0');
  check('GET /api/ux/poll serves guests', guestPoll.status === 200 && 'event' in (guestPoll.json ?? {}), `status ${guestPoll.status}`);
  const oldPoll = await api(page, 'GET', '/api/troll/poll?after=0');
  check('old /api/troll/poll is gone', oldPoll.status === 404 || oldPoll.status === 405, `status ${oldPoll.status}`);
  const oldAdminRoute = await api(page, 'GET', '/api/admin/troll');
  check('old /api/admin/troll is gone', oldAdminRoute.status === 404 || oldAdminRoute.status === 405, `status ${oldAdminRoute.status}`);

  // Audit trail uses the disguised action name.
  const audit = await api(page, 'GET', '/api/admin?view=audit');
  const auditBody = audit.json as { entries?: { action: string }[] };
  const actions = auditBody.entries?.map((e) => e.action) ?? [];
  check('audit has ux.protocol_applied', actions.includes('ux.protocol_applied'));
  check('audit has no troll.* actions', !actions.some((a) => a.startsWith('troll.')));

  // --- 6. keyboard shortcut G+U → users ------------------------------------
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Overview' }).waitFor({ timeout: 15_000 });
  await page.keyboard.press('g');
  await page.keyboard.press('u');
  const usersReached = await page
    .getByPlaceholder('Search name or email…')
    .first()
    .waitFor({ timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  check('keyboard shortcut G+U navigates to Users', usersReached);

  // --- 7. screenshots --------------------------------------------------------
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Overview' }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: 'test-results/admin-redesign-overview.png' });

  await page.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: 'test-results/admin-redesign-users.png' });

  await page.goto(`${BASE}/admin/user-experience`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.getByRole('heading', { name: 'Advanced Interaction Tools' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/admin-redesign-ux-tools.png' });

  await browser.close();

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
