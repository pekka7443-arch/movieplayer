'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Eye, PenLine, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { fetchRatings, saveRating, type RatingRow } from '@/lib/library';
import type { MediaType } from '@/lib/tmdb';

/**
 * Personal rating strip for the watch page: 1–10 score, short private note
 * and a watched toggle. Private to the viewer (guests: device-local).
 */
export function WatchRating({ tmdbId, mediaType }: { tmdbId: number; mediaType: MediaType }) {
  const queryClient = useQueryClient();
  const [hoverScore, setHoverScore] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const query = useQuery<RatingRow[]>({
    queryKey: ['ratings'],
    queryFn: fetchRatings,
    staleTime: 30_000,
  });

  const row = (query.data ?? []).find((r) => r.tmdbId === tmdbId && r.mediaType === mediaType);

  useEffect(() => {
    setNoteDraft(row?.note ?? '');
    setNoteOpen(false);
  }, [row?.note, tmdbId, mediaType]);

  const save = async (patch: { score?: number | null; watched?: boolean; note?: string | null }) => {
    setBusy(true);
    try {
      await saveRating({ tmdbId, mediaType, ...patch });
      void queryClient.invalidateQueries({ queryKey: ['ratings'] });
    } catch {
      toast.error('Could not save — try again');
    } finally {
      setBusy(false);
    }
  };

  const score = row?.score ?? null;

  return (
    <section
      aria-label="Your rating and notes"
      className="mt-4 rounded-2xl border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/40"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2" onMouseLeave={() => setHoverScore(null)}>
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Your score
          </span>
          <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Score from 1 to 10">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => {
              const active = (hoverScore ?? score ?? 0) >= value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={score === value}
                  aria-label={`Rate ${value} of 10`}
                  onMouseEnter={() => setHoverScore(value)}
                  onClick={() => save({ score: score === value ? null : value })}
                  disabled={busy}
                  className="rounded p-0.5 transition-transform hover:scale-115 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  <Star
                    className={
                      'size-4 transition-colors ' +
                      (active ? 'fill-amber-400 text-amber-400' : 'text-zinc-300 dark:text-zinc-600')
                    }
                    aria-hidden
                  />
                </button>
              );
            })}
          </div>
          <span className="min-w-7 text-center font-mono text-sm font-bold text-brand" aria-live="polite">
            {score ?? '—'}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={row?.watched ?? false}
            disabled={busy}
            onClick={() => save({ watched: !row?.watched })}
            className={
              'h-8 gap-1.5 rounded-lg px-3 text-xs font-medium ' +
              (row?.watched
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400')
            }
          >
            <Eye className="size-3.5" aria-hidden />
            {row?.watched ? 'Watched' : 'Mark watched'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={noteOpen}
            onClick={() => setNoteOpen((v) => !v)}
            className="h-8 gap-1.5 rounded-lg border-zinc-200 px-3 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
          >
            <PenLine className="size-3.5" aria-hidden />
            Note
          </Button>
        </div>
      </div>

      {noteOpen && (
        <div className="mt-3 space-y-2">
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value.slice(0, 2000))}
            placeholder="Private note — where you left off, what you thought…"
            rows={2}
            className="resize-none rounded-xl border-zinc-200 bg-white/80 text-sm focus-visible:border-brand/60 dark:border-zinc-800 dark:bg-zinc-950/60"
            aria-label="Private note"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={async () => {
                await save({ note: noteDraft.trim() || null });
                setNoteOpen(false);
                toast.success('Note saved');
              }}
              className="h-7 gap-1 rounded-lg bg-brand px-2.5 text-xs font-semibold text-brand-foreground hover:bg-brand/90"
            >
              <Check className="size-3" aria-hidden />
              Save note
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
