'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { Dices, Play, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ConnectCard } from '@/components/site/connect-card';
import { tmdbImg } from '@/lib/languages';
import { useCinedeckStore } from '@/lib/store';
import { yearOf, type MediaType, type SearchItem } from '@/lib/tmdb';
import type { MetaSearchItem } from '@/lib/meta';

type HeroTrendingItem = SearchItem | MetaSearchItem;

function parsePositive(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) return null;
  return Number(trimmed);
}

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

/**
 * Hero: headline + TMDB ID quick-play card on the left, the #1 trending
 * backdrop (TMDB or keyless Cinemeta — whichever feeds the site) on the right.
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
  const [mediaType, setMediaType] = useState<MediaType>('movie');
  const [idText, setIdText] = useState('');
  const [seasonText, setSeasonText] = useState('1');
  const [episodeText, setEpisodeText] = useState('1');

  const play = () => {
    const id = parsePositive(idText);
    if (id === null) {
      toast.error('Enter a numeric TMDB ID', {
        description: 'For example: 550 (Fight Club) or 1396 (Breaking Bad).',
      });
      return;
    }
    const params = new URLSearchParams({ id: String(id), type: mediaType });
    if (mediaType === 'tv') {
      const s = parsePositive(seasonText) ?? 1;
      const e = parsePositive(episodeText) ?? 1;
      params.set('s', String(s));
      params.set('e', String(e));
    }
    router.push(`/?${params.toString()}`, { scroll: false });
  };

  const surprise = () => {
    if (!trending || trending.length === 0) {
      toast('Catalog is still loading', {
        description: 'Give it a second, then try "Surprise me" again.',
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

  const featured = trending && trending.length > 0 ? trending[0] : null;
  const featuredMeta = featured ? (featured as MetaSearchItem) : null;
  const featuredTitle = featured?.title ?? '';
  const featuredYear = featured
    ? 'id' in featured && typeof featured.id === 'number' && featured.id > 0
      ? yearOf((featured as SearchItem).releaseDate)
      : (featuredMeta?.year ?? '')
    : '';
  const featuredGenre = featuredMeta?.genre;
  const featuredRating = featured && featured.voteAverage > 0 ? featured.voteAverage.toFixed(1) : null;
  const featuredUrl = featured ? watchUrlOf(featured) : null;
  const featuredBackdrop =
    'backdropPath' in (featured ?? {})
      ? tmdbImg((featured as SearchItem).backdropPath ?? (featured as SearchItem).posterPath, 'w1280')
      : featuredMeta?.backdrop ?? featuredMeta?.poster ?? null;

  const fadeUp = (delay: number) => ({
    initial: reduceMotion ? undefined : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.32, delay },
  });

  return (
    <section className="relative overflow-hidden" aria-label="Quick play">
      {/* Ambient accent glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/4 h-72 w-[36rem] rounded-full bg-brand-soft blur-3xl"
      />

      <div className="relative grid items-center gap-8 py-10 sm:py-14 lg:grid-cols-2 lg:gap-12">
        <div>
          <motion.h1 {...fadeUp(0)} className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl lg:text-5xl dark:text-zinc-100">
            {hasKey ? (
              <>
                Play anything with a <span className="text-brand">TMDB ID</span>.
              </>
            ) : (
              <>
                Search it. <span className="text-brand">Press play.</span>
              </>
            )}
          </motion.h1>
          <motion.p {...fadeUp(0.06)} className="mt-3 max-w-md text-sm leading-relaxed text-zinc-600 sm:text-base dark:text-zinc-400">
            {hasKey
              ? 'No sign-ups, no browsing walls. Paste an ID, pick a server, press play — or browse the trending rows below.'
              : 'Type a title in the search bar and hit Enter — CineDeck scans every stream source and plays the healthiest one. No API key, no sign-up: metadata flows live from Cinemeta & TVmaze.'}
          </motion.p>

          <motion.div
            {...fadeUp(0.12)}
            className="mt-6 rounded-xl border border-zinc-200 bg-white/70 p-4 sm:p-5 dark:border-zinc-800/60 dark:bg-zinc-900/60"
          >
            <Tabs
              value={mediaType}
              onValueChange={(v) => setMediaType(v as MediaType)}
              aria-label="Media type"
            >
              <TabsList className="h-9 rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-950/60">
                <TabsTrigger
                  value="movie"
                  className="h-7 rounded-md px-4 text-xs font-medium data-[state=active]:bg-brand data-[state=active]:text-brand-foreground"
                >
                  Movie
                </TabsTrigger>
                <TabsTrigger
                  value="tv"
                  className="h-7 rounded-md px-4 text-xs font-medium data-[state=active]:bg-brand data-[state=active]:text-brand-foreground"
                >
                  TV Show
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="min-w-40 flex-1 space-y-1.5">
                <label htmlFor="hero-tmdb-id" className="text-xs font-medium text-zinc-500">
                  TMDB ID
                </label>
                <Input
                  id="hero-tmdb-id"
                  inputMode="numeric"
                  value={idText}
                  onChange={(e) => setIdText(e.target.value.replace(/[^\d]/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && play()}
                  placeholder="e.g. 550"
                  className="h-11 rounded-lg border-zinc-200 bg-white/80 font-mono text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:border-brand/60 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-100 dark:placeholder:text-zinc-600"
                />
              </div>
              {mediaType === 'tv' && (
                <>
                  <div className="w-20 space-y-1.5">
                    <label htmlFor="hero-season" className="text-xs font-medium text-zinc-500">
                      Season
                    </label>
                    <Input
                      id="hero-season"
                      inputMode="numeric"
                      value={seasonText}
                      onChange={(e) => setSeasonText(e.target.value.replace(/[^\d]/g, ''))}
                      onKeyDown={(e) => e.key === 'Enter' && play()}
                      className="h-11 rounded-lg border-zinc-200 bg-white/80 text-center font-mono text-sm text-zinc-900 focus-visible:border-brand/60 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-100"
                    />
                  </div>
                  <div className="w-20 space-y-1.5">
                    <label htmlFor="hero-episode" className="text-xs font-medium text-zinc-500">
                      Episode
                    </label>
                    <Input
                      id="hero-episode"
                      inputMode="numeric"
                      value={episodeText}
                      onChange={(e) => setEpisodeText(e.target.value.replace(/[^\d]/g, ''))}
                      onKeyDown={(e) => e.key === 'Enter' && play()}
                      className="h-11 rounded-lg border-zinc-200 bg-white/80 text-center font-mono text-sm text-zinc-900 focus-visible:border-brand/60 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-100"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={play}
                className="h-11 rounded-lg bg-brand px-6 text-sm font-semibold text-zinc-950 shadow-[0_0_20px_color-mix(in_srgb,var(--cinedeck-accent)_25%,transparent)] hover:bg-brand/90"
              >
                <Play className="size-4 fill-zinc-950" aria-hidden />
                Play
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={surprise}
                className="h-11 rounded-lg border-zinc-200 bg-transparent px-5 text-sm font-medium text-zinc-700 hover:bg-zinc-200/70 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
              >
                <Dices className="size-4 text-brand" aria-hidden />
                Surprise me
              </Button>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-600">
                {hasKey
                  ? 'Works instantly — no API key needed for playback.'
                  : 'Surprise me picks from the live Cinemeta top catalog.'}
              </span>
            </div>
          </motion.div>
        </div>

        {/* Hero art zone — featured #1 regardless of which API feeds it */}
        <motion.div {...fadeUp(0.18)} className="relative">
          {trendingLoading ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800/60">
              <Skeleton className="size-full rounded-none bg-zinc-200 dark:bg-zinc-900" />
            </div>
          ) : featured && featuredBackdrop && featuredUrl ? (
            <button
              type="button"
              onClick={() => router.push(featuredUrl, { scroll: false })}
              aria-label={`Play ${featuredTitle}`}
              className="group relative block w-full overflow-hidden rounded-xl border border-zinc-200 text-left focus-visible:outline-none dark:border-zinc-800/60"
            >
              <img
                src={featuredBackdrop}
                alt={`${featuredTitle} backdrop`}
                className="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
              {/* gradient masks */}
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-zinc-50 via-zinc-50/35 to-transparent dark:from-zinc-950 dark:via-zinc-950/35"
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-r from-zinc-50/70 via-transparent to-transparent dark:from-zinc-950/70"
              />
              <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-4 sm:p-5">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-brand">
                    {hasKey ? 'Trending #1 this week' : 'Trending #1 — live via Cinemeta'}
                  </p>
                  <p className="mt-1 truncate text-lg font-semibold text-zinc-900 sm:text-xl dark:text-zinc-50">
                    {featuredTitle}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    {featuredYear && <span>{featuredYear}</span>}
                    {featuredGenre && <span className="max-w-40 truncate">{featuredGenre}</span>}
                    {featuredRating && (
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3 fill-brand text-brand" aria-hidden />
                        {featuredRating}
                      </span>
                    )}
                  </p>
                </div>
                <span className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_20px_color-mix(in_srgb,var(--cinedeck-accent)_25%,transparent)] transition-transform duration-200 group-hover:scale-105">
                  <Play className="size-4 fill-zinc-950" aria-hidden />
                  Play
                </span>
              </div>
            </button>
          ) : !hasKey ? (
            <ConnectCard />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-200/40 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-600">
              Trending is unavailable right now.
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}
