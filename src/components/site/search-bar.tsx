'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { Database, Loader2, Search, SearchX } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useSearch } from '@/hooks/use-media';
import { useMetaSearch } from '@/hooks/use-meta';
import { tmdbImg } from '@/lib/languages';
import { useCinedeckStore } from '@/lib/store';
import { useHasTmdbKey } from '@/lib/settings';
import { yearOf, type SearchItem } from '@/lib/tmdb';
import type { MetaSearchItem } from '@/lib/meta';

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function ResultRow({ item, onSelect }: { item: SearchItem; onSelect: (item: SearchItem) => void }) {
  const poster = tmdbImg(item.posterPath, 'w185');
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-zinc-200/80 focus-visible:bg-zinc-200/80 focus-visible:outline-none dark:hover:bg-zinc-800/70 dark:focus-visible:bg-zinc-800/70"
    >
      <span className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950">
        {poster ? (
          <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500 dark:text-zinc-700">
            TMDB
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</span>
          {item.releaseDate && (
            <span className="shrink-0 text-xs text-zinc-500">{yearOf(item.releaseDate)}</span>
          )}
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span
            className={
              'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ' +
              (item.mediaType === 'tv'
                ? 'bg-amber-400/15 text-amber-600 dark:text-amber-300'
                : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400')
            }
          >
            {item.mediaType}
          </span>
          <span className="font-mono text-[11px] text-amber-600/90 dark:text-amber-400/90">ID {item.id}</span>
          {item.voteAverage > 0 && (
            <span className="text-[11px] text-zinc-500">★ {item.voteAverage.toFixed(1)}</span>
          )}
        </span>
      </span>
    </button>
  );
}

function MetaResultRow({
  item,
  onSelect,
}: {
  item: MetaSearchItem;
  onSelect: (item: MetaSearchItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-zinc-200/80 focus-visible:bg-zinc-200/80 focus-visible:outline-none dark:hover:bg-zinc-800/70 dark:focus-visible:bg-zinc-800/70"
    >
      <span className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950">
        {item.poster ? (
          <img src={item.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500 dark:text-zinc-700">
            IMDb
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</span>
          {item.year && <span className="shrink-0 text-xs text-zinc-500">{item.year}</span>}
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span
            className={
              'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ' +
              (item.mediaType === 'tv'
                ? 'bg-amber-400/15 text-amber-600 dark:text-amber-300'
                : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400')
            }
          >
            {item.mediaType}
          </span>
          <span className="font-mono text-[11px] text-amber-600/90 dark:text-amber-400/90">{item.imdbId}</span>
          {item.voteAverage > 0 && (
            <span className="text-[11px] text-zinc-500">★ {item.voteAverage.toFixed(1)}</span>
          )}
        </span>
      </span>
    </button>
  );
}

export function SearchBar() {
  const router = useRouter();
  const language = useCinedeckStore((s) => s.language);
  const hasKey = useHasTmdbKey();

  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(text.trim(), 400);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = debounced.trim();
  const tmdbEnabled = hasKey && trimmed.length >= 2;
  const metaEnabled = !hasKey && trimmed.length >= 2;

  const { data, isFetching } = useSearch(trimmed, language, tmdbEnabled);
  const metaQuery = useMetaSearch(trimmed, metaEnabled);

  const results = useMemo(() => data ?? [], [data]);
  const metaResults = useMemo(() => metaQuery.data ?? [], [metaQuery.data]);

  // Close on outside click.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  // "/" focuses search, Esc closes the dropdown.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      } else if (event.key === 'Escape' && document.activeElement === inputRef.current) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const select = useCallback(
    (item: SearchItem) => {
      setOpen(false);
      setText('');
      router.push(`/?id=${item.id}&type=${item.mediaType}`, { scroll: false });
    },
    [router]
  );

  // Keyless results play straight from their IMDB id — no TMDB key needed.
  const selectMeta = useCallback(
    (item: MetaSearchItem) => {
      setOpen(false);
      setText('');
      router.push(`/?imdb=${item.imdbId}&type=${item.mediaType}`, { scroll: false });
    },
    [router]
  );

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      event.currentTarget.blur();
    }
  };

  const showDropdown = open && text.trim().length > 0;

  let body: React.ReactNode;
  if (!hasKey) {
    if (isFetching && metaResults.length === 0 && metaQuery.isPending) {
      body = (
        <div className="flex items-center gap-3 px-3 py-6 text-sm text-zinc-600 dark:text-zinc-400">
          <Loader2 className="size-4 animate-spin text-amber-500 dark:text-amber-400" aria-hidden />
          Searching…
        </div>
      );
    } else if (trimmed.length < 2) {
      body = (
        <div className="px-3 py-6 text-sm text-zinc-500">
          Keep typing — results appear after 2 characters.
        </div>
      );
    } else if (metaResults.length === 0) {
      body = (
        <div className="flex items-center gap-3 px-3 py-6 text-sm text-zinc-600 dark:text-zinc-400">
          <SearchX className="size-4 text-zinc-500 dark:text-zinc-600" aria-hidden />
          No results for “{trimmed}”
        </div>
      );
    } else {
      body = (
        <div className="p-1">
          {metaResults.map((item) => (
            <MetaResultRow key={`${item.mediaType}-${item.imdbId}`} item={item} onSelect={selectMeta} />
          ))}
          <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[11px] text-zinc-500 dark:text-zinc-600">
            <Database className="size-3" aria-hidden />
            Keyless mode — plays via IMDB · add a TMDB key for the full library
          </p>
        </div>
      );
    }
  } else if (isFetching) {
    body = (
      <div className="flex items-center gap-3 px-3 py-6 text-sm text-zinc-600 dark:text-zinc-400">
        <Loader2 className="size-4 animate-spin text-amber-500 dark:text-amber-400" aria-hidden />
        Searching TMDB…
      </div>
    );
  } else if (trimmed.length < 2) {
    body = (
      <div className="px-3 py-6 text-sm text-zinc-500">
        Keep typing — results appear after 2 characters.
      </div>
    );
  } else if (results.length === 0) {
    body = (
      <div className="flex items-center gap-3 px-3 py-6 text-sm text-zinc-600 dark:text-zinc-400">
        <SearchX className="size-4 text-zinc-500 dark:text-zinc-600" aria-hidden />
        No results for “{trimmed}”
      </div>
    );
  } else {
    body = (
      <div className="p-1">
        {results.map((item) => (
          <ResultRow key={`${item.mediaType}-${item.id}`} item={item} onSelect={select} />
        ))}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative w-full md:w-72 lg:w-80">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500 dark:text-zinc-600"
        aria-hidden
      />
      <Input
        ref={inputRef}
        type="search"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onInputKeyDown}
        placeholder="Search movies & shows…  /"
        aria-label="Search movies and shows by title"
        className="h-10 rounded-lg border-zinc-200 bg-white/80 pl-9 pr-3 text-sm text-zinc-800 placeholder:text-zinc-400 focus-visible:border-amber-400/60 focus-visible:ring-amber-400/20 [&::-webkit-search-cancel-button]:hidden dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200 dark:placeholder:text-zinc-600"
      />
      {showDropdown && (
        <div
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-xl border border-zinc-200 bg-white/95 p-1 shadow-xl shadow-black/10 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95 dark:shadow-black/40 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700"
        >
          {body}
        </div>
      )}
    </div>
  );
}
