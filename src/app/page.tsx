'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { AppProviders } from '@/components/site/app-providers';
import { AmbientBackground } from '@/components/site/ambient-background';
import { BackToTop, ScrollProgress } from '@/components/site/site-chrome';
import { Header } from '@/components/site/header';
import { HomeView } from '@/components/site/home-view';
import { WatchView } from '@/components/site/watch-view';
import { SportsView } from '@/components/site/sports-view';
import { StatsView } from '@/components/site/stats-view';
import { AdminView } from '@/components/site/admin-view';
import { PersonView } from '@/components/site/person-view';
import { SharedListView } from '@/components/site/shared-list-view';
import { SettingsDialog } from '@/components/site/settings-dialog';
import { ArcadeDialog } from '@/components/site/arcade-dialog';
import { AuthDialog } from '@/components/site/auth-dialog';
import { CommandPalette } from '@/components/site/command-palette';
import { PwaBootstrap } from '@/components/site/pwa-bootstrap';
import { SiteFooter } from '@/components/site/site-footer';
import { useCinedeckStore, hydrateActiveProfile } from '@/lib/store';
import type { MediaType } from '@/lib/tmdb';

function parsePositiveInt(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

function parseImdbId(value: string | null): string | null {
  return value && /^tt\d+$/.test(value) ? value : null;
}

/** Announcement banner text from the feature-flag service (admin published). */
function useAnnouncement(): string | null {
  const params = useSearchParams();
  const view = params.get('view');
  useEffect(() => {
    let cancelled = false;
    const storageKey = 'cinedeck.announcement.seen';
    void fetch('/api/flags')
      .then((r) => r.json())
      .then((data: { announcement: { id: string; message: string } | null }) => {
        if (cancelled || !data.announcement) return;
        let seen: string | null = null;
        try {
          seen = window.localStorage.getItem(storageKey);
        } catch {
          // ignore
        }
        if (seen === data.announcement.id) return;
        try {
          window.localStorage.setItem(storageKey, data.announcement.id);
        } catch {
          // ignore
        }
        window.dispatchEvent(
          new CustomEvent('cinedeck:announcement', { detail: data.announcement.message }),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [view]);
  return null;
}

function App() {
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

  useAnnouncement();

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
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 sm:py-8"
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
                <HomeView />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
        <SiteFooter />
        <SettingsDialog />
        <ArcadeDialog />
        <AuthDialog />
        <CommandPalette />
        <BackToTop />
        <PwaBootstrap />
      </div>
    </AppProviders>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  );
}
