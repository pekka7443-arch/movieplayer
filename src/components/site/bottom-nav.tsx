'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { Home, Search, ListVideo, BarChart3, Trophy } from 'lucide-react';

import { useUiStrings } from '@/lib/ui-strings';

/**
 * Mobile bottom navigation — the app's primary destinations within thumb
 * reach. Fixed, blurred, safe-area aware; hidden on ≥md where the header
 * navigation takes over. Items map onto the single-route view system.
 */
export function BottomNav() {
  const t = useUiStrings();
  const router = useRouter();
  const params = useSearchParams();

  const id = params.get('id');
  const imdbId = params.get('imdb');
  const view = params.get('view');
  const activeView = id || imdbId ? 'watch' : (view ?? 'home');

  const go = (hash: string) => router.push(hash, { scroll: false });

  const scrollToSection = (sectionId: string) => {
    const onHome = activeView === 'home';
    if (onHome) {
      document
        .getElementById(sectionId)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      go('/');
      window.setTimeout(() => {
        document
          .getElementById(sectionId)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 450);
    }
  };

  const focusSearch = () => {
    if (activeView !== 'home') {
      go('/');
    }
    window.setTimeout(() => {
      const input = document.getElementById('global-search') as HTMLInputElement | null;
      input?.focus();
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, activeView === 'home' ? 0 : 450);
  };

  const items = [
    { key: 'home', label: t.home, icon: Home, active: activeView === 'home', action: () => go('/') },
    { key: 'sports', label: t.liveSports, icon: Trophy, active: activeView === 'sports', action: () => go('/?view=sports') },
    { key: 'search', label: t.search, icon: Search, active: false, action: focusSearch },
    { key: 'lists', label: t.myList, icon: ListVideo, active: false, action: () => scrollToSection('my-list') },
    { key: 'stats', label: t.statistics, icon: BarChart3, active: activeView === 'stats', action: () => go('/?view=stats') },
  ] as const;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200/80 bg-white/85 backdrop-blur-xl md:hidden dark:border-zinc-800/80 dark:bg-zinc-950/85"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {items.map(({ key, label, icon: Icon, active, action }) => (
          <button
            key={key}
            type="button"
            onClick={action}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 text-[10.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60 ${
              active
                ? 'text-brand'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            <Icon className="size-5" aria-hidden />
            <span className="max-w-full truncate">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
