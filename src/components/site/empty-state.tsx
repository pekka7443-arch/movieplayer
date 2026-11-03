'use client';

import { type ComponentType } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * Illustrated empty states — every empty view gets inline SVG art (no image
 * requests), a helpful title + subtitle, and a clear action button. The art
 * is hand-drawn line style so it matches any accent color.
 */

type EmptyStateVariant = 'list' | 'search' | 'history' | 'error' | 'bell';

function ListArt() {
  return (
    <svg viewBox="0 0 160 120" fill="none" aria-hidden className="h-28 w-auto">
      <rect x="34" y="14" width="92" height="92" rx="10" className="stroke-muted-foreground/40" strokeWidth="2.5" />
      <rect x="46" y="30" width="46" height="60" rx="6" className="fill-brand/10 stroke-brand/60" strokeWidth="2.5" />
      <path d="M104 34h12M104 48h12M104 62h12M104 76h12" className="stroke-muted-foreground/50" strokeWidth="3" strokeLinecap="round" />
      <path d="M56 66l8 9 14-18" className="stroke-brand" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchArt() {
  return (
    <svg viewBox="0 0 160 120" fill="none" aria-hidden className="h-28 w-auto">
      <circle cx="72" cy="54" r="30" className="stroke-muted-foreground/40" strokeWidth="2.5" />
      <circle cx="72" cy="54" r="20" className="fill-brand/10 stroke-brand/50" strokeWidth="2.5" />
      <path d="M94 76l24 24" className="stroke-muted-foreground/60" strokeWidth="4" strokeLinecap="round" />
      <path d="M63 54c1-6 5-10 11-11" className="stroke-brand" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function HistoryArt() {
  return (
    <svg viewBox="0 0 160 120" fill="none" aria-hidden className="h-28 w-auto">
      <circle cx="80" cy="60" r="38" className="stroke-muted-foreground/40" strokeWidth="2.5" />
      <circle cx="80" cy="60" r="26" className="fill-brand/10 stroke-brand/50" strokeWidth="2.5" />
      <path d="M80 46v15l11 7" className="stroke-brand" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M80 14v10M80 96v10M34 60h-10M136 60h-10" className="stroke-muted-foreground/50" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function BellArt() {
  return (
    <svg viewBox="0 0 160 120" fill="none" aria-hidden className="h-28 w-auto">
      <path d="M80 24a26 26 0 0 1 26 26v18l8 14H46l8-14V50a26 26 0 0 1 26-26z" className="fill-brand/10 stroke-brand/60" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M70 90a10 10 0 0 0 20 0" className="stroke-muted-foreground/50" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M118 34l8-8M124 52h10M28 34l-8-8M22 52h-10" className="stroke-muted-foreground/40" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ErrorArt() {
  return (
    <svg viewBox="0 0 160 120" fill="none" aria-hidden className="h-28 w-auto">
      <rect x="30" y="24" width="100" height="66" rx="10" className="stroke-muted-foreground/40" strokeWidth="2.5" />
      <rect x="42" y="36" width="76" height="42" rx="6" className="fill-brand/10 stroke-brand/50" strokeWidth="2.5" />
      <path d="M80 90v12M64 106h32" className="stroke-muted-foreground/50" strokeWidth="3" strokeLinecap="round" />
      <path d="M70 50l20 20M90 50l-20 20" className="stroke-brand" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const ART: Record<EmptyStateVariant, ComponentType> = {
  list: ListArt,
  search: SearchArt,
  history: HistoryArt,
  bell: BellArt,
  error: ErrorArt,
};

export function EmptyState({
  variant = 'list',
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  variant?: EmptyStateVariant;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const Art = ART[variant];
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/40 px-6 py-10 text-center"
    >
      <Art />
      <p className="mt-4 text-[15px] font-semibold text-foreground">{title}</p>
      {subtitle && (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>
      )}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-md bg-brand px-5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          {actionLabel}
        </button>
      )}
    </motion.div>
  );
}
