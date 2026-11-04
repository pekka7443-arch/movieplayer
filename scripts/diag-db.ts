import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
const db = new PrismaClient();
async function main() {
  const users = await db.user.findMany({ select: { id: true, email: true, role: true, createdAt: true, deletedAt: true } });
  console.log('USERS (' + users.length + '):');
  for (const u of users) console.log(' ', u.email, u.role, u.createdAt.toISOString(), u.deletedAt ? 'DELETED' : '');
  const sessions = await db.session.count();
  const attempts = await db.loginAttempt.count();
  console.log('sessions:', sessions, 'loginAttempts:', attempts);
  const migrations = await db.$queryRawUnsafe("SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at") as any[];
  console.log('MIGRATIONS:', migrations.map(m => m.migration_name).join(', '));
  const cols = await db.$queryRawUnsafe("PRAGMA table_info(User)") as any[];
  console.log('User columns:', cols.map(c => c.name).join(', '));
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); }).finally(() => db.$disconnect());
