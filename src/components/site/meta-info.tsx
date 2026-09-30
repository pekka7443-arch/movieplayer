'use client';

import { motion } from 'framer-motion';
import { Clapperboard, Star, Users } from 'lucide-react';
import type { MetaDetails } from '@/lib/meta';

/**
 * Compact keyless info block for the IMDB watch mode (no TMDB key needed).
 * Mirrors the visual language of InfoSection without TMDB-only extras.
 */
export function MetaInfo({ details }: { details: MetaDetails }) {
  const hasOverview = details.overview.trim().length > 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      aria-label="About this title"
      className="mt-10 space-y-5"
    >
      <div className="rounded-xl border border-zinc-200 bg-white/70 p-5 sm:p-6 dark:border-zinc-800/60 dark:bg-zinc-900/60">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          <Clapperboard className="size-4.5 text-amber-500 dark:text-amber-400" aria-hidden />
          About {details.title}
          {details.year && <span className="text-sm font-normal text-zinc-500">{details.year}</span>}
        </h2>

        {details.voteAverage > 0 && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
            <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
            {details.voteAverage.toFixed(1)}
            <span className="text-zinc-500 dark:text-zinc-600">· IMDb rating</span>
          </p>
        )}

        {details.genres.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {details.genres.map((genre) => (
              <span
                key={genre}
                className="rounded-full border border-zinc-300 px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
              >
                {genre}
              </span>
            ))}
          </div>
        )}

        {hasOverview && (
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {details.overview}
          </p>
        )}

        {details.cast.length > 0 && (
          <div className="mt-5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
              <Users className="size-3.5" aria-hidden />
              Cast
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {details.cast.map((name) => (
                <span
                  key={name}
                  className="rounded-lg bg-zinc-200/70 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-300"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {details.director && (
          <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-600">
            Director: <span className="font-medium text-zinc-700 dark:text-zinc-300">{details.director}</span>
          </p>
        )}
      </div>
    </motion.section>
  );
}
