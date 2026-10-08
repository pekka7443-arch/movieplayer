'use client';

// Settings — the signed-in admin's own account and device management
// (admin accounts are limited to 3 active devices by platform policy).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LogOut, RefreshCw, ShieldCheck } from 'lucide-react';

import {
  fetchSessions,
  revokeAllMySessions,
  revokeOneSession,
  revokeOtherSessions,
  type SessionInfo,
} from '@/lib/auth-client';
import { invalidateIdentityCaches, useSession } from '@/hooks/use-session';
import { deviceLabel, browserLabel, timeAgo } from '@/lib/format';
import { AdmButton, Avatar, EmptyState, fmtDate, PageHeader, Section, UpdatedAgo, useRefreshPing } from '@/components/admin/ui';

export function SettingsTab() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { user } = useSession();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: fetchSessions,
    refetchInterval: 30_000,
  });
  useRefreshPing(dataUpdatedAt);

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
      router.push('/');
    } else {
      toast.error('Could not revoke sessions');
    }
  };

  const sessions = data ?? [];

  return (
    <div>
      <PageHeader title="Settings" description="Your administrator account and active devices." />

      <div className="space-y-4">
        <Section title="Account" description="Identity and security posture of this admin account.">
          <div className="flex items-center gap-4">
            <Avatar email={user?.email ?? 'admin'} avatar={user?.avatar} size={44} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{user?.name || user?.email}</p>
              <p className="truncate pt-0.5 font-mono text-xs text-[#9ca3af]">{user?.email}</p>
            </div>
            <div className="ml-auto flex items-center gap-2 text-[11px]">
              <span className="rounded border border-[#3b82f6]/30 px-1.5 py-0.5 font-mono uppercase tracking-wider text-[#3b82f6]">admin</span>
              {user?.totpEnabled && (
                <span className="inline-flex items-center gap-1 rounded border border-[#1f1f1f] px-1.5 py-0.5 font-mono text-[#22c55e]">
                  <ShieldCheck className="size-3" aria-hidden /> 2FA
                </span>
              )}
            </div>
          </div>
          <dl className="mt-5 divide-y divide-[#1f1f1f] border-t border-[#1f1f1f]">
            {[
              { label: 'Role', value: 'Administrator — full platform access' },
              { label: 'Two-factor authentication', value: user?.totpEnabled ? 'Enabled' : 'Disabled — enable it in account settings' },
              { label: 'Email verification', value: user?.emailVerified ? 'Verified' : 'Not verified' },
              { label: 'Device limit', value: '3 active sessions maximum (platform policy)' },
            ].map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-xs text-[#6b7280]">{row.label}</dt>
                <dd className="text-right text-xs text-[#d1d5db]">{row.value}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section
          title="My devices"
          description="Logins from unseen devices are written to the audit log."
          actions={
            <>
              <UpdatedAgo />
              <AdmButton variant="ghost" onClick={() => void refetch()} aria-label="Refresh devices">
                <RefreshCw className="size-3.5" aria-hidden />
              </AdmButton>
              <AdmButton onClick={revokeOthers} disabled={sessions.length <= 1}>
                <LogOut className="size-3" aria-hidden /> Log out others
              </AdmButton>
              <AdmButton variant="danger" onClick={() => void revokeAll()}>
                Revoke all
              </AdmButton>
            </>
          }
        >
          {isLoading ? (
            <div className="h-40 animate-pulse rounded-lg bg-[#0d0d0d]" />
          ) : sessions.length === 0 ? (
            <EmptyState icon={<LogOut className="size-5" aria-hidden />} label="No active sessions." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-[#1f1f1f]">
                    <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Device</th>
                    <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Location</th>
                    <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Signed in</th>
                    <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Last seen</th>
                    <th className="pb-2 text-right text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session, i) => (
                    <tr key={session.id} className={`border-b border-[#1f1f1f] last:border-0 ${i % 2 === 1 ? 'bg-[#0d0d0d]' : ''}`}>
                      <td className="py-2.5">
                        <span className="flex items-center gap-2 text-[13px] text-white">
                          {deviceLabel(session.userAgent)}
                          {session.current && (
                            <span className="rounded border border-[#3b82f6]/30 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#3b82f6]">
                              this device
                            </span>
                          )}
                          <span className="font-mono text-[10px] text-[#6b7280]">· {browserLabel(session.userAgent)}</span>
                        </span>
                      </td>
                      <td className="py-2.5 font-mono text-xs text-[#9ca3af]">
                        {session.country ? `${session.country} · ${session.ip ?? ''}` : '—'}
                      </td>
                      <td className="py-2.5 text-xs text-[#9ca3af]">{fmtDate(session.createdAt)}</td>
                      <td className="py-2.5 text-xs text-[#9ca3af]">{timeAgo(session.lastSeenAt)}</td>
                      <td className="py-2.5 text-right">
                        <AdmButton
                          variant="ghost"
                          disabled={busyId === session.id}
                          onClick={() => void revokeOne(session.id)}
                          className="hover:text-[#ef4444]"
                        >
                          Revoke
                        </AdmButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
