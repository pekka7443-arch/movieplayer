'use client';

import { useCallback, useRef, useState, type ReactNode, type ComponentType } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Custom thin scrollbar styling for vertical overflow lists. */
export const THIN_SCROLLBAR_Y =
  'overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700';

/**
 * Section heading styled after Zoryva: a small accent-colored vertical bar
 * (w-1 h-4 md:h-5 rounded-full bg-brand) before the bold tracking-tight
 * title — recognizable at a glance and repaints live with the brand color.
 */
export function SectionHeadingBar({
  title,
  hint,
  icon: Icon,
}: {
  title: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-zinc-900 md:text-lg dark:text-zinc-100">
        <span className="size-4 rounded-full bg-brand md:h-5 md:w-1" aria-hidden />
        {Icon && <Icon className="size-4 text-brand" aria-hidden />}
        {title}
      </h2>
      {hint && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
      )}
    </div>
  );
}

/**
 * Horizontal snap-scroller with desktop-only arrow buttons and hidden scrollbar.
 * Matches Zoryva's row layout: full-bleed horizontally, snap-x cards, gradient
 * fade-out on the side the arrow points to.
 */
export function MediaRow({ children, label }: { children: ReactNode; label: string }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const setEnd = (el: HTMLDivElement) => {
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
  };

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 8);
    setEnd(el);
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

      {/* Edge fade — gradient overlays that appear only on the scrollable
          side, like Zoryva's row fades. Pointer-events-none so they don't
          block clicks on cards under the gradient. */}
      <div
        aria-hidden
        className={
          'pointer-events-none absolute inset-y-0 left-0 hidden w-12 bg-gradient-to-r from-zinc-50 to-transparent transition-opacity duration-200 dark:from-zinc-950 md:block ' +
          (atStart ? 'opacity-0' : 'opacity-100')
        }
      />
      <div
        aria-hidden
        className={
          'pointer-events-none absolute inset-y-0 right-0 hidden w-12 bg-gradient-to-l from-zinc-50 to-transparent transition-opacity duration-200 dark:from-zinc-950 md:block ' +
          (atEnd ? 'opacity-0' : 'opacity-100')
        }
      />

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
