'use client';

import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCinedeckStore } from '@/lib/store';

const TMDB_KEY_URL = 'https://www.themoviedb.org/settings/api';

export function ConnectCard({ compact = false }: { compact?: boolean }) {
  const openSettings = useCinedeckStore((s) => s.openSettings);

  if (compact) {
    const steps = [
      { n: 1, text: 'Get a free API key from themoviedb.org' },
      { n: 2, text: 'Paste it into CineDeck Settings' },
      { n: 3, text: 'Browse trending titles & search in 12 languages' },
    ];
    return (
      <div className="flex h-full min-h-56 flex-col justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-200/40 p-6 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-500 dark:text-amber-400">
            <KeyRound className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Unlock the library</p>
            <p className="text-xs text-zinc-500">Trending, search & 12 languages</p>
          </div>
        </div>
        <ol className="mt-4 space-y-2.5">
          {steps.map((step) => (
            <li key={step.n} className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-amber-600 dark:bg-zinc-800 dark:text-amber-400">
                {step.n}
              </span>
              {step.text}
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={openSettings}
            className="h-10 rounded-lg bg-amber-400 px-4 text-sm font-semibold text-zinc-950 hover:bg-amber-300"
          >
            <KeyRound className="size-4" aria-hidden />
            Add your free API key
          </Button>
          <a
            href={TMDB_KEY_URL}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-zinc-500 underline-offset-2 transition-colors hover:text-amber-600 hover:underline dark:hover:text-amber-400"
          >
            Get a key ↗
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-zinc-200 bg-white/70 p-6 dark:border-zinc-800/60 dark:bg-zinc-900/60">
      <span className="flex size-11 items-center justify-center rounded-xl bg-amber-400/10 text-amber-500 dark:text-amber-400">
        <KeyRound className="size-5.5" aria-hidden />
      </span>
      <div>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Unlock search, trending & 12 languages</h3>
        <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Playback already works with any TMDB ID. Connect a free TMDB API key to add posters,
          ratings, cast, trailers and recommendations.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={openSettings}
          className="h-10 rounded-lg bg-amber-400 px-4 text-sm font-semibold text-zinc-950 hover:bg-amber-300"
        >
          <KeyRound className="size-4" aria-hidden />
          Add your free API key
        </Button>
        <a
          href={TMDB_KEY_URL}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-zinc-500 underline-offset-2 transition-colors hover:text-amber-600 hover:underline dark:hover:text-amber-400"
        >
          Get a key ↗
        </a>
      </div>
    </div>
  );
}
