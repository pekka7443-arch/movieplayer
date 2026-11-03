'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Clapperboard, Compass, Sparkles, UserRoundPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getSettings, updateSettings } from '@/lib/settings';
import { useCinedeckStore } from '@/lib/store';
import { EXPLORE_GENRES } from '@/components/site/home-view';

const ONBOARDING_KEY = 'cinedeck.onboarding.v1';

/**
 * First-visit tour: 3 steps — welcome, pick your genres (seeds the Explore
 * prefilter), account nudge. Shows once per device, only on the home view,
 * ~1s after mount so it never fights the first paint.
 */
export function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const reduceMotion = useReducedMotion();
  const openAuth = useCinedeckStore((s) => s.openAuth);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let done: string | null = null;
    try {
      done = window.localStorage.getItem(ONBOARDING_KEY);
    } catch {
      /* storage unavailable — never nag */
    }
    if (done) return;
    const timer = window.setTimeout(() => setOpen(true), 1_200);
    return () => window.clearTimeout(timer);
  }, []);

  const finish = (genres: string[]) => {
    try {
      window.localStorage.setItem(ONBOARDING_KEY, 'done');
    } catch {
      /* ignore */
    }
    updateSettings({ favoriteGenres: genres });
    if (genres[0]) {
      // Wire the pick into the real UI: preselect the genre in Explore.
      window.dispatchEvent(new CustomEvent('cinedeck:explore-genre', { detail: genres[0] }));
    }
    setOpen(false);
  };

  const toggleGenre = (genre: string) =>
    setPicked((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre],
    );

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? finish(picked) : setOpen(true))}>
      <DialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl border-zinc-200 bg-zinc-50 p-0 dark:border-zinc-800/80 dark:bg-zinc-950">
        <div className="relative border-b border-zinc-200 bg-white/70 px-6 pb-5 pt-6 dark:border-zinc-800/80 dark:bg-zinc-900/40">
          <span
            aria-hidden
          />
          <DialogHeader className="space-y-2 text-left">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand text-brand-foreground shadow-[0_0_18px_color-mix(in_srgb,var(--cinedeck-accent)_25%,transparent)]">
              <Clapperboard className="size-5" aria-hidden />
            </span>
            <DialogTitle className="pt-1 text-xl font-bold tracking-tight">
              {step === 0 && 'Welcome to CineDeck'}
              {step === 1 && 'What do you like to watch?'}
              {step === 2 && 'Keep your library everywhere'}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              {step === 0 && 'Search any movie or series, press play — CineDeck scans every source and picks the healthiest one. Live sports and replays included, no account needed.'}
              {step === 1 && 'Pick a few genres — we put them first in Explore so your next watch is one tap away. You can change this anytime.'}
              {step === 2 && 'A free account syncs your watchlist, history and ratings across devices. Or keep it local — everything works as a guest too.'}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 py-5">
          {step === 1 && (
            <div
              role="group"
              aria-label="Favorite genres"
              className="flex flex-wrap gap-2"
            >
              {EXPLORE_GENRES.map((genre) => {
                const active = picked.includes(genre);
                return (
                  <button
                    key={genre}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleGenre(genre)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
                      active
                        ? 'border-transparent bg-brand text-brand-foreground'
                        : 'border-zinc-200 bg-white/70 text-zinc-600 hover:border-brand/40 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300'
                    }`}
                  >
                    {genre}
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white/70 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/40">
              <UserRoundPlus className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                Guest mode stores your list on this device. Sign up and it follows
                you — same list, same progress, every screen.
              </p>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === step ? 'w-6 bg-brand' : 'w-1.5 bg-zinc-300 dark:bg-zinc-700'
                  }`}
                />
              ))}
              <span className="sr-only">Step {step + 1} of 3</span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => finish(picked)}>
                Skip
              </Button>
              {step === 0 && (
                <Button
                  size="sm"
                  onClick={() => setStep(1)}
                  className="gap-1.5"
                >
                  <Sparkles className="size-3.5" aria-hidden />
                  Next
                </Button>
              )}
              {step === 1 && (
                <Button size="sm" onClick={() => setStep(2)} className="gap-1.5">
                  <Compass className="size-3.5" aria-hidden />
                  Next
                </Button>
              )}
              {step === 2 && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    finish(picked);
                    openAuth('signup');
                  }}
                >
                  <UserRoundPlus className="size-3.5" aria-hidden />
                  Create account
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
