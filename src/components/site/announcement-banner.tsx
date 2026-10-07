'use client';

// Announcement banner — renders the admin-published announcement right below
// the header. Dismissal is per-announcement (localStorage holds the ids the
// user actually closed), and the banner survives reloads until dismissed.

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Megaphone, X } from 'lucide-react';

const SEEN_STORAGE = 'cinedeck.announcement.dismissed';

interface Announcement {
  id: string;
  message: string;
}

function loadDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function persistDismissed(ids: Set<string>): void {
  try {
    // keep the list short — only the last 20 dismissed ids matter
    window.localStorage.setItem(SEEN_STORAGE, JSON.stringify([...ids].slice(-20)));
  } catch {
    // storage unavailable — the banner simply reappears next load
  }
}

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const check = () => {
      void fetch('/api/flags')
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { announcement: Announcement | null } | null) => {
          if (cancelled || !data) return;
          setDismissed(loadDismissed());
          setAnnouncement(data.announcement);
        })
        .catch(() => undefined);
    };

    // Dismissed-ids load inside the same async check (no sync setState).
    check();
    const interval = setInterval(check, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const dismiss = useCallback(() => {
    if (!announcement) return;
    const next = new Set(loadDismissed());
    next.add(announcement.id);
    persistDismissed(next);
    setDismissed(next);
    setAnnouncement(null);
  }, [announcement]);

  const visible = announcement && !dismissed.has(announcement.id);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -14 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          role="status"
          aria-live="polite"
          className="relative z-30 mx-auto mt-2 flex w-[min(96%,72rem)] items-center gap-3 rounded-xl border border-brand/40 bg-brand-soft px-4 py-2.5 text-sm shadow-sm"
        >
          <Megaphone className="size-4 shrink-0 text-brand" aria-hidden />
          <p className="min-w-0 flex-1 font-medium text-zinc-900 dark:text-zinc-100">{announcement.message}</p>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss announcement"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-900/5 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100"
          >
            <X className="size-4" aria-hidden />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
