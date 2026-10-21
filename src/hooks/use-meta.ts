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
  /** 2-letter dub code (e.g. "fi") — probed + ranked dub-first. null = original. */
  dub?: string | null;
}

export function useServerScan(params: ScanParams, enabled: boolean) {
  const { imdb, tmdb, mediaType, season, episode, dub } = params;
  return useQuery<ScanResult[], MetaError>({
    // Both ids are part of the key — the scan probes both id forms and the
    // player may load whichever one actually answered.
    queryKey: ['scan', mediaType, imdb ?? null, tmdb ?? null, season, episode, dub ?? 'orig'],
    queryFn: async () => {
      const search = new URLSearchParams({
        type: mediaType,
        s: String(season),
        e: String(episode),
      });
      // Send BOTH ids when known — rare titles (Finnish films etc.) are often
      // indexed under only one id form per provider.
      if (imdb) search.set('imdb', imdb);
      if (tmdb) search.set('tmdb', String(tmdb));
      if (dub) search.set('dub', dub);
      const data = await getJson<{ results: ScanResult[] }>(`/api/scan?${search.toString()}`);
      return data.results;
    },
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    // Retry once — a transient blip should not render an all-dead scan that
    // (a) opens the Where-to-watch panel and (b) feeds the failover logic
    // garbage for a full minute.
    retry: 1,
    // Keep health data FRESH DURING PLAYBACK. This is what powers mid-play
    // death detection: cross-origin embed iframes give no signal when their
    // stream dies mid-movie, so the frozen-health scan is the only way to
    // notice the active provider went down and auto-switch sources. 45s hits
    // the server's 60s probe cache ~every other tick, so the upstream cost
    // stays low. Pauses automatically when the tab is hidden.
    refetchInterval: 45 * 1000,
    refetchIntervalInBackground: false,
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

// ---------------------------------------------------------------------------
// Finnish catalog — "Suomalaiset elokuvat & sarjat" home row. Works fully
// keyless (curated catalog via Cinemeta); with a TMDB key the backend uses
// TMDB discover instead. Items carry IMDB ids (+ TMDB ids when known) so the
// player can scan both id forms.
// ---------------------------------------------------------------------------

export function useFinnishCatalog(mediaType: 'movie' | 'tv', enabled: boolean) {
  return useQuery<MetaSearchItem[], MetaError>({
    queryKey: ['meta', 'finnish', mediaType],
    queryFn: async () => {
      const data = await getJson<{ results: MetaSearchItem[] }>(
        `/api/meta/finnish?type=${mediaType}`,
      );
      return data.results;
    },
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}
