// Next.js boot hook — runs ONCE per server process (dev + standalone) before
// the first request is handled.
//
// register() pins the AUTH_SECRET before anything can sign or verify a
// stateless token: if the environment/.env lost the secret (platform resets
// regenerate .env; rebuilds wipe .next/standalone), it is restored from the
// SystemState database row written on the first boot. See
// src/lib/server/auth-secret-store.ts for the full stability contract.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { ensureStableAuthSecret } = await import('@/lib/server/auth-secret-store');
    await ensureStableAuthSecret();
  } catch (error) {
    // Never block boot — authSecret() still self-heals synchronously.
    console.warn(
      '[boot] auth secret stabilization skipped:',
      error instanceof Error ? error.message : error,
    );
  }
}
