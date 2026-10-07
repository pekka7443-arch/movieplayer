'use client';

// Account banners shown under the header:
// - GuestSignupBanner: "Sign in to watch thousands of titles free" (PHASE 2,
//   guests only — dismissible for the session so it never fights the UI).
// - MustChangePasswordBanner: nag for env-seeded admins still on the default
//   password (links to Settings → Security).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { KeyRound, Sparkles, X } from 'lucide-react';

import { useCinedeckStore } from '@/lib/store';
import { useSession } from '@/hooks/use-session';
import { useHydrated } from '@/hooks/use-hydrated';

const GUEST_BANNER_KEY = 'cinedeck.guestBanner.dismissedAt';

export function GuestSignupBanner() {
  const openAuth = useCinedeckStore((s) => s.openAuth);
  // Start hidden so SSR/first paint always match; a microtask reveals it
  // after checking the dismissal window (keeps the effect lint-clean too).
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      // Show again after 3 days (or a fresh browser profile).
      try {
        const raw = window.localStorage.getItem(GUEST_BANNER_KEY);
        const dismissedAt = raw ? Number(raw) : 0;
        setHidden(Date.now() - dismissedAt < 3 * 24 * 60 * 60 * 1000);
      } catch {
        setHidden(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { user } = useSession();
  if (user || hidden) return null;

  return (
    <section
      aria-label="Sign in call to action"
      className="mx-auto w-full max-w-[1440px] px-4 sm:px-6"
    >
      <div className="relative mt-3 overflow-hidden rounded-2xl border border-brand/40 bg-gradient-to-r from-brand/15 via-brand/5 to-transparent px-4 py-3.5 sm:px-5">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 right-0 h-28 w-64 rounded-full bg-brand/20 blur-3xl"
        />
        <div className="relative flex flex-wrap items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-zinc-950 shadow-md">
            <Sparkles className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Sign in to watch thousands of titles free
            </p>
            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Movies, series, live sports & replays — one free account, synced to every device.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => openAuth('signup')}
              className="h-9 rounded-lg bg-brand px-4 text-xs font-bold text-zinc-950 shadow-sm transition-colors hover:bg-brand/90"
            >
              Create free account
            </button>
            <button
              type="button"
              onClick={() => openAuth('signin')}
              className="h-9 rounded-lg border border-zinc-300 px-4 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-200/70 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Sign in
            </button>
            <button
              type="button"
              aria-label="Dismiss banner"
              onClick={() => {
                try {
                  window.localStorage.setItem(GUEST_BANNER_KEY, String(Date.now()));
                } catch {
                  /* ignore */
                }
                setHidden(true);
              }}
              className="flex size-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-200/70 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function MustChangePasswordBanner() {
  const openSettings = useCinedeckStore((s) => s.openSettings);
  const { user } = useSession();
  // mustChangePassword arrives from the localStorage session cache — gate
  // until hydration so the SSR HTML (guest) and the first client render agree.
  const hydrated = useHydrated();
  const [dismissed, setDismissed] = useState(false);

  if (!hydrated || !user?.mustChangePassword || dismissed) return null;

  return (
    <section
      role="alert"
      className="mx-auto w-full max-w-[1440px] px-4 sm:px-6"
    >
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/60 bg-amber-50 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-950/30">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/20 text-amber-600 dark:text-amber-400">
          <KeyRound className="size-4.5" aria-hidden />
        </span>
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
          <span className="font-bold">You are using the default admin password.</span> Please
          change it in Settings → Security right away.
        </p>
        <button
          type="button"
          onClick={openSettings}
          className="h-8 rounded-lg bg-amber-500 px-3 text-xs font-bold text-zinc-950 transition-colors hover:bg-amber-400"
        >
          Open Settings
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="flex size-8 items-center justify-center rounded-lg text-amber-700/70 hover:bg-amber-500/10 dark:text-amber-300/70"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
