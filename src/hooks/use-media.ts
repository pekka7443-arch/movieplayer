'use client';

import { useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  addToWatchlist,
  ApiError,
  clearHistory,
  clearWatchlist,
  fetchCatalogMeta,
  fetchDetails,
  fetchHistory,
  fetchPopular,
  fetchPopularMeta,
  fetchSeason,
  fetchTrending,
  fetchWatchlist,
  removeHistory,
  removeWatchlist,
  saveHistory,
  searchTmdb,
  type HistoryItem,
  type MediaType,
  type MediaDetails,
  type SearchItem,
  type SeasonInfo,
  type WatchlistItem,
} from '@/lib/tmdb';
import type { MetaSearchItem } from '@/lib/meta';
import { useHasTmdbKey } from '@/lib/settings';

// ---------------------------------------------------------------------------
// TMDB (library mode)
// ---------------------------------------------------------------------------

export function useTrending(
  language: string,
  enabled: boolean,
  initialData?: MetaSearchItem[],
) {
  const hasKey = useHasTmdbKey();
  return useQuery<SearchItem[] | MetaSearchItem[], ApiError>({
    // When a TMDB key is present, query TMDB trending; otherwise fall back to
    // Cinemeta's popular-mixed catalog so the home view shows real content
    // even when the user hasn't added a key. The query key includes `hasKey`
    // so refetch triggers when the key state changes (Settings → save key).
    queryKey: ['tmdb', 'trending', language, hasKey ? 'key' : 'keyless'],
    queryFn: () => (hasKey ? fetchTrending(language) : fetchPopularMeta('all')),
    enabled,
    // Server-streamed hero data (page.tsx) paints the LCP image immediately;
    // it is marked stale-on-arrival so the client still refreshes in background.
    ...(initialData && initialData.length > 0 ? { initialData, initialDataUpdatedAt: 0 } : {}),
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.code === 'tmdb_key') return false;
      return failureCount < 2;
    },
  });
}

/** All-time popular movies (separate from this-week trending). */
export function usePopularMovies(language: string, enabled: boolean) {
  const hasKey = useHasTmdbKey();
  return useQuery<SearchItem[] | MetaSearchItem[], ApiError>({
    queryKey: ['popular', 'movie', language, hasKey ? 'key' : 'keyless'],
    queryFn: () => (hasKey ? fetchPopular('movie', language) : fetchPopularMeta('movie')),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.code === 'tmdb_key') return false;
      return failureCount < 2;
    },
  });
}

/** All-time popular TV shows (separate from this-week trending). */
export function usePopularTV(language: string, enabled: boolean) {
  const hasKey = useHasTmdbKey();
  return useQuery<SearchItem[] | MetaSearchItem[], ApiError>({
    queryKey: ['popular', 'tv', language, hasKey ? 'key' : 'keyless'],
    queryFn: () => (hasKey ? fetchPopular('tv', language) : fetchPopularMeta('tv')),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.code === 'tmdb_key') return false;
      return failureCount < 2;
    },
  });
}

export interface CatalogParams {
  type: 'movie' | 'tv';
  sort?: 'top' | 'imdbRating';
  genre?: string | null;
  year?: number | null;
  /** Advanced filters — fully supported with a TMDB key; keyless applies
   * minRating as a server-side post-filter and ignores the rest honestly. */
  minRating?: number | null;
  decade?: number | null;
  maxRuntime?: number | null;
  language?: string | null;
  country?: string | null;
}

/** Keyless Cinemeta catalog row — Top Rated, New This Year, genre explorer. */
export function useCatalog(params: CatalogParams, enabled: boolean) {
  return useQuery<MetaSearchItem[], ApiError>({
    queryKey: [
      'catalog',
      params.type,
      params.sort ?? 'top',
      params.genre ?? '',
      params.year ?? '',
      params.minRating ?? '',
      params.decade ?? '',
      params.maxRuntime ?? '',
      params.language ?? '',
      params.country ?? '',
    ],
    queryFn: () => fetchCatalogMeta(params),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

// ---------------------------------------------------------------------------
// Genre / anime catalog rows (home page)
// ---------------------------------------------------------------------------

/**
 * TMDB genre-id → English genre-name map. Drives the KEYLESS fallback of the
 * genre rows: Cinemeta catalogs are genre-name filtered, so numeric TMDB
 * genre ids from the row specs must be mapped to matchable names.
 */
export const GENRE_ID_TO_NAME: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  14: 'Fantasy',
  27: 'Horror',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10765: 'Science Fiction',
  53: 'Thriller',
  10752: 'War',
  10768: 'War',
  37: 'Western',
  10751: 'Family',
  10402: 'Music',
  // TV-only TMDB ids that share a name with their movie cousins:
  10759: 'Action',
};

/** Row-item union both catalog backends normalize into. */
export type GenreRowItem = SearchItem | MetaSearchItem;

export interface GenreRowState {
  data: GenreRowItem[];
  isPending: boolean;
  isError: boolean;
}

function fetchGenreCatalog(
  mediaType: 'movie' | 'tv',
  extraParams: Record<string, string> | undefined,
  limit: number,
): Promise<MetaSearchItem[]> {
  const search = new URLSearchParams({ mediaType, limit: String(limit) });
  for (const [key, value] of Object.entries(extraParams ?? {})) search.set(key, value);
  return fetch(`/api/catalog?${search.toString()}`).then(async (res) => {
    if (!res.ok) throw new Error(`catalog_${res.status}`);
    const data = (await res.json()) as { results?: MetaSearchItem[] };
    return data.results ?? [];
  });
}

/**
 * One home-page catalog row driven by TMDB genre ids + raw discover filters.
 *
 *  - TMDB key present: hits /api/catalog (server-side raw discover, allowlisted
 *    params only) — up to `limit` (default 40) items.
 *  - Keyless: falls back to the existing useCatalog Cinemeta row filtered by
 *    the first mapped genre name server-side, then post-filtered client-side
 *    so items matching ANY of the mapped genre names survive. Extra discover
 *    filters the keyless upstream can't express are honestly ignored.
 */
export function useGenreRow(
  genreIds: number[],
  mediaType: 'movie' | 'tv',
  extraParams?: Record<string, string>,
  limit = 40,
): GenreRowState {
  const hasKey = useHasTmdbKey();
  const genreNames = useMemo(
    () =>
      [...new Set(genreIds.map((id) => GENRE_ID_TO_NAME[id]).filter((n): n is string => Boolean(n)))],
    [genreIds],
  );

  const keyed = useQuery<MetaSearchItem[], ApiError>({
    queryKey: ['catalog', 'genre-row', mediaType, genreIds.join(','), extraParams ?? {}, limit],
    queryFn: () => fetchGenreCatalog(mediaType, extraParams, limit),
    enabled: hasKey,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Keyless fallback — genre filter param = first mapped genre name (Cinemeta
  // catalogs are single-genre), then keep every item whose genre string
  // contains any of the mapped names.
  const keyless = useCatalog(
    { type: mediaType, genre: genreNames[0] ?? null },
    !hasKey,
  );

  const data = useMemo<GenreRowItem[]>(() => {
    if (hasKey) return keyed.data ?? [];
    const base = keyless.data ?? [];
    if (genreNames.length === 0) return base.slice(0, limit);
    const wanted = genreNames.map((n) => n.toLowerCase());
    return base
      .filter(
        (item) =>
          !item.genre || wanted.some((name) => item.genre!.toLowerCase().includes(name)),
      )
      .slice(0, limit);
  }, [hasKey, keyed.data, keyless.data, genreNames, limit]);

  return {
    data,
    isPending: hasKey ? keyed.isPending : keyless.isPending,
    isError: hasKey ? keyed.isError : keyless.isError,
  };
}

/** Anime series — TMDB animation genre + Japanese origin, most popular first. */
export function useAnimeSeries(): GenreRowState {
  return useGenreRow([16], 'tv', {
    with_genres: '16',
    with_origin_country: 'JP',
    sort_by: 'popularity.desc',
  });
}

/** Anime films — same filters, movie side, capped at 20 items. */
export function useAnimeMovies(): GenreRowState {
  return useGenreRow(
    [16],
    'movie',
    {
      with_genres: '16',
      with_origin_country: 'JP',
      sort_by: 'popularity.desc',
    },
    20,
  );
}

export function useSearch(query: string, language: string, enabled: boolean) {
  return useQuery<SearchItem[], ApiError>({
    queryKey: ['tmdb', 'search', query, language],
    queryFn: () => searchTmdb(query, language),
    enabled: enabled && query.trim().length >= 2,
    staleTime: 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.code === 'tmdb_key') return false;
      return failureCount < 1;
    },
  });
}

export function useMediaDetails(
  id: number | null,
  mediaType: MediaType,
  language: string,
  enabled: boolean
) {
  return useQuery<MediaDetails, ApiError>({
    queryKey: ['tmdb', 'details', mediaType, id, language],
    queryFn: () => fetchDetails(id as number, mediaType, language),
    enabled: enabled && id !== null && id > 0,
    staleTime: 10 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.code === 'tmdb_key') return false;
      return failureCount < 2;
    },
  });
}

export function useSeason(
  id: number | null,
  seasonNumber: number,
  language: string,
  enabled: boolean
) {
  return useQuery<SeasonInfo, ApiError>({
    queryKey: ['tmdb', 'season', id, seasonNumber, language],
    queryFn: () => fetchSeason(id as number, seasonNumber, language),
    enabled: enabled && id !== null && id > 0 && seasonNumber >= 1,
    staleTime: 10 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.code === 'tmdb_key') return false;
      return failureCount < 2;
    },
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export function useHistory() {
  return useQuery<HistoryItem[], ApiError>({
    queryKey: ['history'],
    queryFn: () => fetchHistory(),
    staleTime: 30 * 1000,
    retry: 1,
  });
}

export interface SaveHistoryInput {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  season?: number | null;
  episode?: number | null;
  imdbId?: string | null;
  positionSeconds?: number;
  durationSeconds?: number | null;
}

export function useSaveHistory(): UseMutationResult<HistoryItem, ApiError, SaveHistoryInput> {
  const queryClient = useQueryClient();
  return useMutation<HistoryItem, ApiError, SaveHistoryInput>({
    mutationFn: saveHistory,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export function useRemoveHistory(): UseMutationResult<void, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: removeHistory,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export function useClearHistory(): UseMutationResult<void, ApiError, void> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: clearHistory,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export function useWatchlist() {
  return useQuery<WatchlistItem[], ApiError>({
    queryKey: ['watchlist'],
    queryFn: fetchWatchlist,
    staleTime: 30 * 1000,
    retry: 1,
  });
}

export interface WatchlistToggleInput {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  imdbId?: string | null;
  existingRowId?: string;
}

export function useToggleWatchlist(): UseMutationResult<
  { added: boolean },
  ApiError,
  WatchlistToggleInput
> {
  const queryClient = useQueryClient();
  return useMutation<{ added: boolean }, ApiError, WatchlistToggleInput>({
    mutationFn: async (input) => {
      if (input.existingRowId) {
        await removeWatchlist(input.existingRowId);
        return { added: false };
      }
      await addToWatchlist({
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        title: input.title,
        posterPath: input.posterPath,
        backdropPath: input.backdropPath,
        imdbId: input.imdbId ?? null,
      });
      return { added: true };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });
}

export function useRemoveWatchlist(): UseMutationResult<void, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: removeWatchlist,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });
}

export function useClearWatchlist(): UseMutationResult<void, ApiError, void> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: clearWatchlist,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });
}
