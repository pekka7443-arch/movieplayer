// Profile helpers shared by React and non-React code paths.
//
// The active profile id lives in the zustand store (React) but library API
// helpers in lib/tmdb.ts / lib/library.ts run outside React, so they read
// the same localStorage key directly — one source of truth, no drift.

export const ACTIVE_PROFILE_STORAGE = 'cinedeck.activeProfile';

export const MAIN_PROFILE_ID = 'main';

/** Synchronously read the active profile id ('main' when unset/unavailable). */
export function getActiveProfileId(): string {
  try {
    return window.localStorage.getItem(ACTIVE_PROFILE_STORAGE) || MAIN_PROFILE_ID;
  } catch {
    return MAIN_PROFILE_ID;
  }
}

/**
 * Persist the active profile id. Kept in sync with the store's
 * setActiveProfile — both write the identical key.
 */
export function setActiveProfileId(profileId: string): void {
  try {
    window.localStorage.setItem(ACTIVE_PROFILE_STORAGE, profileId);
  } catch {
    // storage unavailable — session-only switch
  }
}

/**
 * Fire-and-forget sync of the chosen UI language onto the active profile
 * (signed-in, non-main profiles only). Failures are silent: language still
 * applies locally, it just won't roams across devices for that profile.
 */
export function syncProfileLanguage(language: string): void {
  const profileId = getActiveProfileId();
  if (profileId === MAIN_PROFILE_ID) return;
  void fetch('/api/profiles', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: profileId, language }),
  }).catch(() => undefined);
}
