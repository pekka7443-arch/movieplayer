'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMotionValueEvent, useScroll } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bookmark,
  Gamepad2,
  History,
  LogIn,
  LogOut,
  Settings2,
  Trophy,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SearchBar } from '@/components/site/search-bar';
import { LanguageMenu } from '@/components/site/language-menu';
import { ThemeToggle } from '@/components/site/theme-toggle';
import { useCinedeckStore } from '@/lib/store';
import { useHasTmdbKey } from '@/lib/settings';
import { useSession, invalidateIdentityCaches } from '@/hooks/use-session';
import { useHomeSectionNav } from '@/hooks/use-section-nav';
import { logoutAccount } from '@/lib/auth-client';

function initialsOf(name: string | null, email: string): string {
  const base = (name ?? '').trim() || email.split('@')[0] || '?';
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + second).toUpperCase();
}

export function Header() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const openSettings = useCinedeckStore((s) => s.openSettings);
  const openArcade = useCinedeckStore((s) => s.openArcade);
  const openAuth = useCinedeckStore((s) => s.openAuth);
  const hasKey = useHasTmdbKey();
  const { user, loading } = useSession();
  const goSection = useHomeSectionNav();

  // Scroll-aware chrome: the header densifies and gains depth as the page
  // scrolls, then relaxes back at the top.
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, 'change', (latest) => {
    setScrolled(latest > 12);
  });

  const signOut = async () => {
    await logoutAccount();
    invalidateIdentityCaches(queryClient);
    toast.success('Signed out', {
      description: 'Guest mode keeps working on this device — sign back in any time.',
    });
  };

  return (
    <header
      className={`sticky top-0 z-50 border-b backdrop-blur-xl transition-all duration-300 ${
        scrolled
          ? 'border-zinc-200/90 bg-white/85 shadow-[0_10px_38px_-12px_rgba(0,0,0,0.28)] dark:border-zinc-800 dark:bg-zinc-950/85 dark:shadow-black/50'
          : 'border-transparent bg-white/60 dark:bg-zinc-950/55'
      }`}
    >
      <div
        className={`mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-3 px-4 transition-all duration-300 sm:px-6 ${
          scrolled ? 'py-2' : 'py-3'
        }`}
      >
        <button
          type="button"
          onClick={() => router.push('/', { scroll: false })}
          aria-label="CineDeck — back to home"
          className="flex shrink-0 items-center gap-2.5 rounded-lg px-1 py-1 transition-all duration-200 hover:opacity-90 hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          {/* User's hamster logo — round, bordered container so it reads as a
              brand mark at small sizes. */}
          <span className="cd-pulse size-9 overflow-hidden rounded-full ring-2 ring-brand/40 shadow-[0_0_18px_color-mix(in_srgb,var(--cinedeck-accent)_25%,transparent)]">
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
        <div className="order-3 w-full md:order-none md:w-72 md:flex-1 lg:w-96">
          <SearchBar />
        </div>

        <nav aria-label="Site actions" className="ml-auto flex items-center gap-1">
          <LanguageMenu />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Live sports — scores, schedules and free sports TV"
            title="Live Sports"
            onClick={() => router.push('/?view=sports', { scroll: false })}
            className="relative size-10 shrink-0 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/60"
          >
            <Trophy className="size-4.5 text-brand transition-transform duration-300 hover:rotate-12" aria-hidden />
            {/* live dot — the sports section never sleeps */}
            <span aria-hidden className="absolute right-1.5 top-1.5 flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-red-500" />
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open CineDeck Arcade — games"
            onClick={openArcade}
            className="hidden size-10 shrink-0 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/70 sm:inline-flex dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/60"
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

          {/* Account zone */}
          {loading ? (
            <span
              aria-hidden
              className="ml-1 size-9 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"
            />
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Account menu — ${user.name || user.email}`}
                  className="ml-1 flex shrink-0 items-center gap-2 rounded-full p-0.5 pr-0.5 transition-colors hover:bg-zinc-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:pr-2.5 dark:hover:bg-zinc-800/60"
                >
                  <span className="flex size-9 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground shadow-[0_0_16px_color-mix(in_srgb,var(--cinedeck-accent)_30%,transparent)]">
                    {initialsOf(user.name, user.email)}
                  </span>
                  <span className="hidden max-w-24 truncate text-sm font-medium text-zinc-700 lg:block dark:text-zinc-300">
                    {user.name || user.email.split('@')[0]}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 rounded-xl border-zinc-200 dark:border-zinc-800">
                <DropdownMenuLabel className="space-y-0.5">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {user.name || 'CineDeck member'}
                  </p>
                  <p className="truncate text-xs font-normal text-zinc-500 dark:text-zinc-400">
                    {user.email}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => goSection('my-list')} className="gap-2 text-sm">
                  <Bookmark className="size-4 text-brand" aria-hidden />
                  My List
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => goSection('continue-watching')} className="gap-2 text-sm">
                  <History className="size-4 text-brand" aria-hidden />
                  Continue watching
                </DropdownMenuItem>
                <DropdownMenuItem onClick={openSettings} className="gap-2 text-sm">
                  <Settings2 className="size-4" aria-hidden />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={signOut}
                  className="gap-2 text-sm text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                >
                  <LogOut className="size-4" aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="ml-1 flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => openAuth('signin')}
                aria-label="Sign in"
                className="h-9 w-9 gap-1.5 rounded-lg px-0 text-sm font-medium text-zinc-700 hover:bg-zinc-200/70 hover:text-zinc-900 sm:w-auto sm:px-3 dark:text-zinc-300 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
              >
                <UserRound className="size-4" aria-hidden />
                <span className="hidden sm:inline">Sign in</span>
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => openAuth('signup')}
                className="h-9 gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-semibold text-zinc-950 shadow-[0_0_16px_color-mix(in_srgb,var(--cinedeck-accent)_25%,transparent)] hover:bg-brand/90"
              >
                <LogIn className="size-4" aria-hidden />
                Sign up
              </Button>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
