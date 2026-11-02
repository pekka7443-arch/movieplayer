import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  await db.user.update({
    where: { email: 'admin@kana.com' },
    data: { mustChangePassword: false },
  });
  const u = await db.user.findUnique({ where: { email: 'admin@kana.com' } });
  console.log('admin:', u?.email, 'role:', u?.role, 'mustChangePassword:', u?.mustChangePassword);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
