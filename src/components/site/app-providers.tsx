'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { useCinedeckStore } from '@/lib/store';
import { applyAccentColor, getSettings, subscribeToSettings } from '@/lib/settings';

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  // Pull language + preferred server from localStorage after mount so the
  // first client render matches the server-rendered HTML.
  const hydrateFromSettings = useCinedeckStore((s) => s.hydrateFromSettings);
  useEffect(() => {
    hydrateFromSettings();
    // Apply the saved accent color on mount — repainting all bg-brand /
    // text-brand / border-brand classes from the user's localStorage.
    applyAccentColor(getSettings().accentColor);
  }, [hydrateFromSettings]);

  // Re-apply the accent color whenever settings change (e.g. user picks a
  // new color in Settings → applies live without reload).
  useEffect(() => {
    return subscribeToSettings(() => {
      applyAccentColor(getSettings().accentColor);
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        {children}
        <Toaster richColors position="bottom-right" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
