'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PlayerSection } from '@/components/site/player-section';
import { InfoSection } from '@/components/site/info-section';
import { SimilarRow } from '@/components/site/similar-row';
import { MetaInfo } from '@/components/site/meta-info';
import { useMediaDetails, useSaveHistory } from '@/hooks/use-media';
import { useMetaDetails } from '@/hooks/use-meta';
import { useCinedeckStore } from '@/lib/store';
import { useHasTmdbKey, useSettings } from '@/lib/settings';
import type { MediaDetails, MediaType } from '@/lib/tmdb';
import type { MetaDetails } from '@/lib/meta';

/** Map keyless Cinemeta details onto the MediaDetails shape PlayerSection expects. */
function metaToMediaDetails(meta: MetaDetails, mediaType: MediaType): MediaDetails {
  return {
    id: 0,
    mediaType,
    title: meta.title,
    tagline: '',
    overview: meta.overview,
    posterPath: meta.poster,
    backdropPath: meta.backdrop,
    voteAverage: meta.voteAverage,
    runtime: meta.runtime,
    releaseDate: meta.year ? `${meta.year}-01-01` : '',
    genres: meta.genres,
    cast: meta.cast.map((name, index) => ({ id: index, name, character: '', profilePath: null })),
    director: meta.director,
    trailerKey: meta.trailerKey,
    similar: [],
    providers: [],
  };
}

export function WatchView({
  tmdbId,
  imdbId,
  mediaType,
  season,
  episode,
}: {
  /** TMDB watch mode (library mode) — omit when using imdbId. */
  tmdbId?: number;
  /** IMDB watch mode (keyless) — omit when using tmdbId. */
  imdbId?: string;
  mediaType: MediaType;
  season: number;
  episode: number;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const language = useCinedeckStore((s) => s.language);
  const resetServer = useCinedeckStore((s) => s.resetServer);
  const hasKey = useHasTmdbKey();
  const settings = useSettings();

  const isImdbMode = Boolean(imdbId) && tmdbId === undefined;

  const detailsQuery = useMediaDetails(tmdbId ?? null, mediaType, language, hasKey && !isImdbMode);
  const metaQuery = useMetaDetails(isImdbMode ? (imdbId ?? null) : null, mediaType, isImdbMode);

  const details = isImdbMode
    ? metaQuery.data
      ? metaToMediaDetails(metaQuery.data, mediaType)
      : undefined
    : detailsQuery.data;
  const detailsLoading = isImdbMode ? metaQuery.isPending : detailsQuery.isPending;
  const saveHistory = useSaveHistory();

  // Switching titles resets the server to the user's preferred one.
  useEffect(() => {
    resetServer();
  }, [tmdbId, imdbId, mediaType, resetServer]);

  // Upsert into watch history (TMDB mode only — IMDB mode is ephemeral).
  useEffect(() => {
    if (isImdbMode || tmdbId === undefined) return;
    if (!settings.saveHistory) return;
    if (hasKey && detailsQuery.isPending) return;
    saveHistory.mutate({
      tmdbId,
      mediaType,
      title: details?.title ?? `TMDB #${tmdbId}`,
      posterPath: details?.posterPath ?? null,
      backdropPath: details?.backdropPath ?? null,
      season: mediaType === 'tv' ? season : null,
      episode: mediaType === 'tv' ? episode : null,
    });
    // History upsert is safe to re-fire (backend upserts by [tmdbId, mediaType]).
    // `saveHistory.mutate` is a stable callback and intentionally omitted.
  }, [tmdbId, mediaType, season, episode, settings.saveHistory, details?.title, hasKey, detailsQuery.isPending, isImdbMode]);

  return (
    <motion.div
      initial={reduceMotion ? undefined : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => router.push('/', { scroll: false })}
        className="mb-5 h-9 gap-1.5 rounded-lg px-2.5 text-sm text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back to browse
      </Button>

      <PlayerSection
        tmdbId={tmdbId}
        imdbId={imdbId}
        mediaType={mediaType}
        season={season}
        episode={episode}
        details={details}
        detailsLoading={detailsLoading}
        hasKey={hasKey}
      />

      {isImdbMode ? (
        metaQuery.data ? (
          <MetaInfo details={metaQuery.data} />
        ) : metaQuery.isError ? (
          <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-600">
            Details are unavailable right now — the player above should still work.
          </p>
        ) : null
      ) : (
        tmdbId !== undefined && (
          <>
            <InfoSection
              tmdbId={tmdbId}
              mediaType={mediaType}
              details={details}
              detailsLoading={detailsLoading}
            />

            {hasKey && (
              <SimilarRow
                similar={details?.similar}
                mediaType={mediaType}
                loading={detailsLoading}
              />
            )}
          </>
        )
      )}
    </motion.div>
  );
}
