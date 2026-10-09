'use client';

// Admin dashboard shared primitives — Linear/Vercel-grade minimal dark UI.
// Palette is intentionally scoped to the admin surface only:
//   page #0a0a0a · card #111111 · border #1f1f1f · accent #3b82f6 · danger #ef4444
// No gradients, no shadows, no emoji. 150ms ease transitions, mono numerals.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search } from 'lucide-react';

import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`admin_${res.status}`);
  return (await res.json()) as T;
}

export async function adminAction(body: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(payload.error?.message ?? `admin_${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Refresh indicator plumbing — tabs ping the top bar whenever their data
// changes so "Updated Xs ago" stays honest across every view.
// ---------------------------------------------------------------------------

export const ADMIN_REFRESH_EVENT = 'cinedeck-admin-refresh';

export function useRefreshPing(dataUpdatedAt: number | undefined): void {
  useEffect(() => {
    if (!dataUpdatedAt) return;
    window.dispatchEvent(new CustomEvent(ADMIN_REFRESH_EVENT, { detail: dataUpdatedAt }));
  }, [dataUpdatedAt]);
}

export function UpdatedAgo({ className }: { className?: string }) {
  const [at, setAt] = useState<number>(Date.now());
  const [, setTick] = useState(0);

  useEffect(() => {
    const onPing = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      if (typeof detail === 'number') setAt(detail);
    };
    window.addEventListener(ADMIN_REFRESH_EVENT, onPing);
    const timer = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => {
      window.removeEventListener(ADMIN_REFRESH_EVENT, onPing);
      clearInterval(timer);
    };
  }, []);

  const seconds = Math.max(0, Math.round((Date.now() - at) / 1_000));
  return (
    <span className={cn('font-mono text-[11px] tabular-nums text-[#6b7280]', className)} aria-live="off">
      Updated {seconds < 5 ? 'just now' : `${seconds}s ago`}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CountUp — numbers animate from their previous value (or 0 on load) with an
// ease-out cubic. Respects prefers-reduced-motion.
// ---------------------------------------------------------------------------

export function CountUp({ value, duration = 800, format }: { value: number; duration?: number; format?: (n: number) => string }) {
  // Counts up from 0 on mount, then animates from the previous value on change.
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const to = value;
    const from = fromRef.current;
    if (from === to) return;
    let raf = 0;
    const start = performance.now();
    const span = from === 0 ? duration : duration * 0.6;
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / (reduced ? 1 : span));
      const eased = 1 - Math.pow(1 - p, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        setDisplay(to);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const rounded = Math.round(display);
  return <span className="tabular-nums">{format ? format(rounded) : rounded.toLocaleString('en-US')}</span>;
}

// ---------------------------------------------------------------------------
// Layout blocks
// ---------------------------------------------------------------------------

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 pb-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-white">{title}</h1>
        {description && <p className="pt-1 text-sm text-[#9ca3af]">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, description, actions, children, className, muted }: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Muted variant — deliberately boring (used by internal-only tools). */
  muted?: boolean;
}) {
  return (
    <section className={cn('rounded-lg border bg-[#111111]', muted ? 'border-[#1a1a1a]' : 'border-[#1f1f1f]', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f1f1f] px-6 py-4">
        <div>
          <h2 className={cn('text-sm font-medium', muted ? 'text-[#9ca3af]' : 'text-white')}>{title}</h2>
          {description && <p className="pt-0.5 text-xs text-[#6b7280]">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className="p-6">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, trend, trendLabel, hint, format }: {
  label: string;
  value: number;
  trend?: number | null;
  trendLabel?: string;
  hint?: string;
  format?: (n: number) => string;
}) {
  const trendPct = typeof trend === 'number' && Number.isFinite(trend) ? Math.round(trend) : null;
  return (
    <div className="rounded-lg border border-[#1f1f1f] bg-[#111111] p-6 transition-colors duration-150 hover:border-[#2a2a2a]">
      <p className="text-xs text-[#9ca3af]">{label}</p>
      <p className="pt-1.5 font-mono text-3xl font-semibold tracking-tight text-white">
        <CountUp value={value} format={format} />
      </p>
      {trendPct !== null && (
        <p className={cn('flex items-center gap-1 pt-1.5 text-[11px] tabular-nums', trendPct >= 0 ? 'text-[#3b82f6]' : 'text-[#ef4444]')}>
          {trendPct >= 0 ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
          {trendPct >= 0 ? '+' : ''}{trendPct}%{trendLabel ? ` ${trendLabel}` : ''}
        </p>
      )}
      {hint && <p className="pt-1 text-[11px] text-[#6b7280]">{hint}</p>}
    </div>
  );
}

export function EmptyState({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#1f1f1f] py-12 text-center">
      <span className="text-[#4b5563]">{icon}</span>
      <p className="text-sm text-[#9ca3af]">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons (plain, flat, precise)
// ---------------------------------------------------------------------------

const BUTTON_VARIANTS = {
  primary: 'bg-[#3b82f6] text-white hover:bg-[#2b74ee] disabled:opacity-50',
  ghost: 'text-[#9ca3af] hover:bg-[#161616] hover:text-white',
  outline: 'border border-[#1f1f1f] text-[#9ca3af] hover:border-[#2a2a2a] hover:text-white',
  danger: 'text-[#ef4444] hover:bg-[#ef4444]/10',
} as const;

export function AdmButton({ variant = 'outline', className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export function SearchInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#6b7280]" aria-hidden />
      <input
        {...props}
        className="h-9 w-full rounded-lg border border-[#1f1f1f] bg-[#111111] pl-8 pr-3 text-sm text-white placeholder:text-[#6b7280] outline-none transition-colors duration-150 focus:border-[#3b82f6]"
      />
    </div>
  );
}

export function AdmSelect({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn('relative', className)}>
      <select
        {...props}
        className="h-8 w-full appearance-none rounded-lg border border-[#1f1f1f] bg-[#111111] pl-3 pr-7 text-xs text-white outline-none transition-colors duration-150 hover:border-[#2a2a2a] focus:border-[#3b82f6]"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-[#6b7280]" aria-hidden />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export function SortTh({ col, sort, dir, onSort, children, className }: {
  col: string;
  sort: string;
  dir: 'asc' | 'desc';
  onSort: (col: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const active = sort === col;
  return (
    <th scope="col" className={cn('whitespace-nowrap px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]', className)}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          'inline-flex items-center gap-1 transition-colors duration-150 hover:text-white',
          active && 'text-white',
        )}
        aria-label={`Sort by ${typeof children === 'string' ? children : col}`}
      >
        {children}
        {active && (dir === 'asc' ? <ChevronUp className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />)}
      </button>
    </th>
  );
}

export function Pagination({ page, pages, total, onPage, label }: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between pt-3 text-xs text-[#9ca3af]">
      <span className="font-mono tabular-nums">
        {total.toLocaleString('en-US')} {label} · page {page}/{Math.max(1, pages)}
      </span>
      <div className="flex gap-1.5">
        <AdmButton variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-3.5" aria-hidden /> Prev
        </AdmButton>
        <AdmButton variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next <ChevronRight className="size-3.5" aria-hidden />
        </AdmButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small visual atoms
// ---------------------------------------------------------------------------

export function StatusDot({ status }: { status: 'active' | 'suspended' | 'deleted' | 'admin' }) {
  const map = {
    active: { color: '#22c55e', label: 'Active' },
    admin: { color: '#3b82f6', label: 'Admin' },
    suspended: { color: '#ef4444', label: 'Suspended' },
    deleted: { color: '#6b7280', label: 'Deleted' },
  } as const;
  const item = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#d1d5db]">
      <span className="size-1.5 rounded-full" style={{ background: item.color }} aria-hidden />
      {item.label}
    </span>
  );
}

export function TrendBadge({ trend, label = 'vs last week' }: { trend: number | null | undefined; label?: string }) {
  if (typeof trend !== 'number' || !Number.isFinite(trend)) return null;
  const pct = Math.round(trend);
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] tabular-nums', pct >= 0 ? 'text-[#3b82f6]' : 'text-[#ef4444]')}>
      {pct >= 0 ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
      {pct >= 0 ? '+' : ''}{pct}% <span className="text-[#6b7280]">{label}</span>
    </span>
  );
}

export function initialsOf(email: string): string {
  const clean = email.replace(/[^a-zA-Z]/g, ' ').trim();
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

export function Avatar({ email, avatar, size = 24 }: { email: string; avatar?: string | null; size?: number }) {
  if (avatar && /^https?:\/\//.test(avatar)) {
    return <img src={avatar} alt="" width={size} height={size} className="rounded-full object-cover" />;
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-[#1f1f1f] font-mono font-medium text-[#9ca3af]"
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}
      aria-hidden
    >
      {initialsOf(email)}
    </span>
  );
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtClock(iso: string | number): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
