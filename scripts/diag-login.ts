import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const user = await db.user.findUnique({ where: { email: 'admin@kana.com' } });
  if (!user) { console.log('NO ADMIN USER'); return; }
  console.log('USER:', JSON.stringify({
    id: user.id, email: user.email, role: user.role,
    mustChangePassword: user.mustChangePassword,
    deletedAt: user.deletedAt, suspendedAt: user.suspendedAt,
    totpEnabled: user.totpEnabled,
    createdAt: user.createdAt, updatedAt: user.updatedAt,
  }, null, 2));
  const attempts = await db.loginAttempt.findMany({
    orderBy: { createdAt: 'desc' }, take: 25,
  });
  console.log('RECENT LOGIN ATTEMPTS (' + attempts.length + '):');
  for (const a of attempts) {
    console.log(
      a.createdAt.toISOString(),
      a.success ? 'OK ' : 'FAIL',
      a.reason ?? '-',
      a.email ?? '-',
      'ip=' + (a.ip ?? '-'),
    );
  }
  const total = await db.loginAttempt.count();
  console.log('total attempts in table:', total);
}
main().catch(e => { console.error('ERR', e); process.exit(1); }).finally(() => db.$disconnect());
