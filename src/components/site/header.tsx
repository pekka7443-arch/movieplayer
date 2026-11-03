'use client';

import { useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMotionValueEvent, useScroll } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bookmark,
  ChevronsUpDown,
  Command as CommandIcon,
  Film,
  Flag,
  Gamepad2,
  History,
  Home as HomeIcon,
  LogIn,
  LogOut,
  Menu,
  Settings2,
  Sparkles,
  Trophy,
  Tv as TvIcon,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SearchBar } from '@/components/site/search-bar';
import { LanguageMenu } from '@/components/site/language-menu';
import { ThemeToggle } from '@/components/site/theme-toggle';
import { NotificationsButton } from '@/components/site/notifications-button';
import { fetchProfiles, type ProfileRow } from '@/lib/library';
import { useCinedeckStore } from '@/lib/store';
import { useHasTmdbKey } from '@/lib/settings';
import { useSession, invalidateIdentityCaches } from '@/hooks/use-session';
import { useHydrated } from '@/hooks/use-hydrated';
import { useHomeSectionNav } from '@/hooks/use-section-nav';
import { useQuery } from '@tanstack/react-query';
import { logoutAccount } from '@/lib/auth-client';

function initialsOf(name: string | null, email: string): string {
  const base = (name ?? '').trim() || email.split('@')[0] || '?';
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + second).toUpperCase();
}

/**
 * Compact premium navbar — 56px on desktop, quietly densifying once the
 * page scrolls (border + deeper surface, no layout jump). Motion is limited
 * to 150ms color transitions; no glow, pulse or ping effects.
 */
export function Header() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const openSettings = useCinedeckStore((s) => s.openSettings);
  const openArcade = useCinedeckStore((s) => s.openArcade);
  const openAuth = useCinedeckStore((s) => s.openAuth);
  const contentType = useCinedeckStore((s) => s.contentType);
  const setContentType = useCinedeckStore((s) => s.setContentType);
  const hasKey = useHasTmdbKey();
  const { user, loading } = useSession();
  // The session cache lives in localStorage: SSR and the first client render
  // must agree (skeleton) or React throws a hydration mismatch for every
  // signed-in reload. useHydrated flips in the same tick hydration completes,
  // so the real avatar/sign-in button paints immediately after.
  const hydrated = useHydrated();
  const identityLoading = loading || !hydrated;
  const goSection = useHomeSectionNav();
  const setPaletteOpen = useCinedeckStore((s) => s.setPaletteOpen);
  const activeProfileId = useCinedeckStore((s) => s.activeProfileId);
  const setActiveProfile = useCinedeckStore((s) => s.setActiveProfile);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Anime is a home-page section anchor (id="anime-section") — the section-nav
  // helper resolves the same element the home-view animeRef is attached to and
  // handles cross-view navigation + retry-while-mounting for free.
  const goAnime = useCallback(() => {
    setMobileMenuOpen(false);
    goSection('anime-section');
  }, [goSection]);

  const onSportsView = params.get('view') === 'sports';

  const profilesQuery = useQuery<ProfileRow[]>({
    queryKey: ['profiles'],
    queryFn: fetchProfiles,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });
  const profiles = profilesQuery.data ?? [];
  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  // Scroll-aware chrome: the header gains a hairline border + deeper surface
  // as the page scrolls, then relaxes back at the top.
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, 'change', (latest) => {
    setScrolled(latest > 10);
  });

  const signOut = async () => {
    await logoutAccount();
    invalidateIdentityCaches(queryClient);
    toast.success('Signed out', {
      description: 'Guest mode keeps working on this device — sign back in any time.',
    });
  };

  const goHome = () => {
    setMobileMenuOpen(false);
    router.push('/', { scroll: false });
  };

  const browseByType = (type: 'movie' | 'tv') => {
    setContentType(type);
    setMobileMenuOpen(false);
    router.push('/', { scroll: false });
  };

  const navLinkClasses = (active: boolean) =>
    `whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
      active
        ? 'text-foreground'
        : 'text-zinc-500 hover:text-foreground dark:text-zinc-400 dark:hover:text-foreground'
    }`;

  const iconBtnClasses =
    'size-9 shrink-0 max-md:size-10 text-zinc-500 hover:text-foreground hover:bg-white/5 dark:text-zinc-400 dark:hover:text-foreground dark:hover:bg-white/5';

  return (
    <header
      className={`sticky top-0 z-50 border-b backdrop-blur-xl transition-colors duration-200 ${
        scrolled
          ? 'border-border bg-background/90'
          : 'border-transparent bg-gradient-to-b from-background/95 to-background/70'
      }`}
    >
      <div className="mx-auto flex min-h-14 w-full max-w-[1560px] flex-wrap items-center gap-2 px-3 sm:h-[60px] sm:min-h-0 sm:flex-nowrap sm:gap-3 sm:px-6">
        <button
          type="button"
          onClick={() => router.push('/', { scroll: false })}
          aria-label="CineDeck — back to home"
          className="flex shrink-0 items-center gap-2 rounded-md px-0.5 py-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          {/* Brand mark — the user's hamster logo in a quiet bordered chip. */}
          <span className="size-8 overflow-hidden rounded-lg ring-1 ring-border sm:size-9">
            <img
              src="/user-logo.png"
              alt=""
              width={36}
              height={36}
              className="size-full object-cover"
              aria-hidden
            />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-foreground sm:text-base">
            Cine<span className="text-brand">Deck</span>
          </span>
        </button>

        {/* Center text navigation — desktop only */}
        <nav
          aria-label="Primary"
          className="order-none hidden flex-1 items-center justify-center gap-0.5 lg:flex"
        >
          <button type="button" onClick={goHome} aria-current={!onSportsView && contentType === 'all' ? 'page' : undefined} className={navLinkClasses(!onSportsView && contentType === 'all')}>
            Home
          </button>
          <button
            type="button"
            onClick={() => browseByType('movie')}
            aria-current={contentType === 'movie' ? 'page' : undefined}
            className={navLinkClasses(contentType === 'movie')}
          >
            Movies
          </button>
          <button
            type="button"
            onClick={() => browseByType('tv')}
            aria-current={contentType === 'tv' ? 'page' : undefined}
            className={navLinkClasses(contentType === 'tv')}
          >
            TV Shows
          </button>
          <button
            type="button"
            onClick={goAnime}
            className={navLinkClasses(false) + ' inline-flex items-center gap-1'}
          >
            <Sparkles className="size-3.5 text-brand" aria-hidden />
            Anime
          </button>
          <button
            type="button"
            onClick={() => router.push('/?view=finnish', { scroll: false })}
            aria-current={params.get('view') === 'finnish' ? 'page' : undefined}
            className={navLinkClasses(params.get('view') === 'finnish')}
          >
            Finnish
          </button>
          <button
            type="button"
            onClick={() => router.push('/?view=sports', { scroll: false })}
            aria-current={onSportsView ? 'page' : undefined}
            className={navLinkClasses(onSportsView)}
          >
            Sports
          </button>
          <button type="button" onClick={openArcade} className={navLinkClasses(false)}>
            Arcade
          </button>
        </nav>

        {/* Search takes the full second row on <md */}
        <div className="order-3 w-full min-w-0 md:order-none md:w-64 md:flex-1 lg:w-80">
          <SearchBar />
        </div>

        <nav aria-label="Site actions" className="ml-auto flex items-center gap-0.5 sm:gap-1">
          {/* Mobile menu — slides in from the right */}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(true)}
            className={`${iconBtnClasses} lg:hidden`}
          >
            <Menu className="size-[18px]" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette (Ctrl+K)"
            title="Command palette (Ctrl+K)"
            className="hidden h-8 items-center gap-1.5 rounded-md border border-border px-2 text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-white/5 hover:text-foreground lg:inline-flex dark:hover:bg-white/5"
          >
            <CommandIcon className="size-3" aria-hidden />
            <span>K</span>
          </Button>
          <LanguageMenu />
          <ThemeToggle />
          <NotificationsButton />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Live sports — scores, schedules and free sports TV"
            title="Live Sports"
            onClick={() => router.push('/?view=sports', { scroll: false })}
            className={`relative ${iconBtnClasses}`}
          >
            <Trophy className="size-[17px]" aria-hidden />
            {/* Live dot — static, quiet (no ping loop). */}
            <span
              aria-hidden
              className="absolute right-[7px] top-[7px] size-[5px] rounded-full bg-red-500 ring-2 ring-background"
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open CineDeck Arcade — games"
            onClick={openArcade}
            className={`hidden sm:inline-flex ${iconBtnClasses}`}
          >
            <Gamepad2 className="size-[17px]" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open settings"
            onClick={openSettings}
            className={`relative ${iconBtnClasses}`}
          >
            <Settings2 className="size-[17px]" aria-hidden />
            {!hasKey && (
              <span
                aria-hidden
                className="absolute right-[7px] top-[7px] size-[5px] rounded-full bg-brand ring-2 ring-background"
              />
            )}
          </Button>

          {/* Account zone */}
          {identityLoading ? (
            <span
              aria-hidden
              className="ml-1 size-8 shrink-0 animate-pulse rounded-full bg-muted"
            />
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Account menu — ${user.name || user.email}`}
                  className="ml-1 flex shrink-0 items-center gap-2 rounded-full p-0.5 transition-colors duration-150 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:pr-2 dark:hover:bg-white/5"
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
                    {user.avatar ? (
                      <span aria-hidden className="text-lg leading-none">{user.avatar}</span>
                    ) : (
                      initialsOf(user.name, user.email)
                    )}
                  </span>
                  <span className="hidden max-w-24 truncate text-[13px] font-medium text-zinc-700 lg:block dark:text-zinc-300">
                    {user.name || user.email.split('@')[0]}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 rounded-xl">
                <DropdownMenuLabel className="space-y-0.5">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {user.name || 'CineDeck member'}
                  </p>
                  <p className="truncate text-xs font-normal text-muted-foreground">
                    {user.email}
                  </p>
                </DropdownMenuLabel>
                {profiles.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="gap-2 text-sm">
                        <span aria-hidden>{activeProfile?.avatar ?? '👤'}</span>
                        {activeProfile?.name ?? 'Default profile'}
                        {activeProfile?.isKids && (
                          <span className="rounded bg-emerald-500/15 px-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                            KIDS
                          </span>
                        )}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-52">
                        {profiles.map((profile) => (
                          <DropdownMenuItem
                            key={profile.id}
                            onClick={() => {
                              setActiveProfile(profile.id);
                              invalidateIdentityCaches(queryClient);
                              // Per-profile content language: switching profiles
                              // adopts that profile's saved language (if set).
                              if (profile.language) {
                                useCinedeckStore.getState().setLanguage(profile.language);
                              }
                            }}
                            className="gap-2 text-sm"
                          >
                            <span aria-hidden>{profile.avatar ?? '👤'}</span>
                            <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                            {profile.id === activeProfileId && (
                              <span aria-hidden className="text-brand">✓</span>
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => goSection('my-list')} className="gap-2 text-sm">
                  <Bookmark className="size-4 text-muted-foreground" aria-hidden />
                  My List
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => goSection('continue-watching')} className="gap-2 text-sm">
                  <History className="size-4 text-muted-foreground" aria-hidden />
                  Continue watching
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => router.push('/?view=stats', { scroll: false })}
                  className="gap-2 text-sm"
                >
                  <Trophy className="size-4 text-muted-foreground" aria-hidden />
                  Watch stats & achievements
                </DropdownMenuItem>
                {user.role === 'admin' && (
                  <DropdownMenuItem
                    onClick={() => router.push('/admin')}
                    className="gap-2 text-sm"
                  >
                    <Settings2 className="size-4 text-muted-foreground" aria-hidden />
                    Admin dashboard
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={openSettings} className="gap-2 text-sm">
                  <Settings2 className="size-4 text-muted-foreground" aria-hidden />
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
            <div className="ml-1 flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => openAuth('signin')}
                aria-label="Sign in"
                className="h-8 w-8 gap-1.5 rounded-md px-0 text-[13px] font-medium text-zinc-600 hover:bg-white/5 hover:text-foreground sm:w-auto sm:px-2.5 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-foreground"
              >
                <UserRound className="size-4" aria-hidden />
                <span className="hidden sm:inline">Sign in</span>
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => openAuth('signup')}
                className="h-8 gap-1.5 rounded-md bg-brand px-3 text-[13px] font-semibold text-brand-foreground transition-colors duration-150 hover:bg-brand/90"
              >
                <LogIn className="size-3.5" aria-hidden />
                Sign up
              </Button>
            </div>
          )}
        </nav>

        {/* Mobile slide-in menu — right side, primary destinations + account */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetContent
            side="right"
            className="w-80 border-l border-border bg-popover/95 backdrop-blur-xl"
          >
            <SheetHeader className="border-b border-border pb-4">
              <SheetTitle className="flex items-center gap-2 text-lg font-semibold">
                <span className="text-lg font-semibold tracking-tight">
                  Cine<span className="text-brand">Deck</span>
                </span>
              </SheetTitle>
            </SheetHeader>
            <nav aria-label="Mobile primary" className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-4">
              {([
                { label: 'Home', icon: HomeIcon, action: goHome, active: !onSportsView && contentType === 'all' },
                { label: 'Movies', icon: Film, action: () => browseByType('movie'), active: contentType === 'movie' },
                { label: 'TV Shows', icon: TvIcon, action: () => browseByType('tv'), active: contentType === 'tv' },
                { label: 'Anime', icon: Sparkles, action: goAnime, active: false },
                { label: 'Finnish', icon: Flag, action: () => { setMobileMenuOpen(false); router.push('/?view=finnish', { scroll: false }); }, active: params.get('view') === 'finnish' },
                { label: 'Sports', icon: Trophy, action: () => { setMobileMenuOpen(false); router.push('/?view=sports', { scroll: false }); }, active: onSportsView },
                { label: 'Arcade', icon: Gamepad2, action: () => { setMobileMenuOpen(false); openArcade(); }, active: false },
              ]).map(({ label, icon: Icon, action, active }) => (
                <button
                  key={label}
                  type="button"
                  onClick={action}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-[48px] items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
                    active
                      ? 'bg-brand/10 text-brand'
                      : 'text-zinc-700 hover:bg-muted dark:text-zinc-300'
                  }`}
                >
                  <Icon className={`size-4.5 ${active ? 'text-brand' : 'text-muted-foreground'}`} aria-hidden />
                  {label}
                </button>
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-1 border-t border-border px-2 py-4">
              {user ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setMobileMenuOpen(false); goSection('my-list'); }}
                    className="flex min-h-[48px] items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-zinc-700 hover:bg-muted dark:text-zinc-300"
                  >
                    <Bookmark className="size-4.5 text-muted-foreground" aria-hidden />
                    My List
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMobileMenuOpen(false); openSettings(); }}
                    className="flex min-h-[48px] items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-zinc-700 hover:bg-muted dark:text-zinc-300"
                  >
                    <Settings2 className="size-4.5 text-muted-foreground" aria-hidden />
                    Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMobileMenuOpen(false); signOut(); }}
                    className="flex min-h-[48px] items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-red-600 hover:bg-muted dark:text-red-400"
                  >
                    <LogOut className="size-4.5" aria-hidden />
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    onClick={() => { setMobileMenuOpen(false); openAuth('signin'); }}
                    variant="outline"
                    className="min-h-[48px] justify-start gap-2"
                  >
                    <UserRound className="size-4" aria-hidden />
                    Sign in
                  </Button>
                  <Button
                    type="button"
                    onClick={() => { setMobileMenuOpen(false); openAuth('signup'); }}
                    className="min-h-[48px] justify-start gap-2 bg-brand text-white hover:bg-brand/90"
                  >
                    <LogIn className="size-4" aria-hidden />
                    Sign up
                  </Button>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
