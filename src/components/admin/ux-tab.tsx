'use client';

// User Experience — feedback & engagement tools.
//
// Top of the page: the real tools (announcements, feature flags, feedback).
// Bottom, after all legitimate content: "Advanced Interaction Tools" —
// internal overrides with deliberately dry, technical names. The catalog
// (labels + descriptions) is served by the admin API; nothing in this file
// or the client bundle hints at what the protocols actually render.

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Inbox, RefreshCw } from 'lucide-react';

import {
  adminGet,
  AdmButton,
  AdmSelect,
  EmptyState,
  fmtDate,
  PageHeader,
  SearchInput,
  Section,
  useRefreshPing,
} from '@/components/admin/ui';
import { Switch } from '@/components/ui/switch';
import { timeAgo } from '@/lib/format';

interface UxTool {
  type: string;
  label: string;
  description: string;
  needsMessage: boolean;
}

interface OverrideEvent {
  id: number;
  type: string;
  message: string;
  durationSec: number;
  createdAt: number;
  revokedAt: number | null;
  target: string;
  createdBy: string;
}

interface TrollPayload {
  tools: UxTool[];
  events: OverrideEvent[];
}

interface FlagsPayload {
  flags: Record<string, boolean>;
  announcement: { id: string; message: string; createdAt: string } | null;
}

const DURATIONS = [
  { value: 15, label: '15 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
];

export function UxTab() {
  const queryClient = useQueryClient();
  const [targetMode, setTargetMode] = useState<'all' | 'user'>('all');
  const [targetEmail, setTargetEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [firing, setFiring] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const { data, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['admin', 'ux'],
    queryFn: () => adminGet<TrollPayload>('/api/admin/troll'),
    refetchInterval: 30_000,
  });
  useRefreshPing(dataUpdatedAt);

  const { data: flagsData } = useQuery({
    queryKey: ['flags'],
    queryFn: () => adminGet<FlagsPayload>('/api/flags'),
    refetchInterval: 60_000,
  });

  // Victim picker — the admin users table, light page of emails.
  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users', 'ux-picker'],
    queryFn: () =>
      adminGet<{ users: { email: string; name: string | null }[] }>(
        '/api/admin?view=users&sort=created_at&dir=desc&page=1&pageSize=100',
      ),
    staleTime: 60_000,
  });

  // Local clock so expired overrides leave the table without a refetch.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(timer);
  }, []);

  const tools = data?.tools ?? [];
  const activeOverrides = useMemo(() => {
    const now = Date.now();
    return (data?.events ?? []).filter(
      (e) => !e.revokedAt && e.createdAt + e.durationSec * 1_000 > now,
    );
  }, [data]);

  const apply = async (tool: UxTool) => {
    if (targetMode === 'user' && !targetEmail.trim()) {
      toast.error('Select a target user first.');
      return;
    }
    if (tool.needsMessage && notice.trim().length < 2) {
      toast.error('A notice body is required for this protocol.');
      return;
    }
    setFiring(tool.type);
    try {
      const res = await fetch('/api/admin/troll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: tool.type,
          target: targetMode === 'all' ? 'all' : targetEmail.trim().toLowerCase(),
          message: notice.trim() || undefined,
          durationSec: durations[tool.type] ?? 30,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? `ux_${res.status}`);
      }
      toast.success(`${tool.label} applied`);
      setNotice('');
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Apply failed');
    } finally {
      setFiring(null);
    }
  };

  const revoke = async (id: number) => {
    try {
      const res = await fetch('/api/admin/troll', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? `ux_${res.status}`);
      }
      toast.success('Override revoked');
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Revoke failed');
    }
  };

  const setFlag = async (key: string, enabled: boolean) => {
    const res = await fetch('/api/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'flag', key, enabled }),
    });
    if (!res.ok) {
      toast.error('Could not update the flag');
      return;
    }
    toast.success(`${key} ${enabled ? 'enabled' : 'disabled'}`);
    void queryClient.invalidateQueries({ queryKey: ['flags'] });
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
  };

  const publishAnnouncement = async () => {
    const res = await fetch('/api/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'announce', message: announcement.trim() }),
    });
    if (!res.ok) {
      toast.error('Publish failed');
      return;
    }
    toast.success('Announcement published');
    setAnnouncement('');
    void queryClient.invalidateQueries({ queryKey: ['flags'] });
  };

  const clearAnnouncement = async () => {
    const res = await fetch('/api/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'announce-off' }),
    });
    if (!res.ok) {
      toast.error('Clear failed');
      return;
    }
    toast.success('Announcement taken off air');
    void queryClient.invalidateQueries({ queryKey: ['flags'] });
  };

  const [announcement, setAnnouncement] = useState('');
  const flagEntries = Object.entries(flagsData?.flags ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div>
      <PageHeader
        title="User Experience"
        description="Feedback & engagement tools — communicate with users and tune their experience."
        actions={
          <AdmButton variant="ghost" onClick={() => void refetch()} aria-label="Refresh user experience tools">
            <RefreshCw className="size-3.5" aria-hidden /> Refresh
          </AdmButton>
        }
      />

      <div className="space-y-4">
        {/* Real tool 1 — announcement banner */}
        <Section title="Announcement Banner" description="Send a message to all users — displayed site-wide.">
          {flagsData?.announcement && (
            <div className="mb-4 rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-[#6b7280]">Currently live</p>
              <p className="pt-1 text-sm text-white">{flagsData.announcement.message}</p>
            </div>
          )}
          <textarea
            value={announcement}
            onChange={(e) => setAnnouncement(e.target.value)}
            placeholder="Message to all users…"
            maxLength={300}
            rows={3}
            aria-label="Announcement message"
            className="w-full resize-none rounded-lg border border-[#1f1f1f] bg-[#111111] px-3 py-2.5 text-sm text-white placeholder:text-[#6b7280] outline-none transition-colors duration-150 focus:border-[#3b82f6]"
          />
          <div className="flex items-center gap-2 pt-3">
            <AdmButton variant="primary" disabled={announcement.trim().length < 2} onClick={() => void publishAnnouncement()}>
              Publish
            </AdmButton>
            {flagsData?.announcement && <AdmButton onClick={() => void clearAnnouncement()}>Take off air</AdmButton>}
            <span className="ml-auto font-mono text-[10px] tabular-nums text-[#6b7280]">{announcement.length}/300</span>
          </div>
        </Section>

        {/* Real tool 2 — feature flags */}
        <Section title="Feature Flags" description="Toggle platform features. Changes apply immediately.">
          {flagEntries.length === 0 ? (
            <p className="py-3 text-center text-xs text-[#6b7280]">No flags configured — manage them in the Feature Flags tab.</p>
          ) : (
            <ul className="divide-y divide-[#1f1f1f]">
              {flagEntries.map(([key, enabled]) => (
                <li key={key} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <p className="min-w-0 flex-1 font-mono text-[13px] text-white">{key}</p>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-[#6b7280]">{enabled ? 'on' : 'off'}</span>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) => void setFlag(key, checked)}
                    aria-label={`Toggle ${key}`}
                    className="data-[state=checked]:bg-[#3b82f6]"
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Real tool 3 — user feedback */}
        <Section title="User Feedback" description="Messages submitted through the in-app feedback form.">
          <EmptyState icon={<Inbox className="size-5" aria-hidden />} label="No feedback submitted yet. Submissions appear here." />
        </Section>

        {/* ------------------------------------------------------------------
            Advanced Interaction Tools — intentionally plain. Boring names,
            no color, no icons. Served verbatim from the admin API catalog.
           ------------------------------------------------------------------ */}
        <Section
          muted
          className="scroll-mt-20"
          title="Advanced Interaction Tools"
          description="Internal moderation and engagement features. Changes affect the selected audience within 15 seconds."
        >
          {/* Audience */}
          <div className="flex flex-wrap items-center gap-2 pb-4">
            <span className="text-xs text-[#6b7280]">Audience:</span>
            {(['all', 'user'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={targetMode === mode}
                onClick={() => setTargetMode(mode)}
                className={
                  targetMode === mode
                    ? 'h-8 rounded-lg bg-[#141414] px-3 text-xs font-medium text-white transition-colors duration-150'
                    : 'h-8 rounded-lg px-3 text-xs text-[#9ca3af] transition-colors duration-150 hover:bg-[#111111] hover:text-white'
                }
              >
                {mode === 'all' ? 'All users' : 'Specific user'}
              </button>
            ))}
            {targetMode === 'user' && (
              <>
                <input
                  type="email"
                  list="ux-user-emails"
                  value={targetEmail}
                  onChange={(e) => setTargetEmail(e.target.value)}
                  placeholder="user@example.com"
                  aria-label="Target user email"
                  className="h-8 w-64 rounded-lg border border-[#1f1f1f] bg-[#111111] px-2.5 font-mono text-xs text-white placeholder:text-[#6b7280] outline-none transition-colors duration-150 focus:border-[#3b82f6]"
                />
                <datalist id="ux-user-emails">
                  {(usersData?.users ?? []).map((u) => (
                    <option key={u.email} value={u.email}>
                      {u.name ?? 'member'}
                    </option>
                  ))}
                </datalist>
              </>
            )}
          </div>

          {/* Notice body (required by Direct User Communication) */}
          <div className="pb-4">
            <label htmlFor="ux-notice" className="text-xs text-[#6b7280]">
              Notice body <span className="text-[#4b5563]">(required by Direct User Communication, optional elsewhere)</span>
            </label>
            <input
              id="ux-notice"
              value={notice}
              onChange={(e) => setNotice(e.target.value)}
              maxLength={200}
              placeholder="Plain-text notice delivered to the selected audience…"
              className="mt-1.5 h-9 w-full max-w-xl rounded-lg border border-[#1f1f1f] bg-[#111111] px-3 text-sm text-white placeholder:text-[#6b7280] outline-none transition-colors duration-150 focus:border-[#3b82f6]"
            />
          </div>

          {/* Tools */}
          {isLoading ? (
            <div className="h-64 animate-pulse rounded-lg bg-[#0d0d0d]" />
          ) : (
            <ul className="divide-y divide-[#1a1a1a] border-t border-[#1a1a1a]">
              {tools.map((tool) => (
                <li key={tool.type} className="flex flex-wrap items-center gap-3 py-3 first:border-t-0 sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[#d1d5db]">{tool.label}</p>
                    <p className="pt-0.5 text-xs leading-relaxed text-[#6b7280]">{tool.description}</p>
                  </div>
                  <AdmSelect
                    value={String(durations[tool.type] ?? 30)}
                    onChange={(e) => setDurations((d) => ({ ...d, [tool.type]: Number(e.target.value) }))}
                    aria-label={`Duration for ${tool.label}`}
                    className="w-32 shrink-0"
                  >
                    {DURATIONS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </AdmSelect>
                  <AdmButton
                    variant="primary"
                    disabled={firing !== null || (tool.needsMessage && notice.trim().length < 2)}
                    onClick={() => void apply(tool)}
                    className="shrink-0"
                    aria-label={`Apply ${tool.label}`}
                  >
                    {firing === tool.type ? 'Applying…' : 'Apply'}
                  </AdmButton>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Active overrides */}
        <Section
          muted
          title="Active User Experience Overrides"
          description="Overrides currently running on client sessions. Revoking ends them immediately."
        >
          {activeOverrides.length === 0 ? (
            <p className="py-4 text-center text-xs text-[#6b7280]">No active overrides.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-[#1a1a1a]">
                    <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">User</th>
                    <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Protocol</th>
                    <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Applied</th>
                    <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Expires</th>
                    <th className="pb-2 text-right text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">Revoke</th>
                  </tr>
                </thead>
                <tbody>
                  {activeOverrides.map((e) => {
                    const tool = tools.find((t) => t.type === e.type);
                    const expiresAt = e.createdAt + e.durationSec * 1_000;
                    return (
                      <tr key={e.id} className="border-b border-[#1a1a1a] last:border-0">
                        <td className="py-2.5 font-mono text-xs text-[#d1d5db]">{e.target === 'all' ? 'All users' : e.target}</td>
                        <td className="py-2.5 text-xs text-[#d1d5db]">{tool?.label ?? e.type}</td>
                        <td className="py-2.5 font-mono text-xs text-[#6b7280]" title={fmtDate(new Date(e.createdAt).toISOString())}>
                          {timeAgo(new Date(e.createdAt).toISOString())}
                        </td>
                        <td className="py-2.5 font-mono text-xs tabular-nums text-[#6b7280]">
                          in {Math.max(0, Math.round((expiresAt - Date.now()) / 1_000))}s
                        </td>
                        <td className="py-2.5 text-right">
                          <AdmButton variant="ghost" onClick={() => void revoke(e.id)} className="hover:text-[#ef4444]">
                            Revoke
                          </AdmButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
