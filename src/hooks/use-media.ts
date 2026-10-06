'use client';

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
