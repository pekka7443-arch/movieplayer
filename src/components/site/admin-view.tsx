'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Ban, Check, Megaphone, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/use-session';

interface AdminPayload {
  stats: {
    userCount: number;
    activeSessions: number;
    commentCount: number;
    pendingComments: number;
    watchlistCount: number;
    historyCount: number;
  };
  recentUsers: { id: string; email: string; name: string | null; role: string; createdAt: string }[];
  topTitles: { tmdbId: number; mediaType: string; title: string; watchers: number }[];
  providerStats: { id: string; okCount: number; failCount: number; lastOkAt: string | null; lastFailAt: string | null }[];
  flaggedComments: { id: string; authorName: string | null; body: string; createdAt: string }[];
}

async function adminAction(body: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`admin_${res.status}`);
}

/** /admin dashboard (?view=admin) — role-gated. */
export function AdminView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, loading } = useSession();
  const [announcement, setAnnouncement] = useState('');

  const query = useQuery<AdminPayload>({
    queryKey: ['admin'],
    queryFn: async () => {
      const res = await fetch('/api/admin');
      if (!res.ok) throw new Error(`admin_${res.status}`);
      return (await res.json()) as AdminPayload;
    },
    enabled: user?.role === 'admin',
    refetchInterval: 60_000,
  });

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

  const data = query.data;

  const run = async (body: Record<string, unknown>, okMessage: string) => {
    try {
      await adminAction(body);
      toast.success(okMessage);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      void queryClient.invalidateQueries({ queryKey: ['flags'] });
    } catch {
      toast.error('Action failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
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
          <ShieldCheck className="size-5 text-brand" aria-hidden />
          Admin
        </h1>
      </div>

      {!data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl bg-zinc-200 dark:bg-zinc-900" />
          ))}
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Overview">
            {[
              { label: 'Users', value: data.stats.userCount },
              { label: 'Active sessions (24h)', value: data.stats.activeSessions },
              { label: 'Comments', value: data.stats.commentCount },
              { label: 'Flagged comments', value: data.stats.pendingComments },
              { label: 'Watchlist rows', value: data.stats.watchlistCount },
              { label: 'History rows', value: data.stats.historyCount },
            ].map((card) => (
              <div key={card.label} className="rounded-2xl border border-zinc-200 bg-white/70 p-3.5 dark:border-zinc-800/80 dark:bg-zinc-900/50">
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{card.label}</p>
                <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">{card.value}</p>
              </div>
            ))}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Flagged comments */}
            <section className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/50" aria-label="Comment moderation">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-500">Comment moderation</h2>
              {data.flaggedComments.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-500">No flagged comments.</p>
              ) : (
                <ul className="max-h-72 space-y-2 overflow-y-auto">
                  {data.flaggedComments.map((c) => (
                    <li key={c.id} className="rounded-xl bg-zinc-100/70 p-2.5 text-sm dark:bg-zinc-900/60">
                      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{c.authorName ?? 'unknown'}</p>
                      <p className="mt-0.5 line-clamp-2 text-zinc-600 dark:text-zinc-400">{c.body}</p>
                      <div className="mt-1.5 flex gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 gap-1 rounded-lg px-2 text-[11px]" onClick={() => run({ action: 'approveComment', id: c.id }, 'Comment approved')}>
                          <Check className="size-3" aria-hidden /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 gap-1 rounded-lg px-2 text-[11px] text-red-600" onClick={() => run({ action: 'deleteComment', id: c.id }, 'Comment removed')}>
                          <Trash2 className="size-3" aria-hidden /> Remove
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Top titles */}
            <section className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/50" aria-label="Top titles">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-500">Top titles</h2>
              <ol className="space-y-1.5">
                {data.topTitles.map((t, i) => (
                  <li key={`${t.tmdbId}-${t.mediaType}`} className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-right font-mono text-xs text-zinc-400">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">{t.title}</span>
                    <span className="shrink-0 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                      {t.watchers} {t.watchers === 1 ? 'viewer' : 'viewers'}
                    </span>
                  </li>
                ))}
                {data.topTitles.length === 0 && <li className="py-6 text-center text-sm text-zinc-500">No watch data yet.</li>}
              </ol>
            </section>

            {/* Provider health */}
            <section className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/50" aria-label="Provider health">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-500">Provider health</h2>
              <ul className="space-y-2">
                {data.providerStats.map((p) => {
                  const total = p.okCount + p.failCount;
                  const health = total > 0 ? Math.round((p.okCount / total) * 100) : null;
                  return (
                    <li key={p.id} className="flex items-center gap-2 text-sm">
                      <span className="w-28 truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">{p.id}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${health ?? 0}%` }} />
                      </div>
                      <span className="w-14 text-right text-[11px] text-zinc-500">{health == null ? '—' : `${health}% ok`}</span>
                    </li>
                  );
                })}
                {data.providerStats.length === 0 && (
                  <li className="py-6 text-center text-sm text-zinc-500">Provider stats build up as scans run.</li>
                )}
              </ul>
            </section>

            {/* Users + announcement + flags */}
            <section className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/50" aria-label="Users and announcements">
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-zinc-500">
                <Users className="size-3.5" aria-hidden /> Recent users
              </h2>
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {data.recentUsers.map((u) => (
                  <li key={u.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">{u.name ?? u.email}</span>
                    {u.role === 'admin' && (
                      <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-bold text-brand">admin</span>
                    )}
                    <button
                      type="button"
                      aria-label={u.role === 'admin' ? 'Demote to user' : 'Promote to admin'}
                      onClick={() => run({ action: 'promoteUser', id: u.id, admin: u.role !== 'admin' }, 'Role updated')}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <Ban className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>

              <h2 className="mb-2 mt-4 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-zinc-500">
                <Megaphone className="size-3.5" aria-hidden /> Announcement banner
              </h2>
              <div className="flex gap-2">
                <Input
                  value={announcement}
                  onChange={(e) => setAnnouncement(e.target.value.slice(0, 300))}
                  placeholder="Message for every visitor…"
                  className="h-9 rounded-lg border-zinc-200 text-sm dark:border-zinc-800"
                />
                <Button
                  size="sm"
                  disabled={announcement.trim().length < 3}
                  onClick={async () => {
                    await run({ action: 'announce', message: announcement.trim() }, 'Announcement published');
                    setAnnouncement('');
                  }}
                  className="h-9 rounded-lg bg-brand px-3 text-xs font-semibold text-brand-foreground"
                >
                  Publish
                </Button>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
