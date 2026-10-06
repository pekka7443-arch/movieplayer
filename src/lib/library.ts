// Client-side library API — ratings, custom lists, episode marks, comments,
// notifications, library import/export. All endpoints same-origin.

import { fetchHistory, fetchWatchlist } from '@/lib/tmdb';
import type { MediaType, WatchlistItem } from '@/lib/tmdb';
import { getActiveProfileId } from '@/lib/profile';

export type { MediaType };
export type { HistoryItem, WatchlistItem } from '@/lib/tmdb';
export { fetchHistory, fetchWatchlist };

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string } | string;
      message?: string;
    };
    const rawCode = typeof payload.error === 'string' ? payload.error : payload.error?.code;
    const rawMsg = typeof payload.error === 'object' ? payload.error?.message : undefined;
    throw new LibraryError(
      rawCode ?? `http_${res.status}`,
      rawMsg ?? payload.message ?? 'Request failed',
      res.status,
    );
  }
  return (await res.json()) as T;
}

export class LibraryError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'LibraryError';
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Ratings (score / note / watched)
// ---------------------------------------------------------------------------

export interface RatingRow {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  score: number | null;
  note: string | null;
  watched: boolean;
  updatedAt: string;
}

export const fetchRatings = (): Promise<RatingRow[]> => {
  const profileId = getActiveProfileId();
  const suffix = profileId && profileId !== 'main' ? `&profileId=${encodeURIComponent(profileId)}` : '';
  return getJson<{ items: RatingRow[] }>(`/api/ratings?${suffix}`.replace(/\?$/, '')).then((d) => d.items ?? []);
};

export interface RatingUpsert {
  tmdbId: number;
  mediaType: MediaType;
  score?: number | null;
  note?: string | null;
  watched?: boolean;
}

export const saveRating = (input: RatingUpsert): Promise<RatingRow> =>
  getJson<{ item: RatingRow }>('/api/ratings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, profileId: getActiveProfileId() }),
  }).then((d) => d.item);

// ---------------------------------------------------------------------------
// Episode marks
// ---------------------------------------------------------------------------

export const fetchWatchedEpisodes = (tmdbId: number, season: number): Promise<{ s: number; e: number }[]> =>
  getJson<{ watched: { s: number; e: number }[] }>(
    `/api/episode-watch?tmdbId=${tmdbId}&season=${season}`,
  ).then((d) => d.watched ?? []);

export const markEpisodeWatched = (tmdbId: number, season: number, episode: number): Promise<void> =>
  getJson<{ ok: boolean }>('/api/episode-watch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tmdbId, season, episode }),
  }).then(() => undefined);

// ---------------------------------------------------------------------------
// Custom lists
// ---------------------------------------------------------------------------

export interface ListSummary {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  shareToken: string;
  position: number;
  itemCount: number;
  updatedAt: string;
}

export interface ListMemberRow {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  position: number;
  addedAt: string;
}

export const fetchLists = (): Promise<ListSummary[]> =>
  getJson<{ lists: ListSummary[] }>('/api/lists').then((d) => d.lists ?? []);

export const createList = (name: string, isPublic = false): Promise<ListSummary> =>
  getJson<{ list: ListSummary }>('/api/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, isPublic }),
  }).then((d) => d.list);

export const fetchListItems = (listId: string): Promise<{ list: { name: string; isPublic: boolean }; items: ListMemberRow[] }> =>
  getJson(`/api/lists/${listId}`);

export const addToList = (
  listId: string,
  item: { tmdbId: number; mediaType: MediaType; title: string; posterPath: string | null },
): Promise<void> =>
  getJson(`/api/lists/${listId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  }).then(() => undefined);

export const removeFromList = (listId: string, tmdbId: number, mediaType: MediaType): Promise<void> =>
  getJson(`/api/lists/${listId}?tmdbId=${tmdbId}&mediaType=${mediaType}`, { method: 'DELETE' }).then(
    () => undefined,
  );

export const reorderList = (listId: string, order: string[]): Promise<void> =>
  getJson(`/api/lists/${listId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  }).then(() => undefined);

export const deleteList = (listId: string): Promise<void> =>
  getJson(`/api/lists?id=${listId}`, { method: 'DELETE' }).then(() => undefined);

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export interface CommentRow {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  score: number;
  reactions: { kind: string; count: number; mine: boolean }[];
  mine: boolean;
}

export const fetchComments = (tmdbId: number, mediaType: MediaType): Promise<CommentRow[]> =>
  getJson<{ items: CommentRow[] }>(`/api/comments?tmdbId=${tmdbId}&mediaType=${mediaType}`).then(
    (d) => d.items ?? [],
  );

export const postComment = (tmdbId: number, mediaType: MediaType, body: string): Promise<CommentRow> =>
  getJson<{ item: CommentRow }>('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tmdbId, mediaType, body }),
  }).then((d) => d.item);

export const mutateComment = (input: Record<string, unknown>): Promise<{ ok: boolean }> =>
  getJson('/api/comments', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  text: string;
  tmdbId: number | null;
  mediaType: MediaType | null;
  season: number | null;
  episode: number | null;
  read: boolean;
  createdAt: string;
}

export const fetchNotifications = (): Promise<{ items: NotificationRow[]; unread: number }> =>
  getJson('/api/notifications');

export const markNotificationsRead = (all = true, id?: string): Promise<void> =>
  getJson('/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(all ? { all: true } : { id }),
  }).then(() => undefined);

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export interface ProfileRow {
  id: string;
  name: string;
  avatar: string | null;
  isKids: boolean;
  /** Per-profile preferred content language (null = use the device setting). */
  language: string | null;
  position: number;
}

export const fetchProfiles = (): Promise<ProfileRow[]> =>
  getJson<{ profiles: ProfileRow[] }>('/api/profiles').then((d) => d.profiles ?? []);

/** Save the content language on one profile (per-profile language feature). */
export const updateProfileLanguage = (id: string, language: string | null): Promise<void> =>
  getJson('/api/profiles', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, language }),
  }).then(() => undefined);

export const createProfile = (name: string, isKids = false): Promise<ProfileRow> =>
  getJson<{ profile: ProfileRow }>('/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, isKids }),
  }).then((d) => d.profile);

export const deleteProfile = (id: string): Promise<void> =>
  getJson(`/api/profiles?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => undefined);

// ---------------------------------------------------------------------------
// Import / export (JSON + CSV, incl. Letterboxd CSV)
// ---------------------------------------------------------------------------

export interface LibraryExport {
  exportedAt: string;
  watchlist: { tmdbId: number; mediaType: MediaType; title: string; posterPath: string | null }[];
  history: { tmdbId: number; mediaType: MediaType; title: string; season: number | null; episode: number | null; positionSeconds: number }[];
  ratings: RatingRow[];
  lists: { name: string; items: { tmdbId: number; mediaType: MediaType; title: string }[] }[];
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function watchlistToCsv(items: WatchlistItem[]): string {
  const header = 'Title,Type,TmdbId,AddedAt';
  const rows = items.map((i) =>
    [csvEscape(i.title), i.mediaType, String(i.tmdbId), csvEscape(i.addedAt)].join(','),
  );
  return [header, ...rows].join('\n');
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportLibraryJson(): Promise<void> {
  const [watchlist, history, ratings, lists] = await Promise.all([
    fetchWatchlist(),
    fetchHistory(1000),
    fetchRatings(),
    fetchLists(),
  ]);
  const listsWithItems = await Promise.all(
    lists.map(async (list) => {
      const items = await fetchListItems(list.id).catch(() => ({ items: [] as ListMemberRow[] }));
      return {
        name: list.name,
        items: items.items.map((i) => ({ tmdbId: i.tmdbId, mediaType: i.mediaType, title: i.title })),
      };
    }),
  );
  const payload: LibraryExport = {
    exportedAt: new Date().toISOString(),
    watchlist: watchlist.map((i) => ({
      tmdbId: i.tmdbId,
      mediaType: i.mediaType,
      title: i.title,
      posterPath: i.posterPath,
    })),
    history: history.map((h) => ({
      tmdbId: h.tmdbId,
      mediaType: h.mediaType,
      title: h.title,
      season: h.season,
      episode: h.episode,
      positionSeconds: h.positionSeconds,
    })),
    ratings,
    lists: listsWithItems,
  };
  download(`cinedeck-library-${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

export async function exportWatchlistCsv(watchlist: WatchlistItem[]): Promise<void> {
  download(`cinedeck-watchlist-${Date.now()}.csv`, watchlistToCsv(watchlist), 'text/csv');
}

/** Parse a Letterboxd "diary"/"ratings"/"watchlist" CSV → titles to import. */
export function parseLetterboxdCsv(csv: string): { title: string; year?: string }[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const nameIdx = header.findIndex((h) => /^name$/i.test(h));
  const yearIdx = header.findIndex((h) => /^year$/i.test(h));
  if (nameIdx === -1) return [];
  const out: { title: string; year?: string }[] = [];
  for (const line of lines.slice(1)) {
    // Naive CSV row split respecting simple quotes.
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    const title = (cells[nameIdx] ?? '').trim().replace(/^"|"$/g, '');
    if (!title) continue;
    const year = yearIdx >= 0 ? (cells[yearIdx] ?? '').trim().replace(/^"|"$/g, '') : undefined;
    out.push({ title, year: year && /^\d{4}$/.test(year) ? year : undefined });
  }
  return out;
}

/** Import titles by searching them one-by-one and adding the best match. */
export async function importTitles(
  titles: { title: string; year?: string }[],
  onProgress?: (done: number, total: number, title: string, ok: boolean) => void,
): Promise<number> {
  let imported = 0;
  for (let i = 0; i < titles.length; i += 1) {
    const entry = titles[i];
    try {
      const data = await getJson<{ results: MetaSearchItemLike[] }>(
        `/api/meta/search?q=${encodeURIComponent(entry.title)}`,
      );
      const results = data.results ?? [];
      const match =
        results.find((r) => entry.year && r.year.startsWith(entry.year)) ?? results[0];
      if (match?.tmdbId) {
        await getJson('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tmdbId: match.tmdbId,
            mediaType: match.mediaType,
            title: match.title,
            posterPath: match.poster,
            backdropPath: null,
            imdbId: match.imdbId ?? null,
          }),
        });
        imported += 1;
      }
      onProgress?.(i + 1, titles.length, entry.title, Boolean(match?.tmdbId));
    } catch {
      onProgress?.(i + 1, titles.length, entry.title, false);
    }
  }
  return imported;
}

interface MetaSearchItemLike {
  imdbId: string;
  title: string;
  year: string;
  poster: string | null;
  mediaType: MediaType;
  tmdbId?: number;
}

// ---------------------------------------------------------------------------
// Achievements feed (server-computed, same shapes as the stats view)
// ---------------------------------------------------------------------------

export const fetchAchievements = (): Promise<{ achievements: { key: string; title: string; earned: boolean; progress: number; goal: number }[] }> =>
  getJson('/api/achievements');
