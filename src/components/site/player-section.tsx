'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  Radar,
  RotateCw,
  Star,
  Unplug,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSeason } from '@/hooks/use-media';
import { useServerScan } from '@/hooks/use-meta';
import { PROVIDERS, getProvider, getEmbedUrl } from '@/lib/providers';
import { useCinedeckStore } from '@/lib/store';
import { formatRuntime, yearOf, type MediaDetails, type MediaType, type TvDetails } from '@/lib/tmdb';

/** If the active iframe hasn't fired onLoad within this window, we auto-switch. */
const FAILOVER_TIMEOUT_MS = 12_000;

/** Auto-failover bookkeeping, tied to the embed URL it applies to. */
interface FailoverState {
  forUrl: string;
  fromName: string;
  /** Next provider we switched to — null when every candidate is exhausted. */
  toId: string | null;
  /** How many sources have been tried (including the failed one). */
  tried: number;
  total: number;
}

export function PlayerSection({
  tmdbId,
  imdbId,
  mediaType,
  season,
  episode,
  details,
  detailsLoading,
  hasKey,
}: {
  /** TMDB watch mode — omit when using imdbId. */
  tmdbId?: number;
  /** IMDB watch mode (keyless) — omit when using tmdbId. */
  imdbId?: string;
  mediaType: MediaType;
  season: number;
  episode: number;
  details: MediaDetails | undefined;
  detailsLoading: boolean;
  hasKey: boolean;
}) {
  const router = useRouter();
  const server = useCinedeckStore((s) => s.server);
  const setServer = useCinedeckStore((s) => s.setServer);
  const setServerTransient = useCinedeckStore((s) => s.setServerTransient);
  const language = useCinedeckStore((s) => s.language);

  const tvDetails = details && details.mediaType === 'tv' ? (details as TvDetails) : undefined;
  const isTv = mediaType === 'tv';
  const watchId: number | string = imdbId ?? tmdbId ?? 0;

  const seasonQuery = useSeason(tmdbId ?? 0, season, language, hasKey && isTv && !imdbId);
  const episodes = useMemo(() => seasonQuery.data?.episodes ?? [], [seasonQuery.data]);

  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<{ url: string; nonce: number } | null>(null);
  /** Auto-failover bookkeeping for the iframe currently on screen. */
  const [failover, setFailover] = useState<FailoverState | null>(null);

  // ---------------------------------------------------------------------------
  // Source scan — probe every provider for this title, rank them and auto-play
  // the healthiest one. A manual server pick always wins over auto-selection.
  // ---------------------------------------------------------------------------
  const scanQuery = useServerScan(
    { imdb: imdbId ?? null, tmdb: tmdbId ?? null, mediaType, season, episode },
    watchId !== 0,
  );
  const manualPickRef = useRef(false);
  /** Provider ids the watchdog has already tried for the current title/episode. */
  const triedRef = useRef<string[]>([]);

  useEffect(() => {
    manualPickRef.current = false;
    triedRef.current = [];
  }, [imdbId, tmdbId, season, episode]);

  const healthMap = useMemo(() => {
    // true = responded ok, 'unknown' = 403 (Cloudflare may still let browsers
    // through — probe is bot-blocked), false = clearly unreachable/error page.
    const map = new Map<string, boolean | 'unknown'>();
    for (const r of scanQuery.data ?? []) map.set(r.providerId, r.ok ? true : r.status === 403 ? 'unknown' : false);
    return map;
  }, [scanQuery.data]);
  const onlineCount = useMemo(
    () => (scanQuery.data ?? []).filter((r) => r.ok).length,
    [scanQuery.data],
  );

  /**
   * Auto-play order: confirmed-online sources first (fastest response wins),
   * then bot-blocked-but-maybe-working (403), then everything else.
   */
  const candidates = useMemo(() => {
    const rows = scanQuery.data ?? [];
    const ok = rows.filter((r) => r.ok).sort((a, b) => a.ms - b.ms).map((r) => r.providerId);
    const unknown = rows.filter((r) => !r.ok && r.status === 403).map((r) => r.providerId);
    const rest = rows.filter((r) => !r.ok && r.status !== 403).map((r) => r.providerId);
    return [...ok, ...unknown, ...rest];
  }, [scanQuery.data]);

  // The scan outranked the current server → move on (unless the user picked manually).
  useEffect(() => {
    if (!scanQuery.data || manualPickRef.current) return;
    if (healthMap.get(server) !== false) return;
    const best = candidates[0];
    if (best && best !== server) setServerTransient(best);
  }, [scanQuery.data, healthMap, candidates, server, setServerTransient]);

  const provider = getProvider(server);
  const embedUrl = getEmbedUrl(server, mediaType, watchId, isTv ? season : undefined, isTv ? episode : undefined);
  // The overlay shows until the iframe for the *current* URL + refresh nonce reports onLoad.
  const iframeReady = loaded?.url === embedUrl && loaded?.nonce === nonce;

  // ---------------------------------------------------------------------------
  // Auto-failover watchdog — if the iframe for the active URL never reports
  // onLoad, that source is dead for this browser: silently move to the next
  // scan-ranked candidate until something plays or every source is tried.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (watchId === 0) return;
    const timer = setTimeout(() => {
      if (manualPickRef.current) return;
      if (loaded?.url === embedUrl && loaded?.nonce === nonce) return; // playing fine
      if (!scanQuery.data) return; // scan still running — give it a chance

      if (!triedRef.current.includes(server)) {
        triedRef.current = [...triedRef.current, server];
      }
      const nextId = candidates.find((id) => id !== server && !triedRef.current.includes(id));
      const total = Math.max(candidates.length, PROVIDERS.length);

      if (nextId) {
        setFailover({
          forUrl: embedUrl,
          fromName: provider.name,
          toId: nextId,
          tried: triedRef.current.length,
          total,
        });
        setServerTransient(nextId);
        toast(`${getProvider(nextId).name} takes over`, {
          description: `${provider.name} didn't respond — auto-switched sources.`,
        });
      } else {
        setFailover({ forUrl: embedUrl, fromName: provider.name, toId: null, tried: triedRef.current.length, total });
        toast.error('No source responded', {
          description: 'Every stream source timed out. Hit Reload to retry or pick a server manually.',
        });
      }
    }, FAILOVER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [embedUrl, nonce, loaded, scanQuery.data, candidates, server, provider.name, watchId, setServerTransient]);

  const navigateTo = (nextSeason: number, nextEpisode: number) => {
    const params = new URLSearchParams({
      type: mediaType,
      s: String(Math.max(1, nextSeason)),
      e: String(Math.max(1, nextEpisode)),
    });
    if (imdbId) params.set('imdb', imdbId);
    else params.set('id', String(tmdbId));
    router.replace(`/?${params.toString()}`, { scroll: false });
  };

  const title = details?.title ?? (hasKey && detailsLoading ? '' : imdbId ?? `TMDB #${tmdbId}`);
  const year = details ? yearOf(details.releaseDate) : '';

  const maxEpisode = episodes.length > 0 ? episodes[episodes.length - 1].episodeNumber : null;

  return (
    <section aria-label="Player" className="relative">
      {/* Ambient amber glow behind the player */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 left-1/2 -z-10 h-48 w-[42rem] max-w-full -translate-x-1/2 rounded-full bg-amber-400/10 blur-3xl"
      />

      {/* Heading + badges */}
      <div className="mb-4">
        {(hasKey || !imdbId) && detailsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-72 rounded-lg bg-zinc-200 dark:bg-zinc-900" />
            <Skeleton className="h-5 w-44 rounded-md bg-zinc-200 dark:bg-zinc-900" />
          </div>
        ) : (
          <>
            <h1 className="flex flex-wrap items-baseline gap-x-3 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-100">
              {title || <span className="inline-block h-8 w-56 animate-pulse rounded bg-zinc-200 dark:bg-zinc-900" />}
              {year && <span className="text-lg font-normal text-zinc-500">{year}</span>}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {details && details.voteAverage > 0 && (
                <Badge className="gap-1 border-amber-400/30 bg-amber-400/10 text-amber-600 hover:bg-amber-400/10 dark:text-amber-300">
                  <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden />
                  {details.voteAverage.toFixed(1)}
                </Badge>
              )}
              {details?.runtime ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-zinc-300 bg-transparent text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                >
                  <Clock className="size-3" aria-hidden />
                  {formatRuntime(details.runtime)}
                </Badge>
              ) : null}
              {details?.genres.slice(0, 3).map((genre) => (
                <Badge
                  key={genre}
                  variant="outline"
                  className="border-zinc-300 bg-transparent text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                >
                  {genre}
                </Badge>
              ))}
              {!hasKey && !imdbId && (
                <span className="text-xs text-zinc-500 dark:text-zinc-600">
                  Connect a TMDB key to see titles, ratings and genres here.
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Server tabs + tools */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Streaming servers"
          className="flex flex-wrap items-center gap-1.5 rounded-xl border border-zinc-200 bg-white/70 p-1.5 dark:border-zinc-800/60 dark:bg-zinc-900/60"
        >
          {PROVIDERS.map((p) => {
            const active = p.id === server;
            const health = healthMap.get(p.id);
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  manualPickRef.current = true;
                  setServer(p.id);
                }}
                className={
                  'flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 ' +
                  (active
                    ? 'bg-amber-400 text-zinc-950'
                    : 'text-zinc-600 hover:bg-zinc-200/80 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100')
                }
              >
                <span
                  aria-hidden
                  title={
                    health === undefined
                      ? 'Source not scanned yet'
                      : health === true
                        ? 'Source responded'
                        : health === 'unknown'
                          ? 'Source blocked the scan (may still work)'
                          : 'Source did not respond'
                  }
                  className={
                    'size-1.5 shrink-0 rounded-full ' +
                    (health === undefined
                      ? 'bg-zinc-400/60 dark:bg-zinc-600'
                      : health === true
                        ? 'bg-emerald-500'
                        : health === 'unknown'
                          ? 'bg-amber-400'
                          : 'bg-red-500')
                  }
                />
                {p.name}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Source scan status + rescan */}
          <span
            role="status"
            aria-live="polite"
            className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/70 px-3 text-xs text-zinc-600 dark:border-zinc-800/60 dark:bg-zinc-900/60 dark:text-zinc-400"
          >
            <Radar
              className={'size-3.5 text-amber-500 dark:text-amber-400' + (scanQuery.isFetching && !scanQuery.data ? ' animate-pulse' : '')}
              aria-hidden
            />
            {scanQuery.isFetching && !scanQuery.data
              ? 'Scanning sources…'
              : scanQuery.data
                ? onlineCount > 0
                  ? `${onlineCount}/${scanQuery.data.length} online — auto-picked ${provider.name}`
                  : 'No source responded yet'
                : 'Source scan'}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Rescan sources"
            title="Rescan sources"
            onClick={() => scanQuery.refetch()}
            className="h-9 gap-1.5 rounded-lg px-3 text-xs text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
          >
            <RotateCw className={'size-3.5' + (scanQuery.isFetching ? ' animate-spin' : '')} aria-hidden />
            <span className="hidden sm:inline">Rescan</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Open ${provider.name} in a new tab`}
            title={`Open ${provider.name} in a new tab`}
            onClick={() => window.open(embedUrl, '_blank', 'noopener,noreferrer')}
            className="h-9 gap-1.5 rounded-lg px-3 text-xs text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">New tab</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Reload the player"
            title="Reload the player"
            onClick={() => setNonce((n) => n + 1)}
            className="h-9 gap-1.5 rounded-lg px-3 text-xs text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
          >
            <RotateCw className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Reload</span>
          </Button>
        </div>
      </div>

      {/* TV season / episode controls */}
      {isTv && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {hasKey && tvDetails ? (
            <Select
              value={String(season)}
              onValueChange={(v) => navigateTo(Number(v), 1)}
              aria-label="Select season"
            >
              <SelectTrigger className="h-10 w-36 rounded-lg border-zinc-200 bg-white/80 text-sm text-zinc-800 focus-visible:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200">
                <SelectValue placeholder="Season" />
              </SelectTrigger>
              <SelectContent className="z-[60] max-h-72 border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
                {tvDetails.seasons
                  .filter((s) => s.seasonNumber >= 1)
                  .map((s) => (
                    <SelectItem
                      key={s.seasonNumber}
                      value={String(s.seasonNumber)}
                      className="focus:bg-zinc-200/80 focus:text-zinc-900 dark:focus:bg-zinc-800/80 dark:focus:text-zinc-100"
                    >
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ) : (
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              Season
              <Input
                inputMode="numeric"
                value={String(season)}
                onChange={(e) => {
                  const v = Number(e.target.value.replace(/[^\d]/g, ''));
                  if (v > 0) navigateTo(v, episode);
                }}
                className="h-10 w-16 rounded-lg border-zinc-200 bg-white/80 text-center font-mono text-sm text-zinc-800 focus-visible:border-amber-400/60 focus-visible:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200"
                aria-label="Season number"
              />
            </label>
          )}

          {hasKey && episodes.length > 0 ? (
            <Select
              value={String(episode)}
              onValueChange={(v) => navigateTo(season, Number(v))}
              aria-label="Select episode"
            >
              <SelectTrigger className="h-10 w-56 rounded-lg border-zinc-200 bg-white/80 text-sm text-zinc-800 focus-visible:ring-amber-400/20 sm:w-72 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200">
                <SelectValue placeholder="Episode" />
              </SelectTrigger>
              <SelectContent className="z-[60] max-h-72 border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
                {episodes.map((ep) => (
                  <SelectItem
                    key={ep.episodeNumber}
                    value={String(ep.episodeNumber)}
                    className="focus:bg-zinc-200/80 focus:text-zinc-900 dark:focus:bg-zinc-800/80 dark:focus:text-zinc-100"
                  >
                    <span className="line-clamp-1">
                      E{ep.episodeNumber} · {ep.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              Episode
              <Input
                inputMode="numeric"
                value={String(episode)}
                onChange={(e) => {
                  const v = Number(e.target.value.replace(/[^\d]/g, ''));
                  if (v > 0) navigateTo(season, v);
                }}
                className="h-10 w-16 rounded-lg border-zinc-200 bg-white/80 text-center font-mono text-sm text-zinc-800 focus-visible:border-amber-400/60 focus-visible:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200"
                aria-label="Episode number"
              />
            </label>
          )}

          {hasKey && episodes.length === 0 && seasonQuery.isFetching && (
            <Loader2 className="size-4 animate-spin text-zinc-500 dark:text-zinc-600" aria-label="Loading episodes" />
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Previous episode"
              disabled={episode <= 1}
              onClick={() => navigateTo(season, Math.max(1, episode - 1))}
              className="size-9 rounded-lg border-zinc-200 bg-white/70 text-zinc-700 hover:bg-zinc-200 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Next episode"
              disabled={maxEpisode !== null && episode >= maxEpisode}
              onClick={() => navigateTo(season, episode + 1)}
              className="h-9 gap-1 rounded-lg border-zinc-200 bg-white/70 px-3 text-xs text-zinc-700 hover:bg-zinc-200 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Next
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {/* Player iframe */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-200 bg-black dark:border-zinc-800">
        <iframe
          key={`${embedUrl}#${nonce}`}
          src={embedUrl}
          title={`${title || `TMDB #${tmdbId}`} — ${provider.name} player`}
          allowFullScreen
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          // Sandbox keeps the provider functional (scripts, storage, forms) while
          // blocking pop-up ads and top-level redirects to random ad pages.
          sandbox="allow-scripts allow-same-origin allow-forms"
          scrolling="no"
          onLoad={() => {
            setLoaded({ url: embedUrl, nonce });
            setFailover(null);
          }}
          className="absolute inset-0 size-full border-0"
        />
        {!iframeReady && (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-50/85 px-6 text-center backdrop-blur-sm dark:bg-zinc-950/85"
          >
            {failover?.forUrl === embedUrl && failover.toId === null ? (
              <>
                <span className="flex size-14 items-center justify-center rounded-full bg-red-400/10">
                  <Unplug className="size-6 text-red-500 dark:text-red-400" aria-hidden />
                </span>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">No source responded</p>
                <p className="max-w-sm text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                  All {failover.total} stream sources timed out for this title. Hit Reload to retry,
                  or pick a server above — some sources block datacenter scans but work in browsers.
                </p>
              </>
            ) : (
              <>
                <span className="flex size-14 items-center justify-center rounded-full bg-amber-400/10">
                  <Loader2 className="size-6 animate-spin text-amber-500 dark:text-amber-400" aria-hidden />
                </span>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {failover?.forUrl === embedUrl && failover.toId
                    ? `Auto-switched to ${getProvider(failover.toId).name}…`
                    : `Connecting to ${provider.name}…`}
                </p>
                {failover?.forUrl === embedUrl && failover.toId ? (
                  <p className="font-mono text-[11px] text-zinc-500 dark:text-zinc-600">
                    {failover.fromName} timed out · attempt {failover.tried + 1}/{failover.total}
                  </p>
                ) : (
                  <p className="font-mono text-xs text-zinc-500 dark:text-zinc-600">
                    {imdbId ?? `TMDB ${tmdbId}`}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-600">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          CineDeck scans every source, plays the healthiest one and auto-switches if a source
          stalls. Subtitles, audio &amp; quality live in the player's own ⚙ / CC menu.
        </span>
      </p>
    </section>
  );
}
