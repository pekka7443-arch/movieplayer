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
  /** Hex accent color (e.g. "#e50914"). Applied to :root as --cinedeck-accent. */
  accentColor: string;
  /** After the source scan, auto-jump to the healthiest mirror (off = stay on your preferred server). */
  autoPickSource: boolean;
  /**
   * Rank sources whose OWN subtitle track works (VidFast/VidLink/VidZee)
   * ahead of the superembed family (2Embed/VidSrc) whose captions are often
   * missing or laggy. Only reorders ONLINE candidates — dead sources never
   * benefit. Default on: captions are the #1 complaint with the embed pool.
   */
  preferCaptionSources: boolean;
  /** Watchdog that auto-switches sources when the player stalls. */
  autoFailover: boolean;
  /** How long to wait for a source to load before failing over (6–30s). */
  failoverSeconds: number;
  /**
   * Dubbed audio preference for the player. 'original' = don't request dubs;
   * otherwise a 2-letter code ("fi", "de", …) appended to dub-capable sources
   * (Videasy `language`) so they start with that audio/subtitle track.
   */
  dubLanguage: string;
  /** Global home/browse filter: show everything, only movies, or only series. */
  contentType: 'all' | 'movie' | 'tv';
  /** Genre chips picked during onboarding — seed the Explore prefilter. */
  favoriteGenres: string[];
  /** Notification center: episode/release alerts for watchlist titles. */
  notificationsEnabled: boolean;
}

export const FAILOVER_SECONDS_MIN = 6;
export const FAILOVER_SECONDS_MAX = 30;
export const FAILOVER_SECONDS_DEFAULT = 12;

function clampFailoverSeconds(value: unknown): number {
  const n = typeof value === 'number' ? Math.round(value) : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return FAILOVER_SECONDS_DEFAULT;
  return Math.min(FAILOVER_SECONDS_MAX, Math.max(FAILOVER_SECONDS_MIN, n));
}

export const DEFAULT_SETTINGS: CinedeckSettings = {
  language: DEFAULT_LANGUAGE,
  saveHistory: true,
  preferredServer: null,
  accentColor: '#e50914',
  autoPickSource: true,
  preferCaptionSources: true,
  autoFailover: true,
  failoverSeconds: FAILOVER_SECONDS_DEFAULT,
  dubLanguage: 'original',
  contentType: 'all',
  favoriteGenres: [],
  notificationsEnabled: true,
};

function normalizeDubLanguage(value: unknown): string {
  if (typeof value !== 'string' || !value || value === 'original') return 'original';
  const code = value.split('-')[0].toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : 'original';
}

function normalizeContentType(value: unknown): 'all' | 'movie' | 'tv' {
  return value === 'movie' || value === 'tv' ? value : 'all';
}

/**
 * Apply the saved accent color to document.documentElement so all
 * `bg-brand` / `text-brand` / `border-brand` classes repaint live.
 * Idempotent — safe to call on every settings change.
 */
export function applyAccentColor(color: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const value = color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : '#e50914';
  root.style.setProperty('--cinedeck-accent', value);
  // Auto-pick foreground based on luminance: dark text on bright accents,
  // white text on dark accents. Keeps button text readable for any color.
  const hex = value.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  root.style.setProperty('--cinedeck-accent-foreground', luminance > 0.55 ? '#09090b' : '#ffffff');
}

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

/** Public alias of `subscribe` for non-hook consumers (e.g. AppProviders useEffect). */
export const subscribeToSettings = subscribe;

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
        // First boot, nothing saved: pick the metadata language from the
        // browser locale (Finnish browsers get fi-FI) before defaulting.
        const locale = typeof navigator !== 'undefined' ? navigator.language : '';
        cachedSettings = {
          ...DEFAULT_SETTINGS,
          language: locale.toLowerCase().startsWith('fi') ? 'fi-FI' : DEFAULT_SETTINGS.language,
        };
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
          accentColor:
            typeof parsed.accentColor === 'string' &&
            /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(parsed.accentColor)
              ? parsed.accentColor
              : '#e50914',
          autoPickSource: typeof parsed.autoPickSource === 'boolean' ? parsed.autoPickSource : true,
          preferCaptionSources:
            typeof parsed.preferCaptionSources === 'boolean' ? parsed.preferCaptionSources : true,
          autoFailover: typeof parsed.autoFailover === 'boolean' ? parsed.autoFailover : true,
          failoverSeconds: clampFailoverSeconds(parsed.failoverSeconds),
          dubLanguage: normalizeDubLanguage(parsed.dubLanguage),
          contentType: normalizeContentType(parsed.contentType),
          favoriteGenres: Array.isArray(parsed.favoriteGenres)
            ? parsed.favoriteGenres.filter((g): g is string => typeof g === 'string').slice(0, 12)
            : [],
          notificationsEnabled:
            typeof parsed.notificationsEnabled === 'boolean' ? parsed.notificationsEnabled : true,
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
