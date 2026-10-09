'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Cookie } from 'lucide-react';
import { Button } from '@/components/ui/button';

const CONSENT_KEY = 'cinedeck.cookieConsent';

type ConsentChoice = 'all' | 'essential';

/**
 * GDPR cookie consent banner (EU visitors). CineDeck ships zero tracking
 * cookies and no third-party analytics — the only storage is the app's own
 * localStorage (essential). The banner exists so the consent is explicit,
 * the preference is stored, and non-essential storage can be refused.
 * "Manage preferences" = the same choice, spelled out honestly.
 */
export function CookieConsent() {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(CONSENT_KEY)) {
        // Let the page settle before the banner slides in.
        const timer = window.setTimeout(() => setVisible(true), 1200);
        return () => window.clearTimeout(timer);
      }
    } catch {
      /* storage unavailable — never nag */
    }
  }, []);

  const decide = (choice: ConsentChoice) => {
    try {
      window.localStorage.setItem(CONSENT_KEY, choice);
      if (choice === 'essential') {
        // Refuse non-essential storage: the only optional keys are the
        // recent-searches list and PWA engagement counters.
        for (const key of ['cinedeck.recentSearches', 'cinedeck.pwa.views']) {
          window.localStorage.removeItem(key);
        }
      }
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: 24 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          role="dialog"
          aria-label="Cookie consent"
          className="fixed bottom-20 left-4 right-4 z-[60] mx-auto max-w-xl rounded-lg border border-border bg-card/95 p-4 shadow-2xl backdrop-blur-xl sm:bottom-6 sm:left-6 sm:right-auto"
        >
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10">
              <Cookie className="size-4.5 text-brand" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Cookies &amp; storage</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                CineDeck uses essential storage only (your sign-in session, My List and preferences).
                No ad trackers, no third-party analytics.{' '}
                {details && (
                  <span className="mt-1 block">
                    Essential: session cookie, watchlist/history sync, UI settings. Optional
                    (you may refuse): recent-search memory and install-prompt counters. Refusing
                    optional storage never limits playback.
                  </span>
                )}
              </p>
              <button
                type="button"
                onClick={() => setDetails((v) => !v)}
                className="mt-1 text-[11px] font-medium text-brand underline-offset-2 hover:underline"
                aria-expanded={details}
              >
                {details ? 'Hide details' : 'Manage preferences'}
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => decide('essential')}
              className="h-9 rounded-lg px-3 text-xs"
            >
              Essential only
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => decide('all')}
              className="h-9 rounded-lg bg-brand px-4 text-xs font-semibold text-white hover:bg-brand/90"
            >
              Accept all
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
