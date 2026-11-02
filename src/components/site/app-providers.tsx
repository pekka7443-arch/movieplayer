'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { useCinedeckStore } from '@/lib/store';
import { applyAccentColor, getSettings, subscribeToSettings } from '@/lib/settings';
import {
  beginReconnectPolling,
  isNetworkError,
  onReconnected,
  onReconnecting,
} from '@/lib/reconnect';

export function AppProviders({ children, cspNonce }: { children: ReactNode; cspNonce?: string }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
        // Origin-wake detection: when ANY query or mutation fails at the
        // network level (suspended sandbox), start polling /api/health. When
        // it answers again, invalidate everything — the UI heals itself.
        queryCache: new QueryCache({
          onError: (error) => {
            if (isNetworkError(error)) beginReconnectPolling();
          },
        }),
        mutationCache: new MutationCache({
          onError: (error) => {
            if (isNetworkError(error)) beginReconnectPolling();
          },
        }),
      })
  );

  // Auto-heal: when the origin comes back after a suspension, refetch every
  // query so rows/search/detail views repopulate without user action.
  useEffect(() => {
    const offReconnected = onReconnected(() => {
      toast.success('Connection restored — refreshing…', { duration: 3000 });
      void queryClient.invalidateQueries();
    });
    const offReconnecting = onReconnecting(() => {
      toast.info('Server is waking up — will refresh automatically…', {
        duration: 8000,
      });
    });
    return () => {
      offReconnected();
      offReconnecting();
    };
  }, [queryClient]);

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

  // CSP nonce for next-themes' FOUC-prevention inline script — threaded from
  // the server (proxy x-nonce header) so the SSR-rendered script carries it;
  // the strict-dynamic production CSP would block a nonce-less variant.
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} nonce={cspNonce}>
        {children}
        <Toaster
          richColors
          position="bottom-center"
          visibleToasts={2}
          duration={4000}
          toastOptions={{ classNames: { toast: 'text-sm' } }}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
