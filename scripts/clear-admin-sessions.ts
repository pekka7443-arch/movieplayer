/**
 * Deletes every active session for one email. Used by admin test suites to
 * dodge the 3-device admin limit. Run: bun scripts/clear-admin-sessions.ts <email>
 */
import { PrismaClient } from '@prisma/client';

const email = process.argv[2];
if (!email) {
  console.error('usage: bun scripts/clear-admin-sessions.ts <email>');
  process.exit(1);
}

const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? 'file:/home/z/my-project/db/custom.db' } },
});

const result = await db.session.deleteMany({ where: { user: { email } } });
console.log(`cleared ${result.count} session(s) for ${email}`);
await db.$disconnect();
