'use client';

import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertCircle,
  Bookmark,
  History,
  Play,
  RefreshCw,
  TrendingUp,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { HeroSection } from '@/components/site/hero-section';
import { MediaCard, MediaCardSkeleton } from '@/components/site/media-card';
import { MediaRow } from '@/components/site/media-row';
import { ConnectCard } from '@/components/site/connect-card';
import { useHasTmdbKey } from '@/lib/settings';
import { useCinedeckStore } from '@/lib/store';
import { tmdbImg } from '@/lib/languages';
import { useRemoveHistory, useRemoveWatchlist, useTrending, useHistory, useWatchlist } from '@/hooks/use-media';
import { yearOf, type HistoryItem, type WatchlistItem } from '@/lib/tmdb';

function SectionHeading({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        <Icon className="size-4.5 text-amber-500 dark:text-amber-400" aria-hidden />
        {title}
      </h2>
      {hint && <span className="text-xs text-zinc-500 dark:text-zinc-600">{hint}</span>}
    </div>
  );
}

function HistoryCard({ item }: { item: HistoryItem }) {
  const router = useRouter();
  const removeHistory = useRemoveHistory();
  const poster = tmdbImg(item.posterPath, 'w500');

  const open = () => {
    const params = new URLSearchParams({ id: String(item.tmdbId), type: item.mediaType });
    if (item.mediaType === 'tv' && item.season && item.episode) {
      params.set('s', String(item.season));
      params.set('e', String(item.episode));
    }
    router.push(`/?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="group relative w-32 shrink-0 snap-start sm:w-36">
      <button
        type="button"
        onClick={open}
        aria-label={`Continue ${item.title}${item.season && item.episode ? ` S${item.season}E${item.episode}` : ''}`}
        className="block w-full text-left focus-visible:outline-none"
      >
        <span className="relative block aspect-[2/3] w-full overflow-hidden rounded-xl border border-zinc-200 bg-white/70 transition-all duration-200 group-hover:border-amber-400/50 dark:border-zinc-800/80 dark:bg-zinc-900/60">
          {poster ? (
            <img
              src={poster}
              alt={`${item.title} poster`}
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <span className="flex size-full items-center justify-center font-mono text-xs text-zinc-500 dark:text-zinc-700">
              #{item.tmdbId}
            </span>
          )}
          {/* hover play overlay */}
          <span className="absolute inset-0 flex items-center justify-center bg-zinc-950/60 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100">
            <span className="flex size-11 items-center justify-center rounded-full bg-amber-400 text-zinc-950">
              <Play className="size-5 fill-zinc-950" aria-hidden />
            </span>
          </span>
          {item.mediaType === 'tv' && item.season != null && item.episode != null && (
            <span className="absolute left-2 top-2 rounded bg-zinc-950/85 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300 backdrop-blur">
              S{item.season}·E{item.episode}
            </span>
          )}
        </span>
        <span className="mt-2 block truncate text-sm font-medium text-zinc-800 transition-colors group-hover:text-amber-600 dark:text-zinc-200 dark:group-hover:text-amber-300">
          {item.title}
        </span>
        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-600">Continue watching</span>
      </button>
      <button
        type="button"
        aria-label={`Remove ${item.title} from history`}
        onClick={(e) => {
          e.stopPropagation();
          removeHistory.mutate(item.id, {
            onSuccess: () => toast.success('Removed from history'),
            onError: () => toast.error('Could not remove from history'),
          });
        }}
        className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-zinc-950/80 text-zinc-400 opacity-0 backdrop-blur transition-all hover:bg-red-500/80 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function WatchlistCard({ item }: { item: WatchlistItem }) {
  const router = useRouter();
  const removeWatchlist = useRemoveWatchlist();
  const poster = tmdbImg(item.posterPath, 'w500');

  return (
    <div className="group relative w-32 shrink-0 snap-start sm:w-36">
      <button
        type="button"
        onClick={() => router.push(`/?id=${item.tmdbId}&type=${item.mediaType}`, { scroll: false })}
        aria-label={`Open ${item.title}`}
        className="block w-full text-left focus-visible:outline-none"
      >
        <span className="relative block aspect-[2/3] w-full overflow-hidden rounded-xl border border-zinc-200 bg-white/70 transition-all duration-200 group-hover:border-amber-400/50 dark:border-zinc-800/80 dark:bg-zinc-900/60">
          {poster ? (
            <img
              src={poster}
              alt={`${item.title} poster`}
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <span className="flex size-full items-center justify-center font-mono text-xs text-zinc-500 dark:text-zinc-700">
              #{item.tmdbId}
            </span>
          )}
          <span className="absolute bottom-2 left-2 rounded bg-zinc-950/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 backdrop-blur">
            {item.mediaType}
          </span>
        </span>
        <span className="mt-2 block truncate text-sm font-medium text-zinc-800 transition-colors group-hover:text-amber-600 dark:text-zinc-200 dark:group-hover:text-amber-300">
          {item.title}
        </span>
        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-600">In My List</span>
      </button>
      <button
        type="button"
        aria-label={`Remove ${item.title} from My List`}
        onClick={(e) => {
          e.stopPropagation();
          removeWatchlist.mutate(item.id, {
            onSuccess: () => toast.success('Removed from My List'),
            onError: () => toast.error('Could not remove from My List'),
          });
        }}
        className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-zinc-950/80 text-zinc-400 opacity-0 backdrop-blur transition-all hover:bg-red-500/80 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function RowEmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-32 w-full items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-200/30 text-sm text-zinc-500 dark:border-zinc-800/80 dark:bg-zinc-900/30 dark:text-zinc-600">
      {text}
    </div>
  );
}

export function HomeView() {
  const language = useCinedeckStore((s) => s.language);
  const hasKey = useHasTmdbKey();
  const reduceMotion = useReducedMotion();

  const trendingQuery = useTrending(language, hasKey);
  const historyQuery = useHistory();
  const watchlistQuery = useWatchlist();

  const trending = trendingQuery.data;
  const historyItems = historyQuery.data ?? [];
  const watchlistItems = watchlistQuery.data ?? [];

  const fadeIn = {
    initial: reduceMotion ? undefined : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3 },
  };

  return (
    <div className="space-y-12">
      <HeroSection
        trending={trending}
        trendingLoading={hasKey && trendingQuery.isPending}
        hasKey={hasKey}
      />

      {/* Continue watching */}
      <motion.section {...fadeIn} aria-labelledby="continue-watching">
        <div id="continue-watching">
          <SectionHeading icon={History} title="Continue watching" hint="Synced to this browser" />
        </div>
        {historyQuery.isPending ? (
          <div className="flex gap-3 overflow-hidden sm:gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-32 shrink-0 sm:w-36">
                <Skeleton className="aspect-[2/3] w-full rounded-xl bg-zinc-200 dark:bg-zinc-900" />
              </div>
            ))}
          </div>
        ) : historyItems.length === 0 ? (
          <RowEmptyState text="Nothing in progress yet — play something to pick up where you left off." />
        ) : (
          <MediaRow label="Continue watching">
            {historyItems.map((item) => (
              <HistoryCard key={item.id} item={item} />
            ))}
          </MediaRow>
        )}
      </motion.section>

      {/* My List */}
      <motion.section {...fadeIn} aria-labelledby="my-list">
        <div id="my-list">
          <SectionHeading icon={Bookmark} title="My List" hint="Saved titles" />
        </div>
        {watchlistQuery.isPending ? (
          <div className="flex gap-3 overflow-hidden sm:gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-32 shrink-0 sm:w-36">
                <Skeleton className="aspect-[2/3] w-full rounded-xl bg-zinc-200 dark:bg-zinc-900" />
              </div>
            ))}
          </div>
        ) : watchlistItems.length === 0 ? (
          <RowEmptyState text="Your list is empty — tap the bookmark on any title to save it here." />
        ) : (
          <MediaRow label="My List">
            {watchlistItems.map((item) => (
              <WatchlistCard key={item.id} item={item} />
            ))}
          </MediaRow>
        )}
      </motion.section>

      {/* Trending */}
      <motion.section {...fadeIn} aria-labelledby="trending-week">
        <div id="trending-week">
          <SectionHeading icon={TrendingUp} title="Trending this week" hint="TMDB popularity" />
        </div>
        {!hasKey ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-3">
              <ConnectCard compact />
            </div>
          </div>
        ) : trendingQuery.isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <MediaCardSkeleton key={i} />
            ))}
          </div>
        ) : trendingQuery.isError ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-200/30 px-6 py-10 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
            <AlertCircle className="size-6 text-red-600 dark:text-red-400" aria-hidden />
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{trendingQuery.error.message}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => trendingQuery.refetch()}
              className="h-9 rounded-lg border-zinc-200 bg-transparent text-xs text-zinc-700 hover:bg-zinc-200/70 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Try again
            </Button>
          </div>
        ) : trending && trending.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {trending.map((item, index) => (
              <MediaCard key={`${item.mediaType}-${item.id}`} item={item} priority={index < 6} />
            ))}
          </div>
        ) : (
          <RowEmptyState text="No trending data available right now." />
        )}
      </motion.section>
    </div>
  );
}
