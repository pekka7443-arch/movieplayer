'use client';

// Audit Log — monospaced system-log styling:
//   [timestamp] [admin@email] ACTION → target (details)
// with action / date-range / admin filters and CSV export.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, RefreshCw } from 'lucide-react';

import { adminGet, AdmButton, AdmSelect, EmptyState, PageHeader, Pagination, SearchInput, useRefreshPing } from '@/components/admin/ui';
import { fmtClock } from '@/components/admin/ui';

interface AuditEntry {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

interface AuditPayload {
  total: number;
  page: number;
  pages: number;
  entries: AuditEntry[];
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function AuditTab() {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [admin, setAdminInput] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 220);
    return () => clearTimeout(timer);
  }, [qInput]);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ view: 'audit', page: String(page) });
    if (q) p.set('q', q);
    if (action) p.set('action', action);
    if (admin.trim()) p.set('admin', admin.trim());
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p.toString();
  }, [q, action, admin, from, to, page]);

  const { data, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['admin', 'audit', qs],
    queryFn: () => adminGet<AuditPayload>(`/api/admin?${qs}`),
    refetchInterval: 30_000,
  });
  useRefreshPing(dataUpdatedAt);

  const exportCsv = () => {
    const entries = data?.entries ?? [];
    const lines = [
      ['timestamp', 'actor', 'action', 'target_type', 'target_id', 'target_label', 'details'].map(csvEscape).join(','),
      ...entries.map((e) =>
        [
          e.createdAt,
          e.actorEmail ?? 'system',
          e.action,
          e.targetType ?? '',
          e.targetId ?? '',
          e.targetLabel ?? '',
          JSON.stringify(e.details),
        ].map(csvEscape).join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cinedeck-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="Immutable trail of every administrative operation."
        actions={
          <>
            <AdmButton variant="ghost" onClick={exportCsv} aria-label="Export audit log as CSV">
              <Download className="size-3.5" aria-hidden /> Export CSV
            </AdmButton>
            <AdmButton variant="ghost" onClick={() => void refetch()} aria-label="Refresh audit log">
              <RefreshCw className="size-3.5" aria-hidden /> Refresh
            </AdmButton>
          </>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <SearchInput
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search actor or target…"
          aria-label="Search audit log"
          className="w-full sm:w-64"
        />
        <AdmSelect value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Filter by action type" className="w-44">
          <option value="">All actions</option>
          <option value="user.suspended">user.suspended</option>
          <option value="user.unsuspended">user.unsuspended</option>
          <option value="user.promoted">user.promoted</option>
          <option value="user.demoted">user.demoted</option>
          <option value="user.force_logout">user.force_logout</option>
          <option value="user.hard_deleted">user.hard_deleted</option>
          <option value="session.revoked">session.revoked</option>
          <option value="comment.removed">comment.removed</option>
          <option value="report.dismissed">report.dismissed</option>
          <option value="announcement.set">announcement.set</option>
          <option value="ux.protocol_applied">ux.protocol_applied</option>
          <option value="ux.protocol_previewed">ux.protocol_previewed</option>
          <option value="ux.protocol_revoked">ux.protocol_revoked</option>
        </AdmSelect>
        <input
          type="date"
          value={from}
          onChange={(e) => { setFrom(e.target.value); setPage(1); }}
          aria-label="From date"
          className="h-8 rounded-lg border border-[#1f1f1f] bg-[#111111] px-2.5 font-mono text-xs text-[#d1d5db] outline-none transition-colors duration-150 focus:border-[#3b82f6]"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => { setTo(e.target.value); setPage(1); }}
          aria-label="To date"
          className="h-8 rounded-lg border border-[#1f1f1f] bg-[#111111] px-2.5 font-mono text-xs text-[#d1d5db] outline-none transition-colors duration-150 focus:border-[#3b82f6]"
        />
        <input
          value={admin}
          onChange={(e) => { setAdminInput(e.target.value); setPage(1); }}
          placeholder="Admin email"
          aria-label="Filter by admin email"
          className="h-8 w-44 rounded-lg border border-[#1f1f1f] bg-[#111111] px-2.5 font-mono text-xs text-white placeholder:text-[#6b7280] outline-none transition-colors duration-150 focus:border-[#3b82f6]"
        />
      </div>

      {isLoading ? (
        <div className="h-72 animate-pulse rounded-lg bg-[#111111]" />
      ) : !data || data.entries.length === 0 ? (
        <EmptyState icon={<span className="font-mono text-sm">01</span>} label="No audit entries match the filters." />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#111111]">
            <div className="max-h-[calc(100vh-360px)] overflow-auto p-4">
              <ol className="space-y-1 font-mono text-[11px] leading-relaxed">
                {data.entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 whitespace-nowrap">
                    <span className="text-[#6b7280]">[{fmtClock(e.createdAt)}]</span>
                    <span className="text-[#9ca3af]">[{e.actorEmail ?? 'system'}]</span>
                    <span className="font-medium text-white">{e.action}</span>
                    <span className="text-[#4b5563]">→</span>
                    <span className="text-[#d1d5db]">{e.targetLabel ?? e.targetId ?? '—'}</span>
                    {Object.keys(e.details).length > 0 && (
                      <span className="truncate text-[#4b5563]">({JSON.stringify(e.details)})</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} label="entries" />
        </>
      )}
    </div>
  );
}
