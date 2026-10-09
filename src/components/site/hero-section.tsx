'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { Clapperboard, Dices, Info, Play, Server, Star, Users, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConnectCard } from '@/components/site/connect-card';
import { tmdbImg } from '@/lib/languages';
import { yearOf, type SearchItem } from '@/lib/tmdb';
import type { MetaSearchItem } from '@/lib/meta';
import { PROVIDERS } from '@/lib/providers';

type HeroTrendingItem = SearchItem | MetaSearchItem;

/** Build a watch URL for either a TMDB item or a keyless Cinemeta item. */
function watchUrlOf(item: HeroTrendingItem): string | null {
  const type = item.mediaType;
  if ('id' in item && typeof item.id === 'number' && item.id > 0) {
    return `/?id=${item.id}&type=${type}`;
  }
  const meta = item as MetaSearchItem;
  if (meta.tmdbId && meta.tmdbId > 0) return `/?id=${meta.tmdbId}&type=${type}`;
  if (meta.imdbId) return `/?imdb=${meta.imdbId}&type=${type}`;
  return null;
}

/** Up to three clean genre pills from a Cinemeta genre label. */
function genrePillsOf(item: HeroTrendingItem): string[] {
  const genre = 'genre' in item ? (item as MetaSearchItem).genre : undefined;
  if (!genre) return [];
  return genre
    .split(/[,/&]/)
    .map((g) => g.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Cinematic hero — the trending carousel, deliberately compact.
 *
 * The featured title's backdrop (or a blurred, darkened poster when only
 * artwork available) fills a ~2/3-viewport stage edge-to-edge; a layered
 * gradient burns it into the page background. Title, year, genre pills,
 * rating and a two-line description sit bottom-left over the art with
 * Play + More Info actions. The carousel auto-advances every 8 seconds with
 * a slow crossfade, pauses on hover/focus, is manually overridden by the
 * dot indicators, and all motion collapses under prefers-reduced-motion.
 */
export function HeroSection({
  trending,
  trendingLoading,
  hasKey,
}: {
  trending: HeroTrendingItem[] | undefined;
  trendingLoading: boolean;
  hasKey: boolean;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const surprise = () => {
    if (!trending || trending.length === 0) {
      toast('Catalog is still loading', {
        description: 'Give it a second, then try again.',
      });
      return;
    }
    const pick = trending[Math.floor(Math.random() * trending.length)];
    const url = watchUrlOf(pick);
    if (!url) {
      toast.error('That pick had no playable id — try again.');
      return;
    }
    router.push(url, { scroll: false });
  };

  // Auto-rotation: advance every 8s, pause on hover/focus/hidden tab,
  // disabled under reduced motion. Index only — the featured item below is
  // a pure derivation.
  const [rotateIndex, setRotateIndex] = useState(0);
  const [rotatePaused, setRotatePaused] = useState(false);
  const trendingCount = trending?.length ?? 0;
  useEffect(() => {
    if (reduceMotion || rotatePaused || trendingCount < 2) return;
    const id = window.setInterval(
      () => setRotateIndex((i) => (i + 1) % trendingCount),
      8_000,
    );
    return () => window.clearInterval(id);
  }, [reduceMotion, rotatePaused, trendingCount]);
  // Clamp during render when the catalog shrinks (key added/removed).
  const safeIndex = trendingCount > 0 ? Math.min(rotateIndex, trendingCount - 1) : 0;

  const featured = trending && trending.length > 0 ? trending[safeIndex] : null;
  const featuredMeta = featured ? (featured as MetaSearchItem) : null;
  const featuredTitle = featured?.title ?? '';
  const featuredYear = featured
    ? 'id' in featured && typeof featured.id === 'number' && featured.id > 0
      ? yearOf((featured as SearchItem).releaseDate)
      : (featuredMeta?.year ?? '')
    : '';
  const featuredRating =
    featured && featured.voteAverage > 0 ? featured.voteAverage.toFixed(1) : null;
  const featuredPills = useMemo(() => (featured ? genrePillsOf(featured) : []), [featured]);
  const featuredOverview =
    featured && 'overview' in featured && (featured as SearchItem).overview
      ? (featured as SearchItem).overview
      : null;
  const featuredUrl = featured ? watchUrlOf(featured) : null;
  const featuredBackdrop = featured
    ? 'backdropPath' in featured
      ? tmdbImg(
          (featured as SearchItem).backdropPath ?? (featured as SearchItem).posterPath,
          'w1280',
        )
      : (featuredMeta?.backdrop ?? featuredMeta?.poster ?? null)
    : null;
  const hasBackdrop =
    Boolean(featured && 'backdropPath' in featured && (featured as SearchItem).backdropPath) ||
    Boolean(featuredMeta?.backdrop);

  return (
    <section
      aria-label="Featured titles"
      className="relative -mx-4 -mt-6 overflow-hidden sm:-mx-6 sm:-mt-8"
      onPointerEnter={() => setRotatePaused(true)}
      onPointerLeave={() => setRotatePaused(false)}
      onFocus={() => setRotatePaused(true)}
      onBlur={() => setRotatePaused(false)}
    >
      <div className="relative flex min-h-[62svh] flex-col justify-end md:min-h-[70svh]">
        {trendingLoading ? (
          <Skeleton className="absolute inset-0 size-full rounded-none bg-zinc-900" />
        ) : !featured || !featuredUrl ? (
          // Keyless + empty catalog: keep the connect card front and center.
          <div className="flex min-h-[52svh] items-center justify-center px-4">
            <div className="w-full max-w-md">
              <ConnectCard />
            </div>
          </div>
        ) : (
          <>
            {/* Crossfading backdrop layers — the art burns into the page bg */}
            <AnimatePresence initial={false}>
              <motion.div
                key={featuredUrl + featuredTitle}
                initial={reduceMotion ? false : { opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 1.1, ease: 'easeOut' }}
                className="absolute inset-0"
                aria-hidden
              >
                {featuredBackdrop ? (
                   
                  <img
                    src={featuredBackdrop}
                    alt=""
                    loading={safeIndex === 0 ? 'eager' : 'lazy'}
                    fetchPriority={safeIndex === 0 ? 'high' : 'auto'}
                    className={
                      hasBackdrop
                        ? 'size-full object-cover'
                        : 'size-full scale-110 object-cover blur-2xl brightness-[0.55]'
                    }
                  />
                ) : (
                  <div className="size-full bg-zinc-900" />
                )}
                {/* Burn the art into the canvas: bottom + left gradient bed */}
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/10" />
                <div className="absolute inset-0 bg-gradient-to-r from-background/85 via-background/25 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
              </motion.div>
            </AnimatePresence>

            {/* Featured content — bottom-left, like a premium streaming hero */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={featuredUrl + featuredTitle}
                initial={reduceMotion ? false : { opacity: 0, y: 26 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -14 }}
                transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="relative z-10 w-full px-4 pb-10 sm:px-6 sm:pb-12 lg:px-10"
              >
                <div className="max-w-3xl">
                  <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-300">
                    <Clapperboard className="size-3.5 text-brand" aria-hidden />
                    Trending {hasKey ? 'this week' : 'now'}
                  </p>

                  <h1 className="mt-2 text-3xl font-bold leading-[1.06] tracking-tight text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.55)] sm:text-5xl lg:text-[52px]">
                    {featuredTitle}
                  </h1>

                  <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm text-zinc-200">
                    {featuredYear && <span className="font-medium">{featuredYear}</span>}
                    {featuredRating && (
                      <span className="inline-flex items-center gap-1 font-semibold text-white">
                        <Star className="size-3.5 fill-brand text-brand" aria-hidden />
                        {featuredRating}
                      </span>
                    )}
                    {featuredPills.map((pill) => (
                      <span
                        key={pill}
                        className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm"
                      >
                        {pill}
                      </span>
                    ))}
                  </div>

                  {featuredOverview && (
                    <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-relaxed text-zinc-200/90 drop-shadow-[0_1px_8px_rgba(0,0,0,0.6)]">
                      {featuredOverview}
                    </p>
                  )}

                  <div className="mt-5 flex flex-wrap items-center gap-2.5">
                    <Button
                      type="button"
                      onClick={() => router.push(featuredUrl, { scroll: false })}
                      className="h-10 rounded-lg bg-brand px-5 text-sm font-semibold text-white shadow-[0_8px_30px_-8px_rgba(229,9,20,0.55)] transition-all duration-200 hover:bg-brand/90 active:scale-[0.97]"
                    >
                      <Play className="size-4 fill-white" aria-hidden />
                      Play
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.push(featuredUrl, { scroll: false })}
                      className="h-10 rounded-lg border-white/25 bg-white/10 px-4 text-sm font-medium text-white backdrop-blur-md transition-all duration-200 hover:border-white/40 hover:bg-white/20 active:scale-[0.97]"
                    >
                      <Info className="size-4" aria-hidden />
                      More Info
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={surprise}
                      aria-label="Surprise me — play a random trending title"
                      title="Surprise me"
                      className="size-10 rounded-full border border-white/15 bg-black/30 text-zinc-200 backdrop-blur-md hover:bg-black/50 hover:text-white"
                    >
                      <Dices className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Dot indicators — manual override for the auto-cycle */}
            {trendingCount > 1 && (
              <div
                role="tablist"
                aria-label="Featured titles"
                className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 sm:right-6"
              >
                {trending!.slice(0, Math.min(trendingCount, 6)).map((item, i) => {
                  const active = i === safeIndex;
                  const dotTitle = ('title' in item ? item.title : '') || `Featured ${i + 1}`;
                  return (
                    <button
                      key={i}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={`Show ${dotTitle}`}
                      onClick={() => {
                        setRotateIndex(i);
                        setRotatePaused(true);
                      }}
                      className={`h-1.5 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                        active
                          ? 'w-6 bg-brand'
                          : 'w-1.5 bg-white/30 hover:bg-white/60'
                      }`}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Stats strip — one slim line, not a wall of cards */}
      <div className="relative z-10 mx-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/60 py-3.5 text-[11px] text-zinc-500 sm:mx-6 sm:gap-x-6 sm:text-xs dark:text-zinc-400">
        <span className="flex items-center gap-1.5">
          <Clapperboard className="size-3.5 text-brand" aria-hidden />
          <strong className="font-semibold text-zinc-800 dark:text-zinc-100">10,000+</strong>
          keyless catalogs
        </span>
        <span className="flex items-center gap-1.5">
          <Server className="size-3.5 text-brand" aria-hidden />
          <strong className="font-semibold text-zinc-800 dark:text-zinc-100">{PROVIDERS.length}</strong>
          auto-scan + failover
        </span>
        <span className="flex items-center gap-1.5">
          <Zap className="size-3.5 text-brand" aria-hidden />
          One press — search to play
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          <Users className="size-3.5 text-brand" aria-hidden />
          Free accounts sync My List &amp; history
        </span>
      </div>
    </section>
  );
}
