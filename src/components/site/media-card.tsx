'use client';

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Check, Film, Lock, Play, Plus, Star, Tv } from 'lucide-react';
import { toast } from 'sonner';
import { tmdbImg } from '@/lib/languages';
import { POSTER_BLUR } from '@/lib/img-blur';
import { yearOf, type MediaType } from '@/lib/tmdb';
import { fetchRatings, type RatingRow } from '@/lib/library';
import { usePlaybackLocked } from '@/components/site/sign-in-gate';
import { useWatchlist, useToggleWatchlist } from '@/hooks/use-media';
import { useQuery } from '@tanstack/react-query';

export interface MediaCardItem {
  /** TMDB ID — used to build the watch URL (?id=…&type=…). */
  id: number;
  /** IMDB ID — optional; when present, the watch URL falls back to
   * ?imdb=…&type=… (keyless Cinemeta-mode playback). */
  imdbId?: string;
  mediaType: MediaType;
  title: string;
  /** TMDB poster path (e.g. "/abc.jpg"). Mutually exclusive with `posterUrl`. */
  posterPath: string | null;
  /** Full poster URL (used by Cinemeta — points at images.metahub.space).
   * When present, takes precedence over `posterPath` + tmdbImg(). */
  posterUrl?: string | null;
  releaseDate: string;
  voteAverage: number;
  /** Optional genre label shown next to the year. Optional because not every
   * upstream source returns genres — we just hide it when missing. */
  genre?: string;
  /** Finnish-content badge (small FI flag chip, Section 9). */
  finnish?: boolean;
}

/**
 * Premium compact poster card.
 *
 * Consistent 2:3 poster, fixed responsive widths so 7–9 cards fill a desktop
 * row (118px phone → 156px desktop). Hover: 1.03 scale (180ms), an accent
 * hairline, a soft drop shadow and a bottom gradient carrying title, year,
 * rating and genre; the play affordance fades in dead center; quick-add sits
 * top-right. On touch the metadata gradient is always visible (no hover to
 * rely on). All motion is transform/opacity and collapses under
 * prefers-reduced-motion. Poster dimensions are fully reserved — no layout
 * shift while images stream in.
 */
export function MediaCard({
  item,
  priority = false,
  index = 0,
}: {
  item: MediaCardItem;
  priority?: boolean;
  /** Position within the row — drives the entrance stagger. */
  index?: number;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  // Guests see a subtle lock badge on the play affordance — the click still
  // navigates to the watch view, where the full "Sign in to watch" gate lives.
  const playbackLocked = usePlaybackLocked();
  const { data: watchlist } = useWatchlist();
  const toggleWatchlist = useToggleWatchlist();
  // Shared, deduped ratings fetch — one request across every card on the
  // page (React Query collapses identical queryKeys). Drives the tiny
  // watched/rated badges on the poster.
  const ratingsQuery = useQuery<RatingRow[]>({
    queryKey: ['ratings'],
    queryFn: fetchRatings,
    staleTime: 60 * 1000,
  });
  const ratingRow =
    item.id > 0
      ? ratingsQuery.data?.find(
          (r) => r.tmdbId === item.id && r.mediaType === item.mediaType,
        )
      : undefined;

  // Prefer posterUrl (full URL, used by Cinemeta). Fall back to TMDB path →
  // image.tmdb.org URL via tmdbImg().
  const poster = item.posterUrl ?? tmdbImg(item.posterPath, 'w500');
  const year = yearOf(item.releaseDate);

  // Build the watch URL — prefer TMDB id (more providers support it
  // natively), fall back to IMDB id for Cinemeta-only items.
  const watchTarget = item.id
    ? `/?id=${item.id}&type=${item.mediaType}`
    : item.imdbId
      ? `/?imdb=${item.imdbId}&type=${item.mediaType}`
      : null;

  const existingRow = watchlist?.find(
    (w) => w.tmdbId === item.id && w.mediaType === item.mediaType,
  );
  const inList = Boolean(existingRow);

  // Desktop hover drives the gradient overlay through AnimatePresence (mount
  // on hover → fade in, unmount → fade out). Framer hover gestures fire for
  // touch taps too, but the animated layer is md-only so touch never sees it.
  const [hovered, setHovered] = useState(false);
  const overlayTransition = { duration: reduceMotion ? 0 : 0.18 };

  const quickAdd = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!watchTarget) return;
    toggleWatchlist.mutate(
      {
        tmdbId: item.id,
        mediaType: item.mediaType,
        title: item.title,
        posterPath: item.posterPath,
        backdropPath: null,
        imdbId: item.imdbId ?? null,
        existingRowId: existingRow?.id,
      },
      {
        onSuccess: (res) =>
          toast.success(res.added ? 'Added to My List' : 'Removed from My List', {
            description: item.title,
          }),
        onError: () => toast.error('Could not update My List — try again.'),
      },
    );
  };

  return (
    <motion.button
      type="button"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.22,
        delay: reduceMotion || priority ? 0 : Math.min(index * 0.025, 0.2),
      }}
      whileHover={reduceMotion ? undefined : { scale: 1.03, zIndex: 10 }}
      whileTap={reduceMotion ? undefined : { scale: 0.98 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      disabled={!watchTarget}
      onClick={() => watchTarget && router.push(watchTarget, { scroll: false })}
      // No aria-label on purpose: the visible text (title + year + rating in
      // the overlay) IS the accessible name — a summary label would trigger
      // label-content-name-mismatch. The card opens the watch page.
      className="group relative block w-[118px] shrink-0 snap-start text-left focus-visible:outline-none disabled:cursor-not-allowed sm:w-[140px] md:w-[150px] lg:w-[156px]"
    >
      <span className="relative block aspect-[2/3] w-full overflow-hidden rounded-lg border border-border/80 bg-card shadow-sm transition-[border-color,box-shadow] duration-200 group-hover:border-brand/50 group-hover:shadow-[0_14px_36px_-12px_rgba(0,0,0,0.65)] group-focus-visible:border-brand/60">
        {poster ? (
          // TMDB posters (posterPath) run through next/image optimization;
          // third-party URLs (Cinemeta's Amazon CDN etc.) use a plain <img>
          // because their hosts can't be allowlisted in next.config.
          item.posterUrl ? (
            <img
              src={poster}
              alt={`${item.title} poster`}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              className="size-full object-cover"
            />
          ) : (
            <Image
              src={poster}
              alt={`${item.title} poster`}
              fill
              sizes='(max-width: 640px) 118px, (max-width: 768px) 140px, 156px'
              priority={priority}
              placeholder="blur"
              blurDataURL={POSTER_BLUR}
              className="object-cover"
            />
          )
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-2 bg-muted/40">
            {item.mediaType === 'tv' ? (
              <Tv className="size-7 text-muted-foreground/40" aria-hidden />
            ) : (
              <Film className="size-7 text-muted-foreground/40" aria-hidden />
            )}
            <span className="px-2 text-center text-[11px] leading-tight text-muted-foreground">
              {item.title}
            </span>
          </span>
        )}

        {/* Touch: static gradient — no hover to rely on. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg bg-gradient-to-t from-black/95 via-black/40 to-transparent md:hidden"
        />

        {/* Desktop: the hover overlay fades in/out through AnimatePresence. */}
        <AnimatePresence initial={false}>
          {hovered && (
            <motion.span
              key="hover-overlay"
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={overlayTransition}
              className="pointer-events-none absolute inset-0 z-[5] hidden rounded-lg bg-gradient-to-t from-black/95 via-black/40 to-transparent md:block"
            />
          )}
        </AnimatePresence>

        {/* Quick-add-to-list — top right, fades in with the overlay
            (always visible on touch where there is no hover). */}
        {watchTarget && (
          <span
            role="button"
            tabIndex={0}
            aria-label={
              inList ? `Remove ${item.title} from My List` : `Add ${item.title} to My List`
            }
            onClick={quickAdd}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') quickAdd(e);
            }}
            className={`absolute right-1.5 top-1.5 z-20 flex size-7 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/60 text-white backdrop-blur-md transition-[opacity,background-color,border-color] duration-150 hover:border-brand hover:bg-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 md:opacity-0 md:group-hover:opacity-100 ${
              inList ? 'text-emerald-400' : ''
            }`}
          >
            {inList ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
          </span>
        )}

        {/* Finnish-content badge — FI flag chip (blue field, white text). */}
        {item.finnish && (
          <span
            title="Finnish production"
            className="absolute left-1.5 top-1.5 z-10 inline-flex h-5 items-center rounded-md bg-[#002f6c]/90 px-1.5 text-[9px] font-bold tracking-wider text-white ring-1 ring-white/25"
          >
            FI
          </span>
        )}

        {/* Center play button — quick Play action on hover. Guests get a lock. */}
        <span
          aria-hidden
          className="absolute inset-0 z-10 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        >
          <span className="relative flex size-10 items-center justify-center rounded-full bg-brand text-white shadow-[0_6px_24px_-6px_rgba(0,0,0,0.7)]">
            <Play className="size-4.5 translate-x-[1px] fill-white" aria-hidden />
            {playbackLocked && (
              <span className="absolute -right-1.5 -top-1.5 flex size-4.5 items-center justify-center rounded-full bg-zinc-950 text-amber-300 ring-1 ring-white/25">
                <Lock className="size-2.5" aria-hidden />
              </span>
            )}
          </span>
        </span>

        {/* Watched / rated badges — bottom-right, subtle. */}
        {(ratingRow?.watched || ratingRow?.score != null) && (
          <span className="absolute bottom-1.5 right-1.5 z-10 flex items-center gap-1">
            {ratingRow?.watched && (
              <span
                aria-label="Watched"
                title="Watched"
                className="flex size-4.5 items-center justify-center rounded-full bg-emerald-500 text-white shadow"
              >
                <Check className="size-2.5" aria-hidden />
              </span>
            )}
            {ratingRow?.score != null && (
              <span
                title={`You rated this ${ratingRow.score}/10`}
                className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold text-white shadow"
              >
                {ratingRow.score}
              </span>
            )}
          </span>
        )}

        {/* Bottom gradient + metadata — title, year, rating, genre. */}
        <span className="absolute inset-x-0 bottom-0 p-2">
          <span className="block line-clamp-2 text-[13px] font-semibold leading-snug text-white sm:text-sm">
            {item.title}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-300">
            {year && <span>{year}</span>}
            {item.voteAverage > 0 && (
              <>
                {(year || item.genre) && (
                  <span className="size-1 rounded-full bg-zinc-500" aria-hidden />
                )}
                <span className="inline-flex items-center gap-0.5 font-semibold text-amber-400">
                  <Star className="size-3 fill-amber-400" aria-hidden />
                  {item.voteAverage.toFixed(1)}
                </span>
              </>
            )}
            {item.genre && (
              <span className="min-w-0 truncate text-zinc-400">{item.genre}</span>
            )}
          </span>
        </span>
      </span>
    </motion.button>
  );
}

export function MediaCardSkeleton() {
  return (
    <div aria-hidden className="w-[118px] shrink-0 sm:w-[140px] md:w-[150px] lg:w-[156px]">
      <div className="animate-shimmer aspect-[2/3] w-full rounded-lg border border-border/60 bg-muted" />
    </div>
  );
}
