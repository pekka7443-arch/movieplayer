'use client';

// Favorite sports teams — device-local (localStorage), shared across every
// ScheduleRow via useSyncExternalStore so no prop drilling is needed.

import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'cinedeck.sportsFavorites';

/** Lowercase alphanumeric team name — matches the server's dedupe key. */
export function teamKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function loadFavorites(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string' && v.length > 0));
  } catch {
    return new Set();
  }
}

let favorites: Set<string> | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): Set<string> {
  if (favorites === null) favorites = loadFavorites();
  return favorites;
}

function getServerSnapshot(): Set<string> {
  return EMPTY;
}

const EMPTY = new Set<string>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function persist(next: Set<string>): void {
  favorites = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    // storage unavailable — session-only favorites
  }
  for (const listener of listeners) listener();
}

export function toggleFavoriteTeam(name: string): void {
  const key = teamKey(name);
  const next = new Set(getSnapshot());
  if (next.has(key)) next.delete(key);
  else next.add(key);
  persist(next);
}

export function useFavoriteTeams() {
  const set = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggle = useCallback((name: string) => toggleFavoriteTeam(name), []);
  const isFavorite = useCallback((name: string) => getSnapshot().has(teamKey(name)), []);
  return { favorites: set, toggle, isFavorite };
}
