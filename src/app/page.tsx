'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppProviders } from '@/components/site/app-providers';
import { Header } from '@/components/site/header';
import { HomeView } from '@/components/site/home-view';
import { WatchView } from '@/components/site/watch-view';
import { SettingsDialog } from '@/components/site/settings-dialog';
import { SiteFooter } from '@/components/site/site-footer';
import type { MediaType } from '@/lib/tmdb';

function parsePositiveInt(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

function App() {
  const params = useSearchParams();

  const id = parsePositiveInt(params.get('id'));
  const type: MediaType = params.get('type') === 'tv' ? 'tv' : 'movie';
  const season = parsePositiveInt(params.get('s')) ?? 1;
  const episode = parsePositiveInt(params.get('e')) ?? 1;

  return (
    <AppProviders>
      <div className="flex min-h-svh flex-col bg-zinc-950 text-zinc-100">
        <Header />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {id !== null ? (
            <WatchView tmdbId={id} mediaType={type} season={season} episode={episode} />
          ) : (
            <HomeView />
          )}
        </main>
        <SiteFooter />
        <SettingsDialog />
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
