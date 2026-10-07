// CLI: bun run seed — create the .env-configured admin account (idempotent).
// Also runs automatically on first boot via /api/health. Credentials live
// ONLY in .env — this script reads them, never hardcodes them.

import { ensureAdminSeed } from '../src/lib/server/seed';

const result = await ensureAdminSeed({ force: true });

if (!result.ran) {
  if (result.skipped === 'missing_env') {
    console.error(
      '✗ ADMIN_EMAIL / ADMIN_PASSWORD are not set. Add them to .env (see .env.example).',
    );
    process.exit(1);
  }
  console.error('✗ Seed failed — check the server logs.');
  process.exit(1);
}

if (result.created) {
  console.log(`✓ Admin account created for ${result.email} (mustChangePassword=true).`);
  console.log('  Sign in once, then change the password in Settings → Security.');
} else {
  console.log(`✓ No changes — admin account for ${result.email} already exists (idempotent seed).`);
}
process.exit(0);
