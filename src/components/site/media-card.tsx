'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Film, Star, Tv } from 'lucide-react';
import { tmdbImg } from '@/lib/languages';
import { yearOf, type MediaType } from '@/lib/tmdb';

export interface MediaCardItem {
  id: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseDate: string;
  voteAverage: number;
}

export function MediaCard({ item, priority = false }: { item: MediaCardItem; priority?: boolean }) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const poster = tmdbImg(item.posterPath, 'w500');
  const year = yearOf(item.releaseDate);

  return (
    <motion.button
      type="button"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      whileHover={reduceMotion ? undefined : { y: -4 }}
      onClick={() => router.push(`/?id=${item.id}&type=${item.mediaType}`, { scroll: false })}
      aria-label={`${item.title}${year ? ` (${year})` : ''} — open`}
      className="group block w-full text-left focus-visible:outline-none"
    >
      <span className="relative block aspect-[2/3] w-full overflow-hidden rounded-xl border border-zinc-200 bg-white/70 transition-all duration-200 group-hover:border-amber-400/50 group-hover:shadow-[0_8px_30px_rgba(251,191,36,0.08)] group-focus-visible:border-amber-400/50 dark:border-zinc-800/80 dark:bg-zinc-900/60">
        {poster ? (
          <img
            src={poster}
            alt={`${item.title} poster`}
            loading={priority ? 'eager' : 'lazy'}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-2 text-zinc-400 dark:text-zinc-700">
            {item.mediaType === 'tv' ? (
              <Tv className="size-8" aria-hidden />
            ) : (
              <Film className="size-8" aria-hidden />
            )}
            <span className="px-3 text-center text-[11px] leading-tight text-zinc-500 dark:text-zinc-600">
              {item.title}
            </span>
          </span>
        )}
        {item.mediaType === 'tv' && (
          <span className="absolute left-2 top-2 rounded bg-zinc-950/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300 backdrop-blur">
            TV
          </span>
        )}
        {item.voteAverage > 0 && (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-zinc-950/80 px-1.5 py-0.5 text-[11px] font-medium text-amber-300 backdrop-blur">
            <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden />
            {item.voteAverage.toFixed(1)}
          </span>
        )}
      </span>
      <span className="mt-2 block">
        <span className="block truncate text-sm font-medium text-zinc-800 transition-colors group-hover:text-amber-600 dark:text-zinc-200 dark:group-hover:text-amber-300">
          {item.title}
        </span>
        {year && <span className="mt-0.5 block text-xs text-zinc-500">{year}</span>}
      </span>
    </motion.button>
  );
}

export function MediaCardSkeleton() {
  return (
    <div aria-hidden className="w-full">
      <div className="aspect-[2/3] w-full rounded-xl border border-zinc-200 bg-white/70 dark:border-zinc-800/80 dark:bg-zinc-900/60" />
      <div className="mt-2 h-4 w-3/4 rounded bg-zinc-200 dark:bg-zinc-900" />
      <div className="mt-1.5 h-3 w-1/3 rounded bg-zinc-200/80 dark:bg-zinc-900/80" />
    </div>
  );
}
