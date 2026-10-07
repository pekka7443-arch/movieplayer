'use client';

// PHASE 2 — "Sign in to watch" gate.
// Guests keep full browsing/searching/details, but every playback surface
// (movie/TV player, live sports, replays, trailers) shows the gate instead
// of a player. The modal animates in (framer-motion, reduced-motion aware)
// and hands off to the shared auth dialog — no redirects, the user stays on
// the page and is returned to the exact spot after signing in.

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Lock, LogIn, Play, UserRoundPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCinedeckStore } from '@/lib/store';
import { useSession } from '@/hooks/use-session';

/**
 * True when playback must stay locked: no signed-in account. Fails closed —
 * while the very first session query is still resolving, playback stays
 * gated (a signed-in user's cached localStorage profile resolves instantly,
 * so the flash only affects brand-new visitors).
 */
export function usePlaybackLocked(): boolean {
  const { user } = useSession();
  return user === null;
}

interface GateProps {
  /** Title shown in the copy ("Sign in to watch <title>"). */
  title?: string;
  /** Where to return after a successful sign-in (defaults to current URL). */
  returnTo?: string;
}

/** Open the shared auth dialog pre-filled with the watch context. */
export function openAuthForWatch(notice?: string | null, returnTo?: string): void {
  useCinedeckStore.getState().openAuth('signin', {
    notice: notice ?? null,
    returnTo: returnTo ?? (typeof window !== 'undefined' ? window.location.href : null),
  });
}

/** The animated "Sign in to watch" modal. */
export function SignInToWatchModal({
  open,
  onOpenChange,
  title,
}: GateProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const reduceMotion = useReducedMotion();
  const openAuth = useCinedeckStore((s) => s.openAuth);

  const heading = title ? `Sign in to watch ${title}` : 'Sign in to watch';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm gap-0 overflow-hidden rounded-2xl border-zinc-200 bg-zinc-50 p-0 dark:border-zinc-800/80 dark:bg-zinc-950">
        <div className="relative px-6 pb-6 pt-8 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-14 left-1/2 h-36 w-72 -translate-x-1/2 rounded-full bg-brand-soft blur-3xl"
          />
          <motion.span
            initial={reduceMotion ? undefined : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand text-zinc-950 shadow-[0_0_28px_color-mix(in_srgb,var(--cinedeck-accent)_35%,transparent)]"
          >
            <Lock className="size-6" aria-hidden />
          </motion.span>
          <DialogHeader className="space-y-1.5 pt-4 text-center">
            <DialogTitle className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {heading}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              Free account — thousands of movies, series & live sports. Your watchlist and history
              sync everywhere.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 space-y-2">
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false);
                openAuth('signin', { notice: title ? `Sign in to watch ${title}.` : null });
              }}
              className="h-11 w-full rounded-lg bg-brand text-sm font-semibold text-zinc-950 shadow-[0_0_20px_color-mix(in_srgb,var(--cinedeck-accent)_20%,transparent)] hover:bg-brand/90"
            >
              <LogIn className="size-4" aria-hidden /> Sign in
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                openAuth('signup', { notice: title ? `Sign up to watch ${title}.` : null });
              }}
              className="h-11 w-full rounded-lg border-zinc-300 text-sm font-semibold text-zinc-800 hover:bg-zinc-200/70 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <UserRoundPlus className="size-4" aria-hidden /> Create free account
            </Button>
          </div>
          <p className="pt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            Browsing and details stay free — you only need an account to press play.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Inline lock panel that replaces the player for guests. */
export function GuestPlayLock({ title, returnTo }: GateProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const openAuth = useCinedeckStore((s) => s.openAuth);

  // Keep the door obvious: the lock panel is a passive invitation, the modal
  // is the animated "Sign in to watch" moment required by the spec.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timer = window.setTimeout(() => setModalOpen(true), 350);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="relative flex min-h-[220px] flex-col items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-900 px-6 py-10 text-center md:min-h-[420px] dark:border-zinc-800">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--cinedeck-accent)_16%,transparent),transparent_65%)]"
      />
      <span className="relative flex size-14 items-center justify-center rounded-2xl bg-brand text-zinc-950 shadow-[0_0_28px_color-mix(in_srgb,var(--cinedeck-accent)_35%,transparent)]">
        <Lock className="size-6" aria-hidden />
      </span>
      <h2 className="relative pt-4 text-lg font-bold text-white">
        {title ? `Sign in to watch ${title}` : 'Sign in to watch'}
      </h2>
      <p className="relative max-w-sm pt-1.5 text-sm leading-relaxed text-zinc-300">
        Playback needs a free CineDeck account. Everything else — browsing, search, details —
        stays open.
      </p>
      <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          onClick={() => openAuth('signin', { notice: title ? `Sign in to watch ${title}.` : null, returnTo })}
          className="h-11 rounded-lg bg-brand px-5 text-sm font-semibold text-zinc-950 hover:bg-brand/90"
        >
          <LogIn className="size-4" aria-hidden /> Sign in
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => openAuth('signup', { notice: title ? `Sign up to watch ${title}.` : null, returnTo })}
          className="h-11 rounded-lg border-zinc-700 px-5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
        >
          <UserRoundPlus className="size-4" aria-hidden /> Create account
        </Button>
      </div>
      <span className="relative mt-4 inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
        <Play className="size-3" aria-hidden /> Streams stay exactly where they are — nothing is
        downloaded or re-hosted.
      </span>

      <SignInToWatchModal open={modalOpen} onOpenChange={setModalOpen} title={title} />
    </div>
  );
}
