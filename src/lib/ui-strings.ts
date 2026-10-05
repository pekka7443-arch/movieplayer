// UI string catalog — the foundation for translating interface copy.
//
// The existing "language system" (src/lib/languages.ts) localizes METADATA
// (titles, overviews). Interface copy has historically been English-only;
// this module gives every new UI surface a path to Finnish + Swedish without
// installing next-intl. Coverage starts with the highest-visibility shared
// labels; components consume strings via useUiStrings() and must never
// hardcode user-facing copy from this catalog.
//
// Usage:
//   const t = useUiStrings();
//   <h1>{t.statsTitle}</h1>

'use client';

import { useSyncExternalStore } from 'react';
import { getSettings } from '@/lib/settings';

export type UiLanguage = 'en' | 'fi' | 'sv';

export interface UiStrings {
  skipToContent: string;
  searchPlaceholder: string;
  home: string;
  liveSports: string;
  statistics: string;
  arcade: string;
  settings: string;
  signIn: string;
  signUp: string;
  signOut: string;
  myLists: string;
  continueWatching: string;
  myList: string;
  share: string;
  shareCopied: string;
  yourScore: string;
  markWatched: string;
  watched: string;
  note: string;
  discussion: string;
  comments: string;
  post: string;
  notifications: string;
  statsTitle: string;
  timeWatched: string;
  titlesOpened: string;
  currentStreak: string;
  avgRating: string;
  achievements: string;
  rewatchPicks: string;
  admin: string;
  surpriseMe: string;
}

const en: UiStrings = {
  skipToContent: 'Skip to content',
  searchPlaceholder: 'Search titles, people, pages…',
  home: 'Home',
  liveSports: 'Live sports',
  statistics: 'Watch statistics',
  arcade: 'Arcade',
  settings: 'Settings',
  signIn: 'Sign in',
  signUp: 'Sign up',
  signOut: 'Sign out',
  myLists: 'Your lists',
  continueWatching: 'Continue watching',
  myList: 'My List',
  share: 'Share',
  shareCopied: 'Link copied',
  yourScore: 'Your score',
  markWatched: 'Mark watched',
  watched: 'Watched',
  note: 'Note',
  discussion: 'Discussion',
  comments: 'comments',
  post: 'Post',
  notifications: 'Notifications',
  statsTitle: 'Your watch stats',
  timeWatched: 'Time watched',
  titlesOpened: 'Titles opened',
  currentStreak: 'Current streak',
  avgRating: 'Avg rating',
  achievements: 'Achievements',
  rewatchPicks: 'Rewatch picks',
  admin: 'Admin',
  surpriseMe: 'Surprise me',
};

const fi: UiStrings = {
  skipToContent: 'Siirry sisältöön',
  searchPlaceholder: 'Hae elokuvia, henkilöitä, sivuja…',
  home: 'Etusivu',
  liveSports: 'Urheilu suorana',
  statistics: 'Katselutilastot',
  arcade: 'Pelisali',
  settings: 'Asetukset',
  signIn: 'Kirjaudu',
  signUp: 'Luo tili',
  signOut: 'Kirjaudu ulos',
  myLists: 'Omat listat',
  continueWatching: 'Jatka katselua',
  myList: 'Oma lista',
  share: 'Jaa',
  shareCopied: 'Linkki kopioitu',
  yourScore: 'Arviosi',
  markWatched: 'Merkitse katsotuksi',
  watched: 'Katsottu',
  note: 'Muistiinpano',
  discussion: 'Keskustelu',
  comments: 'kommenttia',
  post: 'Lähetä',
  notifications: 'Ilmoitukset',
  statsTitle: 'Katselutilastosi',
  timeWatched: 'Katseltu aika',
  titlesOpened: 'Avatut nimikkeet',
  currentStreak: 'Nykyinen putki',
  avgRating: 'Keskiarvo',
  achievements: 'Saavutukset',
  rewatchPicks: 'Uudelleenkatsontaa',
  admin: 'Ylläpito',
  surpriseMe: 'Yllätä minut',
};

const sv: UiStrings = {
  skipToContent: 'Hoppa till innehållet',
  searchPlaceholder: 'Sök titlar, personer, sidor…',
  home: 'Hem',
  liveSports: 'Sport direktsändning',
  statistics: 'Tittarstatistik',
  arcade: 'Arkad',
  settings: 'Inställningar',
  signIn: 'Logga in',
  signUp: 'Skapa konto',
  signOut: 'Logga ut',
  myLists: 'Mina listor',
  continueWatching: 'Fortsätt titta',
  myList: 'Min lista',
  share: 'Dela',
  shareCopied: 'Länk kopierad',
  yourScore: 'Ditt betyg',
  markWatched: 'Markera som sedd',
  watched: 'Sedd',
  note: 'Anteckning',
  discussion: 'Diskussion',
  comments: 'kommentarer',
  post: 'Skicka',
  notifications: 'Notiser',
  statsTitle: 'Din tittarstatistik',
  timeWatched: 'Tittad tid',
  titlesOpened: 'Öppnade titlar',
  currentStreak: 'Aktuell svit',
  avgRating: 'Snittbetyg',
  achievements: 'Prestationer',
  rewatchPicks: 'Tittar igen',
  admin: 'Administration',
  surpriseMe: 'Överraska mig',
};

const CATALOGS: Record<UiLanguage, UiStrings> = { en, fi, sv };

/** Map a TMDB metadata language code ("fi-FI", "sv-SE", "en-US"…) to a UI catalog. */
export function uiLanguageOf(metadataLanguage: string): UiLanguage {
  const code = metadataLanguage.split('-')[0].toLowerCase();
  if (code === 'fi') return 'fi';
  if (code === 'sv') return 'sv';
  return 'en';
}

const listeners = new Set<() => void>();
let snapshotCache: UiStrings | null = null;
let snapshotLang: string | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): UiStrings {
  const lang = getSettings().language;
  if (snapshotCache === null || snapshotLang !== lang) {
    snapshotLang = lang;
    snapshotCache = CATALOGS[uiLanguageOf(lang)];
  }
  return snapshotCache;
}

/** Reactive UI strings — follows the metadata language selection (fi/sv/en). */
export function useUiStrings(): UiStrings {
  return useSyncExternalStore(subscribe, snapshot, () => CATALOGS.en);
}
