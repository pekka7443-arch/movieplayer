'use client';

// System — health checks, recent server logs and the announcement editor,
// organized as three inline sub-views.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

import { adminAction, adminGet, AdmButton, AdmSelect, EmptyState, PageHeader, Section, useRefreshPing } from '@/components/admin/ui';
import { fmtClock, fmtDate } from '@/components/admin/ui';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

type SystemView = 'health' | 'logs' | 'announcements';

interface HealthPayload {
  ok: boolean;
  time: string;
  db: { ok: boolean; latencyMs: number };
  uptimeSeconds: number;
}

interface LogEntry {
  time: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
  path?: string;
  status?: number;
  durationMs?: number;
}

const VIEWS: { id: SystemView; label: string }[] = [
  { id: 'health', label: 'Health' },
  { id: 'logs', label: 'Logs' },
  { id: 'announcements', label: 'Announcements' },
];

export function SystemTab() {
  const [view, setView] = useState<SystemView>('health');

  return (
    <div>
      <PageHeader title="System" description="Platform health, server logs and user-facing announcements." />
      <div className="flex gap-1 pb-5" role="tablist" aria-label="System sections">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={cn(
              'h-8 rounded-lg px-3.5 text-xs font-medium transition-colors duration-150',
              view === v.id ? 'bg-[#141414] text-white' : 'text-[#9ca3af] hover:bg-[#111111] hover:text-white',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'health' && <HealthView />}
      {view === 'logs' && <LogsView />}
      {view === 'announcements' && <AnnouncementsView />}
    </div>
  );
}

function HealthView() {
  const { data, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: () => adminGet<HealthPayload>('/api/health'),
    refetchInterval: 30_000,
  });
  useRefreshPing(dataUpdatedAt);

  if (isLoading || !data) return <div className="h-56 animate-pulse rounded-lg bg-[#111111]" />;

  const uptime = () => {
    const d = Math.floor(data.uptimeSeconds / 86_400);
    const h = Math.floor((data.uptimeSeconds % 86_400) / 3_600);
    return d > 0 ? `${d}d ${h}h` : `${h}h`;
  };

  const rows = [
    { service: 'CineDeck API', ok: data.ok, ms: 0, checked: data.time },
    { service: 'Database (SQLite)', ok: data.db.ok, ms: data.db.latencyMs, checked: data.time },
  ];

  return (
    <Section
      title="Health checks"
      description={`Uptime ${uptime()} · auto-checks every 30 seconds`}
      actions={
        <AdmButton variant="ghost" onClick={() => void refetch()} aria-label="Run health checks">
          <RefreshCw className="size-3.5" aria-hidden /> Re-run
        </AdmButton>
      }
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1f1f1f]">
            <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Service</th>
            <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Status</th>
            <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Response time</th>
            <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Last checked</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.service} className="border-b border-[#1f1f1f] last:border-0">
              <td className="py-3 text-[13px] text-white">{r.service}</td>
              <td className="py-3">
                <span className="inline-flex items-center gap-1.5 text-xs text-[#d1d5db]">
                  <span className={cn('size-1.5 rounded-full', r.ok ? 'bg-[#22c55e]' : 'bg-[#ef4444]')} aria-hidden />
                  {r.ok ? 'Operational' : 'Down'}
                </span>
              </td>
              <td className="py-3 font-mono text-xs tabular-nums text-[#9ca3af]">{r.ms > 0 ? `${r.ms} ms` : '—'}</td>
              <td className="py-3 font-mono text-xs text-[#9ca3af]">{timeAgo(r.checked)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function LogsView() {
  const [level, setLevel] = useState('');
  const { data, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['admin', 'logs'],
    queryFn: () => adminGet<{ logs: LogEntry[] }>('/api/admin?logs=1'),
    refetchInterval: 15_000,
  });
  useRefreshPing(dataUpdatedAt);

  if (isLoading || !data) return <div className="h-72 animate-pulse rounded-lg bg-[#111111]" />;
  const logs = data.logs.filter((l) => !level || l.level === level).slice(-150).reverse();

  return (
    <Section
      title="Server logs"
      description="In-memory ring buffer — newest first, refreshes every 15 seconds"
      actions={
        <>
          <AdmSelect value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter log level" className="w-28">
            <option value="">All levels</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </AdmSelect>
          <AdmButton variant="ghost" onClick={() => void refetch()} aria-label="Refresh logs">
            <RefreshCw className="size-3.5" aria-hidden />
          </AdmButton>
        </>
      }
    >
      {logs.length === 0 ? (
        <EmptyState icon={<span className="font-mono text-xs">—</span>} label="No log entries." />
      ) : (
        <div className="max-h-[calc(100vh-380px)] overflow-auto">
          <ol className="space-y-0.5 font-mono text-[11px] leading-relaxed">
            {logs.map((entry, index) => (
              <li key={`${entry.time}-${index}`} className="flex flex-wrap items-baseline gap-x-2 whitespace-nowrap">
                <span className="text-[#6b7280]">[{fmtClock(entry.time)}]</span>
                <span
                  className={cn(
                    'w-10',
                    entry.level === 'error' ? 'text-[#ef4444]' : entry.level === 'warn' ? 'text-[#f59e0b]' : 'text-[#3b82f6]',
                  )}
                >
                  {entry.level}
                </span>
                <span className="text-[#d1d5db]">{entry.msg}</span>
                {entry.path && <span className="text-[#4b5563]">{entry.path}{entry.status ? ` ${entry.status}` : ''}</span>}
                {entry.durationMs !== undefined && <span className="text-[#4b5563]">{entry.durationMs}ms</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Section>
  );
}

function AnnouncementsView() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['flags'],
    queryFn: () => adminGet<{ flags: Record<string, boolean>; announcement: { id: string; message: string; createdAt: string } | null }>('/api/flags'),
    refetchInterval: 60_000,
  });
  useRefreshPing(dataUpdatedAt);

  const publish = async () => {
    try {
      await adminAction({ action: 'setAnnouncement', message });
      setMessage('');
      toast.success('Announcement published');
      void queryClient.invalidateQueries({ queryKey: ['flags'] });
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Publish failed');
    }
  };

  const clear = async () => {
    try {
      await adminAction({ action: 'clearAnnouncement', id: data?.announcement?.id });
      toast.success('Announcement cleared');
      void queryClient.invalidateQueries({ queryKey: ['flags'] });
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Clear failed');
    }
  };

  if (isLoading || !data) return <div className="h-56 animate-pulse rounded-lg bg-[#111111]" />;

  return (
    <Section title="Announcement editor" description="Shown as a banner to every signed-in user.">
      {data.announcement && (
        <div className="mb-4 rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#6b7280]">Currently live · {fmtDate(data.announcement.createdAt)}</p>
          <p className="pt-1 text-sm text-white">{data.announcement.message}</p>
        </div>
      )}
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Message to all users…"
        maxLength={300}
        rows={3}
        aria-label="Announcement message"
        className="w-full resize-none rounded-lg border border-[#1f1f1f] bg-[#111111] px-3 py-2.5 text-sm text-white placeholder:text-[#6b7280] outline-none transition-colors duration-150 focus:border-[#3b82f6]"
      />
      <div className="flex items-center gap-2 pt-3">
        <AdmButton variant="primary" disabled={message.trim().length < 2} onClick={() => void publish()}>
          Publish
        </AdmButton>
        {data.announcement && <AdmButton onClick={() => void clear()}>Take off air</AdmButton>}
        <span className="ml-auto font-mono text-[10px] tabular-nums text-[#6b7280]">{message.length}/300</span>
      </div>
    </Section>
  );
}
