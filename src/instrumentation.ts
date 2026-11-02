// Next.js boot hook — runs ONCE per server process (dev + standalone) before
// the first request is handled.
//
// register() pins the AUTH_SECRET before anything can sign or verify a
// stateless token, then runs the 2026-11-03 security boot migrations and
// production configuration validation. Nothing here may block boot — every
// step degrades to a loud log line.
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
  try {
    const { migrateTotpSecretsToSealedStorage, validateProductionSecurity } = await import(
      '@/lib/server/security-boot'
    );
    await migrateTotpSecretsToSealedStorage();
    validateProductionSecurity();
  } catch (error) {
    console.warn(
      '[boot] security boot migrations skipped:',
      error instanceof Error ? error.message : error,
    );
  }
}
