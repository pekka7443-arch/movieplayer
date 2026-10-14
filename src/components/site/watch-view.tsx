'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BookmarkCheck, BookmarkPlus, ChevronLeft, ExternalLink, Globe, Play, Search, Share2, Star, Tv } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { MotionButton } from '@/components/ui/motion-button';
import { Skeleton } from '@/components/ui/skeleton';
import Image from 'next/image';
import { PlayerSection } from '@/components/site/player-section';
import { GuestPlayLock, usePlaybackLocked } from '@/components/site/sign-in-gate';
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
import { WatchRating } from '@/components/site/watch-rating';
import { CommentsSection } from '@/components/site/comments-section';
import { markEpisodeWatched } from '@/lib/library';
import { useCinedeckStore } from '@/lib/store';
import { useHasTmdbKey, useSettings } from '@/lib/settings';
import { tmdbImg } from '@/lib/languages';
import { BACKDROP_BLUR } from '@/lib/img-blur';
import { yearOf, type MediaDetails, type MediaType } from '@/lib/tmdb';
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
        imdbId: imdbId ?? null,
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
      imdbId: imdbId ?? null,
      season: mediaType === 'tv' ? season : null,
      episode: mediaType === 'tv' ? episode : null,
    });
    // History upsert is safe to re-fire (backend upserts by [tmdbId, mediaType]).
    // `saveHistory.mutate` is a stable callback and intentionally omitted.
  }, [tmdbId, mediaType, season, episode, settings.saveHistory, details?.title, hasKey, detailsQuery.isPending, isImdbMode]);

  // Auto-mark TV episodes watched (TMDB mode). Keyless IMDB mode has no
  // stable tmdbId, so those views stay ephemeral.
  useEffect(() => {
    if (isImdbMode || tmdbId === undefined || mediaType !== 'tv') return;
    void markEpisodeWatched(tmdbId, season, episode).catch(() => undefined);
  }, [isImdbMode, tmdbId, mediaType, season, episode]);

  const onShare = () => {
    const url = window.location.href;
    if (navigator.share) {
      void navigator.share({ title: watchTitle ? `${watchTitle} on CineDeck` : 'CineDeck', url }).catch(() => undefined);
    } else {
      void navigator.clipboard.writeText(url).then(
        () => toast.success('Link copied — share it anywhere'),
        () => toast.error('Could not copy the link'),
      );
    }
  };

  const playbackLocked = usePlaybackLocked();

  // Cinematic backdrop banner art — TMDB paths go through tmdbImg(); the
  // keyless Cinemeta adapter already resolves a full URL into backdropPath.
  const bannerArt = details?.backdropPath
    ? details.backdropPath.startsWith('http')
      ? details.backdropPath
      : tmdbImg(details.backdropPath, 'w1280')
    : details?.posterPath
      ? details.posterPath.startsWith('http')
        ? details.posterPath
        : tmdbImg(details.posterPath, 'w780')
      : null;
  const bannerYear = details?.releaseDate ? yearOf(details.releaseDate) : '';
  const scrollToPlayer = () => {
    document
      .getElementById('player-section')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div>
      {/* Cinematic title banner — large backdrop with gradient overlay,
          metadata row and the three primary actions (Play / My List / Share). */}
      <section
        aria-label={`${watchTitle || 'Title'} — details`}
        className="relative -mx-4 -mt-6 overflow-hidden sm:-mx-6 sm:-mt-8"
      >
        <div className="relative flex min-h-[340px] items-end md:min-h-[420px]">
          {detailsLoading ? (
            <Skeleton className="absolute inset-0 size-full rounded-none bg-muted" />
          ) : bannerArt ? (
            details?.backdropPath && !details.backdropPath.startsWith('http') ? (
              // TMDB mode: allowlisted host — full next/image optimization.
              <Image
                src={bannerArt}
                alt=""
                fill
                priority
                sizes="100vw"
                placeholder="blur"
                blurDataURL={BACKDROP_BLUR}
                className="object-cover"
              />
            ) : (
              // Keyless Cinemeta art — third-party host, plain eager img.
              <img
                src={bannerArt}
                alt=""
                loading="eager"
                fetchPriority="high"
                className="absolute inset-0 size-full object-cover"
              />
            )
          ) : (
            <div className="absolute inset-0 bg-muted" />
          )}
          {/* Gradient bed — burns the art into the canvas bottom-left */}
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-background via-background/55 to-background/10" />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-background/85 via-background/20 to-transparent" />

          <div className="relative z-10 w-full px-4 pb-8 pt-24 sm:px-6 sm:pb-10 lg:px-10">
            <div className="max-w-3xl">
              {detailsLoading ? (
                <Skeleton className="h-10 w-2/3 max-w-md rounded-lg bg-white/10" />
              ) : (
                <h1 className="text-3xl font-bold leading-tight tracking-tight text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.6)] sm:text-5xl">
                  {watchTitle || 'Loading title…'}
                </h1>
              )}
              {!detailsLoading && (
                <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm text-zinc-200">
                  {bannerYear && <span className="font-medium">{bannerYear}</span>}
                  {details && details.voteAverage > 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-white">
                      <Star className="size-3.5 fill-brand text-brand" aria-hidden />
                      {details.voteAverage.toFixed(1)}
                    </span>
                  )}
                  {details?.runtime ? <span>{details.runtime} min</span> : null}
                  {details?.genres.slice(0, 3).map((genre) => (
                    <span
                      key={genre}
                      className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <MotionButton
                  type="button"
                  onClick={scrollToPlayer}
                  className="h-11 rounded-lg bg-brand px-6 text-sm font-semibold text-white shadow-[0_8px_30px_-6px_rgba(229,9,20,0.55)] transition-colors duration-200 hover:bg-brand/90"
                >
                  <Play className="size-4 fill-white" aria-hidden />
                  Play
                </MotionButton>
                {tmdbId !== undefined && (
                  <MotionButton
                    type="button"
                    variant="outline"
                    onClick={onToggleSave}
                    disabled={toggleWatchlist.isPending}
                    aria-pressed={savedToList}
                    className="h-11 gap-1.5 rounded-lg border-white/25 bg-white/10 px-5 text-sm font-medium text-white backdrop-blur-md transition-colors duration-200 hover:border-white/40 hover:bg-white/20"
                  >
                    {savedToList ? (
                      <BookmarkCheck className="size-4" aria-hidden />
                    ) : (
                      <BookmarkPlus className="size-4" aria-hidden />
                    )}
                    {savedToList ? 'In My List' : 'My List'}
                  </MotionButton>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onShare}
                  aria-label="Share this title"
                  className="size-11 rounded-full border border-white/15 bg-black/30 text-zinc-200 backdrop-blur-md hover:bg-black/50 hover:text-white"
                >
                  <Share2 className="size-4.5" aria-hidden />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mb-5 mt-4 flex flex-wrap items-center gap-2">
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
      </div>

      {playbackLocked ? (
        <GuestPlayLock title={watchTitle || undefined} returnTo={typeof window !== 'undefined' ? window.location.href : undefined} />
      ) : (
        <div id="player-section" className="scroll-mt-24">
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
        </div>
      )}

      {tmdbId !== undefined && <WatchRating tmdbId={tmdbId} mediaType={mediaType} />}

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
                <Button asChild size="sm" variant="outline" className="h-auto max-w-full whitespace-normal border-sky-300/70 py-1.5 text-left text-xs font-medium text-sky-800 hover:bg-sky-100/70 dark:border-sky-700/60 dark:text-sky-200 dark:hover:bg-sky-900/40">
                  <a
                    href={`https://www.justwatch.com/us/search?q=${encodeURIComponent(watchTitle)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Globe className="size-3.5 shrink-0" aria-hidden />
                    <span>
                      JustWatch — every legal service
                      <ExternalLink className="ml-1 inline size-3 opacity-70" aria-hidden />
                    </span>
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline" className="h-auto max-w-full whitespace-normal border-sky-300/70 py-1.5 text-left text-xs font-medium text-sky-800 hover:bg-sky-100/70 dark:border-sky-700/60 dark:text-sky-200 dark:hover:bg-sky-900/40">
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(`${watchTitle} watch online stream`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Search className="size-3.5 shrink-0" aria-hidden />
                    <span>
                      Google
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
          <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
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

      {tmdbId !== undefined && <CommentsSection tmdbId={tmdbId} mediaType={mediaType} />}
    </div>
  );
}
