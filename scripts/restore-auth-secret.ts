// Restore AUTH_SECRET from the SystemState database when .env lost it.
// Called by scripts/deploy.sh BEFORE the generate-once fallback so a platform
// .env wipe can never rotate the secret (which would invalidate outstanding
// reset/verification links). Exits 0 in every non-fatal case; deploy.sh
// decides afterwards whether a fresh secret still needs to be generated.

import { PrismaClient } from '@prisma/client';
import { envFileGet, upsertEnvValue } from '../src/lib/server/env-file';
import { isValidAuthSecret } from '../src/lib/server/auth-secret-store';

const fromEnv = process.env.AUTH_SECRET;
const fromFile = envFileGet('AUTH_SECRET');
if (isValidAuthSecret(fromEnv) || isValidAuthSecret(fromFile)) {
  console.log('[deploy] AUTH_SECRET present — nothing to restore');
  process.exit(0);
}

const prisma = new PrismaClient();
try {
  const row = await prisma.systemState.findUnique({ where: { key: 'auth_secret' } });
  if (row && isValidAuthSecret(row.value)) {
    upsertEnvValue('AUTH_SECRET', row.value);
    console.log('[deploy] AUTH_SECRET restored from the database (env was wiped)');
  } else {
    console.log('[deploy] no stored secret in the DB yet — deploy will generate one');
  }
} catch (error) {
  console.log(
    `[deploy] restore step skipped (${
      error instanceof Error ? error.message.split('\n')[0] : error
    }) — deploy will generate one if .env is still empty`,
  );
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
