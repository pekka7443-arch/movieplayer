'use client';

// Global route error boundary — catches render/data errors in the app shell
// and offers recovery without a full reload. Details go to the console +
// the /api logging pipeline via the error digest.

import { useEffect } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[cinedeck] route error', error.digest ?? error.message);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto my-16 max-w-md rounded-2xl border border-red-300/50 bg-red-50/70 p-8 text-center dark:border-red-900/40 dark:bg-red-950/30"
    >
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-500/10">
        <AlertTriangle className="size-6 text-red-500 dark:text-red-400" aria-hidden />
      </span>
      <h1 className="mt-4 text-lg font-bold text-zinc-900 dark:text-zinc-100">
        Something went off-script
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        The view failed to render. Your lists and settings are safe — try again, and if it keeps
        happening, reload the page.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-[11px] text-zinc-400">digest: {error.digest}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand/90"
      >
        <RotateCw className="size-4" aria-hidden />
        Try again
      </button>
    </div>
  );
}
