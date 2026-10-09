'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Mic, Search, UserRound, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { MediaCard, MediaCardSkeleton, type MediaCardItem } from '@/components/site/media-card';
import { EmptyState } from '@/components/site/empty-state';
import { SectionHeadingBar } from '@/components/site/media-row';
import { useSearch, useTrending, usePopularMovies, usePopularTV, useCatalog } from '@/hooks/use-media';
import { useMetaSearch, useFinnishCatalog } from '@/hooks/use-meta';
import { useVoiceSearch } from '@/hooks/use-voice-search';
import { useCinedeckStore } from '@/lib/store';
import { useHasTmdbKey } from '@/lib/settings';
import { useUiStrings } from '@/lib/ui-strings';
import { yearOf, type SearchItem } from '@/lib/tmdb';
import type { MetaSearchItem } from '@/lib/meta';

const RECENTS_KEY = 'cinedeck.recentSearches';
const RECENTS_MAX = 8;

const DECADES = [
  { value: '202', label: '2020s' },
  { value: '201', label: '2010s' },
  { value: '200', label: '2000s' },
  { value: '199', label: '1990s' },
  { value: '198', label: '1980s' },
  { value: '197', label: '1970s' },
] as const;

interface PersonHit {
  id: number;
  name: string;
  profile_path?: string | null;
  known_for_department?: string | null;
}

/** Normalize either metadata source into a card item (mirrors home-view). */
function toCardItem(item: SearchItem | MetaSearchItem): MediaCardItem {
  if ('imdbId' in item) {
    return {
      id: item.tmdbId ?? 0,
      imdbId: item.imdbId,
      mediaType: item.mediaType,
      title: item.title,
      posterPath: null,
      posterUrl: item.poster ?? null,
      releaseDate: item.year ? `${item.year}-01-01` : '',
      voteAverage: item.voteAverage,
      genre: item.genre,
    };
  }
  return item;
}

function rowKeyOf(item: SearchItem | MetaSearchItem): string {
  if ('imdbId' in item) return `meta-${item.imdbId}`;
  return `${item.mediaType}-${item.id}`;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function loadRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

/**
 * Full search & browse view (/ ?view=search) — instant grouped results with
 * a 300ms debounce, local recent searches, voice input, and honest filters:
 * type/year/rating apply client-side to any source; genre switches the
 * no-query browse mode onto the catalog API (which supports it server-side).
 */
export function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useUiStrings();
  const hasKey = useHasTmdbKey();
  const language = useCinedeckStore((s) => s.language);

  const browse = params.get('browse');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [type, setType] = useState<'all' | 'movie' | 'tv'>(
    params.get('type') === 'tv' ? 'tv' : params.get('type') === 'movie' ? 'movie' : 'all',
  );
  const [decade, setDecade] = useState('any');
  const [minRating, setMinRating] = useState('0');
  const [genre, setGenre] = useState('any');
  const [recents, setRecents] = useState<string[]>(() => loadRecents());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const debouncedQuery = useDebounced(query.trim(), 300);
  const isQueryMode = debouncedQuery.length >= 2;

  const persistRecent = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) return;
    setRecents((prev) => {
      const next = [trimmed, ...prev.filter((v) => v !== trimmed)].slice(0, RECENTS_MAX);
      try {
        window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  const clearRecents = () => {
    setRecents([]);
    try {
      window.localStorage.removeItem(RECENTS_KEY);
    } catch {
      /* ignore */
    }
  };

  // --- Data: query mode ---------------------------------------------------
  const tmdbQuery = useSearch(debouncedQuery, language, isQueryMode && hasKey);
  const metaQuery = useMetaSearch(debouncedQuery, isQueryMode);
  const peopleQuery = useQuery<PersonHit[]>({
    queryKey: ['tmdb', 'person-search', debouncedQuery],
    queryFn: async () => {
      const res = await fetch(`/api/tmdb/person-search?q=${encodeURIComponent(debouncedQuery)}`);
      if (!res.ok) throw new Error('person search failed');
      const data = (await res.json()) as { results: PersonHit[] };
      return data.results ?? [];
    },
    enabled: isQueryMode && hasKey,
    staleTime: 60 * 1000,
  });
  const finnishMovies = useFinnishCatalog('movie', isQueryMode);
  const finnishTv = useFinnishCatalog('tv', isQueryMode);

  // --- Data: browse mode (no query) ---------------------------------------
  const browseTrending = useTrending(language, !isQueryMode && browse === 'trending');
  const browsePopularMovies = usePopularMovies(language, !isQueryMode && browse === 'popular' && type !== 'tv');
  const browsePopularTv = usePopularTV(language, !isQueryMode && browse === 'popular' && type !== 'movie');
  // Genre filtering needs the catalog API (server-side genre support).
  const browseGenreMovie = useCatalog(
    { type: 'movie', genre: genre === 'any' ? null : genre, minRating: Number(minRating) || null },
    !isQueryMode && genre !== 'any' && type !== 'tv',
  );
  const browseGenreTv = useCatalog(
    { type: 'tv', genre: genre === 'any' ? null : genre, minRating: Number(minRating) || null },
    !isQueryMode && genre !== 'any' && type !== 'movie',
  );

  const applyClientFilters = useCallback(
    (items: (SearchItem | MetaSearchItem)[]) =>
      items.filter((item) => {
        if (type !== 'all' && item.mediaType !== type) return false;
        if (minRating !== '0' && item.voteAverage < Number(minRating)) return false;
        if (decade !== 'any') {
          const year =
            'imdbId' in item
              ? item.year
              : yearOf((item as SearchItem).releaseDate);
          if (!year || !year.startsWith(decade)) return false;
        }
        return true;
      }),
    [type, minRating, decade],
  );

  // --- Derived result groups ----------------------------------------------
  const movieResults = useMemo(() => {
    if (isQueryMode) {
      const fromTmdb = hasKey ? (tmdbQuery.data ?? []).filter((i) => i.mediaType === 'movie') : [];
      const fromMeta = (metaQuery.data ?? []).filter((i) => i.mediaType === 'movie');
      const seen = new Set<string>();
      const merged = [...fromTmdb, ...fromMeta].filter((item) => {
        const key = rowKeyOf(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return applyClientFilters(merged);
    }
    if (browse === 'trending') return applyClientFilters(browseTrending.data ?? []).filter((i) => i.mediaType === 'movie' || type === 'all' ? true : i.mediaType === type);
    if (browse === 'popular') {
      const items = [...(browsePopularMovies.data ?? [])];
      return applyClientFilters(items);
    }
    if (genre !== 'any') return applyClientFilters(browseGenreMovie.data ?? []);
    return null; // idle browse — show recents/trending prompt
  }, [isQueryMode, hasKey, tmdbQuery.data, metaQuery.data, applyClientFilters, browse, browseTrending.data, browsePopularMovies.data, browseGenreMovie.data, type]);

  const tvResults = useMemo(() => {
    if (isQueryMode) {
      const fromTmdb = hasKey ? (tmdbQuery.data ?? []).filter((i) => i.mediaType === 'tv') : [];
      const fromMeta = (metaQuery.data ?? []).filter((i) => i.mediaType === 'tv');
      const seen = new Set<string>();
      const merged = [...fromTmdb, ...fromMeta].filter((item) => {
        const key = rowKeyOf(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return applyClientFilters(merged);
    }
    if (browse === 'popular') return applyClientFilters(browsePopularTv.data ?? []);
    if (genre !== 'any') return applyClientFilters(browseGenreTv.data ?? []);
    return null;
  }, [isQueryMode, hasKey, tmdbQuery.data, metaQuery.data, applyClientFilters, browse, browsePopularTv.data, browseGenreTv.data]);

  const trendingResults = useMemo(() => {
    if (isQueryMode || browse !== 'trending') return null;
    return applyClientFilters(browseTrending.data ?? []);
  }, [isQueryMode, browse, browseTrending.data, applyClientFilters]);

  const peopleResults = useMemo(
    () => (isQueryMode && hasKey ? (peopleQuery.data ?? []).slice(0, 8) : []),
    [isQueryMode, hasKey, peopleQuery.data],
  );

  const finnishResults = useMemo(() => {
    if (!isQueryMode) return [];
    const q = debouncedQuery.toLowerCase();
    const all = [...(finnishMovies.data ?? []), ...(finnishTv.data ?? [])];
    return all
      .filter((item) => item.title.toLowerCase().includes(q))
      .slice(0, 12);
  }, [isQueryMode, debouncedQuery, finnishMovies.data, finnishTv.data]);

  const anyResults =
    (movieResults && movieResults.length > 0) ||
    (tvResults && tvResults.length > 0) ||
    (trendingResults && trendingResults.length > 0) ||
    peopleResults.length > 0 ||
    finnishResults.length > 0;

  const loading =
    isQueryMode &&
    (tmdbQuery.isPending || metaQuery.isPending || (hasKey && peopleQuery.isPending));

  // --- Voice search --------------------------------------------------------
  const { supported: voiceSupported, listening, toggle } = useVoiceSearch((transcript) => {
    setQuery(transcript);
    persistRecent(transcript);
  });

  const gridClasses = 'flex flex-wrap gap-3';

  const renderGrid = (items: (SearchItem | MetaSearchItem)[], priorityCount = 6) => (
    <div className={gridClasses} role="list">
      {items.map((item, index) => (
        <MediaCard
          key={rowKeyOf(item)}
          item={toCardItem(item)}
          priority={index < priorityCount}
          index={index}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Search input — instant, 300ms debounce */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') persistRecent(query);
          }}
          placeholder={t.searchPlaceholder}
          aria-label={t.search}
          className="h-14 rounded-xl border-border bg-card pl-12 pr-24 text-base shadow-sm focus-visible:border-brand/50 focus-visible:ring-brand/20"
        />
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
          {voiceSupported && (
            <button
              type="button"
              aria-label={listening ? 'Listening… tap to stop' : 'Voice search'}
              aria-pressed={listening}
              onClick={() => toggle()}
              className={`flex size-9 items-center justify-center rounded-full transition-colors ${
                listening
                  ? 'bg-brand text-white'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Mic className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* Filters — type always; year/rating everywhere; genre in browse mode */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Result type"
          className="flex h-10 items-center gap-1 rounded-lg border border-border bg-card p-1"
        >
          {([
            { value: 'all', label: 'All' },
            { value: 'movie', label: t.movies },
            { value: 'tv', label: t.tvShows },
          ] as const).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              onClick={() => setType(value)}
              className={`h-8 rounded-md px-3.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
                type === value
                  ? 'bg-brand text-white'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <Select value={decade} onValueChange={setDecade}>
          <SelectTrigger aria-label="Decade" className="h-10 w-32 rounded-lg border-border bg-card text-sm">
            <SelectValue placeholder="Decade" />
          </SelectTrigger>
          <SelectContent className="z-[60]">
            <SelectItem value="any">Any decade</SelectItem>
            {DECADES.map((d) => (
              <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={minRating} onValueChange={setMinRating}>
          <SelectTrigger aria-label="Minimum rating" className="h-10 w-36 rounded-lg border-border bg-card text-sm">
            <SelectValue placeholder="Rating" />
          </SelectTrigger>
          <SelectContent className="z-[60]">
            <SelectItem value="0">Any rating</SelectItem>
            <SelectItem value="5">5.0+</SelectItem>
            <SelectItem value="6">6.0+</SelectItem>
            <SelectItem value="7">7.0+</SelectItem>
            <SelectItem value="8">8.0+</SelectItem>
            <SelectItem value="9">9.0+</SelectItem>
          </SelectContent>
        </Select>

        {!isQueryMode && (
          <Select value={genre} onValueChange={setGenre}>
            <SelectTrigger aria-label="Genre" className="h-10 w-40 rounded-lg border-border bg-card text-sm">
              <SelectValue placeholder="Genre" />
            </SelectTrigger>
            <SelectContent className="z-[60] max-h-72">
              <SelectItem value="any">Any genre</SelectItem>
              {['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western'].map((g) => (
                <SelectItem key={g} value={g}>{g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Recent searches */}
      {!query && recents.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent
          </span>
          {recents.map((recent) => (
            <button
              key={recent}
              type="button"
              onClick={() => setQuery(recent)}
              className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground"
            >
              {recent}
            </button>
          ))}
          <button
            type="button"
            onClick={clearRecents}
            className="inline-flex h-8 items-center rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-brand"
          >
            Clear
          </button>
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className={gridClasses} aria-busy="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <MediaCardSkeleton key={i} />
          ))}
        </div>
      ) : !anyResults ? (
        isQueryMode ? (
          <EmptyState
            variant="search"
            title="No matches found"
            subtitle={`Nothing matched “${debouncedQuery}”. Check the spelling, try a broader term, or browse what everyone is watching right now.`}
          />
        ) : (
          <div className="text-sm text-muted-foreground">
            Pick a type or genre above, or start typing to search every source at once.
          </div>
        )
      ) : (
        <div className="space-y-8">
          {/* Query mode — grouped: Movies / TV / People / Finnish */}
          {isQueryMode ? (
            <>
              {(type === 'all' || type === 'movie') && movieResults && movieResults.length > 0 && (
                <section aria-label="Movie results">
                  <SectionHeadingBar title={t.movies} />
                  {renderGrid(movieResults)}
                </section>
              )}
              {(type === 'all' || type === 'tv') && tvResults && tvResults.length > 0 && (
                <section aria-label="TV results">
                  <SectionHeadingBar title={t.tvShows} />
                  {renderGrid(tvResults)}
                </section>
              )}
              {peopleResults.length > 0 && (
                <section aria-label="People results">
                  <SectionHeadingBar title="People" />
                  <div className="flex flex-wrap gap-3">
                    {peopleResults.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => router.push(`/?person=${person.id}`, { scroll: false })}
                        className="group flex w-28 flex-col items-center gap-2 rounded-lg border border-border bg-card p-3 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 sm:w-32"
                      >
                        {person.profile_path ? (
                           
                          <img
                            src={`https://image.tmdb.org/t/p/w185${person.profile_path}`}
                            alt=""
                            loading="lazy"
                            className="size-16 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex size-16 items-center justify-center rounded-full bg-muted">
                            <UserRound className="size-6 text-muted-foreground" aria-hidden />
                          </span>
                        )}
                        <span className="line-clamp-2 text-xs font-semibold text-foreground">
                          {person.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {finnishResults.length > 0 && (
                <section aria-label="Finnish matches">
                  <SectionHeadingBar title={t.finnishContent} />
                  <div className="flex flex-wrap gap-3">
                    {finnishResults.map((item, index) => (
                      <MediaCard
                        key={rowKeyOf(item)}
                        item={{ ...toCardItem(item), finnish: true }}
                        priority={index < 6}
                        index={index}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            /* Browse mode — one grid */
            <>
              {trendingResults && trendingResults.length > 0 && (
                <section aria-label="Trending">
                  <SectionHeadingBar title={t.trendingNow} />
                  {renderGrid(trendingResults)}
                </section>
              )}
              {browse === 'trending' && (!trendingResults || trendingResults.length === 0) && (
                <div aria-busy="true" className={gridClasses}>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <MediaCardSkeleton key={i} />
                  ))}
                </div>
              )}
              {movieResults && movieResults.length > 0 && (
                <section aria-label="Movies">
                  <SectionHeadingBar title={t.movies} />
                  {renderGrid(movieResults)}
                </section>
              )}
              {tvResults && tvResults.length > 0 && (
                <section aria-label="TV shows">
                  <SectionHeadingBar title={t.tvShows} />
                  {renderGrid(tvResults)}
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
