'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';
import { toast } from 'sonner';
import { Dices, Play, Server, Sparkles, Star, Clapperboard, Undo2, Users, Zap } from 'lucide-react';
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

/** Headline words: [text, accent] — accent words get the animated gradient. */
const HEADLINE_KEY: [string, boolean][] = [
  ['Play', false],
  ['anything', false],
  ['with', false],
  ['a', false],
  ['TMDB', true],
  ['ID.', true],
];
const HEADLINE_KEYLESS: [string, boolean][] = [
  ['Search', false],
  ['it.', false],
  ['Press', true],
  ['play.', true],
];

/** Word-by-word headline reveal: rises out of a blur, springy and cinematic. */
function StaggeredHeadline({ words }: { words: [string, boolean][] }) {
  const reduceMotion = useReducedMotion();
  return (
    <h1 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl lg:text-6xl dark:text-zinc-100">
      {words.map(([word, accent], index) => (
        <motion.span
          key={`${word}-${index}`}
          initial={reduceMotion ? undefined : { opacity: 0, y: '0.55em', filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.55, delay: 0.08 + index * 0.065, ease: [0.22, 1, 0.36, 1] }}
          className={`mr-[0.26em] inline-block last:mr-0 ${accent ? 'cd-gradient-text' : ''}`}
        >
          {word}
        </motion.span>
      ))}
    </h1>
  );
}

/** Count-up number that springs from 0 the first time it scrolls into view. */
function CountUp({ value, suffix = '' }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const count = useMotionValue(0);
  const text = useTransform(count, (v) => `${Math.round(v).toLocaleString('en-US')}${suffix}`);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(count, value, { duration: 1.6, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [inView, value, count]);

  return <motion.span ref={ref}>{text}</motion.span>;
}

/**
 * Hero: headline + TMDB ID quick-play card on the left, the #1 trending
 * backdrop (TMDB or keyless Cinemeta — whichever feeds the site) on the right
 * with mouse parallax, floating feature badges and a hover shine sweep.
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

  // Mouse parallax for the featured backdrop (fine pointers, motion only).
  const pointerNX = useMotionValue(0);
  const pointerNY = useMotionValue(0);
  const springX = useSpring(pointerNX, { stiffness: 55, damping: 18, mass: 0.6 });
  const springY = useSpring(pointerNY, { stiffness: 55, damping: 18, mass: 0.6 });
  const cardX = useTransform(springX, (v) => v * 12);
  const cardY = useTransform(springY, (v) => v * 8);
  const imgX = useTransform(springX, (v) => v * 22);
  const imgY = useTransform(springY, (v) => v * 15);

  const onHeroPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (reduceMotion || e.pointerType !== 'mouse') return;
    pointerNX.set(e.clientX / window.innerWidth - 0.5);
    pointerNY.set(e.clientY / window.innerHeight - 0.5);
  };

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
    <section className="relative overflow-hidden" aria-label="Quick play" onPointerMove={onHeroPointerMove}>
      {/* Ambient accent glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/4 h-72 w-[36rem] rounded-full bg-brand-soft blur-3xl"
      />

      <div className="relative grid items-center gap-8 py-12 sm:py-16 lg:grid-cols-2 lg:gap-12 lg:py-20">
        <div>
          {/* Eyebrow chip */}
          <motion.div {...fadeUp(0)}>
            <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white/60 px-3.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-zinc-600 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
              <Sparkles className="size-3.5 text-brand" aria-hidden />
              Movies · TV · Live sports · Replays
            </span>
          </motion.div>

          <div className="mt-5">
            <StaggeredHeadline words={hasKey ? HEADLINE_KEY : HEADLINE_KEYLESS} />
          </div>

          <motion.p {...fadeUp(0.06)} className="mt-4 max-w-md text-base leading-relaxed text-zinc-600 sm:text-lg dark:text-zinc-400">
            {hasKey
              ? 'Paste an ID, pick a server, press play — or browse the rows below. Create a free account to sync My List & history everywhere.'
              : 'Type a title, hit Enter — CineDeck scans every stream source and plays the healthiest one. No API key. Optional free account syncs your lists across devices.'}
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
                className="h-11 rounded-lg bg-brand px-6 text-sm font-semibold text-zinc-950 shadow-[0_0_20px_color-mix(in_srgb,var(--cinedeck-accent)_25%,transparent)] transition-all duration-200 hover:bg-brand/90 hover:shadow-[0_0_34px_color-mix(in_srgb,var(--cinedeck-accent)_40%,transparent)] hover:-translate-y-0.5 active:scale-[0.97]"
              >
                <Play className="size-4 fill-zinc-950" aria-hidden />
                Play
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={surprise}
                className="h-11 rounded-lg border-zinc-200 bg-transparent px-5 text-sm font-medium text-zinc-700 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-200/70 hover:text-zinc-900 active:scale-[0.97] dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
              >
                <Dices className="size-4 text-brand transition-transform duration-300 hover:rotate-12" aria-hidden />
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

        {/* Hero art zone — featured #1 regardless of which API feeds it,
            wrapped in a springy mouse-parallax layer. */}
        <motion.div {...fadeUp(0.18)} className="relative">
          <motion.div style={reduceMotion ? undefined : { x: cardX, y: cardY }} className="relative">
            {trendingLoading ? (
              <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800/60">
                <Skeleton className="size-full rounded-none bg-zinc-200 dark:bg-zinc-900" />
              </div>
            ) : featured && featuredBackdrop && featuredUrl ? (
              <button
                type="button"
                onClick={() => router.push(featuredUrl, { scroll: false })}
                aria-label={`Play ${featuredTitle}`}
                className="group relative block w-full overflow-hidden rounded-xl border border-zinc-200 text-left shadow-2xl shadow-black/10 transition-shadow duration-500 focus-visible:outline-none hover:shadow-[0_24px_70px_-18px_color-mix(in_srgb,var(--cinedeck-accent)_35%,transparent)] dark:border-zinc-800/60 dark:shadow-black/50"
              >
                <motion.img
                  src={featuredBackdrop}
                  alt={`${featuredTitle} backdrop`}
                  style={reduceMotion ? undefined : { x: imgX, y: imgY }}
                  className="aspect-video w-full scale-[1.07] object-cover"
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
                {/* shine sweep on hover */}
                <span aria-hidden className="cd-shine" />
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
                  <span className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_20px_color-mix(in_srgb,var(--cinedeck-accent)_25%,transparent)] transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
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

            {/* Floating feature badges — decorative, desktop only */}
            {!trendingLoading && (
              <>
                <motion.span
                  initial={reduceMotion ? undefined : { opacity: 0, scale: 0.7, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ delay: 0.55, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  aria-hidden
                  className="cd-float pointer-events-none absolute -left-5 -top-5 hidden items-center gap-2 rounded-xl border border-zinc-200/80 bg-white/80 px-3 py-2 text-[11px] font-semibold text-zinc-700 shadow-lg shadow-black/5 backdrop-blur-md lg:inline-flex dark:border-zinc-700/70 dark:bg-zinc-900/80 dark:text-zinc-200"
                >
                  <Server className="size-3.5 text-brand" aria-hidden />
                  14 servers · auto-failover
                </motion.span>
                <motion.span
                  initial={reduceMotion ? undefined : { opacity: 0, scale: 0.7, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ delay: 0.7, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  aria-hidden
                  className="cd-float-delay pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-2 rounded-xl border border-zinc-200/80 bg-white/80 px-3 py-2 text-[11px] font-semibold text-zinc-700 shadow-lg shadow-black/5 backdrop-blur-md lg:inline-flex dark:border-zinc-700/70 dark:bg-zinc-900/80 dark:text-zinc-200"
                >
                  <Undo2 className="size-3.5 text-brand" aria-hidden />
                  Replays with full seek
                </motion.span>
                <motion.span
                  initial={reduceMotion ? undefined : { opacity: 0, scale: 0.7, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ delay: 0.85, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  aria-hidden
                  className="cd-float-slow pointer-events-none absolute -bottom-5 right-10 hidden items-center gap-2 rounded-xl border border-zinc-200/80 bg-white/80 px-3 py-2 text-[11px] font-semibold text-zinc-700 shadow-lg shadow-black/5 backdrop-blur-md lg:inline-flex dark:border-zinc-700/70 dark:bg-zinc-900/80 dark:text-zinc-200"
                >
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-70" />
                    <span className="relative inline-flex size-2 rounded-full bg-red-500" />
                  </span>
                  Live sports &amp; scores
                </motion.span>
              </>
            )}
          </motion.div>
        </motion.div>
      </div>

      {/* Stats band — what the site ships, at a glance (numbers count up) */}
      <motion.div
        {...fadeUp(0.22)}
        aria-label="What CineDeck ships"
        className="relative grid grid-cols-2 gap-2.5 pb-10 sm:grid-cols-4 lg:pb-14"
      >
        {[
          {
            icon: Clapperboard,
            value: 10000,
            suffix: '+',
            label: 'keyless catalogs',
          },
          {
            icon: Server,
            value: 14,
            suffix: '',
            label: 'auto-scan + failover',
          },
          {
            icon: Zap,
            value: null,
            text: 'One press',
            label: 'search → play',
          },
          {
            icon: Users,
            value: null,
            text: 'Free accounts',
            label: 'sync My List & history',
          },
        ].map(({ icon: Icon, value, suffix, text, label }, index) => (
          <motion.div
            key={label}
            initial={reduceMotion ? undefined : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 + index * 0.08 }}
            whileHover={reduceMotion ? undefined : { y: -4 }}
            className="group flex items-center gap-3 rounded-xl border border-zinc-200 bg-white/60 px-3.5 py-3 backdrop-blur-sm transition-colors duration-300 hover:border-brand/40 dark:border-zinc-800/60 dark:bg-zinc-900/40"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110">
              <Icon className="size-4.5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {value !== null ? <CountUp value={value} suffix={suffix} /> : text}
              </span>
              <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-500">{label}</span>
            </span>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
