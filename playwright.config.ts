import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Read a value from .env (playwright runs before next loads it). */
function envFromDotEnv(key: string): string | undefined {
  try {
    const line = readFileSync('.env', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return line?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/**
 * CineDeck e2e tests. Runs against the dev server on :3000 (started via
 * `.zscripts/dev.sh` / `bun run dev`). Chromium only — the app's real
 * audience covers evergreen browsers and CI time matters.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
    // Dev-only rate-limit bypass for repeated e2e runs (see .env.example) —
    // requires loopback client + non-production server, so it is a no-op
    // against previews or deployments.
    extraHTTPHeaders: (() => {
      const secret = process.env.E2E_RATELIMIT_BYPASS ?? envFromDotEnv('E2E_RATELIMIT_BYPASS');
      const headers: Record<string, string> = {};
      if (secret) headers['x-cinedeck-e2e'] = secret;
      return headers;
    })(),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
});
