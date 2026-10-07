'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Flag, Loader2, MessageSquare, Send, ThumbsUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/hooks/use-session';
import {
  fetchComments,
  mutateComment,
  postComment,
  type CommentRow,
} from '@/lib/library';
import type { MediaType } from '@/lib/tmdb';

const REACTION_ICONS: Record<string, string> = {
  like: '👍',
  love: '❤️',
  funny: '😄',
  info: 'ℹ️',
};

/**
 * Comments + reactions on a title. Signed-in users post and react; guests
 * read and are invited to sign in. Reports flag for admin moderation.
 */
export function CommentsSection({ tmdbId, mediaType }: { tmdbId: number; mediaType: MediaType }) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [visibleCount, setVisibleCount] = useState(4);
  const [reporting, setReporting] = useState<string | null>(null);
  // Reported-comment ids live in state (not a ref) — render reads them to
  // disable the report button.
  const [reported, setReported] = useState<Set<string>>(new Set());

  const query = useQuery<CommentRow[]>({
    queryKey: ['comments', tmdbId, mediaType],
    queryFn: () => fetchComments(tmdbId, mediaType),
    staleTime: 30_000,
  });

  // Reset local UI state when the title changes (async so the effect body
  // stays setState-free — satisfies the react-hooks cascade rule).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setDraft('');
      setVisibleCount(4);
      setReported(new Set());
    });
    return () => cancelAnimationFrame(raf);
  }, [tmdbId, mediaType]);

  const comments = useMemo(() => query.data ?? [], [query.data]);

  const onPost = async () => {
    if (posting || draft.trim().length < 2) return;
    setPosting(true);
    try {
      await postComment(tmdbId, mediaType, draft.trim());
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: ['comments', tmdbId, mediaType] });
      toast.success('Comment posted');
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'unauthorized') {
        toast.error('Sign in to join the discussion');
      } else if (code === 'rate_limited') {
        toast.error('Too many comments — take a short break');
      } else {
        toast.error('Could not post the comment');
      }
    } finally {
      setPosting(false);
    }
  };

  const onReact = async (id: string, kind: string) => {
    if (!user) {
      toast.error('Sign in to react');
      return;
    }
    try {
      await mutateComment({ action: 'react', id, kind });
      void queryClient.invalidateQueries({ queryKey: ['comments', tmdbId, mediaType] });
    } catch {
      toast.error('Could not react');
    }
  };

  const onReport = async (id: string) => {
    try {
      await mutateComment({ action: 'report', id });
      setReported((prev) => new Set(prev).add(id));
      setReporting(null);
      toast.success('Reported — a moderator will take a look');
    } catch {
      toast.error('Could not report');
    }
  };

  const onDelete = async (id: string) => {
    try {
      await mutateComment({ action: 'delete', id });
      void queryClient.invalidateQueries({ queryKey: ['comments', tmdbId, mediaType] });
      toast.success('Comment removed');
    } catch {
      toast.error('Could not delete');
    }
  };

  const shown = comments.slice(0, visibleCount);

  return (
    <section aria-label="Comments" className="mt-8 rounded-2xl border border-zinc-200 bg-white/60 p-4 sm:p-5 dark:border-zinc-800/80 dark:bg-zinc-900/40">
      <header className="mb-3 flex items-center gap-2">
        <MessageSquare className="size-4 text-brand" aria-hidden />
        <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Discussion
        </h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
        </span>
      </header>

      {/* Composer */}
      {user ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
            placeholder="Share your thoughts — no spoilers without warning!"
            rows={2}
            className="resize-none rounded-xl border-zinc-200 bg-white/80 text-sm focus-visible:border-brand/60 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-950/60"
            aria-label="Write a comment"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-400">{draft.length}/1000</span>
            <Button
              type="button"
              size="sm"
              disabled={posting || draft.trim().length < 2}
              onClick={onPost}
              className="h-8 gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-brand-foreground hover:bg-brand/90"
            >
              {posting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
              Post
            </Button>
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Sign in to join the discussion.
        </p>
      )}

      {/* List */}
      <ul className="mt-4 space-y-3">
        {shown.map((comment) => (
          <li key={comment.id} className="rounded-xl bg-zinc-100/70 p-3 dark:bg-zinc-900/60">
            <div className="flex items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/20 text-[10px] font-bold text-brand">
                {comment.author.slice(0, 2).toUpperCase()}
              </span>
              <span className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                {comment.author}
              </span>
              <span className="text-[11px] text-zinc-400">
                {new Date(comment.createdAt).toLocaleDateString()}
              </span>
              <span className="ml-auto flex items-center gap-1">
                {comment.mine && (
                  <button
                    type="button"
                    aria-label="Delete your comment"
                    onClick={() => onDelete(comment.id)}
                    className="rounded p-1 text-zinc-400 hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                )}
                {!reporting || reporting !== comment.id ? (
                  <button
                    type="button"
                    aria-label={`Report comment by ${comment.author}`}
                    onClick={() => setReporting(comment.id)}
                    disabled={reported.has(comment.id)}
                    className="rounded p-1 text-zinc-400 hover:bg-orange-500/10 hover:text-orange-500 disabled:opacity-40"
                  >
                    <Flag className="size-3.5" aria-hidden />
                  </button>
                ) : (
                  <span className="flex items-center gap-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => onReport(comment.id)}
                      className="rounded bg-orange-500/10 px-1.5 py-0.5 font-semibold text-orange-600 dark:text-orange-400"
                    >
                      Confirm report
                    </button>
                    <button
                      type="button"
                      onClick={() => setReporting(null)}
                      className="text-zinc-400 hover:text-zinc-600"
                      aria-label="Cancel report"
                    >
                      ✕
                    </button>
                  </span>
                )}
              </span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              {comment.body}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {Object.entries(REACTION_ICONS).map(([kind, glyph]) => {
                const reaction = comment.reactions.find((r) => r.kind === kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => onReact(comment.id, kind)}
                    aria-pressed={reaction?.mine ?? false}
                    aria-label={`React ${kind}`}
                    className={
                      'flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] transition-colors ' +
                      (reaction?.mine
                        ? 'border-brand/50 bg-brand/10 text-brand'
                        : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200')
                    }
                  >
                    <span aria-hidden>{glyph}</span>
                    {reaction && reaction.count > 0 ? reaction.count : ''}
                  </button>
                );
              })}
              {comment.reactions.length === 0 && (
                <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                  <ThumbsUp className="size-3" aria-hidden />
                  Be the first to react
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {comments.length > visibleCount && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setVisibleCount((v) => v + 8)}
          className="mt-3 h-8 w-full rounded-lg text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          Show {Math.min(8, comments.length - visibleCount)} more
        </Button>
      )}
    </section>
  );
}
