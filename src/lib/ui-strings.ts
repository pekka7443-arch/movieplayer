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
  search: string;
  surpriseMe: string;
  profile: string;
  movies: string;
  tvShows: string;
  finnish: string;
  moreInfo: string;
  seeAll: string;
  trendingNow: string;
  newReleases: string;
  topRatedMovies: string;
  popularTv: string;
  popularMovies: string;
  finnishContent: string;
  becauseYouWatched: string;
  topPicks: string;
  sportsHighlights: string;
  emptyListTitle: string;
  emptyListBody: string;
  emptyListAction: string;
  emptyHistoryTitle: string;
  emptyHistoryBody: string;
  browseAll: string;
  streamingServices: string;
  servicesSubtitle: string;
  watchOnServices: string;
  openService: string;
  freeLabel: string;
  paidLabel: string;
  filterAll: string;
  filterFreeOnly: string;
  servicesDisclaimer: string;
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
  search: 'Search',
  surpriseMe: 'Surprise me',
  profile: 'Profile',
  movies: 'Movies',
  tvShows: 'TV Shows',
  finnish: 'Finnish',
  moreInfo: 'More Info',
  seeAll: 'See all',
  trendingNow: 'Trending Now',
  newReleases: 'New Releases',
  topRatedMovies: 'Top Rated Movies',
  popularTv: 'Popular TV Shows',
  popularMovies: 'Popular Movies',
  finnishContent: 'Finnish Content',
  becauseYouWatched: 'Because you watched',
  topPicks: 'Top picks for you',
  sportsHighlights: 'Sports Highlights',
  emptyListTitle: 'Your list is empty',
  emptyListBody: 'Hover any poster and hit + to save it here — your queue for movie night.',
  emptyListAction: 'Browse trending',
  emptyHistoryTitle: 'Nothing watched yet',
  emptyHistoryBody: 'Press play on anything — we remember where you left off.',
  browseAll: 'Browse all',
  streamingServices: 'Streaming services',
  servicesSubtitle: 'Where the big leagues stream in Finland — subscribe or sign in and watch in the service\u2019s own app.',
  watchOnServices: 'Watch on streaming services',
  openService: 'Open',
  freeLabel: 'Free',
  paidLabel: 'Subscription',
  filterAll: 'All',
  filterFreeOnly: 'Free only',
  servicesDisclaimer: 'Curated for Finland · 2025\u201326 season. Rights move around — confirm the exact game in the service.',
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
  search: 'Haku',
  surpriseMe: 'Yllätä minut',
  profile: 'Profiili',
  movies: 'Elokuvat',
  tvShows: 'Sarjat',
  finnish: 'Suomalainen',
  moreInfo: 'Lisätietoja',
  seeAll: 'Näytä kaikki',
  trendingNow: 'Suosittua nyt',
  newReleases: 'Uudet julkaisut',
  topRatedMovies: 'Arvostetuimmat elokuvat',
  popularTv: 'Suositut sarjat',
  popularMovies: 'Suositut elokuvat',
  finnishContent: 'Suomalainen sisältö',
  becauseYouWatched: 'Koska katsoit',
  topPicks: 'Suosituksia sinulle',
  sportsHighlights: 'Urheilukorostukset',
  emptyListTitle: 'Listasi on tyhjä',
  emptyListBody: 'Pidä hiiri julisteen päällä ja paina + tallentaaksesi sen tänne — elokuvaillasi jono.',
  emptyListAction: 'Selaa suosittuja',
  emptyHistoryTitle: 'Ei vielä katsottua',
  emptyHistoryBody: 'Paina play — muistamme mihin jäit.',
  browseAll: 'Selaa kaikkea',
  streamingServices: 'Suoratoistopalvelut',
  servicesSubtitle: 'Missä suuret sarjat näkyvät Suomessa — tilaa tai kirjaudu ja katso palvelun omassa sovelluksessa.',
  watchOnServices: 'Katso suoratoistopalveluissa',
  openService: 'Avaa',
  freeLabel: 'Ilmainen',
  paidLabel: 'Tilaus',
  filterAll: 'Kaikki',
  filterFreeOnly: 'Vain ilmaiset',
  servicesDisclaimer: 'Koottu Suomen näkyvyyksistä · kausi 2025–26. Oikeudet vaihtuvat — varmista tarkka ottelu palvelusta.',
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
  search: 'Sök',
  surpriseMe: 'Överraska mig',
  profile: 'Profil',
  movies: 'Filmer',
  tvShows: 'TV-serier',
  finnish: 'Finsk',
  moreInfo: 'Mer info',
  seeAll: 'Visa alla',
  trendingNow: 'Populärt nu',
  newReleases: 'Nya releaser',
  topRatedMovies: 'Toppbetyg filmer',
  popularTv: 'Populära serier',
  popularMovies: 'Populära filmer',
  finnishContent: 'Finskt innehåll',
  becauseYouWatched: 'Eftersom du såg',
  topPicks: 'Toppplock åt dig',
  sportsHighlights: 'Sporthöjdpunkter',
  emptyListTitle: 'Din lista är tom',
  emptyListBody: 'Hovra en affisch och tryck + för att spara den här — din kvällskö.',
  emptyListAction: 'Bläddra populärt',
  emptyHistoryTitle: 'Inget sett ännu',
  emptyHistoryBody: 'Tryck play — vi minns var du slutade.',
  browseAll: 'Bläddra allt',
  streamingServices: 'Streamingtjänster',
  servicesSubtitle: 'Var de stora serierna syns i Finland — prenumerera eller logga in och titta i tjänstens app.',
  watchOnServices: 'Se på streamingtjänster',
  openService: 'Öppna',
  freeLabel: 'Gratis',
  paidLabel: 'Prenumeration',
  filterAll: 'Alla',
  filterFreeOnly: 'Endast gratis',
  servicesDisclaimer: 'Kurerat för Finland · säsong 2025–26. Rättigheter ändras — bekräfta matchen i tjänsten.',
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
