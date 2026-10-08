'use client';

// Moderation — reported content queue. Plain text actions, colorless until
// hover, and a calm empty state.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, RefreshCw, Trash2 } from 'lucide-react';

import { adminAction, adminGet, AdmButton, Avatar, EmptyState, PageHeader, SearchInput, useRefreshPing } from '@/components/admin/ui';
import { fmtDate } from '@/components/admin/ui';

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

export function ModerationTab() {
  const queryClient = useQueryClient();
  const [qInput, setQInput] = useState('');
  const { data, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['admin', 'reports'],
    queryFn: () => adminGet<ReportsPayload>('/api/admin?view=reports'),
    refetchInterval: 60_000,
  });
  useRefreshPing(dataUpdatedAt);

  const run = async (body: Record<string, unknown>, okMessage: string) => {
    try {
      await adminAction(body);
      toast.success(okMessage);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    }
  };

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title="Moderation" description="Reported content awaiting review." />
        <div className="h-48 animate-pulse rounded-lg bg-[#111111]" />
      </div>
    );
  }

  const q = qInput.trim().toLowerCase();
  const reports = data.reports.filter(
    (r) => !q || r.commentBody.toLowerCase().includes(q) || (r.authorEmail ?? '').toLowerCase().includes(q),
  );

  return (
    <div>
      <PageHeader
        title="Moderation"
        description="Reported comments awaiting review — dismiss, remove or suspend."
        actions={
          <AdmButton variant="ghost" onClick={() => void refetch()} aria-label="Refresh moderation queue">
            <RefreshCw className="size-3.5" aria-hidden /> Refresh
          </AdmButton>
        }
      />

      <div className="pb-4">
        <SearchInput
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Filter reports…"
          aria-label="Filter reports"
          className="w-full sm:w-72"
        />
      </div>

      {reports.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="size-6" aria-hidden />} label="No reports. Everything looks good." />
      ) : (
        <ul className="space-y-3">
          {reports.map((r, i) => (
            <li
              key={r.id}
              className={`rounded-lg border border-[#1f1f1f] bg-[#111111] p-5 transition-colors duration-150 hover:border-[#2a2a2a] ${i % 2 === 1 ? 'bg-[#0e0e0e]' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-2.5 pb-3 text-xs">
                <Avatar email={r.authorEmail ?? 'unknown'} size={22} />
                <span className="font-medium text-white">{r.authorName || r.authorEmail || 'Unknown author'}</span>
                {r.commentStatus === 'flagged' && (
                  <span className="rounded border border-[#ef4444]/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#ef4444]">
                    flagged
                  </span>
                )}
                <span className="ml-auto font-mono text-[10px] text-[#6b7280]">reported {fmtDate(r.createdAt)}</span>
              </div>
              <p className="pb-2 text-sm leading-relaxed text-[#d1d5db]">{r.commentBody}</p>
              {r.reason && <p className="pb-1 text-xs italic text-[#9ca3af]">Reason: {r.reason}</p>}
              <p className="pb-3 font-mono text-[10px] text-[#6b7280]">comment from {fmtDate(r.commentCreatedAt)}</p>
              <div className="flex flex-wrap gap-1">
                <AdmButton variant="ghost" onClick={() => void run({ action: 'dismissReport', reportId: r.id }, 'Report dismissed')}>
                  Dismiss
                </AdmButton>
                <AdmButton variant="ghost" onClick={() => void run({ action: 'deleteComment', id: r.commentId }, 'Comment removed')} className="hover:text-[#ef4444]">
                  <Trash2 className="size-3" aria-hidden /> Delete
                </AdmButton>
                {r.authorId && (
                  <AdmButton
                    variant="ghost"
                    className="hover:text-[#ef4444]"
                    onClick={() => {
                      const reason = window.prompt('Suspension reason (shown to the user):');
                      if (reason && reason.trim().length >= 3) void run({ action: 'suspendUser', id: r.authorId!, reason: reason.trim() }, 'Author suspended');
                    }}
                  >
                    <Ban className="size-3" aria-hidden /> Suspend
                  </AdmButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
