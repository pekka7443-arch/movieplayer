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

function parsePositive(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) return null;
  return Number(trimmed);
}

/**
 * Hero: headline + TMDB ID quick-play card on the left, trending art (or the
 * connect panel in no-key mode) on the right.
 */
export function HeroSection({
  trending,
  trendingLoading,
  hasKey,
}: {
  trending: SearchItem[] | undefined;
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
    if (!hasKey || !trending || trending.length === 0) {
      toast('Add a TMDB key to unlock “Surprise me”', {
        description: 'It picks a random title from this week’s trending list.',
      });
      return;
    }
    const pick = trending[Math.floor(Math.random() * trending.length)];
    router.push(`/?id=${pick.id}&type=${pick.mediaType}`, { scroll: false });
  };

  const featured = trending && trending.length > 0 ? trending[0] : null;
  const featuredBackdrop = tmdbImg(featured?.backdropPath ?? featured?.posterPath, 'w1280');

  const fadeUp = (delay: number) => ({
    initial: reduceMotion ? undefined : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.32, delay },
  });

  return (
    <section className="relative overflow-hidden" aria-label="Quick play">
      {/* Ambient amber glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/4 h-72 w-[36rem] rounded-full bg-amber-400/10 blur-3xl"
      />

      <div className="relative grid items-center gap-8 py-10 sm:py-14 lg:grid-cols-2 lg:gap-12">
        <div>
          <motion.h1 {...fadeUp(0)} className="text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl lg:text-5xl">
            Play anything with a{' '}
            <span className="text-amber-400">TMDB ID</span>.
          </motion.h1>
          <motion.p {...fadeUp(0.06)} className="mt-3 max-w-md text-sm leading-relaxed text-zinc-400 sm:text-base">
            No sign-ups, no browsing walls. Paste an ID, pick a server, press play — or connect a
            free TMDB key to unlock search, trending and metadata in 12 languages.
          </motion.p>

          <motion.div
            {...fadeUp(0.12)}
            className="mt-6 rounded-xl border border-zinc-800/60 bg-zinc-900/60 p-4 sm:p-5"
          >
            <Tabs
              value={mediaType}
              onValueChange={(v) => setMediaType(v as MediaType)}
              aria-label="Media type"
            >
              <TabsList className="h-9 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
                <TabsTrigger
                  value="movie"
                  className="h-7 rounded-md px-4 text-xs font-medium data-[state=active]:bg-amber-400 data-[state=active]:text-zinc-950"
                >
                  Movie
                </TabsTrigger>
                <TabsTrigger
                  value="tv"
                  className="h-7 rounded-md px-4 text-xs font-medium data-[state=active]:bg-amber-400 data-[state=active]:text-zinc-950"
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
                  className="h-11 rounded-lg border-zinc-800 bg-zinc-950/60 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:border-amber-400/60 focus-visible:ring-amber-400/20"
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
                      className="h-11 rounded-lg border-zinc-800 bg-zinc-950/60 text-center font-mono text-sm text-zinc-100 focus-visible:border-amber-400/60 focus-visible:ring-amber-400/20"
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
                      className="h-11 rounded-lg border-zinc-800 bg-zinc-950/60 text-center font-mono text-sm text-zinc-100 focus-visible:border-amber-400/60 focus-visible:ring-amber-400/20"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={play}
                className="h-11 rounded-lg bg-amber-400 px-6 text-sm font-semibold text-zinc-950 shadow-[0_0_20px_rgba(251,191,36,0.15)] hover:bg-amber-300"
              >
                <Play className="size-4 fill-zinc-950" aria-hidden />
                Play
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={surprise}
                className="h-11 rounded-lg border-zinc-800 bg-transparent px-5 text-sm font-medium text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
              >
                <Dices className="size-4 text-amber-400" aria-hidden />
                Surprise me
              </Button>
              <span className="text-[11px] text-zinc-600">
                Works instantly — no API key needed for playback.
              </span>
            </div>
          </motion.div>
        </div>

        {/* Hero art zone */}
        <motion.div {...fadeUp(0.18)} className="relative">
          {!hasKey ? (
            <ConnectCard />
          ) : trendingLoading ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-800/60">
              <Skeleton className="size-full rounded-none bg-zinc-900" />
            </div>
          ) : featured && featuredBackdrop ? (
            <div className="group relative overflow-hidden rounded-xl border border-zinc-800/60">
              <img
                src={featuredBackdrop}
                alt={`${featured.title} backdrop`}
                className="aspect-video w-full object-cover"
              />
              {/* gradient masks */}
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/35 to-transparent"
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-r from-zinc-950/70 via-transparent to-transparent"
              />
              <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-4 sm:p-5">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-amber-400">
                    Trending #1 this week
                  </p>
                  <p className="mt-1 truncate text-lg font-semibold text-zinc-50 sm:text-xl">
                    {featured.title}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                    {yearOf(featured.releaseDate) && <span>{yearOf(featured.releaseDate)}</span>}
                    {featured.voteAverage > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden />
                        {featured.voteAverage.toFixed(1)}
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={() =>
                    router.push(`/?id=${featured.id}&type=${featured.mediaType}`, { scroll: false })
                  }
                  className="h-10 shrink-0 rounded-lg bg-amber-400 px-5 text-sm font-semibold text-zinc-950 hover:bg-amber-300"
                >
                  <Play className="size-4 fill-zinc-950" aria-hidden />
                  Play
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 text-sm text-zinc-600">
              Trending is unavailable right now.
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}
