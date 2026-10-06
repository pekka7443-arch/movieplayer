import { create } from 'zustand';
import { DEFAULT_LANGUAGE } from '@/lib/languages';
import { DEFAULT_PROVIDER, sanitizePreferredServer } from '@/lib/providers';
import { getSettings, updateSettings } from '@/lib/settings';
import { getActiveProfileId, setActiveProfileId, syncProfileLanguage } from '@/lib/profile';

interface CinedeckState {
  /** Active TMDB content language (persisted). */
  language: string;
  setLanguage: (code: string) => void;
  /** Global browse filter — All / Movies / TV Series (persisted). */
  contentType: 'all' | 'movie' | 'tv';
  setContentType: (type: 'all' | 'movie' | 'tv') => void;
  /** Currently selected stream provider id (persisted as preferred). */
  server: string;
  setServer: (providerId: string) => void;
  /**
   * Switch server WITHOUT persisting it as the user's preference — used by
   * the auto-scan / auto-failover logic so a transiently dead source never
   * overwrites the server the user actually chose.
   */
  setServerTransient: (providerId: string) => void;
  /** Reset the active server to the persisted preference (used when switching titles). */
  resetServer: () => void;
  /** Pull language + preferred server from localStorage (call once on mount). */
  hydrateFromSettings: () => void;
  /** Settings dialog visibility (shared by header / search / connect cards). */
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  /** Arcade dialog (Emoji Quiz + Roulette) visibility. */
  arcadeOpen: boolean;
  openArcade: () => void;
  closeArcade: () => void;
  /** Sign in / create account dialog. */
  authOpen: boolean;
  authMode: 'signin' | 'signup';
  openAuth: (mode?: 'signin' | 'signup') => void;
  closeAuth: () => void;
  /** Global command palette (Ctrl/Cmd+K). */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** Active profile id (per-account; 'main' = default). Persisted locally. */
  activeProfileId: string;
  setActiveProfile: (profileId: string) => void;
}

export const useCinedeckStore = create<CinedeckState>((set) => ({
  language: DEFAULT_LANGUAGE,
  setLanguage: (code) => {
    updateSettings({ language: code });
    set({ language: code });
    // Non-main profiles remember their own content language across devices.
    syncProfileLanguage(code);
  },
  contentType: 'all',
  setContentType: (type) => {
    updateSettings({ contentType: type });
    set({ contentType: type });
  },
  server: DEFAULT_PROVIDER,
  setServer: (providerId) => {
    updateSettings({ preferredServer: providerId });
    set({ server: providerId });
  },
  setServerTransient: (providerId) => {
    set({ server: providerId });
  },
  resetServer: () => {
    set({ server: sanitizePreferredServer(getSettings().preferredServer) });
  },
  hydrateFromSettings: () => {
    const s = getSettings();
    set({
      language: s.language,
      contentType: s.contentType,
      // sanitizePreferredServer drops last-resort sources (e.g. Videasy) that
      // an old session may have persisted as the preference — they are
      // black-screen-prone and must never take autoplay on a fresh load.
      server: sanitizePreferredServer(s.preferredServer),
    });
  },
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  arcadeOpen: false,
  openArcade: () => set({ arcadeOpen: true }),
  closeArcade: () => set({ arcadeOpen: false }),
  authOpen: false,
  authMode: 'signin',
  openAuth: (mode = 'signin') => set({ authOpen: true, authMode: mode }),
  closeAuth: () => set({ authOpen: false }),
  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  activeProfileId: 'main',
  setActiveProfile: (profileId) => {
    setActiveProfileId(profileId);
    set({ activeProfileId: profileId });
  },
}));

/** Hydrate the active profile from localStorage (call once on mount). */
export function hydrateActiveProfile(): string {
  return getActiveProfileId();
}
