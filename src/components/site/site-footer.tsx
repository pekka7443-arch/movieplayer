'use client';

import { useRouter } from 'next/navigation';
import { Bookmark, Clapperboard, Gamepad2, History, Home, Settings2, Trophy } from 'lucide-react';

import { useCinedeckStore } from '@/lib/store';
import { useHomeSectionNav } from '@/hooks/use-section-nav';

export function SiteFooter() {
  const router = useRouter();
  const openArcade = useCinedeckStore((s) => s.openArcade);
  const openSettings = useCinedeckStore((s) => s.openSettings);
  const goSection = useHomeSectionNav();

  const browseLinks = [
    { icon: Home, label: 'Home', action: () => router.push('/', { scroll: false }) },
    { icon: Bookmark, label: 'My List', action: () => goSection('my-list') },
    { icon: History, label: 'Continue watching', action: () => goSection('continue-watching') },
    { icon: Trophy, label: 'Live Sports', action: () => router.push('/?view=sports', { scroll: false }) },
    { icon: Gamepad2, label: 'Arcade', action: openArcade },
    { icon: Settings2, label: 'Settings', action: openSettings },
  ];

  return (
    <footer className="mt-auto border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800/60 dark:bg-zinc-950">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-10 sm:px-6">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-foreground">
                <Clapperboard className="size-4.5" aria-hidden />
              </span>
              <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                Cine<span className="text-brand">Deck</span>
              </span>
            </div>
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-zinc-500">
              Search a title, press play — CineDeck scans every stream source and picks the
              healthiest one. Keyless metadata from Cinemeta &amp; TVmaze; TMDB layer optional.
            </p>
          </div>

          <nav aria-label="Browse">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
              Browse
            </h3>
            <ul className="mt-3 space-y-1.5">
              {browseLinks.map(({ icon: Icon, label, action }) => (
                <li key={label}>
                  <button
                    type="button"
                    onClick={action}
                    className="group flex items-center gap-2 rounded-md py-0.5 text-xs text-zinc-500 transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 dark:text-zinc-500 dark:hover:text-brand"
                  >
                    <Icon className="size-3.5 text-zinc-400 transition-colors group-hover:text-brand dark:text-zinc-600" aria-hidden />
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
              Data sources
            </h3>
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-zinc-500">
              <li>
                <span className="font-medium text-zinc-600 dark:text-zinc-400">Cinemeta</span> — search,
                catalogs &amp; details (no key)
              </li>
              <li>
                <span className="font-medium text-zinc-600 dark:text-zinc-400">TVmaze</span> — TV episodes
                &amp; show facts (no key)
              </li>
              <li>
                <span className="font-medium text-zinc-600 dark:text-zinc-400">TheSportsDB</span> — live
                sports scores &amp; schedules (no key)
              </li>
              <li>
                <span className="font-medium text-zinc-600 dark:text-zinc-400">iptv-org</span> — free sports
                TV channels (no key)
              </li>
              <li>
                <span className="font-medium text-zinc-600 dark:text-zinc-400">TMDB</span> — optional
                localized metadata layer
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
              Disclaimer
            </h3>
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-zinc-500">
              For educational purposes only — CineDeck hosts no video. All streams are served by
              third-party providers. This product uses the TMDB API but is not endorsed or
              certified by TMDB.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-4 text-[11px] text-zinc-500 dark:border-zinc-800/60 dark:text-zinc-600">
          <p>© {new Date().getFullYear()} CineDeck — movies &amp; shows, one press away.</p>
          <p>Built for the big screen · free accounts, zero ads</p>
        </div>
      </div>
    </footer>
  );
}
