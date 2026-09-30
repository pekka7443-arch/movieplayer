'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_LANGUAGE } from '@/lib/languages';
import { DEFAULT_PROVIDER } from '@/lib/providers';

const KEY_STORAGE = 'cinedeck.tmdb.key';
const SETTINGS_STORAGE = 'cinedeck.settings';

export interface CinedeckSettings {
  /** TMDB language code, e.g. "en-US" */
  language: string;
  /** Persist watch progress to /api/history */
  saveHistory: boolean;
  /** Preferred provider id (null → default server) */
  preferredServer: string | null;
}

export const DEFAULT_SETTINGS: CinedeckSettings = {
  language: DEFAULT_LANGUAGE,
  saveHistory: true,
  preferredServer: null,
};

// ---------------------------------------------------------------------------
// Tiny pub/sub so React components can react to localStorage changes.
// Snapshots are cached so useSyncExternalStore sees stable references.
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let cachedKey: string | null = null;
let cachedKeySnapshot = false;
let cachedSettings: CinedeckSettings | null = null;

function emit(): void {
  cachedKey = null;
  cachedSettings = null;
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === KEY_STORAGE || event.key === SETTINGS_STORAGE) emit();
  });
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------
// TMDB key
// ---------------------------------------------------------------------------

export function getTmdbKey(): string {
  if (typeof window === 'undefined') return '';
  if (cachedKey === null) {
    try {
      cachedKey = (window.localStorage.getItem(KEY_STORAGE) ?? '').trim();
    } catch {
      cachedKey = '';
    }
  }
  return cachedKey;
}

export function setTmdbKey(key: string): void {
  try {
    window.localStorage.setItem(KEY_STORAGE, key.trim());
  } catch {
    // storage full / private mode — ignore
  }
  emit();
}

export function clearTmdbKey(): void {
  try {
    window.localStorage.removeItem(KEY_STORAGE);
  } catch {
    // ignore
  }
  emit();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getSettings(): CinedeckSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  if (cachedSettings === null) {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE);
      if (!raw) {
        cachedSettings = DEFAULT_SETTINGS;
      } else {
        const parsed = JSON.parse(raw) as Partial<CinedeckSettings>;
        cachedSettings = {
          language:
            typeof parsed.language === 'string' && parsed.language
              ? parsed.language
              : DEFAULT_LANGUAGE,
          saveHistory: typeof parsed.saveHistory === 'boolean' ? parsed.saveHistory : true,
          preferredServer:
            typeof parsed.preferredServer === 'string' && parsed.preferredServer
              ? parsed.preferredServer
              : parsed.preferredServer === null
                ? null
                : DEFAULT_PROVIDER,
        };
      }
    } catch {
      cachedSettings = DEFAULT_SETTINGS;
    }
  }
  return cachedSettings;
}

export function updateSettings(patch: Partial<CinedeckSettings>): CinedeckSettings {
  const next = { ...getSettings(), ...patch };
  try {
    window.localStorage.setItem(SETTINGS_STORAGE, JSON.stringify(next));
  } catch {
    // ignore
  }
  emit();
  return next;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function keySnapshot(): boolean {
  return getTmdbKey().length > 0;
}

/** Reactive "does the user have a TMDB key" flag. */
export function useHasTmdbKey(): boolean {
  return useSyncExternalStore(subscribe, keySnapshot, () => false);
}

export function useSettings(): CinedeckSettings {
  return useSyncExternalStore(subscribe, getSettings, () => DEFAULT_SETTINGS);
}
