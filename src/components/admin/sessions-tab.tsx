'use client';

// Sessions — live table of every active session with device/browser icons,
// 30s auto-refresh and per-row revoke.

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';

import { adminAction, adminGet, AdmButton, Avatar, fmtDate, PageHeader, Pagination, SearchInput, UpdatedAgo, useRefreshPing } from '@/components/admin/ui';
import { timeAgo } from '@/lib/format';

interface AdminSessionRow {
  id: string;
  email: string;
  userName: string | null;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ip: string | null;
  country: string | null;
  city: string | null;
}

function DeviceIcon({ userAgent }: { userAgent: string | null }) {
  const ua = userAgent ?? '';
  if (/ipad/i.test(ua)) return <Tablet className="size-3.5 text-[#6b7280]" aria-hidden />;
  if (/iphone|android|mobile/i.test(ua)) return <Smartphone className="size-3.5 text-[#6b7280]" aria-hidden />;
  return <Monitor className="size-3.5 text-[#6b7280]" aria-hidden />;
}

export function SessionsTab() {
  const queryClient = useQueryClient();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 220);
    return () => clearTimeout(timer);
  }, [qInput]);

  const { data, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['admin', 'sessions', q, page],
    queryFn: () => adminGet<{ total: number; page: number; pages: number; sessions: AdminSessionRow[] }>(`/api/admin?view=sessions&q=${encodeURIComponent(q)}&page=${page}`),
    refetchInterval: 30_000,
  });
  useRefreshPing(dataUpdatedAt);

  const revoke = async (id: string) => {
    try {
      await adminAction({ action: 'revokeSession', id });
      toast.success('Session revoked');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Revoke failed');
    }
  };

  return (
    <div>
      <PageHeader
        title="Sessions"
        description="Active sign-ins across all accounts — auto-refreshes every 30 seconds."
        actions={
          <AdmButton variant="ghost" onClick={() => void refetch()} aria-label="Refresh sessions">
            <RefreshCw className="size-3.5" aria-hidden /> Refresh
          </AdmButton>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <p className="font-mono text-xs tabular-nums text-[#9ca3af]">
          {data ? `${data.total.toLocaleString('en-US')} active session${data.total === 1 ? '' : 's'}` : '—'}
        </p>
        <div className="flex items-center gap-3">
          <UpdatedAgo />
          <SearchInput
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search by user…"
            aria-label="Search sessions"
            className="w-56"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#111111]">
        <div className="max-h-[calc(100vh-340px)] overflow-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-[#111111]">
              <tr className="border-b border-[#1f1f1f]">
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">User</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Device</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Browser</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Location</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Created</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Last seen</th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-xs text-[#6b7280]">Loading…</td></tr>
              )}
              {!isLoading && data?.sessions.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-xs text-[#9ca3af]">No active sessions.</td></tr>
              )}
              {data?.sessions.map((s, i) => (
                <tr
                  key={s.id}
                  className={`border-b border-[#1f1f1f] transition-colors duration-150 hover:bg-[#161616] ${i % 2 === 1 ? 'bg-[#0d0d0d]' : 'bg-[#111111]'}`}
                >
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <Avatar email={s.email} size={24} />
                      <span className="min-w-0">
                        <span className="block max-w-[160px] truncate text-[13px] text-white">{s.userName || s.email.split('@')[0]}</span>
                        <span className="block max-w-[160px] truncate font-mono text-[10px] text-[#6b7280]">{s.email}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2 text-xs text-[#9ca3af]">
                      <DeviceIcon userAgent={s.userAgent} />
                      {deviceKind(s.userAgent)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2 text-xs text-[#9ca3af]">
                      <GlobeIcon /> {browserName(s.userAgent)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[#9ca3af]">
                    <span className="font-mono uppercase">{s.country ?? '—'}</span>
                    {s.ip && <span className="block font-mono text-[10px] text-[#6b7280]">{s.ip}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[#9ca3af]">{fmtDate(s.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[#9ca3af]">{timeAgo(s.lastSeenAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <AdmButton variant="ghost" onClick={() => void revoke(s.id)} className="hover:text-[#ef4444]">
                      Revoke
                    </AdmButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && (
          <div className="border-t border-[#1f1f1f] px-4 py-3">
            <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} label="sessions" />
          </div>
        )}
      </div>
    </div>
  );
}

function deviceKind(userAgent: string | null): string {
  const ua = userAgent ?? '';
  if (/ipad/i.test(ua)) return 'Tablet';
  if (/iphone|android|mobile/i.test(ua)) return 'Mobile';
  return 'Desktop';
}

function browserName(userAgent: string | null): string {
  const v = (userAgent ?? '').toLowerCase();
  if (v.includes('edg/')) return 'Edge';
  if (v.includes('opr/') || v.includes('opera')) return 'Opera';
  if (v.includes('samsungbrowser')) return 'Samsung';
  if (v.includes('firefox')) return 'Firefox';
  if (v.includes('chrome') || v.includes('crios')) return 'Chrome';
  if (v.includes('safari')) return 'Safari';
  return 'Other';
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5 text-[#6b7280]" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}
