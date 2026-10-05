'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  Award,
  BarChart3,
  Clock,
  Flame,
  ListChecks,
  Star,
  Trophy,
  History as HistoryIcon,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MediaRow, SectionHeadingBar } from '@/components/site/media-row';
import { MediaCard } from '@/components/site/media-card';
import { fetchHistory, type HistoryItem, type MediaType } from '@/lib/tmdb';
import { useUiStrings } from '@/lib/ui-strings';
import { fetchRatings, fetchWatchlist, type RatingRow, type WatchlistItem } from '@/lib/library';
import type { MetaSearchItem } from '@/lib/meta';

interface StatsPayload {
  titles: number;
  movies: number;
  series: number;
  hours: number;
  episodes: number;
  streakDays: number;
  ratedCount: number;
  avgRating: number | null;
  watchedCount: number;
  activity: { day: string; count: number }[];
}

function buildStats(history: HistoryItem[], ratings: RatingRow[]): StatsPayload {
  const movies = history.filter((h) => h.mediaType === 'movie').length;
  const series = history.length - movies;
  const hours = Math.round(
    history.reduce((sum, h) => sum + (h.durationSeconds ?? 0 ? Math.min(h.positionSeconds, h.durationSeconds ?? h.positionSeconds) : h.positionSeconds), 0) / 3600,
  );
  const episodes = history.filter((h) => h.mediaType === 'tv').length;

  // Streak: consecutive days (ending today/yesterday) with any activity.
  const days = new Set(history.map((h) => h.updatedAt.slice(0, 10)));
  let streakDays = 0;
  const cursor = new Date();
  const todayIso = cursor.toISOString().slice(0, 10);
  if (!days.has(todayIso)) cursor.setDate(cursor.getDate() - 1);
  for (let guard = 0; guard < 400; guard += 1) {
    const iso = cursor.toISOString().slice(0, 10);
    if (!days.has(iso)) break;
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // 30-day activity buckets.
  const activity: { day: string; count: number }[] = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    activity.push({ day: iso.slice(5), count: history.filter((h) => h.updatedAt.slice(0, 10) === iso).length });
  }

  const scored = ratings.filter((r) => r.score != null);
  return {
    titles: history.length,
    movies,
    series,
    hours,
    episodes,
    streakDays,
    ratedCount: scored.length,
    avgRating: scored.length > 0 ? scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length : null,
    watchedCount: ratings.filter((r) => r.watched).length,
    activity,
  };
}

const PIE_COLORS = ['#fbbf24', '#38bdf8'];

function StatCard({ icon: Icon, label, value, hint }: { icon: typeof Clock; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/50">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <Icon className="size-4 text-brand" aria-hidden />
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-500">{hint}</p>}
    </div>
  );
}

function Achievement({ icon: Icon, title, earned, hint }: { icon: typeof Trophy; title: string; earned: boolean; hint: string }) {
  return (
    <div
      className={
        'flex items-center gap-3 rounded-xl border p-3 transition-colors ' +
        (earned
          ? 'border-brand/40 bg-brand-soft/60'
          : 'border-zinc-200 bg-white/50 opacity-60 dark:border-zinc-800 dark:bg-zinc-900/40')
      }
      aria-label={`${title} — ${earned ? 'earned' : 'locked'}`}
    >
      <span
        className={
          'flex size-9 shrink-0 items-center justify-center rounded-xl ' +
          (earned ? 'bg-brand text-brand-foreground' : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500')
        }
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-200">{title}</p>
        <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-500">{hint}</p>
      </div>
    </div>
  );
}

/** Watch statistics view (?view=stats). */
export function StatsView() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const t = useUiStrings();
  const [range, setRange] = useState(60);

  const historyQuery = useQuery<HistoryItem[]>({
    queryKey: ['history', 'stats'],
    queryFn: () => fetchHistory(1000),
    staleTime: 30_000,
  });
  const ratingsQuery = useQuery<RatingRow[]>({
    queryKey: ['ratings'],
    queryFn: fetchRatings,
    staleTime: 30_000,
  });
  const watchlistQuery = useQuery<WatchlistItem[]>({
    queryKey: ['watchlist'],
    queryFn: fetchWatchlist,
    staleTime: 30_000,
  });

  const history = historyQuery.data ?? [];
  const stats = useMemo(
    () => buildStats(history.slice(0, range), ratingsQuery.data ?? []),
    [history, range, ratingsQuery.data],
  );

  // Recommendations reuse: top picks fetched by the home row are not shared
  // here — instead show most-watched recent titles as "rewatch picks".
  const rewatchPicks = useMemo(() => {
    const seen = new Set<string>();
    return history
      .filter((h) => {
        const key = `${h.tmdbId}:${h.mediaType}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 14)
      .map(
        (h) => ({
          id: h.tmdbId,
          mediaType: h.mediaType as MediaType,
          title: h.title,
          posterPath: h.posterPath,
          releaseDate: '',
          voteAverage: 0,
        }),
      );
  }, [history]);

  // Loading gate: wait for the first data tick, then render.
  const fadeIn = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3 } };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push('/', { scroll: false })}
          className="h-9 gap-1.5 rounded-lg px-2.5 text-sm text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to browse
        </Button>
        <div className="flex rounded-lg border border-zinc-200 p-0.5 text-xs dark:border-zinc-800" role="tablist" aria-label="Stats range">
          {[30, 90, 1000].map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={
                'rounded-md px-2.5 py-1 font-medium transition-colors ' +
                (range === r ? 'bg-brand text-brand-foreground' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200')
              }
            >
              {r === 1000 ? 'All' : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      <motion.header {...fadeIn}>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-100">
          <BarChart3 className="size-7 text-brand" aria-hidden />
          {t.statsTitle}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Everything you watched on CineDeck — positions, ratings and streaks, updated live.
        </p>
      </motion.header>

      {historyQuery.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl bg-zinc-200 dark:bg-zinc-900" />
          ))}
        </div>
      ) : (
        <>
          <motion.section {...fadeIn} className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Summary">
            <StatCard icon={Clock} label={t.timeWatched} value={`${stats.hours} h`} hint="positions + runtimes" />
            <StatCard icon={Trophy} label={t.titlesOpened} value={String(stats.titles)} hint={`${stats.movies} movies · ${stats.series} series`} />
            <StatCard icon={Flame} label={t.currentStreak} value={`${stats.streakDays} ${stats.streakDays === 1 ? 'day' : 'days'}`} hint="consecutive active days" />
            <StatCard icon={Star} label={t.avgRating} value={stats.avgRating != null ? stats.avgRating.toFixed(1) : '—'} hint={`${stats.ratedCount} rated · ${stats.watchedCount} marked watched`} />
          </motion.section>

          <motion.section {...fadeIn} className="grid gap-4 lg:grid-cols-3" aria-label="Charts">
            <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4 lg:col-span-2 dark:border-zinc-800/80 dark:bg-zinc-900/50">
              <SectionHeadingBar title="Watch activity — last 30 days" icon={BarChart3} />
              <div className="h-48" role="img" aria-label="Bar chart of watch activity for the last 30 days">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.activity} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} stroke="currentColor" className="text-zinc-400" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="currentColor" className="text-zinc-400" />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, fontSize: 12, background: 'rgba(255,255,255,0.96)', border: '1px solid #e4e4e7' }}
                      labelStyle={{ color: '#71717a' }}
                      cursor={{ fill: 'rgba(251,191,36,0.08)' }}
                    />
                    <Bar dataKey="count" fill="var(--cinedeck-accent)" radius={[4, 4, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/50">
              <SectionHeadingBar title="Split" icon={ListChecks} />
              <div className="h-36" role="img" aria-label="Pie chart of movies versus series share">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Movies', value: Math.max(stats.movies, 0.001) },
                        { name: 'Series', value: Math.max(stats.series, 0.001) },
                      ]}
                      dataKey="value"
                      innerRadius={38}
                      outerRadius={60}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {PIE_COLORS.map((color, i) => (
                        <Cell key={i} fill={color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex justify-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: PIE_COLORS[0] }} aria-hidden /> Movies</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: PIE_COLORS[1] }} aria-hidden /> Series</span>
              </div>
            </div>
          </motion.section>

          <motion.section {...fadeIn} aria-label="Achievements">
            <SectionHeadingBar title={t.achievements} icon={Award} hint="unlocked by watching" />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <Achievement icon={Trophy} title="First play" earned={stats.titles >= 1} hint="Open any title in the player" />
              <Achievement icon={Trophy} title="10 movies" earned={stats.movies >= 10} hint={`Watched ${Math.max(stats.movies, 0)} of 10`} />
              <Achievement icon={Trophy} title="7-day streak" earned={stats.streakDays >= 7} hint={`${stats.streakDays} of 7 days`} />
              <Achievement icon={Star} title="Critic" earned={stats.ratedCount >= 10} hint={`${stats.ratedCount} of 10 ratings`} />
              <Achievement icon={ListChecks} title="Curator" earned={(watchlistQuery.data?.length ?? 0) >= 10} hint={`${watchlistQuery.data?.length ?? 0} of 10 in My List`} />
              <Achievement icon={Clock} title="Marathon" earned={stats.hours >= 10} hint={`${stats.hours} of 10 hours watched`} />
            </div>
          </motion.section>

          {rewatchPicks.length > 0 && (
            <motion.section {...fadeIn} aria-label="Rewatch picks">
              <SectionHeadingBar title={t.rewatchPicks} icon={HistoryIcon} hint="from your history" />
              <MediaRow label="Rewatch picks">
                {rewatchPicks.map((item, index) => (
                  <MediaCard key={`${item.id}-${item.mediaType}-${index}`} item={item} index={index} />
                ))}
              </MediaRow>
            </motion.section>
          )}
        </>
      )}
    </div>
  );
}
