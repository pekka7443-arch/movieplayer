// CLI: bun run seed — create the .env-configured admin account (idempotent).
// Also runs automatically on first boot via /api/health. Credentials live
// ONLY in .env — this script reads them, never hardcodes them.
//
// Before seeding, the AUTH_SECRET stability pass runs (same as the server
// boot hook): restores the secret from the DB when .env lost it, or
// generates it exactly once on the literal first boot. Never resets data.

import { ensureAdminSeed } from '../src/lib/server/seed';
import { ensureStableAuthSecret } from '../src/lib/server/auth-secret-store';

const secret = await ensureStableAuthSecret();
if (secret) {
  console.log('✓ AUTH_SECRET stable (present in .env / environment).');
} else {
  console.warn('⚠ AUTH_SECRET could not be resolved — check .env permissions.');
}

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
