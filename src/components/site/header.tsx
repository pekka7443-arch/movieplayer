'use client';

import { Gamepad2, Settings2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { SearchBar } from '@/components/site/search-bar';
import { LanguageMenu } from '@/components/site/language-menu';
import { ThemeToggle } from '@/components/site/theme-toggle';
import { useCinedeckStore } from '@/lib/store';
import { useHasTmdbKey } from '@/lib/settings';

export function Header() {
  const router = useRouter();
  const openSettings = useCinedeckStore((s) => s.openSettings);
  const openArcade = useCinedeckStore((s) => s.openArcade);
  const hasKey = useHasTmdbKey();

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800/60 dark:bg-zinc-950/80">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => router.push('/', { scroll: false })}
          aria-label="CineDeck — back to home"
          className="flex shrink-0 items-center gap-2.5 rounded-lg px-1 py-1 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          {/* User's hamster logo — replaces the clapperboard icon. Round,
              bordered container so it reads as a brand mark at small sizes. */}
          <span className="size-9 overflow-hidden rounded-full ring-2 ring-brand/40 shadow-[0_0_18px_color-mix(in_srgb,var(--cinedeck-accent)_25%,transparent)]">
            { }
            <img
              src="/user-logo.png"
              alt=""
              width={36}
              height={36}
              className="size-full object-cover"
              aria-hidden
            />
          </span>
          <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Cine<span className="text-brand">Deck</span>
          </span>
        </button>

        {/* Search takes the full second row on <md */}
        <div className="order-3 w-full md:order-none md:w-72 md:flex-1 lg:w-80">
          <SearchBar />
        </div>

        <nav aria-label="Site actions" className="ml-auto flex items-center gap-1">
          <LanguageMenu />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open CineDeck Arcade — games"
            onClick={openArcade}
            className="size-10 shrink-0 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/60"
          >
            <Gamepad2 className="size-4.5 text-brand" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open settings"
            onClick={openSettings}
            className="relative size-10 shrink-0 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/60"
          >
            <Settings2 className="size-4.5" aria-hidden />
            {!hasKey && (
              <span
                aria-hidden
                className="absolute right-2 top-2 size-2 animate-pulse rounded-full bg-brand"
              />
            )}
          </Button>
        </nav>
      </div>
    </header>
  );
}
