'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clapperboard, Flag, Sparkles, Trophy, Tv } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { MediaCard, MediaCardSkeleton, type MediaCardItem } from '@/components/site/media-card';
import { SectionHeadingBar } from '@/components/site/media-row';
import { EmptyState } from '@/components/site/empty-state';
import { useFinnishCatalog } from '@/hooks/use-meta';
import { useRouter } from 'next/navigation';
import type { MetaSearchItem } from '@/lib/meta';

interface TvScheduleEntry {
  time: string;
  showName: string;
  episodeName: string | null;
  network: string;
  season: number | null;
  episode: number | null;
  image: string | null;
  imdbId: string | null;
  genre: string | null;
}

function toCard(item: MetaSearchItem): MediaCardItem {
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
    finnish: true,
  };
}

/**
 * "Tänään TV:ssä" — tonight's Finnish linear-TV schedule (Yle TV1, Yle TV2,
 * MTV3, Nelonen …) from /api/meta/tvschedule (TVmaze, cached server-side).
 * Network chips filter; primetime first. Clicking a show searches CineDeck.
 */
export function TvSchedule() {
  const [network, setNetwork] = useState('All');
  const router = useRouter();
  const query = useQuery<{ date: string; entries: TvScheduleEntry[] }>({
    queryKey: ['tvschedule'],
    queryFn: async () => {
      const res = await fetch('/api/meta/tvschedule');
      if (!res.ok) throw new Error('tvschedule_unreachable');
      return (await res.json()) as { date: string; entries: TvScheduleEntry[] };
    },
    staleTime: 30 * 60_000,
  });

  const entries = query.data?.entries ?? [];
  const networks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.network, (counts.get(e.network) ?? 0) + 1);
    return ['All', ...[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n]) => n)];
  }, [entries]);
  const filtered = network === 'All' ? entries : entries.filter((e) => e.network === network);
  // Primetime first: 18:00–23:59, then the rest chronologically.
  const ordered = useMemo(() => {
    const prime = filtered.filter((e) => e.time >= '18:00' && e.time <= '23:59');
    const rest = filtered.filter((e) => !(e.time >= '18:00' && e.time <= '23:59'));
    return [...prime, ...rest];
  }, [filtered]);

  return (
    <section aria-label="Finnish TV tonight" className="rounded-lg border border-border bg-card/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex h-4 w-1 rounded-full bg-[#002f6c]" aria-hidden />
        <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground md:text-xl">
          <Tv className="size-4.5 text-[#2f6db4]" aria-hidden />
          Tänään TV:ssä
        </h3>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Tonight on Finnish channels
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5" role="group" aria-label="Filter by network">
          {networks.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNetwork(n)}
              aria-pressed={network === n}
              className={`h-7 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
                network === n
                  ? 'border-[#2f6db4]/60 bg-[#002f6c]/10 text-[#2f6db4] dark:bg-[#002f6c]/30 dark:text-sky-200'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {query.isPending ? (
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="cd-shimmer h-24 rounded-lg bg-muted" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="mt-4 text-sm text-muted-foreground">
          The TV guide is unreachable right now — try again in a moment.
        </p>
      ) : ordered.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No listings for tonight yet.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {ordered.slice(0, 12).map((entry, i) => (
            <li key={`${entry.showName}-${entry.time}-${i}`}>
              <button
                type="button"
                onClick={() => router.push(`/?q=${encodeURIComponent(entry.showName)}&view=search`, { scroll: false })}
                className="flex h-24 w-full items-center gap-3 rounded-lg border border-border bg-card p-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[#2f6db4]/40"
              >
                {entry.image ? (
                   
                  <img
                    src={entry.image}
                    alt=""
                    loading="lazy"
                    className="h-full w-12 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <span className="flex h-full w-12 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Tv className="size-4 text-muted-foreground" aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-mono text-xs font-bold text-[#2f6db4] dark:text-sky-300">
                      {entry.time}
                    </span>
                    <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {entry.network}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] font-semibold text-foreground">
                    {entry.showName}
                  </span>
                  {entry.episodeName && (
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {entry.episodeName}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Finnish content page (/ ?view=finnish) — the home-turf surface: subtle
 * flag-accented hero, "Tänään TV:ssä" guide, Finnish movies + series grids
 * and a sports handoff. Works fully keyless (curated catalog + TMDB path).
 */
export function FinnishView() {
  const router = useRouter();
  const moviesQuery = useFinnishCatalog('movie', true);
  const tvQuery = useFinnishCatalog('tv', true);

  const grid = (items: MetaSearchItem[]) => (
    <div className="flex flex-wrap gap-3" role="list">
      {items.map((item, index) => (
        <MediaCard key={item.imdbId} item={toCard(item)} priority={index < 6} index={index} />
      ))}
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Hero — Finnish flag colors, subtle (blue field + white, no kitsch) */}
      <section
        aria-label="Finnish content"
        className="relative overflow-hidden rounded-lg border border-border bg-card p-6 sm:p-10"
      >
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-64 w-96 rotate-12 bg-gradient-to-b from-[#002f6c]/25 via-[#002f6c]/10 to-transparent blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 h-40 w-72 -rotate-6 bg-sky-100/40 blur-3xl dark:bg-sky-900/10" />
        <div className="relative max-w-2xl">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#2f6db4] dark:text-sky-300">
            <Flag className="size-3.5" aria-hidden />
            Suomalaista sisältöä
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl">
            Finnish movies, series &amp; live TV
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            Kotimaiset klassikot ja uudet sarjat — laidasta laitaan. Embed sources rarely carry
            Finnish audio, so every title page surfaces YLE Areena as a free, legal fallback.
            Browse below or check what&apos;s on TV tonight.
          </p>
        </div>
      </section>

      <TvSchedule />

      <section aria-label="Finnish movies">
        <SectionHeadingBar
          title="Suomalaiset elokuvat"
          icon={Clapperboard}
          hint="Finnish movies"
        />
        {moviesQuery.isPending ? (
          <div className="flex flex-wrap gap-3" aria-busy="true">
            {Array.from({ length: 12 }).map((_, i) => (
              <MediaCardSkeleton key={i} />
            ))}
          </div>
        ) : (moviesQuery.data?.length ?? 0) === 0 ? (
          <EmptyState variant="search" title="Finnish movies unavailable" subtitle="The catalog is unreachable right now." />
        ) : (
          grid(moviesQuery.data ?? [])
        )}
      </section>

      <section aria-label="Finnish series">
        <SectionHeadingBar title="Suomalaiset sarjat" icon={Sparkles} hint="Finnish series" />
        {tvQuery.isPending ? (
          <div className="flex flex-wrap gap-3" aria-busy="true">
            {Array.from({ length: 12 }).map((_, i) => (
              <MediaCardSkeleton key={i} />
            ))}
          </div>
        ) : (tvQuery.data?.length ?? 0) === 0 ? (
          <EmptyState variant="search" title="Finnish series unavailable" subtitle="The catalog is unreachable right now." />
        ) : (
          grid(tvQuery.data ?? [])
        )}
      </section>

      <section aria-label="Finnish sports">
        <button
          type="button"
          onClick={() => router.push('/?view=sports', { scroll: false })}
          className="group flex w-full items-center gap-4 rounded-lg border border-border bg-card px-5 py-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10">
            <Trophy className="size-5 text-brand" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-bold tracking-tight text-foreground">
              Urheilu suorana
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              Liiga, Veikkausliiga, rally &amp; more — live scores, replays and 280+ free channels
            </span>
          </span>
        </button>
      </section>
    </div>
  );
}

