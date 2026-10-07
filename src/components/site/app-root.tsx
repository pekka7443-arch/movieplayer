'use client';

// Client root — extracted from page.tsx so the route can stream server-fetched
// hero data (see page.tsx) into React Query as initialData: the hero image
// becomes part of the first HTML paint instead of hydration→fetch→render.

import { Suspense, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { AppProviders } from '@/components/site/app-providers';
import { AmbientBackground } from '@/components/site/ambient-background';
import { BackToTop, ScrollProgress } from '@/components/site/site-chrome';
import { Header } from '@/components/site/header';
import { HomeView } from '@/components/site/home-view';
import { PwaBootstrap } from '@/components/site/pwa-bootstrap';
import { SiteFooter } from '@/components/site/site-footer';
import { BottomNav } from '@/components/site/bottom-nav';
import { OnboardingTour } from '@/components/site/onboarding-tour';
import { useSession } from '@/hooks/use-session';
import { useCinedeckStore, hydrateActiveProfile } from '@/lib/store';
import { ViewSkeleton } from '@/components/site/view-skeleton';
import type { MediaType } from '@/lib/tmdb';

// ---------------------------------------------------------------------------
// Code-split views & dialogs — the home experience ships in the initial
// bundle; the player (hls.js + scan machinery), charts, admin, palette and
// every on-demand dialog load only when first opened/shown.
// ---------------------------------------------------------------------------
const WatchView = dynamic(
  () => import('@/components/site/watch-view').then((m) => m.WatchView),
  { loading: () => <ViewSkeleton kind="watch" />, ssr: false },
);
const SportsView = dynamic(
  () => import('@/components/site/sports-view').then((m) => m.SportsView),
  { loading: () => <ViewSkeleton kind="rows" />, ssr: false },
);
const StatsView = dynamic(
  () => import('@/components/site/stats-view').then((m) => m.StatsView),
  { loading: () => <ViewSkeleton kind="stats" />, ssr: false },
);
const AdminView = dynamic(
  () => import('@/components/site/admin-view').then((m) => m.AdminView),
  { loading: () => <ViewSkeleton kind="stats" />, ssr: false },
);
const PersonView = dynamic(
  () => import('@/components/site/person-view').then((m) => m.PersonView),
  { loading: () => <ViewSkeleton kind="watch" />, ssr: false },
);
const SharedListView = dynamic(
  () => import('@/components/site/shared-list-view').then((m) => m.SharedListView),
  { loading: () => <ViewSkeleton kind="rows" />, ssr: false },
);
const SettingsDialog = dynamic(
  () => import('@/components/site/settings-dialog').then((m) => m.SettingsDialog),
  { ssr: false },
);
const ArcadeDialog = dynamic(
  () => import('@/components/site/arcade-dialog').then((m) => m.ArcadeDialog),
  { ssr: false },
);
const AuthDialog = dynamic(
  () => import('@/components/site/auth-dialog').then((m) => m.AuthDialog),
  { ssr: false },
);
const CommandPalette = dynamic(
  () => import('@/components/site/command-palette').then((m) => m.CommandPalette),
  { ssr: false },
);
import { AnnouncementBanner } from '@/components/site/announcement-banner';
import { GuestSignupBanner, MustChangePasswordBanner } from '@/components/site/account-banners';

function parsePositiveInt(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

function parseImdbId(value: string | null): string | null {
  return value && /^tt\d+$/.test(value) ? value : null;
}

/**
 * Maintenance gate — reads the public flags endpoint INSIDE the React Query
 * provider tree. Admins pass through; everyone else sees a maintenance
 * screen when the flag is on.
 */
function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const { data: flagData } = useQuery({
    queryKey: ['flags'],
    queryFn: async () => {
      const res = await fetch('/api/flags');
      return res.ok ? ((await res.json()) as { flags: Record<string, boolean> }) : { flags: {} };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { user } = useSession();
  const maintenance = flagData?.flags['maintenance'] === true && user?.role !== 'admin';

  if (!maintenance) return <>{children}</>;
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24 text-center">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">CineDeck is under maintenance</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          We’re making things better. The app will be back shortly — thanks for your patience.
        </p>
      </div>
    </main>
  );
}

function App({ initialTrending }: { initialTrending?: import('@/lib/meta').MetaSearchItem[] }) {
  const params = useSearchParams();

  const id = parsePositiveInt(params.get('id'));
  const imdbId = parseImdbId(params.get('imdb'));
  const personId = parsePositiveInt(params.get('person'));
  const shareToken = params.get('share');
  const type: MediaType = params.get('type') === 'tv' ? 'tv' : 'movie';
  const season = parsePositiveInt(params.get('s')) ?? 1;
  const episode = parsePositiveInt(params.get('e')) ?? 1;

  // Coarse view key — drives the cross-view transition (and scroll reset).
  const viewKey =
    id !== null || imdbId !== null
      ? 'watch'
      : params.get('view') === 'sports'
        ? 'sports'
        : params.get('view') === 'stats'
          ? 'stats'
          : params.get('view') === 'admin'
            ? 'admin'
            : personId !== null
              ? 'person'
              : shareToken
                ? 'share'
                : 'home';

  // Global shortcuts: Ctrl/Cmd+K opens the command palette. Profile id is
  // hydrated once so scoped library writes (profileId) match the UI.
  const setPaletteOpen = useCinedeckStore((s) => s.setPaletteOpen);
  const setActiveProfile = useCinedeckStore((s) => s.setActiveProfile);
  useEffect(() => {
    setActiveProfile(hydrateActiveProfile());
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen, setActiveProfile]);

  // Fresh views start at the top; same-view param edits (episode change,
  // genre switch) keep the current scroll position untouched.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [viewKey]);

  return (
    <AppProviders>
      <MaintenanceGate>
      <div className="flex min-h-svh flex-col text-zinc-900 dark:text-zinc-100">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[80] focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-foreground"
        >
          Skip to content
        </a>
        <AmbientBackground />
        <ScrollProgress />
        <Header />
        <AnnouncementBanner />
        <GuestSignupBanner />
        <MustChangePasswordBanner />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+72px)] py-6 sm:px-6 sm:py-8 md:pb-8"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={viewKey}
              initial={{ opacity: 0, y: 18, scale: 0.996 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -14, scale: 0.997 }}
              transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
            >
              {viewKey === 'watch' ? (
                <WatchView tmdbId={id ?? undefined} imdbId={imdbId ?? undefined} mediaType={type} season={season} episode={episode} />
              ) : viewKey === 'sports' ? (
                <SportsView />
              ) : viewKey === 'stats' ? (
                <StatsView />
              ) : viewKey === 'admin' ? (
                <AdminView />
              ) : viewKey === 'person' ? (
                <PersonView personId={personId ?? 0} />
              ) : viewKey === 'share' ? (
                <SharedListView token={shareToken ?? ''} />
              ) : (
                <HomeView initialTrending={initialTrending} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
        <SiteFooter />
        <BottomNav />
        <OnboardingTour />
        <SettingsDialog />
        <ArcadeDialog />
        <AuthDialog />
        <CommandPalette />
        <BackToTop />
        <PwaBootstrap />
      </div>
      </MaintenanceGate>
    </AppProviders>
  );
}

export default function AppRoot({ initialTrending }: { initialTrending?: import('@/lib/meta').MetaSearchItem[] }) {
  return (
    <Suspense fallback={null}>
      <App initialTrending={initialTrending} />
    </Suspense>
  );
}
