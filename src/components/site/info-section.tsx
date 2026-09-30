'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Bookmark,
  BookmarkCheck,
  Calendar,
  Clock,
  Film,
  Link2,
  Loader2,
  Play,
  Star,
  User,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConnectCard } from '@/components/site/connect-card';
import { TrailerDialog } from '@/components/site/trailer-dialog';
import { useToggleWatchlist, useWatchlist } from '@/hooks/use-media';
import { tmdbImg } from '@/lib/languages';
import { useHasTmdbKey } from '@/lib/settings';
import {
  formatRuntime,
  type MediaDetails,
  type MediaType,
} from '@/lib/tmdb';

function CastAvatar({ name, character, profilePath }: { name: string; character: string; profilePath: string | null }) {
  const profile = tmdbImg(profilePath, 'w185');
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <figure className="w-24 shrink-0 snap-start text-center">
      <div className="relative mx-auto size-24 overflow-hidden rounded-full border border-zinc-800 bg-zinc-900">
        {profile ? (
          <img src={profile} alt={name} loading="lazy" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-lg font-semibold text-zinc-600">
            {initials || '?'}
          </span>
        )}
      </div>
      <figcaption className="mt-2 px-1">
        <span className="block truncate text-xs font-medium text-zinc-200">{name}</span>
        <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{character}</span>
      </figcaption>
    </figure>
  );
}

export function InfoSection({
  tmdbId,
  mediaType,
  details,
  detailsLoading,
}: {
  tmdbId: number;
  mediaType: MediaType;
  details: MediaDetails | undefined;
  detailsLoading: boolean;
}) {
  const hasKey = useHasTmdbKey();
  const [trailerOpen, setTrailerOpen] = useState(false);

  const watchlistQuery = useWatchlist();
  const toggleWatchlist = useToggleWatchlist();

  const inList = (watchlistQuery.data ?? []).find(
    (item) => item.tmdbId === tmdbId && item.mediaType === mediaType
  );
  const inListPending =
    watchlistQuery.isPending || (toggleWatchlist.isPending && inList !== undefined);

  const toggle = () => {
    toggleWatchlist.mutate(
      {
        tmdbId,
        mediaType,
        title: details?.title ?? `TMDB #${tmdbId}`,
        posterPath: details?.posterPath ?? null,
        backdropPath: details?.backdropPath ?? null,
        existingRowId: inList?.id,
      },
      {
        onSuccess: (result) => {
          toast.success(result.added ? 'Added to My List' : 'Removed from My List');
        },
        onError: () => {
          toast.error('Could not update My List');
        },
      }
    );
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  // ---- No-key mode -------------------------------------------------------
  if (!hasKey) {
    return (
      <div className="mt-8 grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="flex aspect-[2/3] w-full max-w-56 flex-col items-center justify-center gap-3 rounded-xl border border-zinc-800/60 bg-zinc-900/60 lg:max-w-none">
          <Film className="size-10 text-zinc-700" aria-hidden />
          <span className="font-mono text-lg text-zinc-600">#{tmdbId}</span>
          <span className="text-[11px] uppercase tracking-widest text-zinc-700">
            {mediaType === 'tv' ? 'TV Show' : 'Movie'}
          </span>
        </div>
        <div className="min-w-0">
          <ConnectCard />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggle}
              disabled={inListPending}
              className="h-9 gap-1.5 rounded-lg border-zinc-800 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
            >
              {inListPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : inList ? (
                <BookmarkCheck className="size-3.5 text-amber-400" aria-hidden />
              ) : (
                <Bookmark className="size-3.5" aria-hidden />
              )}
              {inList ? 'In My List' : 'My List'}
            </Button>
            <a
              href={`https://www.themoviedb.org/${mediaType}/${tmdbId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-800 bg-transparent px-3 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100"
            >
              TMDB ↗
            </a>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyLink}
              className="h-9 gap-1.5 rounded-lg border-zinc-800 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
            >
              <Link2 className="size-3.5" aria-hidden />
              Copy link
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Library mode ------------------------------------------------------
  if (detailsLoading && !details) {
    return (
      <div className="mt-8 grid gap-6 lg:grid-cols-[280px_1fr]">
        <Skeleton className="aspect-[2/3] w-full max-w-56 rounded-xl bg-zinc-900 lg:max-w-none" />
        <div className="min-w-0 space-y-3">
          <Skeleton className="h-5 w-64 rounded bg-zinc-900" />
          <Skeleton className="h-4 w-full rounded bg-zinc-900" />
          <Skeleton className="h-4 w-5/6 rounded bg-zinc-900" />
          <Skeleton className="h-4 w-2/3 rounded bg-zinc-900" />
          <div className="flex gap-3 pt-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="size-24 rounded-full bg-zinc-900" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="mt-8 flex items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-10 text-sm text-zinc-500">
        Metadata is unavailable for this title right now.
      </div>
    );
  }

  const poster = tmdbImg(details.posterPath, 'w500');

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* Poster */}
      <div className="w-full max-w-56 lg:max-w-none">
        <div className="aspect-[2/3] w-full overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-900/60">
          {poster ? (
            <img
              src={poster}
              alt={`${details.title} poster`}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-3">
              <Film className="size-10 text-zinc-700" aria-hidden />
              <span className="font-mono text-lg text-zinc-600">#{tmdbId}</span>
            </div>
          )}
        </div>
      </div>

      {/* Info column */}
      <div className="min-w-0">
        {details.tagline && (
          <p className="mb-2 text-sm italic text-amber-400/90">“{details.tagline}”</p>
        )}
        {details.overview ? (
          <p className="text-sm leading-relaxed text-zinc-400">{details.overview}</p>
        ) : (
          <p className="text-sm italic text-zinc-600">No overview available in this language.</p>
        )}

        {/* Meta grid */}
        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
          {details.director && (
            <div>
              <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                <User className="size-3" aria-hidden />
                Director
              </dt>
              <dd className="mt-1 text-sm text-zinc-200">{details.director}</dd>
            </div>
          )}
          {details.releaseDate && (
            <div>
              <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                <Calendar className="size-3" aria-hidden />
                Release
              </dt>
              <dd className="mt-1 text-sm text-zinc-200">{details.releaseDate}</dd>
            </div>
          )}
          {details.runtime ? (
            <div>
              <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                <Clock className="size-3" aria-hidden />
                Runtime
              </dt>
              <dd className="mt-1 text-sm text-zinc-200">{formatRuntime(details.runtime)}</dd>
            </div>
          ) : null}
          {details.genres.length > 0 && (
            <div className="sm:col-span-3">
              <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                <Star className="size-3" aria-hidden />
                Genres
              </dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {details.genres.map((genre) => (
                  <Badge
                    key={genre}
                    variant="outline"
                    className="border-zinc-700 bg-transparent text-zinc-400"
                  >
                    {genre}
                  </Badge>
                ))}
              </dd>
            </div>
          )}
        </dl>

        {/* Actions */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggle}
            disabled={inListPending}
            className="h-9 gap-1.5 rounded-lg border-zinc-800 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            {inListPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : inList ? (
              <BookmarkCheck className="size-3.5 text-amber-400" aria-hidden />
            ) : (
              <Bookmark className="size-3.5" aria-hidden />
            )}
            {inList ? 'In My List' : 'My List'}
          </Button>

          {details.trailerKey && (
            <Button
              type="button"
              size="sm"
              onClick={() => setTrailerOpen(true)}
              className="h-9 gap-1.5 rounded-lg bg-amber-400 px-4 text-xs font-semibold text-zinc-950 hover:bg-amber-300"
            >
              <Play className="size-3.5 fill-zinc-950" aria-hidden />
              Trailer
            </Button>
          )}

          <a
            href={`https://www.themoviedb.org/${mediaType}/${tmdbId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-800 bg-transparent px-3 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            TMDB ↗
          </a>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyLink}
            className="h-9 gap-1.5 rounded-lg border-zinc-800 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            <Link2 className="size-3.5" aria-hidden />
            Copy link
          </Button>
        </div>

        {/* Cast */}
        {details.cast.length > 0 && (
          <div className="mt-7">
            <h3 className="mb-3 text-sm font-semibold text-zinc-200">Cast</h3>
            <div className="flex snap-x gap-4 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {details.cast.map((member) => (
                <CastAvatar
                  key={member.id}
                  name={member.name}
                  character={member.character}
                  profilePath={member.profilePath}
                />
              ))}
            </div>
          </div>
        )}

        {/* Providers */}
        {details.providers.length > 0 && (
          <div className="mt-7">
            <h3 className="mb-3 text-sm font-semibold text-zinc-200">Streaming on</h3>
            <div className="flex flex-wrap items-center gap-2.5">
              {details.providers.map((provider) => {
                const logo = tmdbImg(provider.logoPath, 'w92');
                return (
                  <span
                    key={provider.name}
                    title={provider.name}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 py-1.5 pl-1.5 pr-3"
                  >
                    <span className="size-7 overflow-hidden rounded-md bg-zinc-800">
                      {logo && (
                        <img
                          src={logo}
                          alt={`${provider.name} logo`}
                          loading="lazy"
                          className="size-full object-contain"
                        />
                      )}
                    </span>
                    <span className="text-xs text-zinc-300">{provider.name}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <TrailerDialog
        trailerKey={details.trailerKey}
        title={details.title}
        open={trailerOpen}
        onOpenChange={setTrailerOpen}
      />
    </div>
  );
}
