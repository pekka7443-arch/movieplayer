import { create } from 'zustand';
import { DEFAULT_LANGUAGE } from '@/lib/languages';
import { DEFAULT_PROVIDER } from '@/lib/providers';
import { getSettings, updateSettings } from '@/lib/settings';

interface CinedeckState {
  /** Active TMDB content language (persisted). */
  language: string;
  setLanguage: (code: string) => void;
  /** Currently selected stream provider id (persisted as preferred). */
  server: string;
  setServer: (providerId: string) => void;
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
}

export const useCinedeckStore = create<CinedeckState>((set) => ({
  language: DEFAULT_LANGUAGE,
  setLanguage: (code) => {
    updateSettings({ language: code });
    set({ language: code });
  },
  server: DEFAULT_PROVIDER,
  setServer: (providerId) => {
    updateSettings({ preferredServer: providerId });
    set({ server: providerId });
  },
  resetServer: () => {
    set({ server: getSettings().preferredServer ?? DEFAULT_PROVIDER });
  },
  hydrateFromSettings: () => {
    const s = getSettings();
    set({ language: s.language, server: s.preferredServer ?? DEFAULT_PROVIDER });
  },
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  arcadeOpen: false,
  openArcade: () => set({ arcadeOpen: true }),
  closeArcade: () => set({ arcadeOpen: false }),
}));
