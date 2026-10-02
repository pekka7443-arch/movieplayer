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
import { SettingsDialog } from '@/components/site/settings-dialog';
import { ArcadeDialog } from '@/components/site/arcade-dialog';
import { AuthDialog } from '@/components/site/auth-dialog';
import { SiteFooter } from '@/components/site/site-footer';
import type { MediaType } from '@/lib/tmdb';

function parsePositiveInt(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

function parseImdbId(value: string | null): string | null {
  return value && /^tt\d+$/.test(value) ? value : null;
}

function App() {
  const params = useSearchParams();

  const id = parsePositiveInt(params.get('id'));
  const imdbId = parseImdbId(params.get('imdb'));
  const type: MediaType = params.get('type') === 'tv' ? 'tv' : 'movie';
  const season = parsePositiveInt(params.get('s')) ?? 1;
  const episode = parsePositiveInt(params.get('e')) ?? 1;

  // Coarse view key — drives the cross-view transition (and scroll reset).
  const viewKey =
    id !== null || imdbId !== null ? 'watch' : params.get('view') === 'sports' ? 'sports' : 'home';

  // Fresh views start at the top; same-view param edits (episode change,
  // genre switch) keep the current scroll position untouched.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [viewKey]);

  return (
    <AppProviders>
      <div className="flex min-h-svh flex-col text-zinc-900 dark:text-zinc-100">
        <AmbientBackground />
        <ScrollProgress />
        <Header />
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
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
        <BackToTop />
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
