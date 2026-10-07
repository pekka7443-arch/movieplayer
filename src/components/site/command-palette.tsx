'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import {
  Clapperboard,
  Dice5,
  Film,
  Gamepad2,
  History,
  LayoutList,
  Search,
  Settings2,
  Trophy,
  Tv,
  UserRound,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useCinedeckStore } from '@/lib/store';
import { getTmdbKey } from '@/lib/settings';
import type { MetaSearchItem } from '@/lib/meta';
import type { HistoryItem, SearchItem } from '@/lib/tmdb';

interface PersonHit {
  id: number;
  name: string;
  department: string;
  profilePath: string | null;
  knownFor: string;
}

interface PaletteTitle {
  key: string;
  tmdbId?: number;
  imdbId?: string;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
  poster: string | null;
}

function toPaletteItem(item: MetaSearchItem | SearchItem): PaletteTitle {
  if ('imdbId' in item) {
    // Cinemeta MetaSearchItem
    return {
      key: `m-${item.imdbId}`,
      imdbId: item.imdbId,
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
      title: item.title,
      year: item.year,
      poster: item.poster,
    };
  }
  return {
    key: `t-${item.mediaType}-${item.id}`,
    tmdbId: item.id,
    mediaType: item.mediaType,
    title: item.title,
    year: item.releaseDate?.slice(0, 4) ?? '',
    poster: item.posterPath ? `https://image.tmdb.org/t/p/w185${item.posterPath}` : null,
  };
}

/**
 * Global command palette (Ctrl/Cmd+K): fuzzy title search, jump to any
 * section, people search (TMDB key) and quick actions. Pure client-side —
 * searches reuse the existing metadata endpoints.
 */
export function CommandPalette() {
  const router = useRouter();
  const open = useCinedeckStore((s) => s.paletteOpen);
  const setOpen = useCinedeckStore((s) => s.setPaletteOpen);
  const openArcade = useCinedeckStore((s) => s.openArcade);
  const openSettings = useCinedeckStore((s) => s.openSettings);

  const [query, setQuery] = useState('');
  const [titles, setTitles] = useState<PaletteTitle[]>([]);
  const [people, setPeople] = useState<PersonHit[]>([]);
  const [searching, setSearching] = useState(false);

  // Recent titles for instant jumping (history, newest 8).
  const historyQuery = useQuery<HistoryItem[]>({
    queryKey: ['history'],
    queryFn: () => fetch('/api/history').then((r) => r.json()).then((d) => d.items ?? []),
    enabled: open,
    staleTime: 60_000,
  });

  // Close-reset (async so the effect body stays setState-free — satisfies
  // the react-hooks cascade rule).
  useEffect(() => {
    if (open) return;
    const raf = requestAnimationFrame(() => {
      setQuery('');
      setTitles([]);
      setPeople([]);
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Debounced search — keyless via Cinemeta, with key via TMDB multi; people
  // searched too when a key exists. All state updates happen inside the
  // debounce callback (never synchronously in the effect body).
  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (q.length < 2) {
        setTitles([]);
        setPeople([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const key = getTmdbKey();
        const [titleRes, personRes] = await Promise.all([
          key
            ? fetch(`/api/tmdb/search?q=${encodeURIComponent(q)}&language=en-US`, {
                headers: { 'x-tmdb-key': key },
                signal: controller.signal,
              })
            : fetch(`/api/meta/search?q=${encodeURIComponent(q)}`, { signal: controller.signal }),
          key
            ? fetch(`/api/tmdb/person-search?q=${encodeURIComponent(q)}`, {
                headers: { 'x-tmdb-key': key },
                signal: controller.signal,
              })
            : Promise.resolve({ ok: false, json: async () => ({ results: [] }) } as Response),
        ]);
        const titleData = (await titleRes.json()) as {
          results: (MetaSearchItem | SearchItem)[];
        };
        setTitles((titleData.results ?? []).slice(0, 8).map(toPaletteItem));
        const personData = (await personRes.json()) as { results: PersonHit[] };
        setPeople(personData.results?.slice(0, 4) ?? []);
      } catch {
        // aborted or failed — keep whatever we had
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const run = (push: string) => {
    setOpen(false);
    router.push(push, { scroll: false });
  };

  const surprise = () => {
    // Pick a random card from the loaded history-independent rows: fetch
    // keyless popular mixed and choose randomly — quick "Surprise me".
    setOpen(false);
    void fetch('/api/meta/popular?type=all')
      .then((r) => r.json())
      .then((d: { results: MetaSearchItem[] }) => {
        const pool = d.results ?? [];
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick) {
          const params = new URLSearchParams({ type: pick.mediaType });
          if (pick.tmdbId) params.set('id', String(pick.tmdbId));
          else params.set('imdb', pick.imdbId);
          router.push(`/?${params.toString()}`, { scroll: false });
        }
      })
      .catch(() => undefined);
  };

  const recents = useMemo(() => (historyQuery.data ?? []).slice(0, 8), [historyQuery.data]);

  return (
    <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
      <DialogContent
        showCloseButton={false}
        className="top-[12%] max-w-xl translate-y-0 gap-0 overflow-hidden rounded-2xl border-zinc-200 bg-white/95 p-0 shadow-2xl backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/95"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command shouldFilter={false} className="w-full">
          <div className="flex items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
            <Search className="size-4 shrink-0 text-zinc-400" aria-hidden />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search titles, people, pages…"
              className="h-12 w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              aria-label="Command palette search"
            />
            {searching && <span className="size-3 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden />}
            <kbd className="hidden shrink-0 rounded border border-zinc-200 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 sm:block dark:border-zinc-800">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-[55vh] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {query.trim().length >= 2 ? 'Nothing found.' : 'Type to search or pick an action below.'}
            </Command.Empty>

            {query.trim().length < 2 && recents.length > 0 && (
              <Command.Group heading="Jump back in" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-400">
                {recents.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={`recent-${item.tmdbId}`}
                    onSelect={() =>
                      run(
                        `/?id=${item.tmdbId}&type=${item.mediaType}` +
                          (item.mediaType === 'tv' && item.season && item.episode
                            ? `&s=${item.season}&e=${item.episode}`
                            : ''),
                      )
                    }
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-700 data-[selected=true]:bg-brand-soft data-[selected=true]:text-zinc-900 dark:text-zinc-300 dark:data-[selected=true]:text-zinc-100"
                  >
                    <History className="size-4 shrink-0 text-brand" aria-hidden />
                    <span className="truncate">{item.title}</span>
                    {item.mediaType === 'tv' && item.season != null && (
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-400">
                        S{item.season}·E{item.episode}
                      </span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {titles.length > 0 && (
              <Command.Group heading="Titles" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-400">
                {titles.map((item) => (
                  <Command.Item
                    key={item.key}
                    value={item.key}
                    onSelect={() =>
                      run(
                        item.tmdbId
                          ? `/?id=${item.tmdbId}&type=${item.mediaType}` +
                              (item.imdbId ? `&imdb=${item.imdbId}` : '')
                          : `/?imdb=${item.imdbId ?? ''}&type=${item.mediaType}`,
                      )
                    }
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-700 data-[selected=true]:bg-brand-soft dark:text-zinc-300"
                  >
                    {item.mediaType === 'tv' ? (
                      <Tv className="size-4 shrink-0 text-brand" aria-hidden />
                    ) : (
                      <Film className="size-4 shrink-0 text-brand" aria-hidden />
                    )}
                    <span className="truncate">{item.title}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-zinc-400">{item.year}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {people.length > 0 && (
              <Command.Group heading="People" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-400">
                {people.map((person) => (
                  <Command.Item
                    key={`person-${person.id}`}
                    value={`person-${person.id}`}
                    onSelect={() => run(`/?person=${person.id}`)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-700 data-[selected=true]:bg-brand-soft dark:text-zinc-300"
                  >
                    <UserRound className="size-4 shrink-0 text-brand" aria-hidden />
                    <span className="truncate">{person.name}</span>
                    <span className="ml-auto max-w-40 truncate text-[10px] text-zinc-400">
                      {person.knownFor}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-400">
              <Item icon={Dice5} label="Surprise me — random title" onSelect={surprise} />
              <Item icon={Trophy} label="Live sports" onSelect={() => run('/?view=sports')} />
              <Item icon={LayoutList} label="Watch statistics" onSelect={() => run('/?view=stats')} />
              <Item icon={History} label="Continue watching" onSelect={() => run('/#continue-watching')} />
              <Item icon={Clapperboard} label="Browse home" onSelect={() => run('/')} />
              <Item icon={Gamepad2} label="Arcade" onSelect={() => { setOpen(false); openArcade(); }} />
              <Item icon={Settings2} label="Settings" onSelect={() => { setOpen(false); openSettings(); }} />
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Item({
  icon: Icon,
  label,
  onSelect,
}: {
  icon: typeof Trophy;
  label: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-700 data-[selected=true]:bg-brand-soft dark:text-zinc-300"
    >
      <Icon className="size-4 shrink-0 text-brand" aria-hidden />
      {label}
    </Command.Item>
  );
}
