// Finnish-dub provider allowlist — runtime half.
//
// The STATIC half lives in lib/providers.ts (FINNISH_DUB_PROVIDERS, ships
// empty). Admins populate the RUNTIME half via POST /api/admin/finnish-providers,
// which persists a JSON array into the SystemState key-value table under
// "finnish_dub_providers" and hot-reloads the in-memory list below — the scan
// picks it up on the next request without a server restart.
//
// Loaded lazily on first read (≈ app start for the scan route) and revalidated
// on a short TTL; writes refresh the cache synchronously so hot-reload is
// immediate. Never throws — a DB hiccup degrades to the static list.

import { db } from '@/lib/db';
import { FINNISH_DUB_PROVIDERS } from '@/lib/providers';

export const FINNISH_PROVIDERS_STATE_KEY = 'finnish_dub_providers';

/** Provider-id shaped tokens only — "twoembed_cc", "vidfast", … */
const PROVIDER_ID_RE = /^[a-z0-9_-]{2,60}$/;
const MAX_PROVIDERS = 50;
const CACHE_TTL_MS = 30_000;

interface FinnishProviderCache {
  at: number;
  runtime: string[];
}

const globalForFinnishProviders = globalThis as unknown as {
  __cinedeckFinnishProviders?: FinnishProviderCache;
};

/** Provider-id sanitize — trim, lowercase, dedupe, cap, shape-check. */
export function sanitizeFinnishProviders(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim().toLowerCase();
    if (!PROVIDER_ID_RE.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_PROVIDERS) break;
  }
  return out;
}

async function readRuntimeList(): Promise<string[]> {
  const cached = globalForFinnishProviders.__cinedeckFinnishProviders;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.runtime;
  try {
    const row = await db.systemState.findUnique({
      where: { key: FINNISH_PROVIDERS_STATE_KEY },
      select: { value: true },
    });
    let parsed: unknown = [];
    if (row?.value) {
      try {
        parsed = JSON.parse(row.value);
      } catch {
        parsed = [];
      }
    }
    const runtime = sanitizeFinnishProviders(parsed);
    globalForFinnishProviders.__cinedeckFinnishProviders = { at: Date.now(), runtime };
    return runtime;
  } catch {
    // DB unavailable — keep serving the last known list (or the static one).
    return cached?.runtime ?? [];
  }
}

/**
 * Merged allowlist: static FINNISH_DUB_PROVIDERS + admin-curated runtime list.
 * Awaited by the scan before flagging finnishAudioConfirmed.
 */
export async function getFinnishDubProviders(): Promise<string[]> {
  const runtime = await readRuntimeList();
  return [...new Set([...FINNISH_DUB_PROVIDERS, ...runtime])];
}

/** True when the merged (static + runtime) allowlist contains the provider. */
export async function isFinnishDubProvider(providerId: string): Promise<boolean> {
  const list = await getFinnishDubProviders();
  return list.includes(providerId.trim().toLowerCase());
}

/**
 * Replace the runtime list (admin POST). Persists to SystemState and refreshes
 * the in-memory cache synchronously — hot-reload without a restart.
 */
export async function setFinnishDubProviders(providers: string[]): Promise<string[]> {
  const list = sanitizeFinnishProviders(providers);
  await db.systemState.upsert({
    where: { key: FINNISH_PROVIDERS_STATE_KEY },
    create: { key: FINNISH_PROVIDERS_STATE_KEY, value: JSON.stringify(list) },
    update: { value: JSON.stringify(list) },
  });
  globalForFinnishProviders.__cinedeckFinnishProviders = { at: Date.now(), runtime: list };
  return list;
}
