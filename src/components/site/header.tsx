'use client';

import { Clapperboard, Settings2 } from 'lucide-react';
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
  const hasKey = useHasTmdbKey();

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => router.push('/', { scroll: false })}
          aria-label="CineDeck — back to home"
          className="flex shrink-0 items-center gap-2.5 rounded-lg px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-amber-400 text-zinc-950 shadow-[0_0_18px_rgba(251,191,36,0.25)]">
            <Clapperboard className="size-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold tracking-tight text-zinc-100">
            Cine<span className="text-amber-400">Deck</span>
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
            aria-label="Open settings"
            onClick={openSettings}
            className="relative size-10 shrink-0 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
          >
            <Settings2 className="size-4.5" aria-hidden />
            {!hasKey && (
              <span
                aria-hidden
                className="absolute right-2 top-2 size-2 animate-pulse rounded-full bg-amber-400"
              />
            )}
          </Button>
        </nav>
      </div>
    </header>
  );
}
