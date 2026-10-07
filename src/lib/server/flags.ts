// Feature-flag reads (server side). Flags live in the FeatureFlag table and
// are toggled from the admin dashboard. Cached briefly in-process so routes
// can check them without hammering the DB.

import { db } from '@/lib/db';

const globalForFlags = globalThis as unknown as {
  __cinedeckFlagCache?: { at: number; values: Map<string, boolean> };
};

const CACHE_TTL_MS = 30_000;

async function allFlags(): Promise<Map<string, boolean>> {
  const cached = globalForFlags.__cinedeckFlagCache;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.values;
  try {
    const rows = await db.featureFlag.findMany({ select: { key: true, enabled: true } });
    const values = new Map(rows.map((r) => [r.key, r.enabled]));
    globalForFlags.__cinedeckFlagCache = { at: Date.now(), values };
    return values;
  } catch {
    return cached?.values ?? new Map();
  }
}

/** True when the flag exists AND is enabled. Unknown flags are off. */
export async function isFlagEnabled(key: string): Promise<boolean> {
  const flags = await allFlags();
  return flags.get(key) === true;
}
