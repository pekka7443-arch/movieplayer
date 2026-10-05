/**
 * CineDeck startup self-check — `bun run doctor`
 *
 * Verifies the things the platform publish/preview flow depends on and
 * prints a PASS/FAIL table. Exits 1 if any required check fails.
 *
 * Checks: env vars, DB connection, migrations applied, port 3000 open,
 * GET / → 200, CSP frame-ancestors for z.ai, build artifacts present.
 * (Run `bun run build` for the full compile — doctor verifies the artifacts
 * that build produces so it stays fast enough to run on every boot.)
 */
import { connect } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type Row = { name: string; ok: boolean; required: boolean; detail: string };

const rows: Row[] = [];
const record = (name: string, ok: boolean, detail: string, required = true) =>
  rows.push({ name, ok, required, detail });

const BASE = process.cwd();

// 1. ENV ------------------------------------------------------------
const envPath = path.join(BASE, '.env');
const envFile = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const envGet = (k: string) => process.env[k] ?? envFile.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();

const dbUrl = envGet('DATABASE_URL');
record('env: DATABASE_URL', !!dbUrl, dbUrl || 'missing');

const authSecret = envGet('AUTH_SECRET');
const authOk = !!authSecret && authSecret.length >= 32;
record(
  'env: AUTH_SECRET',
  authOk,
  authOk
    ? 'present (32+ chars)'
    : 'missing — self-heals on first authenticated request (or set PUBLISH_STRICT=1 to hard-fail instead)',
  false,
);

const tmdb = envGet('TMDB_API_KEY');
record('env: TMDB_API_KEY', !!tmdb, tmdb ? 'set (rich metadata)' : 'unset — keyless mode via Cinemeta', false);

// 2. BUILD ARTIFACTS -------------------------------------------------
const standalone = path.join(BASE, '.next/standalone/server.js');
const buildId = path.join(BASE, '.next/BUILD_ID');
const buildOk = existsSync(standalone) && existsSync(buildId);
record(
  'build: standalone server.js + BUILD_ID',
  buildOk,
  buildOk ? 'present (bun run build passed)' : 'missing — run `bun run build`',
);

// 3. DB CONNECTION ----------------------------------------------------
let dbOk = false;
let dbDetail = 'failed';
if (dbUrl) {
  try {
    const { PrismaClient } = await import('@prisma/client').then((m) => m);
    const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
    dbDetail = 'SELECT 1 ok';
    // 4. MIGRATIONS APPLIED ---------------------------------------------
    let applied: string[] = [];
    try {
      const res = await prisma.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations`;
      applied = res.map((r) => r.migration_name);
    } catch {
      /* no _prisma_migrations table */
    }
    const fs = await import('node:fs');
    const expected = fs
      .readdirSync(path.join(BASE, 'prisma/migrations'))
      .filter((d) => !d.startsWith('.') && d !== 'migration_lock.toml');
    const missing = expected.filter((m) => !applied.includes(m));
    record(
      'db: migrations applied',
      missing.length === 0,
      missing.length === 0 ? `${applied.length}/${expected.length} applied` : `NOT APPLIED: ${missing.join(', ')} — run \`bunx prisma migrate deploy\``,
    );
    await prisma.$disconnect();
  } catch (e) {
    dbDetail = e instanceof Error ? e.message : String(e);
  }
}
record('db: connection', dbOk, dbOk ? dbDetail : dbDetail);

// 5. PORT 3000 --------------------------------------------------------
const portOpen = await new Promise<boolean>((resolve) => {
  const sock = connect(3000, '127.0.0.1');
  sock.once('connect', () => {
    sock.destroy();
    resolve(true);
  });
  sock.once('error', () => resolve(false));
  sock.setTimeout(2000, () => {
    sock.destroy();
    resolve(false);
  });
});
record('port: 3000 listening', portOpen, portOpen ? '127.0.0.1:3000 reachable' : 'dev server not running — bun run dev / .zscripts/dev.sh');

// 6. HTTP CHECKS -------------------------------------------------------
let httpOk = false;
let cspOk = false;
let cspDetail = 'no response';
let xfoAbsent = true;
let healthOk = false;
if (portOpen) {
  try {
    const res = await fetch('http://127.0.0.1:3000/');
    httpOk = res.status === 200;
    const csp = res.headers.get('content-security-policy') ?? '';
    cspOk = /frame-ancestors[^;]*z\.ai/.test(csp);
    cspDetail = csp.match(/frame-ancestors[^;]*/)?.[0] ?? 'no frame-ancestors found';
    xfoAbsent = res.headers.get('x-frame-options') === null;
    record('http: GET / → 200', httpOk, `status ${res.status}`);
    record('csp: frame-ancestors allows z.ai', cspOk, cspOk ? cspDetail : `BAD: ${cspDetail}`);
    record(
      'csp: no X-Frame-Options conflict',
      xfoAbsent,
      xfoAbsent ? 'absent (frame-ancestors is authoritative)' : 'X-Frame-Options present — remove it, it blocks the platform iframe',
    );
    const h = await fetch('http://127.0.0.1:3000/api/health');
    healthOk = h.status === 200;
    record('http: GET /api/health → 200', healthOk, `status ${h.status}`, false);
  } catch (e) {
    cspDetail = e instanceof Error ? e.message : String(e);
  }
}

// REPORT ---------------------------------------------------------------
const nameW = Math.max(...rows.map((r) => r.name.length));
console.log('\n🩺 CineDeck doctor\n');
console.log(`${'CHECK'.padEnd(nameW)}  RESULT  DETAIL`);
console.log('-'.repeat(nameW + 60));
let fail = 0;
for (const r of rows) {
  const icon = r.ok ? '✅ PASS' : r.required ? '❌ FAIL' : '⚠️  WARN';
  if (!r.ok && r.required) fail++;
  console.log(`${r.name.padEnd(nameW)}  ${icon}  ${r.detail}`);
}
console.log('');
if (fail === 0) {
  console.log('✅ ALL REQUIRED CHECKS PASSED — publish/preview dependencies are healthy.\n');
} else {
  console.log(`❌ ${fail} required check(s) failed — fix the ❌ rows above, then re-run \`bun run doctor\`.\n`);
  process.exit(1);
}
