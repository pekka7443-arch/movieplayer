'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowRight,
  Bookmark,
  Clapperboard,
  Compass,
  Film,
  Flag,
  History,
  LayoutGrid,
  Play,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Trophy,
  Tv,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { HeroSection } from '@/components/site/hero-section';
import {
  MediaCard,
  MediaCardSkeleton,
  type MediaCardItem,
} from '@/components/site/media-card';
import { MediaRow } from '@/components/site/media-row';
import { useNearViewport } from '@/hooks/use-near-viewport';
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCinedeckStore } from '@/lib/store';
import { useHasTmdbKey } from '@/lib/settings';
import { useSession } from '@/hooks/use-session';
import {
  useCatalog,
  useRemoveHistory,
  useRemoveWatchlist,
  useTrending,
  usePopularMovies,
  usePopularTV,
  useHistory,
  useWatchlist,
  type CatalogParams,
} from '@/hooks/use-media';
import { type HistoryItem, type SearchItem, type WatchlistItem } from '@/lib/tmdb';
import { tmdbImg } from '@/lib/languages';
import type { MetaSearchItem } from '@/lib/meta';
import { useFinnishCatalog } from '@/hooks/use-meta';
import { CustomLists } from '@/components/site/custom-lists';
import { fetchProfiles, type ProfileRow } from '@/lib/library';

type AnyRowItem = SearchItem | MetaSearchItem;

/** Normalize either TMDB or keyless Cinemeta row items into MediaCardItem. */
function toCardItem(item: AnyRowItem): MediaCardItem {
  if ('imdbId' in item) {
    // Keyless Cinemeta item — poster is a full URL, watch URL prefers tmdbId.
    return {
      id: item.tmdbId ?? 0,
      imdbId: item.imdbId,
      mediaType: item.mediaType,
      title: item.title,
      posterPath: null,
      posterUrl: item.poster ?? null,
      releaseDate: item.year ? `${item.year}-01-01` : '',
      voteAverage: item.voteAverage,
      genre: item.genre,
    };
  }
  return item;
}

function rowKeyOf(item: AnyRowItem): string {
  if ('imdbId' in item) return `meta-${item.imdbId}`;
  return `${item.mediaType}-${item.id}`;
}

function SectionHeading({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
}) {
  // Section heading: small accent vertical bar + bold tracking-tight title.
  // Repaints live with the user's chosen accent color (bg-brand).
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
      <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-zinc-900 md:text-xl dark:text-zinc-100">
        <span className="size-4 rounded-full bg-brand md:h-5 md:w-1" aria-hidden />
        <Icon className="size-5 text-brand" aria-hidden />
        {title}
      </h2>
      {hint && <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </div>
  );
}

/** Skeleton stripe shown by LazySection until the row scrolls near. */
function RowSkeletonStripe() {
  return (
    <div className="flex gap-3 overflow-hidden sm:gap-4">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="w-[130px] shrink-0 sm:w-[160px] md:w-[180px]">
          <Skeleton className="cd-shimmer aspect-[2/3] w-full rounded-xl bg-zinc-200 dark:bg-zinc-900" />
        </div>
      ))}
    </div>
  );
}

/** Rotating highlight text for the sports teaser band. */
const SPORTS_HIGHLIGHTS = [
  'Live scores & schedules',
  'Replays with full seek',
  'Rally · WRC · F1',
  '280+ free sports channels',
] as const;

function CyclingHighlight() {
  const [index, setIndex] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % SPORTS_HIGHLIGHTS.length),
      2600,
    );
    return () => clearInterval(timer);
  }, [reduceMotion]);

  const text = reduceMotion ? SPORTS_HIGHLIGHTS[0] : SPORTS_HIGHLIGHTS[index];
  return (
    <span aria-hidden className="relative inline-flex h-5 min-w-52 overflow-hidden align-middle">
      <AnimatePresence mode="wait">
        <motion.span
          key={text}
          initial={reduceMotion ? undefined : { y: 14, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduceMotion ? undefined : { y: -14, opacity: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="absolute whitespace-nowrap text-brand"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * Renders its children only once scrolled close to the viewport — keeps the
 * (now much bigger) home page fast: below-fold rows fetch when approached.
 */
function LazySection({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    // IntersectionObserver is available in every supported browser; when it
    // is somehow missing the row simply stays on its skeleton (safe no-op).
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '700px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <section ref={ref} id={id} aria-label={label} aria-busy={!visible}>
      {visible ? children : <RowSkeletonStripe />}
    </section>
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
          {/* Watch-progress bar — real seconds spent watching vs runtime. */}
          {item.durationSeconds != null && item.durationSeconds > 0 && (
            <span className="absolute inset-x-0 bottom-0 block h-1 bg-zinc-950/60" aria-hidden>
              <span
                className="block h-full bg-brand transition-[width] duration-500"
                style={{
                  width: `${Math.min(100, Math.round((item.positionSeconds / item.durationSeconds) * 100))}%`,
                }}
              />
            </span>
          )}
        </span>
        <span className="mt-2 block truncate text-sm font-medium text-zinc-800 transition-colors group-hover:text-amber-600 dark:text-zinc-200 dark:group-hover:text-amber-300">
          {item.title}
        </span>
        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
          {item.durationSeconds != null && item.durationSeconds > 0
            ? `${Math.min(100, Math.round((item.positionSeconds / item.durationSeconds) * 100))}% watched`
            : item.positionSeconds > 0
              ? `${Math.round(item.positionSeconds / 60)} min watched`
              : 'Continue watching'}
        </span>
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
        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">In My List</span>
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
    <div className="flex h-32 w-full items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-200/30 text-sm text-zinc-500 dark:border-zinc-800/80 dark:bg-zinc-900/30 dark:text-zinc-400">
      {text}
    </div>
  );
}

/** Shared fetch-state shell for keyless catalog rows (skeleton / cards / empty). */
function CatalogRow({
  icon,
  title,
  hint,
  params,
  enabled,
  priorityCount = 4,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  params: CatalogParams;
  enabled: boolean;
  priorityCount?: number;
}) {
  // Below-fold rows defer BOTH their fetch and their ~20-card hydration until
  // they scroll near the viewport (800px) — the skeleton keeps the layout
  // stable in the meantime. Above-the-fold rows start near=true immediately.
  const { ref, near } = useNearViewport<HTMLDivElement>();
  const query = useCatalog(params, enabled && near);
  const items = query.data;
  const reduceMotion = useReducedMotion();
  const reveal = {
    initial: reduceMotion ? undefined : { opacity: 0, y: 22 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-70px' },
    transition: { duration: 0.5, ease: 'easeOut' as const },
  };

  return (
    <motion.div {...reveal} ref={ref}>
      <SectionHeading icon={icon} title={title} hint={hint} />
      {!near || query.isPending || (!enabled && !items) ? (
        <RowSkeletonStripe />
      ) : query.isError ? (
        <RowEmptyState text="This row is unavailable right now." />
      ) : items && items.length > 0 ? (
        <MediaRow label={title}>
          {items.map((item, index) => {
            const card = toCardItem(item);
            return <MediaCard key={rowKeyOf(item)} item={card} priority={index < priorityCount} index={index} />;
          })}
        </MediaRow>
      ) : (
        <RowEmptyState text="Nothing here right now." />
      )}
    </motion.div>
  );
}

/**
 * "Suomalaista sisältöä" — Finnish movies & series row. Works fully keyless:
 * a curated catalog of Finnish originals resolved to IMDB+TMDB ids via
 * Cinemeta (with a TMDB key the backend uses TMDB discover instead). Every
 * item carries BOTH ids so the player scan can try whichever id form the
 * embed servers actually index the title under.
 */
function FinnishSection() {
  const contentType = useCinedeckStore((s) => s.contentType);
  const reduceMotion = useReducedMotion();
  const wantMovies = contentType !== 'tv';
  const wantTv = contentType !== 'movie';
  // Deferred like CatalogRow: fetch + hydrate only when near the viewport.
  const { ref, near } = useNearViewport<HTMLElement>();
  const moviesQuery = useFinnishCatalog('movie', wantMovies && near);
  const tvQuery = useFinnishCatalog('tv', wantTv && near);

  // Interleave movies and series (movies first) so the row mixes both —
  // the global browse filter decides which of the two lists contributes.
  // (A disabled query keeps its cached data — respect the flag, not the cache.)
  const items = useMemo(() => {
    const m = wantMovies ? (moviesQuery.data ?? []) : [];
    const t = wantTv ? (tvQuery.data ?? []) : [];
    const out: MetaSearchItem[] = [];
    const max = Math.max(m.length, t.length);
    for (let i = 0; i < max; i++) {
      if (m[i]) out.push(m[i]);
      if (t[i]) out.push(t[i]);
    }
    return out;
  }, [wantMovies, wantTv, moviesQuery.data, tvQuery.data]);

  const loading = (wantMovies && moviesQuery.isPending) || (wantTv && tvQuery.isPending);
  const title =
    contentType === 'movie'
      ? 'Suomalaiset elokuvat'
      : contentType === 'tv'
        ? 'Suomalaiset sarjat'
        : 'Suomalaista sisältöä';

  const reveal = {
    initial: reduceMotion ? undefined : { opacity: 0, y: 22 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-70px' },
    transition: { duration: 0.5, ease: 'easeOut' as const },
  };

  return (
    <motion.section {...reveal} ref={ref} aria-labelledby="finnish-picks">
      <div id="finnish-picks" className="scroll-mt-24">
        <SectionHeading
          icon={Flag}
          title={title}
          hint="Finnish originals — Yle Areena fallback on every title page"
        />
      </div>
      {loading || !near ? (
        <RowSkeletonStripe />
      ) : items.length > 0 ? (
        <MediaRow label={title}>
          {items.map((item, index) => (
            <MediaCard key={rowKeyOf(item)} item={toCardItem(item)} priority={index < 4} index={index} />
          ))}
        </MediaRow>
      ) : (
        <RowEmptyState text="Finnish catalog is unavailable right now." />
      )}
    </motion.section>
  );
}

// Curated Cinemeta genre labels for the Explore section (all verified live).
const EXPLORE_GENRES = [
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Crime',
  'Drama',
  'Fantasy',
  'Horror',
  'Mystery',
  'Romance',
  'Science Fiction',
  'Thriller',
] as const;

export function HomeView({ initialTrending }: { initialTrending?: MetaSearchItem[] }) {
  const router = useRouter();
  const language = useCinedeckStore((s) => s.language);
  const openSettings = useCinedeckStore((s) => s.openSettings);
  const contentType = useCinedeckStore((s) => s.contentType);
  const setContentType = useCinedeckStore((s) => s.setContentType);
  const hasKey = useHasTmdbKey();
  const reduceMotion = useReducedMotion();
  const { user } = useSession();

  const [exploreGenre, setExploreGenre] = useState<string>('Action');
  const [localExploreType, setLocalExploreType] = useState<'movie' | 'tv'>('movie');
  // The global Movies/TV filter also drives the Explore section when active.
  const exploreType = contentType === 'all' ? localExploreType : contentType;
  const pickExploreType = (t: 'movie' | 'tv') => {
    setLocalExploreType(t);
    if (contentType !== 'all') setContentType(t);
  };

  // Always fetch trending + popular (keyless Cinemeta fallback is built into
  // the hooks themselves). When the user has a TMDB key, the data comes from
  // TMDB; without a key, it comes from Cinemeta's public catalogs so the
  // home view shows real content instead of "Connect TMDB" prompts.
  const trendingQuery = useTrending(language, true, initialTrending);
  const popularMoviesQuery = usePopularMovies(language, true);
  const popularTVQuery = usePopularTV(language, true);
  const historyQuery = useHistory();
  const watchlistQuery = useWatchlist();

  const trending = trendingQuery.data;
  const popularMovies = popularMoviesQuery.data;
  const popularTV = popularTVQuery.data;
  const historyItems = historyQuery.data ?? [];
  const watchlistItems = watchlistQuery.data ?? [];

  // Profiles (signed-in only) — kids profiles get a family-safe genre filter.
  const activeProfileId = useCinedeckStore((s) => s.activeProfileId);
  const profilesQuery = useQuery<ProfileRow[]>({
    queryKey: ['profiles'],
    queryFn: fetchProfiles,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });
  const isKidsProfile = useMemo(
    () => (profilesQuery.data ?? []).some((p) => p.id === activeProfileId && p.isKids),
    [profilesQuery.data, activeProfileId],
  );
  const KIDS_BLOCKED_GENRES = new Set(['Horror', 'Thriller', 'Crime', 'War', 'Documentary', 'Mystery']);
  const kidsFilter = useCallback(
    (items: AnyRowItem[] | undefined): AnyRowItem[] | undefined => {
      if (!isKidsProfile || !items) return items;
      return items.filter((i) => {
        const genre = 'genre' in i ? i.genre : undefined;
        return !genre || !KIDS_BLOCKED_GENRES.has(genre);
      });
    },
    [isKidsProfile],
  );

  // Global Movies / TV Series filter — trims every mixed row (trending,
  // continue watching, my list). Catalog rows handle it via their `type` param.
  const filteredTrending = useMemo(
    () => kidsFilter(contentType === 'all' ? trending : trending?.filter((i) => i.mediaType === contentType)),
    [trending, contentType, kidsFilter],
  );
  const filteredHistory = useMemo(
    () => (contentType === 'all' ? historyItems : historyItems.filter((i) => i.mediaType === contentType)),
    [historyItems, contentType],
  );
  const filteredWatchlist = useMemo(
    () => (contentType === 'all' ? watchlistItems : watchlistItems.filter((i) => i.mediaType === contentType)),
    [watchlistItems, contentType],
  );

  const syncHint = user ? 'Synced to your account' : 'Saved on this device';
  const currentYear = new Date().getFullYear();

  // Scroll-reveal for every home section: rises in once, 70px before it
  // would enter the viewport.
  const fadeIn = {
    initial: reduceMotion ? undefined : { opacity: 0, y: 22 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-70px' },
    transition: { duration: 0.5, ease: 'easeOut' as const },
  };

  return (
    <div className="space-y-12">
      <HeroSection
        trending={filteredTrending}
        trendingLoading={trendingQuery.isPending}
        hasKey={hasKey}
      />

      {/* Global content filter — Movies / TV Series / All. Slides the amber
          pill, persists the choice and filters every row + search below. */}
      <motion.section {...fadeIn} aria-label="Browse filter">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-zinc-200 bg-white/70 px-4 py-3 shadow-sm backdrop-blur-sm dark:border-zinc-800/60 dark:bg-zinc-900/50">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <LayoutGrid className="size-3.5 text-brand" aria-hidden />
            Browse
          </span>
          <div
            role="group"
            aria-label="Show movies or series"
            className="flex rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-950/60"
          >
            {([
              { id: 'all', label: 'All', icon: LayoutGrid },
              { id: 'movie', label: 'Movies', icon: Film },
              { id: 'tv', label: 'TV Series', icon: Tv },
            ] as const).map(({ id, label, icon: Icon }) => {
              const active = contentType === id;
              return (
                <motion.button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setContentType(id)}
                  whileTap={reduceMotion ? undefined : { scale: 0.95 }}
                  className={`relative flex h-8 items-center gap-1.5 overflow-hidden rounded-lg px-3.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:px-4 ${
                    active
                      ? 'text-brand-foreground'
                      : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="content-filter-pill"
                      className="absolute inset-0 rounded-lg bg-brand shadow-[0_0_16px_color-mix(in_srgb,var(--cinedeck-accent)_35%,transparent)]"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    <Icon className="size-3.5" aria-hidden />
                    {label}
                  </span>
                </motion.button>
              );
            })}
          </div>
          <span className="ml-auto hidden text-[11px] text-zinc-500 md:inline dark:text-zinc-400">
            {contentType === 'all'
              ? 'Showing everything — pick Movies or TV Series to filter every row'
              : `Showing ${contentType === 'movie' ? 'movies only' : 'series only'} — every row, the hero and search respect this`}
          </span>
        </div>
      </motion.section>

      {/* Live Sports teaser band */}
      <motion.section {...fadeIn} aria-labelledby="sports-teaser">
        <button
          type="button"
          id="sports-teaser"
          onClick={() => router.push('/?view=sports', { scroll: false })}
          className="group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white/80 px-5 py-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[0_16px_44px_-14px_color-mix(in_srgb,var(--cinedeck-accent)_35%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 dark:border-zinc-800 dark:bg-zinc-900/60"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-16 h-44 w-72 rounded-full bg-brand-soft blur-3xl"
          />
          <span aria-hidden className="cd-shine" />
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
            <Trophy className="size-5 text-brand" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              <span className="relative flex size-2" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-red-500" />
              </span>
              Live Sports
            </span>
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
              Live scores, schedules, replays &amp; 280+ free sports TV channels — keyless.
            </span>
          </span>
          <span
            aria-hidden
            className="ml-auto hidden shrink-0 items-center text-xs font-medium text-zinc-500 md:inline-flex dark:text-zinc-400"
          >
            <CyclingHighlight />
          </span>
          <ArrowRight
            className="ml-auto size-5 shrink-0 text-zinc-400 transition-transform duration-300 group-hover:translate-x-1.5 group-hover:text-brand md:ml-4"
            aria-hidden
          />
        </button>
      </motion.section>

      {/* Continue watching */}
      <motion.section {...fadeIn} aria-labelledby="continue-watching">
        <div id="continue-watching" className="scroll-mt-24">
          <SectionHeading icon={History} title="Continue watching" hint={syncHint} />
        </div>
        {historyQuery.isPending ? (
          <div className="flex gap-3 overflow-hidden sm:gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-32 shrink-0 sm:w-36">
                <Skeleton className="cd-shimmer aspect-[2/3] w-full rounded-xl bg-zinc-200 dark:bg-zinc-900" />
              </div>
            ))}
          </div>
        ) : filteredHistory.length === 0 ? (
          <RowEmptyState
            text={
              historyItems.length > 0
                ? `No ${contentType === 'tv' ? 'series' : 'movies'} in progress — switch the browse filter to All.`
                : 'Nothing in progress yet — play something to pick up where you left off.'
            }
          />
        ) : (
          <MediaRow label="Continue watching">
            {filteredHistory.map((item) => (
              <HistoryCard key={item.id} item={item} />
            ))}
          </MediaRow>
        )}
      </motion.section>

      {/* My List */}
      <motion.section {...fadeIn} aria-labelledby="my-list">
        <div id="my-list" className="scroll-mt-24">
          <SectionHeading icon={Bookmark} title="My List" hint={syncHint} />
        </div>
        {watchlistQuery.isPending ? (
          <div className="flex gap-3 overflow-hidden sm:gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-32 shrink-0 sm:w-36">
                <Skeleton className="cd-shimmer aspect-[2/3] w-full rounded-xl bg-zinc-200 dark:bg-zinc-900" />
              </div>
            ))}
          </div>
        ) : filteredWatchlist.length === 0 ? (
          <RowEmptyState
            text={
              watchlistItems.length > 0
                ? `No ${contentType === 'tv' ? 'series' : 'movies'} saved — switch the browse filter to All.`
                : user
                  ? 'Your list is empty — tap the bookmark on any title to save it here.'
                  : 'Your list is empty — bookmark titles or create an account to sync them everywhere.'
            }
          />
        ) : (
          <MediaRow label="My List">
            {filteredWatchlist.map((item) => (
              <WatchlistCard key={item.id} item={item} />
            ))}
          </MediaRow>
        )}
      </motion.section>

      {/* Custom lists — create, curate, share (renders under My List) */}
      {user && (
        <motion.section {...fadeIn} aria-label="Custom lists wrapper" className="mb-8">
          <CustomLists />
        </motion.section>
      )}

      {/* Trending — horizontal scroll row (type follows the browse filter) */}
      <motion.section {...fadeIn} aria-labelledby="trending-week">
        <div id="trending-week" className="scroll-mt-24">
          <SectionHeading
            icon={TrendingUp}
            title={contentType === 'movie' ? 'Trending Movies' : contentType === 'tv' ? 'Trending Series' : 'Trending Now'}
            hint={hasKey ? 'This week on TMDB' : 'Top picks'}
          />
        </div>
        {trendingQuery.isPending ? (
          <RowSkeletonStripe />
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
        ) : filteredTrending && filteredTrending.length > 0 ? (
          <MediaRow label="Trending Now">
            {filteredTrending.map((item, index) => (
              <MediaCard
                key={rowKeyOf(item)}
                item={toCardItem(item)}
                priority={index < 6}
                index={index}
              />
            ))}
          </MediaRow>
        ) : (
          <RowEmptyState text="No trending data available right now." />
        )}
      </motion.section>

      {/* Popular Movies — hidden while the filter shows series only */}
      {contentType !== 'tv' && (
      <motion.section {...fadeIn} aria-labelledby="popular-movies">
        <div id="popular-movies" className="scroll-mt-24">
          <SectionHeading icon={Film} title="Popular Movies" hint={hasKey ? 'All-time on TMDB' : 'Cinemeta top'} />
        </div>
        {popularMoviesQuery.isPending ? (
          <RowSkeletonStripe />
        ) : popularMoviesQuery.isError ? null : popularMovies && popularMovies.length > 0 ? (
          <MediaRow label="Popular Movies">
            {popularMovies.map((item, index) => (
              <MediaCard
                key={rowKeyOf(item)}
                item={toCardItem(item)}
                priority={index < 4}
                index={index}
              />
            ))}
          </MediaRow>
        ) : (
          <RowEmptyState text="No popular movies right now." />
        )}
      </motion.section>
      )}

      {/* Popular TV Shows — hidden while the filter shows movies only */}
      {contentType !== 'movie' && (
      <motion.section {...fadeIn} aria-labelledby="popular-tv">
        <div id="popular-tv" className="scroll-mt-24">
          <SectionHeading icon={Tv} title="Popular TV Shows" hint={hasKey ? 'All-time on TMDB' : 'Cinemeta top'} />
        </div>
        {popularTVQuery.isPending ? (
          <RowSkeletonStripe />
        ) : popularTVQuery.isError ? null : popularTV && popularTV.length > 0 ? (
          <MediaRow label="Popular TV Shows">
            {popularTV.map((item, index) => (
              <MediaCard
                key={rowKeyOf(item)}
                item={toCardItem(item)}
                priority={index < 4}
                index={index}
              />
            ))}
          </MediaRow>
        ) : (
          <RowEmptyState text="No popular TV shows right now." />
        )}
      </motion.section>
      )}

      {/* Suomalainen sisältö — the home-turf row. Embed servers rarely index
          Finnish titles, so every item carries both IMDB + TMDB ids and the
          scan tries both; title pages surface Yle Areena as fallback. */}
      <FinnishSection />

      {/* Top Rated — keyless imdbRating catalog, type follows the browse filter */}
      <LazySection id="top-rated" label="Top rated">
        <CatalogRow
          icon={Trophy}
          title={contentType === 'tv' ? 'Top Rated Shows' : 'Top Rated Movies'}
          hint="IMDB all-time greats"
          params={{ type: contentType === 'tv' ? 'tv' : 'movie', sort: 'imdbRating' }}
          enabled
        />
      </LazySection>

      {/* New This Year — keyless year catalog, type follows the browse filter */}
      <LazySection id="new-this-year" label="New this year">
        <CatalogRow
          icon={Sparkles}
          title={
            contentType === 'tv'
              ? `New series in ${currentYear}`
              : contentType === 'movie'
                ? `New movies in ${currentYear}`
                : `New in ${currentYear}`
          }
          hint="Fresh releases"
          params={{ type: contentType === 'tv' ? 'tv' : 'movie', year: currentYear }}
          enabled
        />
      </LazySection>

      {/* Explore by genre — interactive keyless genre browser */}
      <LazySection id="explore" label="Explore by genre">
        <div>
          <SectionHeading
            icon={Compass}
            title="Explore by genre"
            hint="Pick a mood — instant keyless catalog"
          />
          <div
            role="group"
            aria-label="Genre filter"
            className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {EXPLORE_GENRES.map((genre) => {
              const active = genre === exploreGenre;
              return (
                <motion.button
                  key={genre}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setExploreGenre(genre)}
                  whileTap={reduceMotion ? undefined : { scale: 0.94 }}
                  className={`relative h-8 shrink-0 overflow-hidden rounded-full border px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
                    active
                      ? 'border-transparent text-brand-foreground'
                      : 'border-zinc-200 bg-white/70 text-zinc-600 hover:border-brand/40 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="explore-genre-pill"
                      className="absolute inset-0 rounded-full bg-brand shadow-[0_0_14px_color-mix(in_srgb,var(--cinedeck-accent)_30%,transparent)]"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10">{genre}</span>
                </motion.button>
              );
            })}
          </div>
          <div className="mb-4 flex items-center gap-2">
            <div className="flex rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-950/60">
              {(['movie', 'tv'] as const).map((t) => (
                <motion.button
                  key={t}
                  type="button"
                  aria-pressed={exploreType === t}
                  onClick={() => pickExploreType(t)}
                  whileTap={reduceMotion ? undefined : { scale: 0.95 }}
                  className={`relative flex h-7 items-center gap-1.5 overflow-hidden rounded-md px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
                    exploreType === t
                      ? 'text-brand-foreground'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  {exploreType === t && (
                    <motion.span
                      layoutId="explore-type-pill"
                      className="absolute inset-0 rounded-md bg-brand"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    {t === 'movie' ? <Film className="size-3.5" aria-hidden /> : <Tv className="size-3.5" aria-hidden />}
                    {t === 'movie' ? 'Movies' : 'TV'}
                  </span>
                </motion.button>
              ))}
            </div>
          </div>
          <CatalogRow
            icon={Clapperboard}
            title={`${exploreGenre} ${exploreType === 'movie' ? 'movies' : 'shows'}`}
            params={{ type: exploreType, genre: exploreGenre, sort: 'top' }}
            enabled
            priorityCount={6}
          />
        </div>
      </LazySection>

      {/* Keyless nudge — the full TMDB layer is optional, not a paywall. */}
      {!hasKey && (
        <motion.section
          {...fadeIn}
          aria-label="Unlock the TMDB layer"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-zinc-300 bg-white/50 px-4 py-3.5 dark:border-zinc-700/60 dark:bg-zinc-900/40"
        >
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">Optional:</span>{' '}
            connect a free TMDB key in Settings for localized titles, cast photos &amp; richer
            details — everything above already works without it.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openSettings}
            className="h-8 shrink-0 rounded-lg border-zinc-300 px-3 text-xs text-zinc-700 hover:bg-zinc-200/70 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
          >
            Open settings
          </Button>
        </motion.section>
      )}
    </div>
  );
}
