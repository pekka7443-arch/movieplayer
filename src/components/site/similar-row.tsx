'use client';

import { Film } from 'lucide-react';
import { MediaCard, MediaCardSkeleton, type MediaCardItem } from '@/components/site/media-card';
import { MediaRow } from '@/components/site/media-row';
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
      <h2 id="similar-heading" className="mb-3 text-lg font-semibold text-zinc-100">
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
        <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-zinc-800/80 bg-zinc-900/30 text-sm text-zinc-600">
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
