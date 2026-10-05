import { Link } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="mx-auto my-16 max-w-md rounded-2xl border border-zinc-200 bg-white/70 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
      <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Page not found</h1>
      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        CineDeck lives on a single page — head back home and search for anything.
      </p>
      <a
        href="/"
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand/90"
      >
        <Link className="size-4" aria-hidden />
        Back to CineDeck
      </a>
    </div>
  );
}
