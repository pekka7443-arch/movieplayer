'use client';

import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Film, Play, Star, Tv } from 'lucide-react';
import { tmdbImg } from '@/lib/languages';
import { yearOf, type MediaType } from '@/lib/tmdb';

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
}

/**
 * Premium poster card: spring-back 3D tilt on pointer move (fine pointers
 * only), a shine sweep on hover, a scale-in center play button, and a
 * staggered rise-in entrance. All motion is transform/opacity only and
 * collapses to static under prefers-reduced-motion.
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
    rotateY.set(nx * 9);
    rotateX.set(-ny * 7);
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

  return (
    <motion.button
      type="button"
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: reduceMotion || priority ? 0 : Math.min(index * 0.035, 0.32),
      }}
      whileHover={reduceMotion ? undefined : { y: -6 }}
      whileTap={reduceMotion ? undefined : { scale: 0.97 }}
      style={{ rotateX: tiltX, rotateY: tiltY, transformPerspective: 750 }}
      onPointerMove={onPointerMove}
      onPointerLeave={resetTilt}
      disabled={!watchTarget}
      onClick={() => watchTarget && router.push(watchTarget, { scroll: false })}
      aria-label={`${item.title}${year ? ` (${year})` : ''} — open`}
      className="group relative block w-[130px] shrink-0 text-left focus-visible:outline-none disabled:cursor-not-allowed sm:w-[160px] md:w-[180px]"
    >
      <span className="relative block aspect-[2/3] w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 transition-all duration-300 group-hover:border-brand/40 group-hover:shadow-[0_14px_40px_-8px_color-mix(in_srgb,var(--cinedeck-accent)_30%,transparent)] group-focus-visible:border-brand/60 dark:border-zinc-800/80 dark:bg-zinc-900/60">
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
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.06]"
            />
          ) : (
            <Image
              src={poster}
              alt={`${item.title} poster`}
              fill
              sizes='(max-width: 640px) 130px, (max-width: 768px) 160px, 180px'
              priority={priority}
              className="object-cover transition-transform duration-300 group-hover:scale-[1.06]"
            />
          )
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-2 bg-zinc-200/40 dark:bg-zinc-900/40">
            {item.mediaType === 'tv' ? (
              <Tv className="size-8 text-zinc-400 dark:text-zinc-700" aria-hidden />
            ) : (
              <Film className="size-8 text-zinc-400 dark:text-zinc-700" aria-hidden />
            )}
            <span className="px-2 text-center text-[11px] leading-tight text-zinc-500 dark:text-zinc-600">
              {item.title}
            </span>
          </span>
        )}

        {/* Top-left media-type badge — small pill with the icon + label. */}
        <span className="absolute left-2 top-2 inline-flex h-5 items-center gap-1 rounded-md border border-transparent bg-zinc-950/70 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
          {item.mediaType === 'tv' ? (
            <Tv className="size-2.5" aria-hidden />
          ) : (
            <Film className="size-2.5" aria-hidden />
          )}
          {item.mediaType === 'tv' ? 'TV' : 'Movie'}
        </span>

        {/* Rating chip top-right — shown only when vote > 0. */}
        {item.voteAverage > 0 && (
          <span className="absolute right-2 top-2 inline-flex h-5 items-center gap-0.5 rounded-md bg-zinc-950/70 px-1.5 text-[10px] font-semibold text-amber-300 backdrop-blur-sm">
            <Star className="size-2.5 fill-amber-400 text-amber-400" aria-hidden />
            {item.voteAverage.toFixed(1)}
          </span>
        )}

        {/* Center play button — springs in on hover. */}
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 group-hover:opacity-100"
        >
          <span className="flex size-11 scale-50 items-center justify-center rounded-full bg-brand text-zinc-950 shadow-[0_0_28px_color-mix(in_srgb,var(--cinedeck-accent)_45%,transparent)] transition-transform duration-300 group-hover:scale-100">
            <Play className="size-5 translate-x-[1px] fill-zinc-950" aria-hidden />
          </span>
        </span>

        {/* Shine sweep on hover. */}
        <span aria-hidden className="cd-shine rounded-xl" />

        {/* Bottom gradient + title overlay so the title reads cleanly over
            busy poster artwork. */}
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent opacity-80 transition-opacity duration-300 group-hover:opacity-95" />
        <span className="absolute inset-x-0 bottom-0 p-2.5 md:p-3">
          <span className="block line-clamp-2 text-xs font-semibold text-white drop-shadow md:text-sm">
            {item.title}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-200">
            {year && <span>{year}</span>}
            {year && item.genre && (
              <span className="size-1 rounded-full bg-zinc-400" aria-hidden />
            )}
            {item.genre && <span className="truncate">{item.genre}</span>}
          </span>
        </span>
      </span>
    </motion.button>
  );
}

export function MediaCardSkeleton() {
  return (
    <div aria-hidden className="w-[130px] shrink-0 sm:w-[160px] md:w-[180px]">
      <div className="cd-shimmer aspect-[2/3] w-full animate-pulse rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800/80 dark:bg-zinc-900" />
    </div>
  );
}
