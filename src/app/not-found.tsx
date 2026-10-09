import { Search, Tv } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="mx-auto my-16 max-w-xl rounded-2xl border border-zinc-200 bg-white/70 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900/40 sm:p-10">
      <p className="font-mono text-6xl font-black tracking-tight text-brand sm:text-7xl">404</p>
      <h1 className="mt-3 text-lg font-bold text-zinc-900 dark:text-zinc-100">
        This page went missing
      </h1>
      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        CineDeck lives on a single page — head back home and search for anything.
      </p>
      <form action="/" method="get" className="mx-auto mt-5 flex max-w-sm gap-2">
        <label htmlFor="nf-search" className="sr-only">
          Search CineDeck
        </label>
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            aria-hidden
          />
          <input
            id="nf-search"
            name="q"
            type="search"
            placeholder="Search titles, people…"
            className="h-11 w-full rounded-lg border border-zinc-200 bg-white/80 pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-100"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand/90"
        >
          <Tv className="size-4" aria-hidden />
          Search
        </button>
      </form>
      <a
        href="/"
        className="mt-4 inline-flex h-10 items-center rounded-lg border border-zinc-200 px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
      >
        Back to CineDeck
      </a>
    </div>
  );
}
