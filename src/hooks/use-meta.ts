'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  MetaDetails,
  MetaSearchItem,
  ScanResult,
  TvmazeEpisode,
  TvmazeShow,
} from '@/lib/meta';

// ---------------------------------------------------------------------------
// Keyless metadata hooks (Cinemeta proxy) + provider health scan
// ---------------------------------------------------------------------------

export class MetaError extends Error {
  readonly status: number;
  constructor(status: number, message?: string) {
    super(message ?? `meta_error_${status}`);
    this.name = 'MetaError';
    this.status = status;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new MetaError(res.status);
  return (await res.json()) as T;
}

export function useMetaSearch(query: string, enabled: boolean) {
  return useQuery<MetaSearchItem[], MetaError>({
    queryKey: ['meta', 'search', query.toLowerCase()],
    queryFn: async () => {
      const data = await getJson<{ results: MetaSearchItem[] }>(
        `/api/meta/search?q=${encodeURIComponent(query)}`,
      );
      return data.results;
    },
    enabled: enabled && query.trim().length >= 2,
    staleTime: 10 * 60 * 1000,
    retry: 0,
  });
}

export function useMetaDetails(imdbId: string | null, mediaType: 'movie' | 'tv', enabled: boolean) {
  return useQuery<MetaDetails, MetaError>({
    queryKey: ['meta', 'details', mediaType, imdbId],
    queryFn: async () => {
      const data = await getJson<{ details: MetaDetails }>(
        `/api/meta/details?imdb=${imdbId}&type=${mediaType}`,
      );
      return data.details;
    },
    enabled: enabled && imdbId !== null,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
}

export interface ScanParams {
  imdb?: string | null;
  tmdb?: number | null;
  mediaType: 'movie' | 'tv';
  season: number;
  episode: number;
}

export function useServerScan(params: ScanParams, enabled: boolean) {
  const { imdb, tmdb, mediaType, season, episode } = params;
  return useQuery<ScanResult[], MetaError>({
    queryKey: ['scan', mediaType, imdb ?? tmdb, season, episode],
    queryFn: async () => {
      const search = new URLSearchParams({
        type: mediaType,
        s: String(season),
        e: String(episode),
      });
      if (imdb) search.set('imdb', imdb);
      else if (tmdb) search.set('tmdb', String(tmdb));
      const data = await getJson<{ results: ScanResult[] }>(`/api/scan?${search.toString()}`);
      return data.results;
    },
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
}

// ---------------------------------------------------------------------------
// TVmaze — CineDeck's second keyless source (zero signup): show facts +
// full episode lists with real names for the keyless TV watch mode.
// ---------------------------------------------------------------------------

export interface TvmazeFull {
  show: TvmazeShow;
  episodes: TvmazeEpisode[];
}

export function useTvmazeShow(imdbId: string | null, enabled: boolean) {
  return useQuery<TvmazeFull, MetaError>({
    queryKey: ['meta', 'tvmaze', imdbId],
    queryFn: async () => {
      const data = await getJson<TvmazeFull>(`/api/meta/tvmaze?imdb=${imdbId}`);
      return data;
    },
    enabled: enabled && imdbId !== null,
    staleTime: 60 * 60 * 1000,
    retry: 0,
  });
}

// ---------------------------------------------------------------------------
// Cinemeta genre catalog — keyless "More like this" for the IMDB watch mode.
// ---------------------------------------------------------------------------

export function useMetaSimilar(
  mediaType: 'movie' | 'tv',
  imdbId: string | null,
  genre: string | null,
  enabled: boolean,
) {
  return useQuery<MetaSearchItem[], MetaError>({
    queryKey: ['meta', 'similar', mediaType, imdbId, genre],
    queryFn: async () => {
      const search = new URLSearchParams({ type: mediaType, imdb: imdbId ?? '' });
      if (genre) search.set('genre', genre);
      const data = await getJson<{ results: MetaSearchItem[] }>(
        `/api/meta/similar?${search.toString()}`,
      );
      return data.results;
    },
    enabled: enabled && imdbId !== null,
    staleTime: 30 * 60 * 1000,
    retry: 0,
  });
}
