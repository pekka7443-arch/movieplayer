'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Custom thin scrollbar styling for vertical overflow lists. */
export const THIN_SCROLLBAR_Y =
  'overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700';

/**
 * Horizontal snap-scroller with desktop-only arrow buttons and hidden scrollbar.
 */
export function MediaRow({ children, label }: { children: ReactNode; label: string }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 8);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
  }, []);

  const scrollBy = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.8, 240), behavior: 'smooth' });
  };

  return (
    <div className="relative" role="region" aria-label={label}>
      <div
        ref={scrollerRef}
        onScroll={updateEdges}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-4"
      >
        {children}
      </div>

      <div className="pointer-events-none absolute -left-4 top-1/2 hidden -translate-y-1/2 md:block">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={`Scroll ${label} left`}
          disabled={atStart}
          onClick={() => scrollBy(-1)}
          className="pointer-events-auto size-9 rounded-full border border-zinc-200 bg-white/90 text-zinc-700 shadow-lg shadow-black/10 backdrop-blur hover:bg-zinc-200 hover:text-zinc-900 disabled:opacity-0 dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-300 dark:shadow-black/40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Button>
      </div>
      <div className="pointer-events-none absolute -right-4 top-1/2 hidden -translate-y-1/2 md:block">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={`Scroll ${label} right`}
          disabled={atEnd}
          onClick={() => scrollBy(1)}
          className="pointer-events-auto size-9 rounded-full border border-zinc-200 bg-white/90 text-zinc-700 shadow-lg shadow-black/10 backdrop-blur hover:bg-zinc-200 hover:text-zinc-900 disabled:opacity-0 dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-300 dark:shadow-black/40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <ChevronRight className="size-5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
