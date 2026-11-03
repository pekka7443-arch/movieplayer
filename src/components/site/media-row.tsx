'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode, type ComponentType } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Custom thin scrollbar styling for vertical overflow lists. */
export const THIN_SCROLLBAR_Y =
  'overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700';

/**
 * Section heading — 24px/semibold on desktop per the type scale, with an
 * optional "See all" affordance on the right. The accent bar repaints live
 * with the brand color.
 */
export function SectionHeadingBar({
  title,
  hint,
  icon: Icon,
  seeAll,
}: {
  title: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  /** When set, renders a "See all" action on the right edge of the heading. */
  seeAll?: { label?: string; onClick: () => void };
}) {
  return (
    <div className="mb-2 flex items-baseline gap-2.5">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground md:text-base">
        {Icon && <Icon className="size-4 text-brand" aria-hidden />}
        {title}
      </h2>
      {hint && (
        <span className="hidden text-xs text-muted-foreground sm:inline">{hint}</span>
      )}
      {seeAll && (
        <button
          type="button"
          onClick={seeAll.onClick}
          className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-md text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          aria-label={seeAll.label ?? `See all — ${title}`}
        >
          {seeAll.label ?? 'See all'}
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * Horizontal snap-scroller with momentum and a fully hidden scrollbar.
 * Arrow buttons: always visible on mobile (touch has no hover), fade in on
 * container hover for fine pointers. Edge fades mark the scrollable side.
 */
export function MediaRow({ children, label }: { children: ReactNode; label: string }) {
  const reduceMotion = useReducedMotion();
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

  // Recompute edge state when the row content changes (catalog swap, kids
  // filter, lazy mount) — otherwise arrows can start out in a stale state.
  useEffect(() => {
    updateEdges();
  }, [updateEdges, children]);

  const scrollBy = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.8, 240), behavior: 'smooth' });
  };

  const arrowClasses =
    'pointer-events-auto size-7 rounded-full border border-border/80 bg-popover/95 text-zinc-400 shadow-md shadow-black/20 backdrop-blur transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-0';

  // Hover micro-interaction for the scroll arrows: gentle scale, 150ms.
  const arrowMotion = (direction: 1 | -1) => ({
    whileHover: reduceMotion ? undefined : { scale: 1.08 },
    whileTap: reduceMotion ? undefined : { scale: 0.95 },
    transition: { duration: reduceMotion ? 0 : 0.15, ease: 'easeOut' as const },
  });

  return (
    <div className="group/row relative" role="region" aria-label={label}>
      <div
        ref={scrollerRef}
        onScroll={updateEdges}
        className="flex snap-x gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-2.5"
        style={{ scrollBehavior: 'smooth' }}
      >
        {children}
      </div>

      {/* Edge fades — pointer-events-none so they never block card clicks. */}
      <div
        aria-hidden
        className={
          'pointer-events-none absolute inset-y-0 left-0 hidden w-12 bg-gradient-to-r from-background to-transparent transition-opacity duration-200 md:block ' +
          (atStart ? 'opacity-0' : 'opacity-100')
        }
      />
      <div
        aria-hidden
        className={
          'pointer-events-none absolute inset-y-0 right-0 hidden w-12 bg-gradient-to-l from-background to-transparent transition-opacity duration-200 md:block ' +
          (atEnd ? 'opacity-0' : 'opacity-100')
        }
      />

      {/* Left arrow — always visible on mobile, hover-revealed on desktop. */}
      <div className="pointer-events-none absolute -left-1.5 top-1/2 z-10 -translate-y-1/2 sm:-left-2 md:opacity-0 md:transition-opacity md:duration-150 md:group-hover/row:opacity-100">
        <motion.div className="inline-flex" {...arrowMotion(-1)}>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={`Scroll ${label} left`}
            disabled={atStart}
            onClick={() => scrollBy(-1)}
            className={arrowClasses}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
        </motion.div>
      </div>
      {/* Right arrow — same reveal behavior. */}
      <div className="pointer-events-none absolute -right-1.5 top-1/2 z-10 -translate-y-1/2 sm:-right-2 md:opacity-0 md:transition-opacity md:duration-150 md:group-hover/row:opacity-100">
        <motion.div className="inline-flex" {...arrowMotion(1)}>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={`Scroll ${label} right`}
            disabled={atEnd}
            onClick={() => scrollBy(1)}
            className={arrowClasses}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
