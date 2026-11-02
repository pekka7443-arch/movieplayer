import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Query logging is opt-in via DEBUG_PRISMA=1 — even in development the
// default 'query' level printed BOUND PARAMETERS (including passwordHash
// values on user updates) into dev.log (2026-11-03 hardening).
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.DEBUG_PRISMA === '1'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
