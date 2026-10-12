// One-off DB state probe: which core tables exist and do they hold rows?
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const tables = (await db.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  )).map((r) => r.name);
  console.log('tables:', tables.join(', '));

  for (const model of ['user', 'session', 'systemState', 'watchHistory', 'comment'] as const) {
    try {
      const delegate = (db as unknown as Record<string, { count: () => Promise<number> }>)[model];
      const n = await delegate.count();
      console.log(`${model}: ${n} rows`);
    } catch (err) {
      console.log(`${model}: ERROR ${(err as Error).message.slice(0, 80)}`);
    }
  }
}

main().finally(() => db.$disconnect());
