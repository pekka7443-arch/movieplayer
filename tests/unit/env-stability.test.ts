// Unit tests for the .env stability layer (Task 44):
// - env-file.ts: idempotent line upserts at the project root
// - auth-secret-store.ts: secret validity + fingerprint (pure helpers)
//
// The tests redirect projectRoot() at a throwaway directory via the
// CINEDECK_ROOT override (with a fake prisma/schema.prisma marker) so the
// real project .env is NEVER touched.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, afterAll } from 'vitest';

const sandbox = mkdtempSync(path.join(tmpdir(), 'cinedeck-env-'));
mkdirSync(path.join(sandbox, 'prisma'), { recursive: true });
writeFileSync(path.join(sandbox, 'prisma', 'schema.prisma'), '// test marker\n');
process.env.CINEDECK_ROOT = sandbox;

const { envFileGet, upsertEnvValue } = await import('@/lib/server/env-file');
const { fingerprint, isValidAuthSecret } = await import('@/lib/server/auth-secret-store');

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('upsertEnvValue (idempotent .env writes)', () => {
  it('creates the file with a single line when .env does not exist', () => {
    const result = upsertEnvValue('AUTH_SECRET', 'a'.repeat(64));
    expect(result).toBe('created');
    expect(readFileSync(path.join(sandbox, '.env'), 'utf8')).toBe(`AUTH_SECRET=${'a'.repeat(64)}\n`);
  });

  it('replaces the value in place and preserves unrelated lines', () => {
    writeFileSync(
      path.join(sandbox, '.env'),
      'DATABASE_URL=file:./db/custom.db\nAUTH_SECRET=old\nADMIN_EMAIL=admin@example.com\n',
    );
    const result = upsertEnvValue('AUTH_SECRET', 'b'.repeat(64));
    expect(result).toBe('replaced');
    const content = readFileSync(path.join(sandbox, '.env'), 'utf8');
    expect(content).toBe(
      `DATABASE_URL=file:./db/custom.db\nAUTH_SECRET=${'b'.repeat(64)}\nADMIN_EMAIL=admin@example.com\n`,
    );
    expect(envFileGet('AUTH_SECRET')).toBe('b'.repeat(64));
  });

  it('is a no-op when the value already matches (no rewrite churn)', () => {
    const before = readFileSync(path.join(sandbox, '.env'), 'utf8');
    const result = upsertEnvValue('AUTH_SECRET', 'b'.repeat(64));
    expect(result).toBe('unchanged');
    expect(readFileSync(path.join(sandbox, '.env'), 'utf8')).toBe(before);
  });

  it('appends a missing key and collapses duplicate KEY= lines', () => {
    writeFileSync(
      path.join(sandbox, '.env'),
      `DATABASE_URL=file:./db/custom.db\nDATABASE_URL=file:./db/custom.db\nAUTH_SECRET=${'b'.repeat(64)}\n`,
    );
    // Re-writing the SAME value must collapse the duplicated DATABASE_URL.
    upsertEnvValue('DATABASE_URL', 'file:./db/custom.db');
    const content = readFileSync(path.join(sandbox, '.env'), 'utf8');
    expect(content.match(/^DATABASE_URL=.*$/gm)?.length).toBe(1);

    // A brand-new key is appended once.
    expect(upsertEnvValue('TMDB_API_KEY', 'k'.repeat(8))).toBe('created');
    const final = readFileSync(path.join(sandbox, '.env'), 'utf8');
    expect(final.match(/^TMDB_API_KEY=.*$/gm)?.length).toBe(1);
    // Similar prefixes must not be treated as the same key.
    expect(upsertEnvValue('AUTH_SECRET_ROTATE', '1')).toBe('created');
    expect(envFileGet('AUTH_SECRET')).toBe('b'.repeat(64));
  });

  it('never leaves duplicate lines when replacing across duplicates', () => {
    writeFileSync(
      path.join(sandbox, '.env'),
      'AUTH_SECRET=x1\nOTHER=y\nAUTH_SECRET=x2\n',
    );
    upsertEnvValue('AUTH_SECRET', 'c'.repeat(64));
    const content = readFileSync(path.join(sandbox, '.env'), 'utf8');
    expect(content.match(/^AUTH_SECRET=.*$/gm)?.length).toBe(1);
    expect(content).toContain('OTHER=y');
    expect(envFileGet('AUTH_SECRET')).toBe('c'.repeat(64));
  });

  it('rejects invalid env keys', () => {
    expect(() => upsertEnvValue('BAD KEY', 'v')).toThrow(/invalid env key/);
    expect(() => upsertEnvValue('A=B', 'v')).toThrow(/invalid env key/);
  });
});

describe('auth secret validity + fingerprint', () => {
  it('accepts 32+ char secrets and rejects short/empty/placeholder ones', () => {
    expect(isValidAuthSecret('a'.repeat(64))).toBe(true);
    expect(isValidAuthSecret('a'.repeat(32))).toBe(true);
    expect(isValidAuthSecret('')).toBe(false);
    expect(isValidAuthSecret(null)).toBe(false);
    expect(isValidAuthSecret(undefined)).toBe(false);
    expect(isValidAuthSecret('short')).toBe(false);
    expect(isValidAuthSecret('replace-me-with-openssl-rand-hex-32')).toBe(false);
    expect(isValidAuthSecret('CHANGEME_CHANGEME_CHANGEME_CHANGEME')).toBe(false);
  });

  it('produces a deterministic SHA-256 fingerprint', () => {
    expect(fingerprint('secret-a')).toBe(fingerprint('secret-a'));
    expect(fingerprint('secret-a')).not.toBe(fingerprint('secret-b'));
    expect(fingerprint('secret-a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('projectRoot override', () => {
  it('honors CINEDECK_ROOT (sandbox marker dir)', async () => {
    const { projectRoot } = await import('@/lib/server/project-root');
    expect(projectRoot()).toBe(sandbox);
    expect(existsSync(path.join(projectRoot(), 'prisma', 'schema.prisma'))).toBe(true);
  });
});
