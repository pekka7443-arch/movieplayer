'use client';

// Feature Flags — clean toggle list. Blue switch when on.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, RefreshCw } from 'lucide-react';

import { adminGet, AdmButton, PageHeader, Section, useRefreshPing } from '@/components/admin/ui';
import { Switch } from '@/components/ui/switch';

const FLAG_DESCRIPTIONS: Record<string, string> = {
  maintenance: 'Shows a maintenance screen to non-admin users.',
  registration: 'When off, new signups are closed.',
};

interface FlagsPayload {
  flags: Record<string, boolean>;
  announcement: { id: string; message: string } | null;
}

export function FlagsTab() {
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['flags'],
    queryFn: () => adminGet<FlagsPayload>('/api/flags'),
    refetchInterval: 60_000,
  });
  useRefreshPing(dataUpdatedAt);

  const setFlag = async (key: string, enabled: boolean) => {
    setBusy(key);
    try {
      const res = await fetch('/api/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'flag', key, enabled }),
      });
      if (!res.ok) throw new Error(`flag_${res.status}`);
      toast.success(`${key} ${enabled ? 'enabled' : 'disabled'}`);
      void queryClient.invalidateQueries({ queryKey: ['flags'] });
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch {
      toast.error('Could not update the flag');
    } finally {
      setBusy(null);
    }
  };

  const entries = Object.entries(data?.flags ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div>
      <PageHeader
        title="Feature Flags"
        description="Toggle platform features app-wide. Changes apply immediately."
        actions={
          <AdmButton variant="ghost" onClick={() => void refetch()} aria-label="Refresh flags">
            <RefreshCw className="size-3.5" aria-hidden /> Refresh
          </AdmButton>
        }
      />

      <Section title="Flags" description={isLoading ? 'Loading…' : `${entries.length} configured`}>
        {entries.length === 0 && !isLoading ? (
          <p className="py-4 text-center text-xs text-[#6b7280]">No feature flags defined.</p>
        ) : (
          <ul className="divide-y divide-[#1f1f1f]">
            {entries.map(([key, enabled]) => (
              <li key={key} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[13px] text-white">{key}</p>
                  <p className="pt-0.5 text-xs text-[#9ca3af]">{FLAG_DESCRIPTIONS[key] ?? 'Custom platform flag.'}</p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#6b7280]">{enabled ? 'on' : 'off'}</span>
                <Switch
                  checked={enabled}
                  disabled={busy === key}
                  onCheckedChange={(checked) => void setFlag(key, checked)}
                  aria-label={`Toggle ${key}`}
                  className="data-[state=checked]:bg-[#3b82f6]"
                />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex gap-2 border-t border-[#1f1f1f] pt-5">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="new flag key (e.g. beta-playlists)"
            maxLength={60}
            aria-label="New flag key"
            className="h-8 min-w-0 flex-1 rounded-lg border border-[#1f1f1f] bg-[#111111] px-2.5 font-mono text-xs text-white placeholder:text-[#6b7280] outline-none transition-colors duration-150 focus:border-[#3b82f6]"
          />
          <AdmButton
            variant="primary"
            disabled={newKey.trim().length < 2}
            onClick={async () => {
              await setFlag(newKey.trim(), false);
              setNewKey('');
            }}
          >
            <Plus className="size-3.5" aria-hidden /> Create flag
          </AdmButton>
        </div>
      </Section>
    </div>
  );
}
