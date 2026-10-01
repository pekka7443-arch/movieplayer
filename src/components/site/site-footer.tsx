'use client';

import { Clapperboard } from 'lucide-react';

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800/60 dark:bg-zinc-950">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-foreground">
              <Clapperboard className="size-4.5" aria-hidden />
            </span>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
              Cine<span className="text-brand">Deck</span>
            </span>
          </div>
          <p className="mt-3 max-w-xs text-xs leading-relaxed text-zinc-500">
            A minimal player-first front-end for movies and shows. Bring a TMDB ID, pick a server,
            press play.
          </p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
            Attribution
          </h3>
          <p className="mt-3 max-w-xs text-xs leading-relaxed text-zinc-500">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
            Disclaimer
          </h3>
          <p className="mt-3 max-w-xs text-xs leading-relaxed text-zinc-500">
            For educational purposes only — CineDeck hosts no video. All streams are served by
            third-party providers.
          </p>
        </div>
      </div>
    </footer>
  );
}
