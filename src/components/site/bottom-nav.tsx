'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { Home, Search, ListVideo, UserRound } from 'lucide-react';

import { useUiStrings } from '@/lib/ui-strings';
import { useCinedeckStore } from '@/lib/store';

/**
 * Mobile bottom navigation — the app's four primary destinations within
 * thumb reach: Home, Search, My List, Profile. Fixed, blurred, safe-area
 * aware; hidden on ≥md where the header navigation takes over. Items map
 * onto the single-route view system. Tap targets ≥44px (56px tall rows).
 */
export function BottomNav() {
  const t = useUiStrings();
  const router = useRouter();
  const params = useSearchParams();
  const openSettings = useCinedeckStore((s) => s.openSettings);
  const setContentType = useCinedeckStore((s) => s.setContentType);

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
    { key: 'search', label: t.search, icon: Search, active: false, action: focusSearch },
    { key: 'lists', label: t.myList, icon: ListVideo, active: false, action: () => scrollToSection('my-list') },
    { key: 'profile', label: t.profile, icon: UserRound, active: false, action: () => { setContentType('all'); openSettings(); } },
  ] as const;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/85 backdrop-blur-xl md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto grid max-w-lg grid-cols-4">
        {items.map(({ key, label, icon: Icon, active, action }) => (
          <button
            key={key}
            type="button"
            onClick={action}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 text-[10.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60 ${
              active
                ? 'text-brand'
                : 'text-muted-foreground hover:text-foreground'
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
