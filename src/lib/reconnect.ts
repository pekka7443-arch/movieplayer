'use client';

// ---------------------------------------------------------------------------
// Origin wake-up / auto-reconnect.
//
// WHY THIS EXISTS: the platform suspends the sandbox between assistant turns.
// While suspended, the browser's service worker still serves the cached app
// shell, so the user sees a fully rendered CineDeck where EVERY data fetch
// fails with "Network error — check your connection" (or a misleading "No
// results"). The old UI was a dead end — the user had to keep pressing
// "Try again" until the sandbox happened to wake.
//
// HOW IT WORKS: any network-level fetch failure starts a lightweight
// /api/health poll (2.5s → 15s backoff). The moment the origin answers,
// 'cinedeck:reconnected' fires and AppProviders invalidates the whole React
// Query cache — every row, search and detail view heals by itself.
// ---------------------------------------------------------------------------

const RECONNECTING_EVENT = 'cinedeck:reconnecting';
const RECONNECTED_EVENT = 'cinedeck:reconnected';

type Listener = () => void;

let polling = false;

/** True while a wake-up poll is running (origin presumed down). */
export function isReconnectPolling(): boolean {
  return polling;
}

/**
 * Network-level error detector for React Query cache callbacks.
 * Duck-types by `code` so it works for ApiError (lib/tmdb) and the auth
 * client's error class without importing either (no cycles); a raw fetch()
 * failure surfaces as TypeError.
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'network') {
    return true;
  }
  return false;
}

/** Start polling /api/health until the origin answers. Idempotent. */
export function beginReconnectPolling(): void {
  if (typeof window === 'undefined' || polling) return;
  polling = true;
  window.dispatchEvent(new CustomEvent(RECONNECTING_EVENT));

  let delay = 2500;
  const tick = async (): Promise<void> => {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (res.ok) {
        polling = false;
        window.dispatchEvent(new CustomEvent(RECONNECTED_EVENT));
        return;
      }
    } catch {
      // Origin still unreachable (sandbox suspended) — keep polling.
    }
    delay = Math.min(delay * 1.5, 15_000);
    window.setTimeout(tick, delay);
  };
  window.setTimeout(tick, delay);
}

/** Subscribe to the origin-is-back event. Returns an unsubscribe function. */
export function onReconnected(listener: Listener): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(RECONNECTED_EVENT, listener);
  return () => window.removeEventListener(RECONNECTED_EVENT, listener);
}

/** Subscribe to the origin-looks-down event (fired once per polling session). */
export function onReconnecting(listener: Listener): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(RECONNECTING_EVENT, listener);
  return () => window.removeEventListener(RECONNECTING_EVENT, listener);
}
