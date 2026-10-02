'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BookmarkCheck, BookmarkPlus, ChevronLeft, ExternalLink, Tv } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PlayerSection } from '@/components/site/player-section';
import { InfoSection } from '@/components/site/info-section';
import { SimilarRow, MetaSimilarRow } from '@/components/site/similar-row';
import { MetaInfo } from '@/components/site/meta-info';
import {
  useMediaDetails,
  useSaveHistory,
  useToggleWatchlist,
  useWatchlist,
} from '@/hooks/use-media';
import { useMetaDetails, useMetaSimilar, useTvmazeShow } from '@/hooks/use-meta';
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
    // Cinemeta gives production countries ("Finland, Belgium, …") instead of a
    // language code — normalize Finland → "fi" so the Areena banner logic is
    // uniform across both metadata modes.
    originalLanguage: meta.country?.toLowerCase().includes('finland') ? 'fi' : null,
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

  const language = useCinedeckStore((s) => s.language);
  const resetServer = useCinedeckStore((s) => s.resetServer);
  const hasKey = useHasTmdbKey();
  const settings = useSettings();

  const isImdbMode = Boolean(imdbId) && tmdbId === undefined;

  const detailsQuery = useMediaDetails(tmdbId ?? null, mediaType, language, hasKey && !isImdbMode);
  const metaQuery = useMetaDetails(isImdbMode ? (imdbId ?? null) : null, mediaType, isImdbMode);

  // Second keyless source (TVmaze): show facts + episode names for IMDB-mode TV.
  const tvmazeQuery = useTvmazeShow(
    isImdbMode && mediaType === 'tv' ? (imdbId ?? null) : null,
    isImdbMode && mediaType === 'tv',
  );
  // Keyless "More like this" via Cinemeta's genre catalog (IMDB mode only).
  const metaSimilarQuery = useMetaSimilar(
    mediaType,
    isImdbMode ? (imdbId ?? null) : null,
    metaQuery.data?.genres[0] ?? null,
    isImdbMode && Boolean(metaQuery.data),
  );

  const details = isImdbMode
    ? metaQuery.data
      ? metaToMediaDetails(metaQuery.data, mediaType)
      : undefined
    : detailsQuery.data;
  const detailsLoading = isImdbMode ? metaQuery.isPending : detailsQuery.isPending;
  const saveHistory = useSaveHistory();

  // Finnish titles: embed servers (2Embed/VidSrc) almost never carry Finnish
  // films or Finnish audio — surface YLE Areena (free, legal, in Finland)
  // as the honest way to actually watch them.
  const isFinnishTitle =
    details?.originalLanguage === 'fi' ||
    Boolean(metaQuery.data?.country?.toLowerCase().includes('finland'));
  const watchTitle = details?.title ?? (isImdbMode ? (metaQuery.data?.title ?? '') : '');

  // My List toggle (TMDB-mode titles only — keyless IMDB mode has no tmdbId).
  const watchlistQuery = useWatchlist();
  const toggleWatchlist = useToggleWatchlist();
  const existingRowId =
    tmdbId !== undefined
      ? (watchlistQuery.data ?? []).find(
          (row) => row.tmdbId === tmdbId && row.mediaType === mediaType,
        )?.id
      : undefined;
  const savedToList = Boolean(existingRowId);

  const onToggleSave = () => {
    if (tmdbId === undefined) return;
    toggleWatchlist.mutate(
      {
        tmdbId,
        mediaType,
        title: details?.title ?? `TMDB #${tmdbId}`,
        posterPath: details?.posterPath ?? null,
        backdropPath: details?.backdropPath ?? null,
        existingRowId,
      },
      {
        onSuccess: ({ added }) =>
          toast.success(added ? 'Saved to My List' : 'Removed from My List'),
        onError: () => toast.error('Could not update My List'),
      },
    );
  };

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
    <div>
      {/* Local accent bloom behind the player — draws the eye to the action. */}
      <div
        aria-hidden
        className="pointer-events-none relative -mt-2 mb-1"
      >
        <div className="absolute -top-6 left-1/2 h-40 w-[82%] max-w-3xl -translate-x-1/2 rounded-full bg-brand/15 blur-[90px]" />
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push('/', { scroll: false })}
          className="h-9 gap-1.5 rounded-lg px-2.5 text-sm text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Back to browse
        </Button>

        {tmdbId !== undefined && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onToggleSave}
            disabled={toggleWatchlist.isPending}
            aria-pressed={savedToList}
            className={`h-9 gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
              savedToList
                ? 'border-brand/50 bg-brand/10 text-brand hover:bg-brand/20'
                : 'border-zinc-200 bg-transparent text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
            }`}
          >
            {savedToList ? (
              <BookmarkCheck className="size-4" aria-hidden />
            ) : (
              <BookmarkPlus className="size-4" aria-hidden />
            )}
            {savedToList ? 'In My List' : 'My List'}
          </Button>
        )}
      </div>

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

      {isFinnishTitle && (
        <section
          aria-label="Finnish content — YLE Areena suggestion"
          className="mt-4 rounded-2xl border border-sky-300/60 bg-sky-50/80 p-4 backdrop-blur-sm sm:p-5 dark:border-sky-700/50 dark:bg-sky-950/25"
        >
          <div className="flex flex-wrap items-start gap-3">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400"
            >
              <Tv className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-200">
                Finnish production — watch it on YLE Areena (free)
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-sky-900/80 dark:text-sky-200/80">
                Embed servers like 2Embed and VidSrc rarely carry Finnish films or Finnish
                audio, so playback here may come up empty. YLE Areena streams nearly every
                Finnish movie and series for free — search for it with the Finnish title.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm" className="h-auto max-w-full whitespace-normal py-1.5 text-left text-xs font-semibold">
                  <a
                    href={`https://areena.yle.fi/haku?q=${encodeURIComponent(watchTitle)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gap-1.5 bg-sky-600 text-white hover:bg-sky-500"
                  >
                    <Tv className="size-3.5 shrink-0" aria-hidden />
                    <span>
                      Search “{watchTitle}” on YLE Areena
                      <ExternalLink className="ml-1 inline size-3 opacity-70" aria-hidden />
                    </span>
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      {isImdbMode ? (
        metaQuery.data ? (
          <MetaInfo
            details={metaQuery.data}
            tvmaze={tvmazeQuery.data?.show ?? null}
            episodeCount={tvmazeQuery.data?.episodes.length}
          />
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

      {isImdbMode && (
        <MetaSimilarRow items={metaSimilarQuery.data} loading={metaSimilarQuery.isPending} />
      )}
    </div>
  );
}
