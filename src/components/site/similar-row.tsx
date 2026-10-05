'use client';

import { Film } from 'lucide-react';
import { MediaCard, MediaCardSkeleton, type MediaCardItem } from '@/components/site/media-card';
import { MediaRow } from '@/components/site/media-row';
import type { MetaSearchItem } from '@/lib/meta';
import type { MediaType, SimilarItem } from '@/lib/tmdb';

export function SimilarRow({
  similar,
  mediaType,
  loading,
}: {
  similar: SimilarItem[] | undefined;
  mediaType: MediaType;
  loading: boolean;
}) {
  const items: MediaCardItem[] = (similar ?? []).map((s) => ({
    id: s.id,
    mediaType,
    title: s.title,
    posterPath: s.posterPath,
    releaseDate: s.releaseDate,
    voteAverage: s.voteAverage,
  }));

  return (
    <section aria-labelledby="similar-heading" className="mt-10">
      <h2 id="similar-heading" className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        More like this
      </h2>
      {loading ? (
        <div className="flex gap-3 overflow-hidden sm:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="w-28 shrink-0 sm:w-36">
              <MediaCardSkeleton />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-200/30 text-sm text-zinc-500 dark:border-zinc-800/80 dark:bg-zinc-900/30 dark:text-zinc-400">
          <Film className="mr-2 size-4" aria-hidden />
          No recommendations available.
        </div>
      ) : (
        <MediaRow label="More like this">
          {items.map((item) => (
            <div key={item.id} className="w-28 shrink-0 snap-start sm:w-36">
              <MediaCard item={item} />
            </div>
          ))}
        </MediaRow>
      )}
    </section>
  );
}

/**
 * Keyless "More like this" (IMDB watch mode): cards from Cinemeta's
 * genre-filtered top catalog — no TMDB key needed.
 */
export function MetaSimilarRow({
  items,
  loading,
}: {
  items: MetaSearchItem[] | undefined;
  loading: boolean;
}) {
  const cards: MediaCardItem[] = (items ?? []).map((m) => ({
    id: m.tmdbId ?? 0,
    imdbId: m.imdbId,
    mediaType: m.mediaType,
    title: m.title,
    posterPath: null,
    posterUrl: m.poster,
    releaseDate: m.year ? `${m.year}-01-01` : '',
    voteAverage: m.voteAverage,
    genre: m.genre,
  }));

  if (!loading && cards.length === 0) return null; // stay silent when keyless has nothing

  return (
    <section aria-labelledby="meta-similar-heading" className="mt-10">
      <h2
        id="meta-similar-heading"
        className="mb-3 flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100"
      >
        More like this
        <span className="rounded bg-zinc-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 dark:bg-zinc-800/70 dark:text-zinc-400">
          Cinemeta
        </span>
      </h2>
      {loading ? (
        <div className="flex gap-3 overflow-hidden sm:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="w-28 shrink-0 sm:w-36">
              <MediaCardSkeleton />
            </div>
          ))}
        </div>
      ) : (
        <MediaRow label="More like this">
          {cards.map((item) => (
            <div
              key={item.imdbId ?? item.id}
              className="w-28 shrink-0 snap-start sm:w-36"
            >
              <MediaCard item={item} />
            </div>
          ))}
        </MediaRow>
      )}
    </section>
  );
}
