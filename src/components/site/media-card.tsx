'use client';

import { useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
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
 * Premium poster card, streaming-grade hover state.
 *
 * Poster fills the card edge-to-edge. On hover (desktop) the card scales to
 * 1.05 and a gradient overlay fades in carrying the title, year, rating and
 * a quick-add-to-list affordance top-right; a play button springs in dead
 * center. On touch devices the overlay is always visible (no hover to rely
 * on). Quick-add writes straight to My List with toast feedback. All motion
 * is transform/opacity and collapses under prefers-reduced-motion.
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

  // 3D tilt motion values (springs return the card to flat on leave).
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const tiltX = useSpring(rotateX, { stiffness: 280, damping: 24, mass: 0.5 });
  const tiltY = useSpring(rotateY, { stiffness: 280, damping: 24, mass: 0.5 });

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (reduceMotion || e.pointerType !== 'mouse') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    rotateY.set(nx * 7);
    rotateX.set(-ny * 5);
  };

  const resetTilt = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

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
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: reduceMotion || priority ? 0 : Math.min(index * 0.035, 0.32),
      }}
      whileHover={reduceMotion ? undefined : { scale: 1.05, zIndex: 10 }}
      whileTap={reduceMotion ? undefined : { scale: 0.97 }}
      style={{ rotateX: tiltX, rotateY: tiltY, transformPerspective: 750 }}
      onPointerMove={onPointerMove}
      onPointerLeave={resetTilt}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      disabled={!watchTarget}
      onClick={() => watchTarget && router.push(watchTarget, { scroll: false })}
      // No aria-label on purpose: the visible text (title + year + rating in
      // the overlay) IS the accessible name — a summary label would trigger
      // label-content-name-mismatch. The card opens the watch page.
      className="group relative block w-[130px] shrink-0 snap-start rounded-lg text-left focus-visible:outline-none disabled:cursor-not-allowed sm:w-[160px] md:w-[180px]"
    >
      <span className="relative block aspect-[2/3] w-full overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all duration-300 group-hover:border-brand/50 group-hover:shadow-[0_16px_40px_-10px_rgba(0,0,0,0.55)] group-focus-visible:border-brand/60">
        {/* Poster rides in a zoom-on-hover frame — the parent card's hover
            gesture propagates down as the "hover" variant. */}
        <motion.span
          variants={{ hover: { scale: 1.06 } }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' }}
          className="block size-full overflow-hidden rounded-lg"
        >
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
              sizes='(max-width: 640px) 130px, (max-width: 768px) 160px, 180px'
              priority={priority}
              placeholder="blur"
              blurDataURL={POSTER_BLUR}
              className="object-cover"
            />
          )
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-2 bg-muted/40">
            {item.mediaType === 'tv' ? (
              <Tv className="size-8 text-muted-foreground/40" aria-hidden />
            ) : (
              <Film className="size-8 text-muted-foreground/40" aria-hidden />
            )}
            <span className="px-2 text-center text-[11px] leading-tight text-muted-foreground">
              {item.title}
            </span>
          </span>
        )}
        </motion.span>

        {/* Touch: static gradient — no hover to rely on. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg bg-gradient-to-t from-black/95 via-black/45 to-transparent md:hidden"
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
              className="pointer-events-none absolute inset-0 z-[5] hidden rounded-lg bg-gradient-to-t from-black/95 via-black/45 to-transparent md:block"
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
            className={`absolute right-1.5 top-1.5 z-20 flex size-7 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-black/55 text-white opacity-100 backdrop-blur-md transition-all duration-200 hover:scale-110 hover:bg-brand hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 md:opacity-0 md:group-hover:opacity-100 ${
              inList ? 'text-emerald-400 md:text-emerald-400' : ''
            }`}
          >
            {inList ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
          </span>
        )}

        {/* Finnish-content badge — FI flag chip (blue field, white text). */}
        {item.finnish && (
          <span
            title="Finnish production"
            className="absolute left-1.5 top-1.5 z-10 inline-flex h-5 items-center rounded-md bg-[#002f6c]/90 px-1.5 text-[9px] font-bold tracking-wider text-white ring-1 ring-white/25 backdrop-blur-sm"
          >
            FI
          </span>
        )}

        {/* Center play button — springs in on hover. Guests get a lock. */}
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        >
          <span className="relative flex size-11 scale-50 items-center justify-center rounded-full bg-brand text-white shadow-[0_0_28px_rgba(229,9,20,0.5)] transition-transform duration-300 group-hover:scale-100">
            <Play className="size-5 translate-x-[1px] fill-white" aria-hidden />
            {playbackLocked && (
              <span className="absolute -right-1.5 -top-1.5 flex size-4.5 items-center justify-center rounded-full bg-zinc-950 text-amber-300 ring-1 ring-white/25">
                <Lock className="size-2.5" aria-hidden />
              </span>
            )}
          </span>
        </span>

        {/* Watched / rated badges — bottom-left, spring in when they appear. */}
        {(ratingRow?.watched || ratingRow?.score != null) && (
          <span className="absolute bottom-1.5 right-1.5 z-10 flex items-center gap-1">
            {ratingRow?.watched && (
              <motion.span
                aria-label="Watched"
                title="Watched"
                initial={reduceMotion ? { opacity: 0 } : { scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 400, damping: 20 }
                }
                className="flex size-4.5 items-center justify-center rounded-full bg-emerald-500 text-white shadow"
              >
                <Check className="size-2.5" aria-hidden />
              </motion.span>
            )}
            {ratingRow?.score != null && (
              <motion.span
                title={`You rated this ${ratingRow.score}/10`}
                initial={reduceMotion ? { opacity: 0 } : { scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 400, damping: 20 }
                }
                className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold text-white shadow"
              >
                {ratingRow.score}
              </motion.span>
            )}
          </span>
        )}

        {/* Shine sweep on hover. */}
        <span aria-hidden className="cd-shine rounded-lg" />

        {/* Bottom gradient + title overlay — everything lives here, no text
            below the card. */}
        <span className="absolute inset-x-0 bottom-0 p-2.5 md:p-3">
          <span className="block line-clamp-2 text-sm font-semibold leading-snug text-white drop-shadow md:text-lg">
            {item.title}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-xs text-zinc-300">
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
    <div aria-hidden className="w-[130px] shrink-0 sm:w-[160px] md:w-[180px]">
      <div className="animate-shimmer aspect-[2/3] w-full rounded-lg border border-border bg-muted" />
    </div>
  );
}
