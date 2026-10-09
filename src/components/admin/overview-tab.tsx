'use client';

// Overview — 6 stat cards with count-up numerals, clean line charts (no
// fills), a countries bar list and a compact activity feed.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  adminGet,
  AdmButton,
  Avatar,
  CountUp,
  PageHeader,
  Section,
  StatCard,
  useRefreshPing,
} from '@/components/admin/ui';

interface SeriesPoint {
  day: string;
  count: number;
}

interface OverviewPayload {
  cards: Record<string, number>;
  signupSeries: SeriesPoint[];
  dauSeries: SeriesPoint[];
  wauSeries: SeriesPoint[];
  mauSeries: SeriesPoint[];
  countries: { name: string; count: number }[];
  failedByIp: { ip: string; count: number }[];
  failedLogins24h: number;
  recentUsers: { id: string; email: string; name: string | null; role: string; createdAt: string; country: string | null; avatar: string | null }[];
  recentComments: { id: string; body: string; status: string; authorName: string | null; createdAt: string }[];
  providerStats: { id: string; okCount: number; failCount: number }[];
}

// ---------------------------------------------------------------------------
// Minimal SVG line chart — 1.5px stroke, grid hairlines, no fills, no libs.
// ---------------------------------------------------------------------------

const CHART_COLORS = ['#3b82f6', '#60a5fa', '#93c5fd'] as const;

function LineChart({ series, height = 200 }: { series: { name: string; points: SeriesPoint[] }[]; height?: number }) {
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.count)));
  const length = Math.max(1, (series[0]?.points.length ?? 1) - 1);
  const firstDay = series[0]?.points[0]?.day ?? '';
  const lastDay = series[0]?.points[series[0]!.points.length - 1]?.day ?? '';

  return (
    <div>
      <div className="flex items-baseline justify-between pb-2 font-mono text-[10px] text-[#6b7280]">
        <span>peak {max.toLocaleString('en-US')}</span>
        <span className="flex gap-3">
          {series.map((s, i) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden />
              {s.name}
            </span>
          ))}
        </span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }} className="w-full" role="img" aria-label={series.map((s) => s.name).join(' and ') + ' over time'}>
        {[0, 25, 50, 75, 100].map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="#1f1f1f" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s, i) => (
          <polyline
            key={s.name}
            points={s.points.map((p, idx) => `${(idx / length) * 100},${100 - (p.count / max) * 94 - 3}`).join(' ')}
            fill="none"
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="flex justify-between pt-1.5 font-mono text-[10px] text-[#6b7280]">
        <span>{firstDay}</span>
        <span>{lastDay}</span>
      </div>
    </div>
  );
}

function CountryBars({ data }: { data: { name: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  if (data.length === 0) return <p className="py-6 text-center text-xs text-[#6b7280]">No data yet.</p>;
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.name} className="flex items-center gap-3 text-xs">
          <span className="w-28 shrink-0 truncate text-[#9ca3af]">{d.name}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1f1f1f]">
            <span className="block h-full rounded-full bg-[#3b82f6] transition-all duration-300" style={{ width: `${(d.count / max) * 100}%` }} />
          </span>
          <span className="w-8 text-right font-mono tabular-nums text-[#9ca3af]">{d.count}</span>
        </li>
      ))}
    </ul>
  );
}

interface FeedItem {
  id: string;
  kind: 'signup' | 'comment';
  email: string;
  avatar: string | null;
  text: string;
  at: string;
}

export function OverviewTab() {
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => adminGet<OverviewPayload>('/api/admin?view=overview'),
    refetchInterval: 60_000,
  });
  useRefreshPing(dataUpdatedAt);

  const feed = useMemo<FeedItem[]>(() => {
    if (!data) return [];
    const items: FeedItem[] = [
      ...data.recentUsers.map((u) => ({
        id: `u-${u.id}`,
        kind: 'signup' as const,
        email: u.name || u.email,
        avatar: u.avatar,
        text: `signed up${u.country ? ` from ${u.country}` : ''}`,
        at: u.createdAt,
      })),
      ...data.recentComments.map((c) => ({
        id: `c-${c.id}`,
        kind: 'comment' as const,
        email: c.authorName ?? 'A member',
        avatar: null,
        text: `commented: ${c.body.slice(0, 60)}${c.body.length > 60 ? '…' : ''}`,
        at: c.createdAt,
      })),
    ];
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 12);
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="space-y-4" aria-busy>
        <div className="h-8 w-48 animate-pulse rounded bg-[#111111]" />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-[#111111]" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-lg bg-[#111111]" />
      </div>
    );
  }

  const c = data.cards;
  const signupTrend = c.newPrevWeek > 0 ? ((c.newWeek - c.newPrevWeek) / c.newPrevWeek) * 100 : c.newWeek > 0 ? 100 : 0;
  const weekTrend = signupTrend;

  const uptime = (seconds: number) => {
    const d = Math.floor(seconds / 86_400);
    const h = Math.floor((seconds % 86_400) / 3_600);
    const m = Math.floor((seconds % 3_600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    return `${h}h ${m}m`;
  };

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Platform activity at a glance — refreshed automatically every minute."
        actions={
          <AdmButton variant="ghost" onClick={() => void refetch()} aria-label="Refresh overview">
            <RefreshCw className="size-3.5" aria-hidden /> Refresh
          </AdmButton>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
        <StatCard label="Total Users" value={c.totalUsers} trend={c.newWeek + c.newPrevWeek > 0 ? weekTrend : null} />
        <StatCard label="Active Today" value={c.active24h} hint={`${c.activeNow} online now`} />
        <StatCard label="New This Week" value={c.newWeek} trend={weekTrend} />
        <StatCard label="Suspended" value={c.suspended} />
        <StatCard label="Sessions Active" value={c.sessionCount} />
        <StatCard label="Uptime" value={c.uptimeSeconds} format={uptime} />
      </div>

      {/* Charts + activity feed */}
      <div className="grid gap-4 pt-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Signups per day" description="New accounts over the last 30 days">
            <LineChart series={[{ name: 'Signups', points: data.signupSeries }]} />
          </Section>
          <Section title="Active users" description="Daily, weekly and monthly unique actives (30 days)">
            <LineChart
              series={[
                { name: 'DAU', points: data.dauSeries },
                { name: 'WAU', points: data.wauSeries },
                { name: 'MAU', points: data.mauSeries },
              ]}
            />
          </Section>
          <Section title="Signups by country" description="Top countries across all accounts">
            <CountryBars data={data.countries} />
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Recent activity" description="Latest signups and comments">
            {feed.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#6b7280]">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-[#1f1f1f]">
                {feed.map((item) => (
                  <li key={item.id} className="flex items-center gap-2.5 py-2.5">
                    <Avatar email={item.email} avatar={item.avatar} size={24} />
                    <p className="min-w-0 flex-1 truncate text-xs text-[#d1d5db]">
                      <span className="font-medium text-white">{item.email}</span>{' '}
                      <span className="text-[#9ca3af]">{item.text}</span>
                    </p>
                    <span className="shrink-0 font-mono text-[10px] text-[#6b7280]">{timeAgo(item.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Failed logins" description={`Last 24 hours — ${data.failedLogins24h} total`}>
            {data.failedByIp.length === 0 ? (
              <p className="py-4 text-center text-xs text-[#6b7280]">No failed attempts. Quiet day.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.failedByIp.slice(0, 6).map((f) => (
                  <li key={f.ip} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-mono text-[#9ca3af]">{f.ip}</span>
                    <span className="font-mono tabular-nums text-[#6b7280]">{f.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Stream providers" description="Source health from the latest scan">
            <ul className="space-y-1.5">
              {data.providerStats.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={cn('size-1.5 rounded-full', p.failCount > p.okCount ? 'bg-[#ef4444]' : 'bg-[#22c55e]')}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-[#9ca3af]">{p.id}</span>
                  <span className="font-mono tabular-nums text-[#6b7280]">
                    <CountUp value={p.okCount} /> ok · <CountUp value={p.failCount} /> fail
                  </span>
                </li>
              ))}
              {data.providerStats.length === 0 && <li className="text-xs text-[#6b7280]">No probes yet — run a scan.</li>}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
