'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ListPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MediaCard, MediaCardSkeleton } from '@/components/site/media-card';
import { MediaRow } from '@/components/site/media-row';
import type { MediaType } from '@/lib/tmdb';

interface SharedListPayload {
  list: { name: string; description: string | null; updatedAt: string };
  items: {
    tmdbId: number;
    mediaType: MediaType;
    title: string;
    posterPath: string | null;
  }[];
}

/** Read-only public list view (?share=token). */
export function SharedListView({ token }: { token: string }) {
  const router = useRouter();

  const query = useQuery<SharedListPayload>({
    queryKey: ['shared-list', token],
    queryFn: async () => {
      const res = await fetch(`/api/lists/share?token=${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error(`share_${res.status}`);
      return (await res.json()) as SharedListPayload;
    },
    enabled: token.length > 0,
    staleTime: 60_000,
    retry: 0,
  });

  return (
    <div className="space-y-6">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => router.push('/', { scroll: false })}
        className="h-9 gap-1.5 rounded-lg px-2.5 text-sm text-zinc-600 dark:text-zinc-400"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to browse
      </Button>

      {query.isPending ? (
        <div className="flex gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <MediaCardSkeleton key={i} />
          ))}
        </div>
      ) : query.isError ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
          <ListPlus className="mx-auto size-8 text-zinc-400" aria-hidden />
          <h1 className="mt-3 text-lg font-bold text-zinc-800 dark:text-zinc-200">This list isn’t available</h1>
          <p className="mt-1 text-sm text-zinc-500">
            The share link is invalid, or the list was made private.
          </p>
        </div>
      ) : (
        <>
          <header>
            <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              <ListPlus className="size-6 text-brand" aria-hidden />
              {query.data.list.name}
            </h1>
            {query.data.list.description && (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{query.data.list.description}</p>
            )}
            <p className="mt-1 text-xs text-zinc-400">
              A shared CineDeck list · {query.data.items.length} titles
            </p>
          </header>
          <MediaRow label="Shared list">
            {query.data.items.map((item) => (
              <MediaCard
                key={`${item.tmdbId}-${item.mediaType}`}
                item={{
                  id: item.tmdbId,
                  mediaType: item.mediaType,
                  title: item.title,
                  posterPath: item.posterPath,
                  releaseDate: '',
                  voteAverage: 0,
                }}
              />
            ))}
          </MediaRow>
        </>
      )}
    </div>
  );
}
