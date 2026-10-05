'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'cinedeck.pwa.dismissedAt';

/** Registers the service worker + shows a soft install suggestion. */
export function PwaBootstrap() {
  const reduceMotion = useReducedMotion();
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [showSuggestion, setShowSuggestion] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      const dismissed = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
      // Re-suggest after two weeks if the user said no earlier.
      if (Date.now() - dismissed < 14 * 86_400_000) return;
      setInstallEvent(event as InstallPromptEvent);
      setShowSuggestion(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => {
    setShowSuggestion(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice.catch(() => undefined);
    setShowSuggestion(false);
  };

  return (
    <AnimatePresence>
      {showSuggestion && (
        <motion.div
          initial={reduceMotion ? undefined : { opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          role="dialog"
          aria-label="Install CineDeck"
          className="fixed bottom-20 right-4 z-40 flex max-w-[280px] items-center gap-3 rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 sm:bottom-6 sm:right-24"
        >
          <img src="/icons/icon-192.png" alt="" width={40} height={40} className="rounded-xl" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Install CineDeck</p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Full-screen playback + offline shell.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <Button
              type="button"
              size="sm"
              onClick={install}
              className="h-7 gap-1 rounded-lg bg-brand px-2 text-[11px] font-semibold text-brand-foreground"
            >
              <Download className="size-3" aria-hidden />
              Install
            </Button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss install suggestion"
              className="flex size-11 items-center justify-center rounded-lg text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <X className="size-3" aria-hidden />
              Later
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
