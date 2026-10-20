/**
 * Rotate the admin password (the old one leaked in public git history).
 * - Updates the admin user's passwordHash in the DB
 * - Updates local untracked config/bootstrap-admin.json (seed fallback)
 * - Adds ADMIN_EMAIL/ADMIN_PASSWORD to .env (untracked; used by verify scripts/tests)
 * Usage: bun scripts/rotate-admin-pass.ts <newPassword>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

async function main() {
  const newPassword = process.argv[2];
  if (!newPassword || newPassword.length < 10) {
    console.error('usage: bun scripts/rotate-admin-pass.ts <newPassword >=10 chars>');
    process.exit(1);
  }

  // Resolve project root from cwd (script runs via bun from repo root)
  const root = process.cwd();
  const bootstrapPath = `${root}/config/bootstrap-admin.json`;

  // Current admin email: env > bootstrap file > hardcoded default
  let email = process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? '';
  if (!email && existsSync(bootstrapPath)) {
    try {
      email = JSON.parse(readFileSync(bootstrapPath, 'utf8')).email ?? '';
    } catch {}
  }
  if (!email) email = 'admin@example.com';

  // 1. Update DB
  process.env.DATABASE_URL ??= 'file:/home/z/my-project/db/custom.db';
  const { PrismaClient } = await import('@prisma/client');
  const { hashPassword } = await import('../src/lib/server/auth');
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      console.error(`admin user not found: ${email} — nothing to rotate in DB`);
    } else {
      await prisma.user.update({
        where: { email },
        data: { passwordHash: hashPassword(newPassword) },
      });
      // Kill any live sessions for safety
      const anyPrisma = prisma as unknown as {
        session?: { deleteMany: (q: { where: { userId: string } }) => Promise<unknown> };
      };
      if (anyPrisma.session) {
        await anyPrisma.session.deleteMany({ where: { userId: user.id } });
      }
      console.log(`DB: password rotated for ${email}, sessions revoked`);
    }
  } finally {
    await prisma.$disconnect();
  }

  // 2. Update bootstrap config (untracked, gitignored)
  writeFileSync(bootstrapPath, `${JSON.stringify({ email, password: newPassword }, null, 2)}\n`);
  console.log(`config/bootstrap-admin.json updated (untracked)`);

  // 3. Sync .env ADMIN_* vars (untracked)
  const envPath = `${root}/.env`;
  let env = readFileSync(envPath, 'utf8');
  const upsert = (key: string, val: string) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(env)) env = env.replace(re, `${key}=${val}`);
    else env += (env.endsWith('\n') ? '' : '\n') + `${key}=${val}\n`;
  };
  upsert('ADMIN_EMAIL', email);
  upsert('ADMIN_PASSWORD', newPassword);
  writeFileSync(envPath, env);
  console.log('.env ADMIN_* vars updated (untracked)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
void pathToFileURL;
