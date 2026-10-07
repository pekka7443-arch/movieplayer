'use client';

// PHASE 3 — /admin dashboard: Overview, Users (+detail), Moderation, Audit,
// Flags, Sessions, Logs. Everything role-gated server-side; this UI only
// renders what the admin API answers.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity,
  ArrowLeft,
  Ban,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  Flag,
  LogOut,
  Mail,
  Megaphone,
  MonitorSmartphone,
  MousePointerClick,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { browserLabel, deviceLabel, timeAgo } from '@/lib/format';
import {
  fetchSessions,
  revokeAllMySessions,
  revokeOneSession,
  revokeOtherSessions,
  type SessionInfo,
} from '@/lib/auth-client';
import { invalidateIdentityCaches, useSession } from '@/hooks/use-session';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`admin_${res.status}`);
  return (await res.json()) as T;
}

async function adminAction(body: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(payload.error?.message ?? `admin_${res.status}`);
  }
}

interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  avatar: string | null;
  createdAt: string;
  country: string | null;
  city: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  suspensionEndsAt: string | null;
  deletedAt: string | null;
  emailVerified: boolean;
  totpEnabled: boolean;
  signupIp: string | null;
  watchCount: number;
  watchlistSize: number;
  commentCount: number;
  ratingCount: number;
  sessionCount: number;
  lastSeenAt: string | null;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const COUNTRY_FLAG = (code: string | null) => {
  if (!code || code.length !== 2) return '';
  const base = 0x1f1e6;
  return String.fromCodePoint(base + code.toUpperCase().charCodeAt(0) - 65, base + code.toUpperCase().charCodeAt(1) - 65);
};

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 py-10 text-center dark:border-zinc-700">
      <span className="text-zinc-400">{icon}</span>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/60">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="pt-0.5 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</p>
      {hint && <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role gate + tab shell
// ---------------------------------------------------------------------------

type Tab = 'overview' | 'users' | 'moderation' | 'audit' | 'flags' | 'sessions' | 'my-sessions' | 'logs';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <BarChart3 className="size-4" aria-hidden /> },
  { id: 'users', label: 'Users', icon: <Users className="size-4" aria-hidden /> },
  { id: 'moderation', label: 'Moderation', icon: <ClipboardList className="size-4" aria-hidden /> },
  { id: 'audit', label: 'Audit log', icon: <ScrollText className="size-4" aria-hidden /> },
  { id: 'flags', label: 'Feature flags', icon: <Flag className="size-4" aria-hidden /> },
  { id: 'sessions', label: 'Sessions', icon: <Activity className="size-4" aria-hidden /> },
  { id: 'my-sessions', label: 'My sessions', icon: <MonitorSmartphone className="size-4" aria-hidden /> },
  { id: 'logs', label: 'Logs', icon: <MousePointerClick className="size-4" aria-hidden /> },
];

export function AdminView() {
  const router = useRouter();
  const { user, loading } = useSession();
  const [tab, setTab] = useState<Tab>('overview');

  if (loading) {
    return <Skeleton className="h-64 rounded-2xl bg-zinc-200 dark:bg-zinc-900" />;
  }
  if (user?.role !== 'admin') {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
        <ShieldCheck className="mx-auto size-8 text-zinc-400" aria-hidden />
        <h1 className="mt-3 text-lg font-bold text-zinc-800 dark:text-zinc-200">Admin area</h1>
        <p className="mt-1 text-sm text-zinc-500">You don’t have access to this view.</p>
        <Button variant="outline" size="sm" onClick={() => router.push('/', { scroll: false })} className="mt-4 rounded-lg">
          Back to browse
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          <ShieldCheck className="size-5 text-brand" aria-hidden /> Admin dashboard
        </h1>
      </div>

      <div role="tablist" aria-label="Admin sections" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors',
              tab === t.id
                ? 'border-brand/50 bg-brand/15 text-zinc-900 dark:text-zinc-50'
                : 'border-zinc-200 text-zinc-600 hover:bg-zinc-200/60 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'moderation' && <ModerationTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'flags' && <FlagsTab />}
      {tab === 'sessions' && <SessionsTab />}
      {tab === 'my-sessions' && <MySessionsTab />}
      {tab === 'logs' && <LogsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OVERVIEW
// ---------------------------------------------------------------------------

interface OverviewPayload {
  cards: Record<string, number>;
  signupSeries: { day: string; count: number }[];
  dauSeries: { day: string; count: number }[];
  countries: { name: string; count: number }[];
  browsers: { name: string; count: number }[];
  devices: { name: string; count: number }[];
  failedByIp: { ip: string; count: number }[];
  failedLogins24h: number;
  recentUsers: { id: string; email: string; name: string | null; role: string; createdAt: string; country: string | null; avatar: string | null }[];
  topTitles: { tmdbId: number; mediaType: string; title: string; watchers: number }[];
  providerStats: { id: string; okCount: number; failCount: number; lastOkAt: string | null; lastFailAt: string | null }[];
  announcement: { id: string; message: string; active: boolean; createdAt: string } | null;
}

function SimpleBars({ data, color = 'bg-brand' }: { data: { name: string; count: number }[]; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  if (data.length === 0) return <p className="py-4 text-center text-xs text-zinc-500">No data yet.</p>;
  return (
    <ul className="space-y-1.5">
      {data.map((d) => (
        <li key={d.name} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 truncate text-zinc-600 dark:text-zinc-300">{d.name}</span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <span className={cn('block h-full rounded-full', color)} style={{ width: `${(d.count / max) * 100}%` }} />
          </span>
          <span className="w-8 text-right tabular-nums text-zinc-500">{d.count}</span>
        </li>
      ))}
    </ul>
  );
}

function Sparkline({ series, label }: { series: { day: string; count: number }[]; label: string }) {
  const max = Math.max(1, ...series.map((s) => s.count));
  return (
    <div>
      <p className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
      <div className="flex h-16 items-end gap-[2px]" aria-hidden>
        {series.map((s) => (
          <span
            key={s.day}
            title={`${s.day}: ${s.count}`}
            className="flex-1 rounded-t bg-brand/70"
            style={{ height: `${Math.max(4, (s.count / max) * 100)}%` }}
          />
        ))}
      </div>
      <p className="pt-1 text-[10px] text-zinc-400">
        {series[0]?.day ?? ''} → {series[series.length - 1]?.day ?? ''} · peak {max}/day
      </p>
    </div>
  );
}

function OverviewTab() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => adminGet<OverviewPayload>('/api/admin?view=overview'),
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl bg-zinc-200 dark:bg-zinc-900" />
          ))}
        </div>
      </div>
    );
  }

  const c = data.cards;
  const publish = async () => {
    try {
      await adminAction({ action: 'setAnnouncement', message });
      setMessage('');
      toast.success('Announcement published');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      void queryClient.invalidateQueries({ queryKey: ['flags'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to publish');
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Total users" value={c.totalUsers} hint={`${c.newToday} today · ${c.newWeek} this week`} />
        <StatCard label="Active 24h" value={c.active24h} />
        <StatCard label="Active 7d" value={c.active7d} />
        <StatCard label="Active 30d" value={c.active30d} />
        <StatCard label="Suspended" value={c.suspended} />
        <StatCard label="Deleted" value={c.deleted} hint="grace window" />
        <StatCard label="Verified" value={c.verified} hint={`${c.unverified} unverified`} />
        <StatCard label="2FA enabled" value={c.twofa} />
        <StatCard label="Sessions" value={c.sessionCount} hint="active" />
        <StatCard label="Comments" value={c.commentCount} hint={`${c.flaggedComments} flagged`} />
        <StatCard label="Watchlist rows" value={c.watchlistCount} />
        <StatCard label="History rows" value={c.historyCount} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <Sparkline series={data.signupSeries} label="Signups per day (30d)" />
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <Sparkline series={data.dauSeries} label="Active users per day (DAU, 30d)" />
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Signups by country</p>
          <SimpleBars data={data.countries} />
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Top browsers / devices</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <SimpleBars data={data.browsers} />
            <SimpleBars data={data.devices} />
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Failed logins 24h — {data.failedLogins24h} total
          </p>
          {data.failedByIp.length === 0 ? (
            <p className="py-3 text-xs text-zinc-500">No failed attempts. Quiet day.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {data.failedByIp.map((f) => (
                <li key={f.ip} className="flex justify-between gap-2">
                  <span className="truncate font-mono text-zinc-600 dark:text-zinc-300">{f.ip}</span>
                  <span className="tabular-nums text-zinc-500">{f.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Provider health</p>
          <ul className="space-y-1.5 text-xs">
            {data.providerStats.map((p) => {
              const down = p.failCount > p.okCount;
              return (
                <li key={p.id} className="flex items-center gap-2">
                  <span className={cn('size-2 rounded-full', down ? 'bg-red-500' : 'bg-emerald-500')} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">{p.id}</span>
                  <span className="tabular-nums text-zinc-500">
                    {p.okCount}✓ {p.failCount}✗
                  </span>
                </li>
              );
            })}
            {data.providerStats.length === 0 && <li className="text-zinc-500">No probes yet — run a scan.</li>}
          </ul>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Announcement banner</p>
          {data.announcement && (
            <p className="mb-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-200">
              <Megaphone className="mr-1 inline size-3" aria-hidden /> {data.announcement.message}
            </p>
          )}
          <div className="flex gap-2">
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message to all users…" maxLength={300} className="h-9 rounded-lg text-xs" />
            <Button type="button" size="sm" disabled={message.trim().length < 2} onClick={publish} className="h-9 rounded-lg px-3 text-xs font-semibold">
              <Plus className="size-3.5" aria-hidden /> Publish
            </Button>
            {data.announcement && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  await adminAction({ action: 'clearAnnouncement', id: data.announcement!.id });
                  void queryClient.invalidateQueries({ queryKey: ['admin'] });
                  void queryClient.invalidateQueries({ queryKey: ['flags'] });
                  toast.success('Announcement cleared');
                }}
                className="h-9 rounded-lg px-3 text-xs"
              >
                Off
              </Button>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Recent signups</p>
          <ul className="divide-y divide-zinc-200 text-xs dark:divide-zinc-800">
            {data.recentUsers.map((u) => (
              <li key={u.id} className="flex items-center gap-2 py-1.5">
                <span className="w-6 text-center">{u.avatar ?? '👤'}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">{u.name || u.email}</span>
                {u.country && <span title={u.country}>{COUNTRY_FLAG(u.country)}</span>}
                <span className="shrink-0 text-zinc-400">{fmtDate(u.createdAt)}</span>
              </li>
            ))}
            {data.recentUsers.length === 0 && <li className="py-3 text-zinc-500">No users yet.</li>}
          </ul>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Top titles</p>
          <ul className="divide-y divide-zinc-200 text-xs dark:divide-zinc-800">
            {data.topTitles.map((t) => (
              <li key={`${t.tmdbId}:${t.mediaType}`} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-200">{t.title}</span>
                <span className="shrink-0 tabular-nums text-zinc-500">{t.watchers} viewers</span>
              </li>
            ))}
            {data.topTitles.length === 0 && <li className="py-3 text-zinc-500">No watch history yet.</li>}
          </ul>
        </section>
      </div>

      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()} className="h-8 rounded-lg text-xs">
          <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} aria-hidden /> Refresh
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// USERS (+ detail drawer)
// ---------------------------------------------------------------------------

function UsersTab() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [verified, setVerified] = useState('');
  const [twofa, setTwofa] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ view: 'users', sort, dir, page: String(page), pageSize: '25' });
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    if (role) p.set('role', role);
    if (verified) p.set('verified', verified);
    if (twofa) p.set('twofa', twofa);
    return p.toString();
  }, [q, status, role, verified, twofa, sort, dir, page]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', qs],
    queryFn: () => adminGet<{ total: number; users: AdminUserRow[] }>(`/api/admin?${qs}`),
  });

  const run = async (body: Record<string, unknown>, okMessage: string) => {
    try {
      await adminAction(body);
      toast.success(okMessage);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));

  if (detailId) {
    return <UserDetail id={detailId} onBack={() => setDetailId(null)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search name or email…"
            className="h-9 w-56 rounded-lg pl-8 text-xs"
          />
        </div>
        {(
          [
            ['status', status, setStatus, ['active', 'suspended', 'deleted']],
            ['role', role, setRole, ['user', 'admin']],
            ['verified', verified, setVerified, ['yes', 'no']],
            ['2FA', twofa, setTwofa, ['yes', 'no']],
          ] as const
        ).map(([label, value, setter, options]) => (
          <select
            key={label}
            value={value}
            onChange={(e) => {
              setter(e.target.value);
              setPage(1);
            }}
            aria-label={`Filter by ${label}`}
            className="h-9 rounded-lg border border-zinc-200 bg-white/70 px-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <option value="">{label}: all</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ))}
        <select
          value={`${sort}:${dir}`}
          onChange={(e) => {
            const [s, d] = e.target.value.split(':');
            setSort(s);
            setDir(d as 'asc' | 'desc');
          }}
          aria-label="Sort users"
          className="h-9 rounded-lg border border-zinc-200 bg-white/70 px-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <option value="createdAt:desc">Newest first</option>
          <option value="createdAt:asc">Oldest first</option>
          <option value="email:asc">Email A→Z</option>
          <option value="name:asc">Name A→Z</option>
          <option value="lastSeenAt:desc">Last seen</option>
        </select>
        <a
          href={`/api/admin?view=users&format=csv${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-200/60 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <Download className="size-3.5" aria-hidden /> CSV
        </a>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-xs">
          <span className="font-semibold">{selected.size} selected</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-md text-xs"
            onClick={async () => {
              await run({ action: 'bulkSuspend', ids: [...selected], reason: 'Bulk suspension by admin' }, `${selected.size} users suspended`);
              setSelected(new Set());
            }}
          >
            <Ban className="size-3" aria-hidden /> Suspend selected
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-md text-xs"
            onClick={async () => {
              await run({ action: 'bulkDelete', ids: [...selected] }, `${selected.size} users deleted (30-day grace)`);
              setSelected(new Set());
            }}
          >
            <Trash2 className="size-3" aria-hidden /> Delete selected
          </Button>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-72 rounded-xl bg-zinc-200 dark:bg-zinc-900" />
      ) : users.length === 0 ? (
        <EmptyState icon={<Users className="size-8" />} label="No users match these filters." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="bg-zinc-100 text-[11px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-2 py-2"><input type="checkbox" aria-label="Select all on page" checked={users.every((u) => selected.has(u.id)) && users.length > 0} onChange={(e) => setSelected(e.target.checked ? new Set(users.map((u) => u.id)) : new Set())} className="accent-[var(--cinedeck-accent)]" /></th>
                <th className="px-2 py-2">User</th>
                <th className="px-2 py-2">Role</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Signed up</th>
                <th className="px-2 py-2">Location</th>
                <th className="px-2 py-2">Last seen</th>
                <th className="px-2 py-2 text-right">Flags</th>
                <th className="px-2 py-2 text-right">Activity</th>
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white/60 dark:divide-zinc-800 dark:bg-zinc-950/40">
              {users.map((u) => (
                <tr key={u.id} className="text-zinc-700 dark:text-zinc-200">
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSelect(u.id)} aria-label={`Select ${u.email}`} className="accent-[var(--cinedeck-accent)]" />
                  </td>
                  <td className="max-w-[220px] px-2 py-2">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <span>{u.avatar ?? '👤'}</span>
                      <span className="truncate">{u.name || u.email.split('@')[0]}</span>
                      {u.totpEnabled && <span title="2FA" className="text-emerald-500">2FA</span>}
                    </p>
                    <p className="truncate text-[11px] text-zinc-400">{u.email}</p>
                  </td>
                  <td className="px-2 py-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', u.role === 'admin' ? 'bg-brand/20 text-zinc-900 dark:text-zinc-50' : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300')}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    {u.deletedAt ? (
                      <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400">deleted</span>
                    ) : u.suspendedAt ? (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">suspended</span>
                    ) : (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">active</span>
                    )}
                    {u.suspendedAt && u.suspensionEndsAt && (
                      <p className="pt-0.5 text-[10px] text-zinc-400">until {fmtDate(u.suspensionEndsAt)}</p>
                    )}
                  </td>
                  <td className="px-2 py-2 text-[11px] text-zinc-500">{fmtDate(u.createdAt)}</td>
                  <td className="px-2 py-2 text-[11px] text-zinc-500">
                    {u.country ? `${COUNTRY_FLAG(u.country)} ${u.city ?? u.country}` : '—'}
                  </td>
                  <td className="px-2 py-2 text-[11px] text-zinc-500">{fmtDate(u.lastSeenAt)}</td>
                  <td className="px-2 py-2 text-right text-[11px]">
                    {u.emailVerified ? '✓ verified' : 'unverified'} · {u.sessionCount} sessions
                  </td>
                  <td className="px-2 py-2 text-right text-[11px] tabular-nums text-zinc-500">
                    {u.watchCount}w · {u.watchlistSize}l · {u.commentCount}c · {u.ratingCount}r
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setDetailId(u.id)} className="h-7 rounded-md px-2 text-[11px]" aria-label={`View ${u.email}`}>
                        <Eye className="size-3.5" aria-hidden />
                      </Button>
                      {u.suspendedAt ? (
                        <Button type="button" size="sm" variant="ghost" onClick={() => run({ action: 'unsuspendUser', id: u.id }, 'User unsuspended')} className="h-7 rounded-md px-2 text-[11px]" aria-label={`Unsuspend ${u.email}`}>
                          <UserCheck className="size-3.5" aria-hidden />
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const reason = window.prompt('Suspension reason (shown to the user):');
                            if (reason && reason.trim().length >= 3) run({ action: 'suspendUser', id: u.id, reason: reason.trim() }, 'User suspended');
                          }}
                          className="h-7 rounded-md px-2 text-[11px]"
                          aria-label={`Suspend ${u.email}`}
                        >
                          <Ban className="size-3.5" aria-hidden />
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="ghost" onClick={() => run({ action: 'promoteUser', id: u.id, admin: u.role !== 'admin' }, u.role === 'admin' ? 'Demoted to user' : 'Promoted to admin')} className="h-7 rounded-md px-2 text-[11px]" aria-label="Toggle role">
                        <ShieldOff className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{total} users · page {page}/{pages}</span>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-7 rounded-md px-2">
            <ChevronLeft className="size-3.5" aria-hidden /> Prev
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="h-7 rounded-md px-2">
            Next <ChevronRight className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// USER DETAIL
// ---------------------------------------------------------------------------

interface UserDetailPayload {
  user: Omit<AdminUserRow, 'emailVerified'> & {
    emailVerified: string | null;
    mustChangePassword: boolean;
    updatedAt: string;
  };
  loginHistory: { id: string; success: boolean; reason: string | null; ip: string | null; userAgent: string | null; country: string | null; city: string | null; createdAt: string }[];
  loginTotal: number;
  loginPages: number;
  historyPage: number;
  sessions: { id: string; createdAt: string; lastSeenAt: string; userAgent: string | null; ip: string | null; country: string | null; city: string | null }[];
  activity: {
    history: { id: string; title: string; mediaType: string; updatedAt: string }[];
    watchlistCount: number;
    ratingCount: number;
    avgScore: number | null;
    lists: number;
    comments: { id: string; body: string; status: string; createdAt: string }[];
    reports: { id: string; reason: string | null; createdAt: string; comment: { body: string; status: string } }[];
  };
  notes: { id: string; authorEmail: string; body: string; createdAt: string }[];
}

function UserDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [historyPage, setHistoryPage] = useState(1);
  const [note, setNote] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'user', id, historyPage],
    queryFn: () => adminGet<UserDetailPayload>(`/api/admin?view=user&id=${encodeURIComponent(id)}&historyPage=${historyPage}`),
  });

  const run = async (body: Record<string, unknown>, okMessage: string) => {
    try {
      await adminAction(body);
      toast.success(okMessage);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    }
  };

  const suspendWithReason = async () => {
    const reason = window.prompt('Suspension reason (shown to the user on next login):');
    if (!reason || reason.trim().length < 3) return;
    const until = window.prompt('Optional end date (YYYY-MM-DD, empty = permanent):');
    const body: Record<string, unknown> = { action: 'suspendUser', id, reason: reason.trim() };
    if (until) body.endsAt = new Date(`${until}T23:59:59.999Z`).toISOString();
    await run(body, 'User suspended — all sessions revoked');
  };

  if (isLoading || !data) {
    return <Skeleton className="h-96 rounded-xl bg-zinc-200 dark:bg-zinc-900" />;
  }
  const u = data.user;

  return (
    <div className="space-y-4">
      <Button type="button" variant="ghost" size="sm" onClick={onBack} className="h-9 gap-1.5 rounded-lg px-2.5 text-sm text-zinc-600 dark:text-zinc-400">
        <ArrowLeft className="size-4" aria-hidden /> All users
      </Button>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Profile + flags */}
        <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 lg:col-span-1">
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-zinc-200 text-2xl dark:bg-zinc-800">{u.avatar ?? '👤'}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{u.name || u.email.split('@')[0]}</p>
              <p className="truncate text-xs text-zinc-500">{u.email}</p>
            </div>
          </div>
          <dl className="mt-3 space-y-1 text-[11px] text-zinc-600 dark:text-zinc-300">
            <div className="flex justify-between gap-2"><dt>Role</dt><dd className="font-semibold">{u.role}</dd></div>
            <div className="flex justify-between gap-2"><dt>Signed up</dt><dd>{fmtDate(u.createdAt)}</dd></div>
            <div className="flex justify-between gap-2"><dt>Signup location</dt><dd>{u.country ? `${COUNTRY_FLAG(u.country)} ${u.city ?? u.country}` : '—'} · {u.signupIp ?? '—'}</dd></div>
            <div className="flex justify-between gap-2"><dt>Email verified</dt><dd>{u.emailVerified ? 'yes' : 'no'}</dd></div>
            <div className="flex justify-between gap-2"><dt>2FA</dt><dd>{u.totpEnabled ? 'on' : 'off'}</dd></div>
            <div className="flex justify-between gap-2"><dt>Suspended</dt><dd>{u.suspendedAt ? `${fmtDate(u.suspendedAt)}${u.suspensionEndsAt ? ` (until ${fmtDate(u.suspensionEndsAt)})` : ' (permanent)'}` : 'no'}</dd></div>
            {u.suspensionReason && <div className="flex justify-between gap-2"><dt>Reason</dt><dd className="text-right">{u.suspensionReason}</dd></div>}
            <div className="flex justify-between gap-2"><dt>Soft deleted</dt><dd>{u.deletedAt ? fmtDate(u.deletedAt) : 'no'}</dd></div>
            <div className="flex justify-between gap-2"><dt>Default password</dt><dd>{u.mustChangePassword ? 'yes — nagging' : 'no'}</dd></div>
          </dl>

          {/* Admin actions */}
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            {u.suspendedAt ? (
              <Button type="button" size="sm" variant="outline" onClick={() => run({ action: 'unsuspendUser', id }, 'Unsuspended')} className="h-7 rounded-md text-[11px]">
                <UserCheck className="size-3" aria-hidden /> Unsuspend
              </Button>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={suspendWithReason} className="h-7 rounded-md text-[11px]">
                <Ban className="size-3" aria-hidden /> Suspend
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => run({ action: 'forceLogout', id }, 'All sessions revoked')} className="h-7 rounded-md text-[11px]">
              <LogOut className="size-3" aria-hidden /> Force logout
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => run({ action: 'resetTotp', id }, '2FA reset')} className="h-7 rounded-md text-[11px]">
              <ShieldCheck className="size-3" aria-hidden /> Reset 2FA
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => run({ action: 'sendPasswordReset', id }, 'Reset email sent')} className="h-7 rounded-md text-[11px]">
              <Mail className="size-3" aria-hidden /> Send reset
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => run({ action: 'verifyEmail', id }, 'Email verified')} className="h-7 rounded-md text-[11px]">
              <Check className="size-3" aria-hidden /> Verify email
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => run({ action: 'promoteUser', id, admin: u.role !== 'admin' }, u.role === 'admin' ? 'Demoted' : 'Promoted')} className="h-7 rounded-md text-[11px]">
              <ShieldOff className="size-3" aria-hidden /> {u.role === 'admin' ? 'Demote' : 'Promote'}
            </Button>
            {u.deletedAt ? (
              <Button type="button" size="sm" variant="outline" onClick={() => run({ action: 'reactivateUser', id }, 'Account reactivated')} className="h-7 rounded-md text-[11px]">
                <UserCheck className="size-3" aria-hidden /> Reactivate
              </Button>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => { if (window.confirm('Soft-delete this account (30-day grace)?')) run({ action: 'softDeleteUser', id }, 'Soft-deleted (30-day grace)'); }} className="h-7 rounded-md text-[11px]">
                <Trash2 className="size-3" aria-hidden /> Soft delete
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => {
                const confirm = window.prompt('Type DELETE to permanently remove this account and all its data:');
                if (confirm === 'DELETE') run({ action: 'hardDeleteUser', id, confirm }, 'Account permanently deleted');
                else if (confirm !== null) toast.error('Confirmation did not match.');
              }}
              className="h-7 rounded-md text-[11px]"
            >
              <Trash2 className="size-3" aria-hidden /> Hard delete
            </Button>
          </div>

          {/* Admin notes */}
          <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Internal notes (never shown to user)</p>
            <div className="flex gap-1.5">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" className="h-8 rounded-lg text-xs" maxLength={1000} />
              <Button
                type="button"
                size="sm"
                disabled={note.trim().length < 2}
                onClick={async () => {
                  await run({ action: 'addNote', id, body: note.trim() }, 'Note added');
                  setNote('');
                }}
                className="h-8 rounded-lg px-2.5 text-xs"
              >
                Add
              </Button>
            </div>
            <ul className="mt-2 space-y-1.5">
              {data.notes.map((n) => (
                <li key={n.id} className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[11px] dark:bg-zinc-800/60">
                  <p className="text-zinc-700 dark:text-zinc-200">{n.body}</p>
                  <p className="text-[10px] text-zinc-400">{n.authorEmail} · {fmtDate(n.createdAt)}</p>
                </li>
              ))}
              {data.notes.length === 0 && <li className="text-[11px] text-zinc-500">No notes.</li>}
            </ul>
          </div>
        </section>

        {/* Sessions + login history */}
        <div className="space-y-4 lg:col-span-2">
          <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
            <p className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Active sessions ({data.sessions.length})</p>
            <ul className="divide-y divide-zinc-200 text-xs dark:divide-zinc-800">
              {data.sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">{s.userAgent ?? 'unknown device'}</span>
                  <span className="text-[10px] text-zinc-400">{s.ip ?? '—'} {s.country ? COUNTRY_FLAG(s.country) : ''}</span>
                  <span className="text-[10px] text-zinc-400">seen {fmtDate(s.lastSeenAt)}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => run({ action: 'revokeSession', id: s.id }, 'Session revoked')} className="h-6 rounded-md px-1.5 text-[10px]">
                    Revoke
                  </Button>
                </li>
              ))}
              {data.sessions.length === 0 && <li className="py-2 text-zinc-500">No active sessions.</li>}
            </ul>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
            <p className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Login history — 90 days ({data.loginTotal})</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[11px]">
                <thead className="text-zinc-400">
                  <tr>
                    <th className="py-1 pr-2">When</th>
                    <th className="py-1 pr-2">Result</th>
                    <th className="py-1 pr-2">IP</th>
                    <th className="py-1 pr-2">Place</th>
                    <th className="py-1">Device</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {data.loginHistory.map((row) => (
                    <tr key={row.id} className="text-zinc-600 dark:text-zinc-300">
                      <td className="py-1 pr-2">{fmtDate(row.createdAt)}</td>
                      <td className="py-1 pr-2">
                        {row.success ? (
                          <span className="text-emerald-600 dark:text-emerald-400">✓ {row.reason ?? 'ok'}</span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400">✗ {row.reason ?? 'failed'}</span>
                        )}
                      </td>
                      <td className="py-1 pr-2 font-mono">{row.ip ?? '—'}</td>
                      <td className="py-1 pr-2">{row.country ? `${COUNTRY_FLAG(row.country)} ${row.city ?? row.country}` : '—'}</td>
                      <td className="max-w-[220px] truncate py-1">{row.userAgent ?? '—'}</td>
                    </tr>
                  ))}
                  {data.loginHistory.length === 0 && (
                    <tr><td colSpan={5} className="py-2 text-zinc-500">No login attempts in 90 days.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {data.loginPages > 1 && (
              <div className="flex items-center justify-between pt-2 text-[11px] text-zinc-500">
                <span>Page {data.historyPage}/{data.loginPages}</span>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="outline" disabled={historyPage <= 1} onClick={() => setHistoryPage((p) => p - 1)} className="h-6 rounded-md px-2 text-[10px]">Prev</Button>
                  <Button type="button" size="sm" variant="outline" disabled={historyPage >= data.loginPages} onClick={() => setHistoryPage((p) => p + 1)} className="h-6 rounded-md px-2 text-[10px]">Next</Button>
                </div>
              </div>
            )}
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
              <p className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Content activity</p>
              <p className="text-[11px] text-zinc-500">
                {u.watchCount ?? '—'} watches · list rows {data.activity.watchlistCount} · ratings {data.activity.ratingCount}
                {data.activity.avgScore !== null && ` (avg ${data.activity.avgScore.toFixed(1)})`} · lists {data.activity.lists}
              </p>
              <ul className="mt-1.5 divide-y divide-zinc-200 text-[11px] dark:divide-zinc-800">
                {data.activity.history.map((h) => (
                  <li key={h.id} className="flex justify-between gap-2 py-1">
                    <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-300">{h.title}</span>
                    <span className="shrink-0 text-zinc-400">{fmtDate(h.updatedAt)}</span>
                  </li>
                ))}
                {data.activity.history.length === 0 && <li className="py-1 text-zinc-500">No watch history.</li>}
              </ul>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
              <p className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Recent comments & reports</p>
              <ul className="divide-y divide-zinc-200 text-[11px] dark:divide-zinc-800">
                {data.activity.comments.map((cm) => (
                  <li key={cm.id} className="py-1">
                    <p className="line-clamp-2 text-zinc-600 dark:text-zinc-300">{cm.body}</p>
                    <p className="text-[10px] text-zinc-400">{cm.status} · {fmtDate(cm.createdAt)}</p>
                  </li>
                ))}
                {data.activity.comments.length === 0 && <li className="py-1 text-zinc-500">No comments.</li>}
              </ul>
              {data.activity.reports.length > 0 && (
                <>
                  <p className="pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Reports against this user</p>
                  <ul className="space-y-1 text-[11px]">
                    {data.activity.reports.map((r) => (
                      <li key={r.id} className="rounded-lg bg-red-500/10 px-2 py-1 text-red-700 dark:text-red-300">
                        “{r.comment.body.slice(0, 80)}” — {r.reason ?? 'no reason'} · {fmtDate(r.createdAt)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MODERATION
// ---------------------------------------------------------------------------

interface ReportsPayload {
  reports: {
    id: string;
    reason: string | null;
    createdAt: string;
    commentId: string;
    commentBody: string;
    commentStatus: string;
    commentCreatedAt: string;
    authorName: string | null;
    authorEmail: string | null;
    authorId: string | null;
  }[];
}

function ModerationTab() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'reports'],
    queryFn: () => adminGet<ReportsPayload>('/api/admin?view=reports'),
    refetchInterval: 60_000,
  });

  const run = async (body: Record<string, unknown>, okMessage: string) => {
    try {
      await adminAction(body);
      toast.success(okMessage);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    }
  };

  if (isLoading || !data) return <Skeleton className="h-64 rounded-xl bg-zinc-200 dark:bg-zinc-900" />;
  const reports = data.reports.filter((r) => !q || r.commentBody.toLowerCase().includes(q.toLowerCase()) || (r.authorEmail ?? '').toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="relative w-56">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter reports…" className="h-9 rounded-lg pl-8 text-xs" />
      </div>
      {reports.length === 0 ? (
        <EmptyState icon={<ClipboardList className="size-8" />} label="No reports — the community behaves." />
      ) : (
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id} className="rounded-xl border border-zinc-200 bg-white/70 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">{r.authorName || r.authorEmail || 'unknown'}</span>
                <span>· {fmtDate(r.commentCreatedAt)}</span>
                <span className={cn('rounded px-1.5 py-0.5 font-bold', r.commentStatus === 'flagged' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-zinc-200 dark:bg-zinc-800')}>
                  {r.commentStatus}
                </span>
                <span className="ml-auto">{fmtDate(r.createdAt)}</span>
              </div>
              <p className="py-1.5 leading-relaxed text-zinc-700 dark:text-zinc-200">{r.commentBody}</p>
              {r.reason && <p className="text-[11px] italic text-zinc-500">Reason: {r.reason}</p>}
              <div className="flex flex-wrap gap-1.5 pt-2">
                <Button type="button" size="sm" variant="outline" onClick={() => run({ action: 'dismissReport', reportId: r.id }, 'Report dismissed')} className="h-7 rounded-md text-[11px]">
                  Dismiss report
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => run({ action: 'deleteComment', id: r.commentId }, 'Comment removed')} className="h-7 rounded-md text-[11px]">
                  <Trash2 className="size-3" aria-hidden /> Delete comment
                </Button>
                {r.authorId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const reason = window.prompt('Suspension reason (shown to the user):');
                      if (reason && reason.trim().length >= 3) run({ action: 'suspendUser', id: r.authorId!, reason: reason.trim() }, 'Commenter suspended');
                    }}
                    className="h-7 rounded-md text-[11px]"
                  >
                    <Ban className="size-3" aria-hidden /> Suspend commenter
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AUDIT LOG
// ---------------------------------------------------------------------------

interface AuditPayload {
  total: number;
  page: number;
  pages: number;
  entries: {
    id: string;
    actorEmail: string | null;
    action: string;
    targetType: string | null;
    targetId: string | null;
    targetLabel: string | null;
    details: Record<string, unknown>;
    createdAt: string;
  }[];
}

function AuditTab() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit', q, page],
    queryFn: () => adminGet<AuditPayload>(`/api/admin?view=audit&q=${encodeURIComponent(q)}&page=${page}`),
    refetchInterval: 30_000,
  });

  if (isLoading || !data) return <Skeleton className="h-64 rounded-xl bg-zinc-200 dark:bg-zinc-900" />;

  return (
    <div className="space-y-3">
      <div className="relative w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search actor or target…"
          className="h-9 rounded-lg pl-8 text-xs"
        />
      </div>
      {data.entries.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-8" />} label="No audit entries yet." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-zinc-100 text-[11px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white/60 dark:divide-zinc-800 dark:bg-zinc-950/40">
              {data.entries.map((e) => (
                <tr key={e.id} className="text-zinc-700 dark:text-zinc-200">
                  <td className="whitespace-nowrap px-3 py-1.5 text-[11px] text-zinc-500">{fmtDate(e.createdAt)}</td>
                  <td className="px-3 py-1.5 text-[11px]">{e.actorEmail ?? 'system'}</td>
                  <td className="px-3 py-1.5 font-semibold">{e.action}</td>
                  <td className="px-3 py-1.5 text-[11px]">{e.targetLabel ?? e.targetId ?? '—'}</td>
                  <td className="max-w-[280px] truncate px-3 py-1.5 text-[10px] text-zinc-500">{Object.keys(e.details).length > 0 ? JSON.stringify(e.details) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{data.total} entries · page {data.page}/{data.pages}</span>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-7 rounded-md px-2">Prev</Button>
          <Button type="button" size="sm" variant="outline" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} className="h-7 rounded-md px-2">Next</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FLAGS
// ---------------------------------------------------------------------------

function FlagsTab() {
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['flags'],
    queryFn: () => adminGet<{ flags: Record<string, boolean>; announcement: { id: string; message: string } | null }>('/api/flags'),
  });

  const setFlag = async (key: string, enabled: boolean) => {
    const res = await fetch('/api/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'flag', key, enabled }),
    });
    if (!res.ok) {
      toast.error('Could not update flag');
      return;
    }
    toast.success(`${key} ${enabled ? 'enabled' : 'disabled'}`);
    void queryClient.invalidateQueries({ queryKey: ['flags'] });
  };

  if (isLoading || !data) return <Skeleton className="h-64 rounded-xl bg-zinc-200 dark:bg-zinc-900" />;
  const entries = Object.entries(data.flags);

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {entries.map(([key, enabled]) => (
          <li key={key} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
            <span className="min-w-0 flex-1 font-semibold text-zinc-700 dark:text-zinc-200">{key}</span>
            <Button
              type="button"
              size="sm"
              variant={enabled ? 'default' : 'outline'}
              onClick={() => setFlag(key, !enabled)}
              className="h-7 rounded-md text-[11px]"
            >
              {enabled ? 'On — click to disable' : 'Off — click to enable'}
            </Button>
          </li>
        ))}
        {entries.length === 0 && <EmptyState icon={<Flag className="size-8" />} label="No feature flags defined." />}
      </ul>
      <div className="flex gap-2">
        <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="new flag key (e.g. maintenance)" className="h-9 rounded-lg text-xs" maxLength={60} />
        <Button
          type="button"
          size="sm"
          disabled={newKey.trim().length < 2}
          onClick={async () => {
            await setFlag(newKey.trim(), false);
            setNewKey('');
          }}
          className="h-9 rounded-lg px-3 text-xs font-semibold"
        >
          <Plus className="size-3.5" aria-hidden /> Create
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Flags apply app-wide. <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">maintenance</code> shows a
        maintenance page to non-admins; <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">registration</code>{' '}
        closes signups. Flag semantics are honored by the routes that gate the matching features.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SESSIONS
// ---------------------------------------------------------------------------

interface SessionsPayload {
  total: number;
  page: number;
  pages: number;
  sessions: { id: string; email: string; userName: string | null; createdAt: string; lastSeenAt: string; userAgent: string | null; ip: string | null; country: string | null; city: string | null }[];
}

function SessionsTab() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'sessions', q, page],
    queryFn: () => adminGet<SessionsPayload>(`/api/admin?view=sessions&q=${encodeURIComponent(q)}&page=${page}`),
    refetchInterval: 30_000,
  });

  if (isLoading || !data) return <Skeleton className="h-64 rounded-xl bg-zinc-200 dark:bg-zinc-900" />;

  return (
    <div className="space-y-3">
      <div className="relative w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search by user…"
          className="h-9 rounded-lg pl-8 text-xs"
        />
      </div>
      {data.sessions.length === 0 ? (
        <EmptyState icon={<Activity className="size-8" />} label="No active sessions." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-zinc-100 text-[11px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Last seen</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white/60 dark:divide-zinc-800 dark:bg-zinc-950/40">
              {data.sessions.map((s) => (
                <tr key={s.id} className="text-zinc-700 dark:text-zinc-200">
                  <td className="px-3 py-1.5">{s.userName || s.email}</td>
                  <td className="max-w-[280px] truncate px-3 py-1.5 text-[11px] text-zinc-500">{s.userAgent ?? '—'}</td>
                  <td className="px-3 py-1.5 text-[11px]">{s.country ? `${COUNTRY_FLAG(s.country)} ${s.city ?? s.country} · ${s.ip ?? ''}` : '—'}</td>
                  <td className="px-3 py-1.5 text-[11px] text-zinc-500">{fmtDate(s.lastSeenAt)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await adminAction({ action: 'revokeSession', id: s.id });
                        toast.success('Session revoked');
                        void queryClient.invalidateQueries({ queryKey: ['admin'] });
                      }}
                      className="h-7 rounded-md text-[11px]"
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{data.total} sessions · page {data.page}/{data.pages}</span>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-7 rounded-md px-2">Prev</Button>
          <Button type="button" size="sm" variant="outline" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} className="h-7 rounded-md px-2">Next</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MY SESSIONS — the signed-in admin's own devices (limit: 3 active).
// ---------------------------------------------------------------------------

function MySessionsTab() {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: fetchSessions,
    refetchInterval: 30_000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
  };

  const revokeOne = async (id: string) => {
    setBusyId(id);
    try {
      const ok = await revokeOneSession(id);
      if (ok) {
        toast.success('Session revoked');
        refresh();
      } else {
        toast.error('Could not revoke that session');
      }
    } finally {
      setBusyId(null);
    }
  };

  const revokeOthers = async () => {
    const revoked = await revokeOtherSessions();
    toast.success(`${revoked} other device${revoked === 1 ? '' : 's'} signed out`);
    refresh();
  };

  const revokeAll = async () => {
    const ok = await revokeAllMySessions();
    if (ok) {
      toast.success('All sessions revoked — you are signed out everywhere');
      invalidateIdentityCaches(queryClient);
      refresh();
    } else {
      toast.error('Could not revoke sessions');
    }
  };

  if (isLoading || !data) return <Skeleton className="h-64 rounded-xl bg-zinc-200 dark:bg-zinc-900" />;

  const sessions = data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Admin accounts are limited to <span className="font-semibold text-zinc-700 dark:text-zinc-200">3 active devices</span> —
          a login beyond that is rejected. Logins from unseen devices are written to the audit log.
        </p>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={revokeOthers}
            disabled={sessions.length <= 1}
            className="h-7 gap-1 rounded-md text-[11px]"
          >
            <LogOut className="size-3" aria-hidden />
            Log out other devices
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={revokeAll}
            className="h-7 gap-1 rounded-md border-red-300 text-[11px] text-red-600 hover:bg-red-500/10 dark:border-red-900 dark:text-red-400"
          >
            <Trash2 className="size-3" aria-hidden />
            Revoke all
          </Button>
        </div>
      </div>

      {sessions.length === 0 ? (
        <EmptyState icon={<MonitorSmartphone className="size-8" />} label="No active sessions." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-zinc-100 text-[11px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Browser</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Signed in</th>
                <th className="px-3 py-2">Last seen</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white/60 dark:divide-zinc-800 dark:bg-zinc-950/40">
              {sessions.map((session) => (
                <tr key={session.id} className="text-zinc-700 dark:text-zinc-200">
                  <td className="px-3 py-1.5">
                    {deviceLabel(session.userAgent)}
                    {session.current && (
                      <span className="ml-1.5 rounded bg-brand/15 px-1 py-0.5 text-[10px] font-semibold text-brand">
                        this device
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">{browserLabel(session.userAgent)}</td>
                  <td className="px-3 py-1.5 text-[11px]">
                    {session.country ? `${COUNTRY_FLAG(session.country)} ${session.city ?? session.country} · ${session.ip ?? ''}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-[11px] text-zinc-500">{fmtDate(session.createdAt)}</td>
                  <td className="px-3 py-1.5 text-[11px] text-zinc-500">{timeAgo(session.lastSeenAt)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyId === session.id}
                      onClick={() => void revokeOne(session.id)}
                      className="h-7 rounded-md text-[11px]"
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LOGS (existing in-memory ring)
// ---------------------------------------------------------------------------

interface LogEntry {
  time: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
  path?: string;
  status?: number;
  durationMs?: number;
  requestId?: string;
}

function LogsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'logs'],
    queryFn: () => adminGet<{ logs: LogEntry[] }>('/api/admin?logs=1'),
    refetchInterval: 15_000,
  });
  if (isLoading || !data) return <Skeleton className="h-64 rounded-xl bg-zinc-200 dark:bg-zinc-900" />;
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[640px] text-left text-[11px]">
        <thead className="bg-zinc-100 uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2">Level</th>
            <th className="px-3 py-2">Message</th>
            <th className="px-3 py-2">Path</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">ms</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {data.logs.map((entry, index) => (
            <tr key={`${entry.time}-${index}`} className="text-zinc-600 dark:text-zinc-300">
              <td className="whitespace-nowrap px-3 py-1">{fmtDate(entry.time)}</td>
              <td className={cn('px-3 py-1 font-bold', entry.level === 'error' ? 'text-red-500' : entry.level === 'warn' ? 'text-amber-500' : 'text-emerald-500')}>{entry.level}</td>
              <td className="max-w-[320px] truncate px-3 py-1">{entry.msg}</td>
              <td className="max-w-[200px] truncate px-3 py-1">{entry.path ?? '—'}</td>
              <td className="px-3 py-1">{entry.status ?? '—'}</td>
              <td className="px-3 py-1 tabular-nums">{entry.durationMs ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
