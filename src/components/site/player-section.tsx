'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FastForward,
  Fullscreen,
  Info,
  Languages,
  Loader2,
  Maximize2,
  Minimize,
  Minimize2,
  MapPin,
  Radar,
  RotateCw,
  ShoppingCart,
  SkipForward,
  Star,
  Unplug,
  X,
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
import { Fragment } from 'react';
import { useSeason, useHistory } from '@/hooks/use-media';
import { useServerScan, useTvmazeShow } from '@/hooks/use-meta';
import { PROVIDERS, PROVIDER_GROUPS, getProvider, getEmbedUrl, supportsDub, dubCodeOf, isProven, reliabilityRank, captionQualityOf } from '@/lib/providers';
import type { ScanResult } from '@/lib/meta';
import { saveHistoryProgress } from '@/lib/tmdb';
import { tmdbImg } from '@/lib/languages';
import { useCinedeckStore } from '@/lib/store';
import { useSettings } from '@/lib/settings';
import { PlayerSettingsMenu } from '@/components/site/player-settings';
import { formatRuntime, yearOf, type MediaDetails, type MediaType, type TvDetails } from '@/lib/tmdb';

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
  // Playback preferences (auto-pick / auto-failover / stall timeout).
  const settings = useSettings();
  const [theater, setTheater] = useState(false);
  // Fullscreen on the player box itself (F key / button) — cross-origin
  // embeds can't be commanded, but the surrounding box CAN be fullscreened
  // via the Fullscreen API, which zooms the whole iframe to the screen.
  const playerBoxRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = useCallback(() => {
    const el = playerBoxRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void el.requestFullscreen().catch(() =>
        toast.error('Fullscreen was blocked by the browser'),
      );
    }
  }, []);
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  /** Timed "Skip intro" affordance — visible during the 0:30–2:30 window. */
  const [showSkipIntro, setShowSkipIntro] = useState(false);
  const skipIntroFiredRef = useRef('');
  /** Blurred poster shown behind the player loading overlay. */
  const loadingPoster =
    details?.posterPath && !details.posterPath.startsWith('http')
      ? tmdbImg(details.posterPath, 'w500')
      : (details?.posterPath ?? null);
  /** 2-letter dub code when the user wants dubbed audio (null = original). */
  const dubLang = dubCodeOf(settings.dubLanguage);

  const tvDetails = details && details.mediaType === 'tv' ? (details as TvDetails) : undefined;
  const isTv = mediaType === 'tv';
  const watchId: number | string = imdbId ?? tmdbId ?? 0;

  const seasonQuery = useSeason(tmdbId ?? 0, season, language, hasKey && isTv && !imdbId);
  // Stored watch history — seeds the resume counter (see tracker below).
  const historyQuery = useHistory();
  const episodes = useMemo(() => seasonQuery.data?.episodes ?? [], [seasonQuery.data]);

  // TVmaze — the second keyless source. In IMDB watch mode it powers real
  // season/episode menus (episode names!) without any TMDB key.
  const tvmazeQuery = useTvmazeShow(isTv && imdbId ? imdbId : null, isTv && imdbId !== undefined);
  const tvmazeEpisodes = useMemo(() => tvmazeQuery.data?.episodes ?? [], [tvmazeQuery.data]);
  const tvmazeSeasons = useMemo(() => {
    const set = new Set<number>();
    for (const e of tvmazeEpisodes) if (e.season >= 1) set.add(e.season);
    return [...set].sort((a, b) => a - b);
  }, [tvmazeEpisodes]);
  const tvmazeSeasonEpisodes = useMemo(
    () => tvmazeEpisodes.filter((e) => e.season === season),
    [tvmazeEpisodes, season],
  );

  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<{ url: string; nonce: number } | null>(null);
  /** Auto-failover bookkeeping for the iframe currently on screen. */
  const [failover, setFailover] = useState<FailoverState | null>(null);

  // ---------------------------------------------------------------------------
  // Source scan — probe every provider for this title, rank them and auto-play
  // the healthiest one. A manual server pick always wins over auto-selection.
  // ---------------------------------------------------------------------------
  const scanQuery = useServerScan(
    { imdb: imdbId ?? null, tmdb: tmdbId ?? null, mediaType, season, episode, dub: dubLang },
    watchId !== 0,
  );
  const manualPickRef = useRef(false);
  /**
   * Mirror of manualPickRef for rendering (status line wording). Keyed by
   * title+season+episode so the derived flag expires exactly when the ref
   * resets — no setState-in-effect needed.
   */
  const [manualPickKey, setManualPickKey] = useState<string | null>(null);
  const watchKey = `${imdbId ?? `t${tmdbId ?? 0}`}:${season}:${episode}`;
  const manualPick = manualPickKey !== null && manualPickKey === watchKey;
  const rememberManualPick = useCallback(() => setManualPickKey(watchKey), [watchKey]);
  /**
   * Dub-capable sources that already failed for THIS title this session
   * (user skipped away from them) — the FI dub chip won't re-offer those.
   * Keyed "${watchId}:${providerId}".
   */
  const [failedDubs, setFailedDubs] = useState<Set<string>>(() => new Set());
  const markDubFailed = useCallback(
    (providerId: string) => {
      setFailedDubs((prev) => {
        const next = new Set(prev);
        next.add(`${watchId}:${providerId}`);
        return next.size === prev.size ? prev : next;
      });
    },
    [watchId],
  );
  /** Provider ids the watchdog has already tried for the current title/episode. */
  const triedRef = useRef<string[]>([]);
  /**
   * Auto-pick preference latch — the proven↔caption and unproven↔proven
   * handoffs must run AT MOST ONCE per title/episode, or the effect would
   * ping-pong forever (A hands to B, B's rule hands back to A, …) and React
   * kills the component with "Maximum update depth exceeded". Dead-source
   * recovery intentionally ignores this latch.
   */
  const autoPickLatchRef = useRef<string | null>(null);
  /** Anti-flap throttle for the mid-playback death watch (ms of last auto-switch). */
  const lastDeathSwitchAtRef = useRef(0);
  /** How many fresh-lap recoveries ran for the current title/episode (capped). */
  const recoveryLapsRef = useRef(0);

  useEffect(() => {
    manualPickRef.current = false;
    triedRef.current = [];
    lastDeathSwitchAtRef.current = 0;
    recoveryLapsRef.current = 0;
    autoPickLatchRef.current = null;
  }, [imdbId, tmdbId, season, episode]);

  const healthMap = useMemo(() => {
    // true = responded ok, 'unknown' = 403 (Cloudflare may still let browsers
    // through — probe is bot-blocked), false = clearly unreachable/error page.
    const map = new Map<string, boolean | 'unknown'>();
    for (const r of scanQuery.data ?? []) map.set(r.providerId, r.ok ? true : r.status === 403 ? 'unknown' : false);
    return map;
  }, [scanQuery.data]);
  // Finnish-audio CONFIRMATION map — true only for sources whose scan row says
  // finnishAudioConfirmed (real manifest/content-language validation or the
  // admin allowlist). Metadata claims ("supports dubbing") never count, so
  // every FI indicator below is gated on this instead.
  const confirmedMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const r of scanQuery.data ?? []) map.set(r.providerId, r.finnishAudioConfirmed === true);
    return map;
  }, [scanQuery.data]);
  const finnishActive = dubLang === 'fi';
  // FI unavailable = the user asked for Finnish AND the finished scan found no
  // source with confirmed Finnish audio (pending scan keeps options open).
  const finnishUnavailable =
    finnishActive && scanQuery.isSuccess && !(scanQuery.data ?? []).some((r) => r.finnishAudioConfirmed);
  const onlineCount = useMemo(
    () => (scanQuery.data ?? []).filter((r) => r.ok).length,
    [scanQuery.data],
  );

  // ---------------------------------------------------------------------------
  // "Where to watch" — the honest fallback when no embed carries the title.
  // Small/national productions (Finnish films, Nordic series) are frequently
  // missing from the free embed catalogs, and several families answer 200 for
  // ANY id (the player shell just says "not found" inside the iframe), so the
  // scan alone can't prove absence. Two triggers:
  //   1. scan finished and EVERY row verifiably failed (vidlink's honest 500s
  //      count as proof; 403 "unknown" rows don't — CF may still let browsers in)
  //   2. the user opens the panel via the "Where to watch" tool button.
  // The panel offers Yle Areena (free, Finland), JustWatch (legal services)
  // and Google — plus "Try anyway" to dismiss and keep the current source.
  // ---------------------------------------------------------------------------
  const [whereOpen, setWhereOpen] = useState(false);
  const scanRows = scanQuery.data ?? [];
  const scanDone = scanRows.length > 0 && !scanQuery.isFetching;
  const nothingIndexed = useMemo(
    () =>
      scanDone &&
      scanRows.length > 0 &&
      scanRows.every((r) => !r.ok && r.status !== 403),
    [scanDone, scanRows],
  );

  /**
   * Auto-play order — health/trust mixed:
   *   1. online proven + maybe mirrors (.cc/.skin/.sh/.su, fastest first)
   *   2. bot-blocked "unknown" (VidSrc.cc — CF wall for probes, often plays)
   *   3. online last-resort (Videasy — probes ok but black-screen-prone)
   *   4. dead rows
   * A 200 probe is NOT proof of playback, so an online last-resort source
   * ranks BELOW a bot-blocked mirror.
   *
   * With settings.preferCaptionSources, ONLINE rows additionally sort
   * caption-friendly modern players (VidFast/VidLink/VidZee — real CC menus)
   * ahead of the superembed family (2Embed/VidSrc — subs missing/laggy)
   * within the same health tier. Dead rows never benefit.
   */
  const candidates = useMemo(() => {
    const captionBoost = (id: string) =>
      settings.preferCaptionSources && captionQualityOf(id) === 'good' ? 0 : 1;
    const weight = (r: ScanResult) =>
      r.ok
        ? reliabilityRank(r.providerId) < 2
          ? 0
          : 2
        : r.status === 403
          ? 1
          : 3;
    return [...(scanQuery.data ?? [])]
      .sort(
        (a, b) =>
          weight(a) - weight(b) ||
          captionBoost(a.providerId) - captionBoost(b.providerId) ||
          reliabilityRank(a.providerId) - reliabilityRank(b.providerId) ||
          a.ms - b.ms,
      )
      .map((r) => r.providerId);
  }, [scanQuery.data, settings.preferCaptionSources]);

  /**
   * The scan outranked the current server → move on (unless the user picked
   * manually or disabled auto-pick in playback settings).
   *
   * Three triggers:
   *  1. the current source is DEAD (health=false) → best candidate takes over;
   *  2. the current source is alive but UNPROVEN (e.g. persisted Videasy that
   *     probes ok yet shows a black screen) → hand autoplay back to the best
   *     PROVEN mirror that responded;
   *  3. caption preference is ON and the current source is proven but has
   *     flaky subs (superembed family) while an online caption-friendly
   *     candidate exists → subtitles beat legacy trust (the #1 complaint).
   */
  useEffect(() => {
    if (!settings.autoPickSource) return;
    if (!scanQuery.data || manualPickRef.current) return;
    const currentHealth = healthMap.get(server);
    if (currentHealth === false) {
      // DEAD source — always recovers, latch never blocks this trigger.
      const best = candidates[0];
      if (best && best !== server) {
        autoPickLatchRef.current = watchKey;
        setServerTransient(best);
        toast(`${getProvider(best).name} takes over`, {
          description: `${getProvider(server).name} didn't respond — auto-switched sources.`,
        });
      }
      return;
    }
    // Preference handoffs (caption / unproven→proven) run once per watch —
    // without the latch the two rules would fight in an infinite setState loop.
    if (autoPickLatchRef.current === watchKey) return;
    const captionMode = settings.preferCaptionSources;
    const captionBetter =
      captionMode &&
      captionQualityOf(server) !== 'good' &&
      candidates.some((id) => captionQualityOf(id) === 'good' && healthMap.get(id) !== false);
    if (isProven(server) && !captionBetter) return;
    if (!isProven(server) && !captionBetter) {
      // Alive but unproven (Videasy persisted before trust tiers) — the proven
      // pool still wins UNLESS the caption preference outranks it.
      const bestProven = candidates.find((id) => isProven(id) && healthMap.get(id) !== false);
      if (bestProven && bestProven !== server) {
        autoPickLatchRef.current = watchKey;
        setServerTransient(bestProven);
        toast(`${getProvider(bestProven).name} takes over`, {
          description: `${getProvider(server).name} loads but isn't a proven player — the tested pool plays first.`,
        });
      }
      return;
    }
    // Caption-driven handoff: best ONLINE caption-friendly candidate.
    const bestCaption = candidates.find(
      (id) => captionQualityOf(id) === 'good' && healthMap.get(id) !== false,
    );
    if (bestCaption && bestCaption !== server) {
      autoPickLatchRef.current = watchKey;
      setServerTransient(bestCaption);
      toast(`${getProvider(bestCaption).name} takes over`, {
        description: `Playing a source with working subtitles — ${getProvider(server).name}'s captions are often broken. Toggle in Settings.`,
      });
    }
  }, [settings.autoPickSource, settings.preferCaptionSources, scanQuery.data, healthMap, candidates, server, setServerTransient, watchKey]);

  const provider = getProvider(server);
  const builtUrl = getEmbedUrl(server, mediaType, watchId, isTv ? season : undefined, isTv ? episode : undefined, dubLang);
  // Prefer the scan-VERIFIED url. The scan tries every provider under BOTH id
  // forms (IMDB + TMDB) — rare titles (Finnish films, Nordic series) are often
  // indexed under only one of them, and the form that answered may be the one
  // we would never build from the primary watch id. Loading the probed URL
  // verbatim guarantees the player opens exactly what the scan proved alive.
  const scannedUrl = useMemo(
    () =>
      (scanQuery.data ?? []).find((r) => r.providerId === server && r.ok && r.url)?.url ?? null,
    [scanQuery.data, server],
  );
  const embedUrl = scannedUrl ?? builtUrl;
  // The player iframe is loaded via /api/player-proxy — a wrapper page that
  // contains the real provider iframe WITHOUT sandbox. The OUTER iframe
  // (this one) is sandboxed, which blocks pop-ups and top-level redirects
  // (random ad pages) while letting 2Embed and friends play normally —
  // providers detect iframe[sandbox] on window.frameElement, and since the
  // proxy's inner iframe is cross-origin with the proxy page itself,
  // window.frameElement is null in the provider's window, so the check
  // passes. The inner iframe inherits the outer sandbox's navigation /
  // pop-up restrictions.
  const proxyUrl = `/api/player-proxy?u=${encodeURIComponent(embedUrl)}`;
  // The overlay shows until the iframe for the *current* URL + refresh nonce reports onLoad.
  const iframeReady = loaded?.url === embedUrl && loaded?.nonce === nonce;

  // "Where to watch" visibility — pure derivation, no effect needed: a manual
  // open collapses automatically once a source actually plays while mirrors
  // are online; the scan-ruled-out trigger stands on its own unless the user
  // dismissed it for this exact title/episode ("Try anyway").
  const wherePanelActive = whereOpen && !(iframeReady && onlineCount > 0);
  const [whereDismissedKey, setWhereDismissedKey] = useState<string | null>(null);
  const nothingIndexedActive = nothingIndexed && whereDismissedKey !== watchKey;
  const showWhereToWatch = wherePanelActive || nothingIndexedActive;
  const dismissWherePanel = () => {
    setWhereOpen(false);
    setWhereDismissedKey(watchKey);
  };

  // Listen for the inner provider iframe's onload postMessage — the outer
  // iframe's onLoad fires as soon as the proxy HTML loads (which is fast
  // since it's just a tiny wrapper), so it can't be trusted as the real
  // "player is playing" signal. The postMessage arrives when the inner
  // provider iframe actually finishes loading.
  //
  // SECOND-LOAD DEATH SIGNAL: the same ready message arriving AGAIN while
  // this URL+nonce was already marked loaded means the provider page
  // re-navigated itself mid-play (error page retry, Cloudflare re-challenge,
  // crash reload — the classic "stream just stops" inside 2Embed/VidSrc).
  // The scan still reports such sources as online, so the death-watch below
  // can't see them — this is the only reliable signal we get across the
  // cross-origin boundary. Bumped into `midPlayReloads` state and handled by
  // its own effect (same failover shape as the watchdogs).
  const loadedAtRef = useRef(0);
  const [midPlayReloads, setMidPlayReloads] = useState(0);
  useEffect(() => {
    if (watchId === 0) return;
    loadedAtRef.current = 0;
    const handler = (event: MessageEvent) => {
      // Only accept messages from CineDeck's own origin — the proxy page
      // is served from /api/player-proxy (same origin) and inherits our
      // origin thanks to allow-same-origin on the outer sandbox.
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== 'cinedeck:player-loaded') return;
      if (data.url && decodeURIComponent(data.url) !== embedUrl) return;
      setLoaded({ url: embedUrl, nonce });
      setFailover(null);
      if (loadedAtRef.current === 0) {
        loadedAtRef.current = Date.now();
      } else if (Date.now() - loadedAtRef.current > 10_000) {
        // Already playing this exact source for 10s+ and it JUST reloaded —
        // playback died. (Fires <10s apart are init double-taps, ignored.)
        loadedAtRef.current = Date.now();
        setMidPlayReloads((n) => n + 1);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [embedUrl, nonce, watchId]);

  // ---------------------------------------------------------------------------
  // Auto-failover watchdog — if the iframe for the active URL never reports
  // onLoad, that source is dead for this browser: silently move to the next
  // scan-ranked candidate until something plays or every source is tried.
  // Can be disabled + tuned (stall timeout) in playback settings.
  // ---------------------------------------------------------------------------
  const failoverTimeoutMs = settings.failoverSeconds * 1000;
  useEffect(() => {
    if (watchId === 0 || !settings.autoFailover) return;
    const timer = setTimeout(() => {
      if (manualPickRef.current) return;
      if (loaded?.url === embedUrl && loaded?.nonce === nonce) return; // playing fine
      if (!scanQuery.data) return; // scan still running — give it a chance

      if (!triedRef.current.includes(server)) {
        triedRef.current = [...triedRef.current, server];
      }
      // Leaving a dub-capable source that never loaded counts as a dub failure.
      if (dubLang && supportsDub(server)) markDubFailed(server);
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
          description: 'Every stream source timed out. We retry the pool automatically — or pick a server manually.',
        });
      }
    }, failoverTimeoutMs);
    return () => clearTimeout(timer);
  }, [embedUrl, nonce, loaded, scanQuery.data, candidates, server, provider.name, watchId, setServerTransient, settings.autoFailover, failoverTimeoutMs, dubLang, markDubFailed]);

  // ---------------------------------------------------------------------------
  // Mid-playback DEATH WATCH — the fix for "streams randomly stop midway".
  // The load watchdog above only covers "the iframe never reported onLoad";
  // once a source is playing, a cross-origin iframe gives NO signal when its
  // stream dies (the user just sees a frozen player forever). The scan now
  // refetches every 45s, so when the ACTIVE source flips to health=false
  // (verifiably dead upstream) while it was playing, switch to the best
  // still-alive candidate. Manual picks are deliberately covered too —
  // recovering a dead stream is not an auto-pick re-run, it's the whole point.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (watchId === 0 || !settings.autoFailover) return;
    if (!scanQuery.data) return;
    // Non-manual sources are owned by the auto-pick effect — unless auto-pick
    // is disabled, in which case this death watch is the only recovery left.
    if (!manualPickRef.current && settings.autoPickSource) return;
    if (!iframeReady) return; // only recover streams that WERE playing
    if (healthMap.get(server) !== false) return; // alive or unknown (403) — can't judge
    if (Date.now() - lastDeathSwitchAtRef.current < 20_000) return; // anti-flap
    // Switch deferred to a timer (same shape as the load watchdog): keeps the
    // effect itself free of synchronous setStates.
    const timer = setTimeout(() => {
      lastDeathSwitchAtRef.current = Date.now();
      if (!triedRef.current.includes(server)) {
        triedRef.current = [...triedRef.current, server];
      }
      if (dubLang && supportsDub(server)) markDubFailed(server);
      // Best candidate that isn't the dead source or an already-failed try.
      const nextId = candidates.find((id) => id !== server && !triedRef.current.includes(id));
      const total = Math.max(candidates.length, PROVIDERS.length);
      setFailover({
        forUrl: embedUrl,
        fromName: provider.name,
        toId: nextId ?? null,
        tried: triedRef.current.length,
        total,
      });
      if (nextId) {
        setServerTransient(nextId);
        toast(`${getProvider(nextId).name} takes over`, {
          description: `${provider.name} went down mid-playback — auto-switched sources.`,
        });
      } else {
        toast.error('Source went down', {
          description: `${provider.name} died mid-playback and every other try failed too. Hit Reload to start over.`,
        });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [
    watchId,
    settings.autoFailover,
    settings.autoPickSource,
    scanQuery.data,
    iframeReady,
    healthMap,
    candidates,
    server,
    provider.name,
    embedUrl,
    setServerTransient,
    dubLang,
    markDubFailed,
  ]);

  // ---------------------------------------------------------------------------
  // MID-PLAY RELOAD failover — acts on the second-load death signal above.
  // A provider page that re-navigates itself after 10s+ of "playing" is a
  // stream that died for THIS user while the upstream still looks healthy —
  // exactly the "randomly stops midway" case none of the other watchdogs can
  // see. Same recovery shape as the death watch: mark tried, switch to the
  // best untried candidate, anti-flap throttled. Manual picks included.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (watchId === 0 || midPlayReloads === 0 || !settings.autoFailover) return;
    if (!iframeReady) return; // a fresh source is still connecting — let it
    if (Date.now() - lastDeathSwitchAtRef.current < 20_000) return; // anti-flap
    const timer = setTimeout(() => {
      lastDeathSwitchAtRef.current = Date.now();
      if (!triedRef.current.includes(server)) {
        triedRef.current = [...triedRef.current, server];
      }
      if (dubLang && supportsDub(server)) markDubFailed(server);
      const nextId = candidates.find((id) => id !== server && !triedRef.current.includes(id));
      const total = Math.max(candidates.length, PROVIDERS.length);
      setFailover({
        forUrl: embedUrl,
        fromName: provider.name,
        toId: nextId ?? null,
        tried: triedRef.current.length,
        total,
      });
      if (nextId) {
        setServerTransient(nextId);
        toast(`${getProvider(nextId).name} takes over`, {
          description: `${provider.name} reloaded mid-playback (stream died) — auto-switched sources.`,
        });
      } else {
        toast.error('Stream dropped', {
          description: `${provider.name} died mid-playback and every other try failed too. Hit Reload to start over.`,
        });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [
    watchId,
    midPlayReloads,
    settings.autoFailover,
    iframeReady,
    candidates,
    server,
    provider.name,
    embedUrl,
    setServerTransient,
    dubLang,
    markDubFailed,
  ]);

  // ---------------------------------------------------------------------------
  // Fresh-lap recovery — when the watchdog exhausts every candidate (failover
  // reports toId: null), don't leave a permanent dead end: after a cooldown,
  // forget the tried list and refetch the scan. A CDN blip that killed the
  // whole pool usually heals within a minute, so the player gets a second
  // lap (capped at two laps, then it stays quiet for the title).
  // ---------------------------------------------------------------------------
  const exhausted = failover !== null && failover.forUrl === embedUrl && failover.toId === null;
  useEffect(() => {
    if (!exhausted || watchId === 0) return;
    if (recoveryLapsRef.current >= 2) return;
    const lap = recoveryLapsRef.current;
    const timer = setTimeout(() => {
      recoveryLapsRef.current = lap + 1;
      triedRef.current = [];
      setFailover(null);
      void scanQuery.refetch();
      toast('Retrying sources', {
        description: 'Starting a fresh pass — earlier timeouts may have recovered.',
      });
    }, 60_000);
    return () => clearTimeout(timer);
    // scanQuery.refetch is stable in React Query v5 — excluded so in-flight
    // refetches don't reset the cooldown timer.
  }, [exhausted, watchId, embedUrl]);

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

  // Max episode for the Next button — TMDB data when present, TVmaze otherwise.
  const maxEpisode =
    episodes.length > 0
      ? episodes[episodes.length - 1].episodeNumber
      : tvmazeSeasonEpisodes.length > 0
        ? tvmazeSeasonEpisodes[tvmazeSeasonEpisodes.length - 1].number
        : null;

  /** Jump to the next candidate source — shared by the Skip button + "S" key. */
  const skipSource = useCallback(() => {
    // Follow the full scan-ranked order (online proven → online mirrors →
    // bot-blocked → dead). Without scan data, cycle through PROVIDERS as-is.
    const order =
      scanQuery.data && candidates.length > 0 ? candidates : PROVIDERS.map((p) => p.id);
    const currentIdx = order.indexOf(server);
    const nextId = order[(currentIdx + 1) % order.length] ?? order[0];
    if (!nextId || nextId === server) {
      toast(`${provider.name} is the only option`, {
        description: 'Hit Rescan to re-probe all sources.',
      });
      return;
    }
    // Don't set manualPickRef — keep auto-failover enabled so if this new
    // source ALSO fails to load, the watchdog still cycles automatically.
    // Leaving a dub-capable source behind counts as a dub failure for it.
    if (dubLang && supportsDub(server)) markDubFailed(server);
    setServerTransient(nextId);
    setLoaded(null);
    setFailover(null);
    toast(`Switched to ${getProvider(nextId).name}`, {
      description: 'If it still shows an error, hit Skip again.',
    });
  }, [scanQuery.data, candidates, server, provider.name, setServerTransient, setLoaded, setFailover, dubLang, markDubFailed]);

  // ---------------------------------------------------------------------------
  // "Stuck?" escape hatch — a black-screen or provider error page still fires
  // onLoad, so the watchdog sees it as fine. After 15s on a loaded source,
  // float a small "Not playing? → next server" pill over the player. It stays
  // visible until dismissed or the source changes — a stream that dies 20
  // minutes in needs the one-tap escape THEN, not only during the first 45s.
  // Visibility is DERIVED from the URL the pill was shown for, so a source
  // switch clears it without renders.
  // ---------------------------------------------------------------------------
  const [stuckShownFor, setStuckShownFor] = useState<string | null>(null);
  const stuckDismissedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!iframeReady) return;
    const showT = setTimeout(() => {
      if (stuckDismissedRef.current !== embedUrl) setStuckShownFor(embedUrl);
    }, 15_000);
    return () => clearTimeout(showT);
  }, [iframeReady, embedUrl]);
  const stuckHint = iframeReady && stuckShownFor === embedUrl;

  const stuckDismiss = useCallback(() => {
    stuckDismissedRef.current = embedUrl;
    setStuckShownFor(null);
  }, [embedUrl]);

  /**
   * Dub-capable mirror that responded (ok preferred, then bot-blocked).
   * Sources the user already skipped away from for this title are excluded,
   * so a dead dub mirror isn't re-offered after it proved useless.
   * Finnish audio additionally REQUIRES a scan-confirmed source — when the
   * user selects FI on an unconfirmed source, the handoff moves them to the
   * best confirmed one first (switch source, then switch audio track).
   */
  const dubSource = useMemo(() => {
    if (!dubLang) return null;
    const rows = (scanQuery.data ?? []).filter(
      (r) =>
        supportsDub(r.providerId) &&
        !failedDubs.has(`${watchId}:${r.providerId}`) &&
        (!finnishActive || r.finnishAudioConfirmed === true),
    );
    return rows.find((r) => r.ok) ?? rows.find((r) => r.status === 403) ?? null;
  }, [scanQuery.data, dubLang, failedDubs, watchId, finnishActive]);

  const switchToDubSource = useCallback(() => {
    if (!dubSource) return;
    // Manual intent: auto-pick must not yank the user straight back.
    manualPickRef.current = true;
    rememberManualPick();
    setServerTransient(dubSource.providerId);
    setLoaded(null);
    setFailover(null);
    toast(`${getProvider(dubSource.providerId).name} · ${dubLang?.toUpperCase()} dub`, {
      description: finnishActive
        ? 'Switched to a source with Finnish audio'
        : 'Unproven source — use Skip / “Not playing?” if it stays blank.',
    });
  }, [dubSource, dubLang, finnishActive, setServerTransient, setLoaded, setFailover, rememberManualPick]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts — R reload · S skip source · T theater · N/P episodes.
  // Ignored while typing in inputs or when a dialog/popover has focus capture.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (watchId === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) return; // a dialog is open
      const key = event.key.toLowerCase();
      if (key === 'r') {
        event.preventDefault();
        setNonce((n) => n + 1);
      } else if (key === 's') {
        event.preventDefault();
        skipSource();
      } else if (key === 't') {
        event.preventDefault();
        setTheater((v) => !v);
      } else if (key === 'f') {
        event.preventDefault();
        toggleFullscreen();
      } else if (key === 'n' && isTv) {
        if (maxEpisode === null || episode < maxEpisode) navigateTo(season, episode + 1);
      } else if (key === 'p' && isTv) {
        if (episode > 1) navigateTo(season, episode - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // navigateTo closes over season/episode/mediaType + router — recreated each render.
     
  }, [watchId, isTv, season, episode, maxEpisode, skipSource, toggleFullscreen]);

  // ---------------------------------------------------------------------------
  // Watch-progress tracker — embed players are cross-origin so real playback
  // position is unknowable; we track wall-clock seconds the player has been
  // up (paused while the tab is hidden). Saved every 15s, on tab-hide and on
  // unmount via keepalive so closing the tab never loses the session.
  // ---------------------------------------------------------------------------
  const watchedSecondsRef = useRef(0);
  const lastSavedRef = useRef(0);
  const durationSeconds = useMemo(() => {
    if (details?.runtime && details.runtime > 0) return details.runtime * 60;
    const ep = isTv ? episodes.find((e) => e.episodeNumber === episode) : undefined;
    if (ep?.runtime && ep.runtime > 0) return ep.runtime * 60;
    const tvmazeEp = isTv ? tvmazeSeasonEpisodes.find((e) => e.number === episode) : undefined;
    if (tvmazeEp?.runtime && tvmazeEp.runtime > 0) return tvmazeEp.runtime * 60;
    return null;
  }, [details, isTv, episodes, episode, tvmazeSeasonEpisodes]);

  const flushProgress = useCallback(
    (invalidateHint?: boolean) => {
      if (watchId === 0) return;
      const positionSeconds = watchedSecondsRef.current;
      if (positionSeconds < 5) return; // bounces don't count as watching
      lastSavedRef.current = positionSeconds;
      if (tmdbId === undefined) return; // keyless IMDB mode is ephemeral
      saveHistoryProgress({
        tmdbId,
        mediaType,
        title: title || `TMDB #${tmdbId}`,
        posterPath: details?.posterPath ?? null,
        backdropPath: details?.backdropPath ?? null,
        imdbId: imdbId ?? null,
        season: mediaType === 'tv' ? season : null,
        episode: mediaType === 'tv' ? episode : null,
        positionSeconds,
        durationSeconds,
      });
      void invalidateHint;
    },
    [watchId, tmdbId, mediaType, title, details?.posterPath, details?.backdropPath, imdbId, season, episode, durationSeconds],
  );

  useEffect(() => {
    if (!iframeReady || watchId === 0) return;
    // Resume the counter per URL+episode, not per component.
    watchedSecondsRef.current = lastSavedRef.current;
    const interval = setInterval(() => {
      if (document.hidden) return; // tab in background — not watching
      watchedSecondsRef.current += 1;
      if (watchedSecondsRef.current - lastSavedRef.current >= 15) {
        flushProgress();
      }
      // Skip-intro window: 0:30–2:30 of watch time, feature-length content
      // only, once per title+episode.
      const siKey = `${watchId}:${season}:${episode}`;
      const watched = watchedSecondsRef.current;
      const inWindow =
        watched >= 30 &&
        watched < 150 &&
        skipIntroFiredRef.current !== siKey &&
        (durationSeconds == null || durationSeconds >= 420);
      setShowSkipIntro((prev) => (prev === inWindow ? prev : inWindow));
    }, 1000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushProgress();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      flushProgress(); // episode switch / unmount — persist what we have
    };
  }, [iframeReady, watchId, flushProgress, durationSeconds, season, episode]);

  /**
   * Skip intro — embeds can't be seeked cross-origin, so "skipping" advances
   * the watch-time tracker to the 2:30 mark (history, continue-watching and
   * the up-next logic all treat the intro as watched) and tells the user
   * honestly what happened.
   */
  const skipIntro = useCallback(() => {
    const siKey = `${watchId}:${season}:${episode}`;
    skipIntroFiredRef.current = siKey;
    setShowSkipIntro(false);
    const target = Math.max(watchedSecondsRef.current, 150);
    watchedSecondsRef.current = target;
    lastSavedRef.current = target;
    flushProgress();
    toast('Intro window skipped', {
      description: 'Embed sources cannot seek — watch tracking jumped to 2:30 so your progress stays accurate.',
    });
  }, [watchId, season, episode, flushProgress]);

  // Seed the watched counter from stored history when the title/episode
  // changes — progress accumulates across visits instead of resetting to
  // zero on every open (continue-watching keeps growing like a real
  // streaming service). Movies always resume; TV only when the stored row
  // is the same season/episode. Waits for the history query to settle so a
  // late-arriving duration/row can never wipe session progress mid-watch.
  const seededForRef = useRef('');
  useEffect(() => {
    const key = `${tmdbId ?? imdbId ?? 0}:${mediaType}:${season}:${episode}`;
    if (!(historyQuery.isSuccess || historyQuery.isError)) return; // wait for data
    if (seededForRef.current === key) return; // already seeded this watch
    seededForRef.current = key;
    watchedSecondsRef.current = 0;
    lastSavedRef.current = 0;
    skipIntroFiredRef.current = '';
    if (tmdbId === undefined) return; // keyless mode is ephemeral
    const row = historyQuery.data?.find(
      (h) =>
        h.tmdbId === tmdbId &&
        h.mediaType === mediaType &&
        (mediaType === 'movie' || (h.season === season && h.episode === episode)),
    );
    if (row && row.positionSeconds > 0) {
      watchedSecondsRef.current = row.positionSeconds;
      lastSavedRef.current = row.positionSeconds;
      if (row.positionSeconds >= 60 && (durationSeconds == null || row.positionSeconds < durationSeconds * 0.95)) {
        toast.info(`Picking up where you left off — ${Math.round(row.positionSeconds / 60)} min logged`, {
          description: 'Embed sources start from the top; your watch time keeps accumulating on top of it.',
        });
      }
    }
  }, [tmdbId, imdbId, mediaType, season, episode, historyQuery.status, historyQuery.data, durationSeconds]);

  // ---------------------------------------------------------------------------
  // "Up next" auto-advance — when the wall-clock watched time crosses ~92% of
  // the known runtime (cross-origin embeds can't report the real playhead),
  // offer the next episode with a 10s countdown. Tab-hidden time doesn't
  // count; dismissing once per episode keeps it from nagging.
  // ---------------------------------------------------------------------------
  const [upNextSeconds, setUpNextSeconds] = useState<number | null>(null);
  const upNextFiredRef = useRef('');
  const hasNextEpisode = isTv && (maxEpisode === null || episode < maxEpisode);

  useEffect(() => {
    if (!iframeReady || !hasNextEpisode || durationSeconds == null || durationSeconds <= 0) return;
    const firedKey = `${watchId}:${season}:${episode}`;
    const interval = setInterval(() => {
      if (document.hidden) return;
      if (upNextFiredRef.current === firedKey) return;
      if (watchedSecondsRef.current >= durationSeconds * 0.92) {
        upNextFiredRef.current = firedKey;
        setUpNextSeconds(10);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [iframeReady, hasNextEpisode, durationSeconds, watchId, season, episode]);

  useEffect(() => {
    if (upNextSeconds == null) return;
    const timer = setTimeout(() => {
      if (document.hidden) return; // hold the countdown while the tab is hidden
      const next = upNextSeconds - 1;
      if (next <= 0) {
        setUpNextSeconds(null);
        navigateTo(season, episode + 1);
      } else {
        setUpNextSeconds(next);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [upNextSeconds, navigateTo, season, episode]);

  return (
    <section aria-label="Player" className="relative">
      {/* Ambient amber glow behind the player */}
      <div
        aria-hidden
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
                <Badge className="gap-1 border-brand/30 bg-brand-soft text-brand hover:bg-brand-soft dark:text-brand">
                  <Star className="size-3 fill-brand text-brand" aria-hidden />
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
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Connect a TMDB key to see titles, ratings and genres here.
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Server tabs + tools — providers grouped into 2Embed / VidSrc / Other clusters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Streaming servers"
          className="flex flex-wrap items-center gap-0.5 gap-y-1 rounded-xl border border-zinc-200 bg-white/70 p-1.5 dark:border-zinc-800/60 dark:bg-zinc-900/60"
        >
          {PROVIDER_GROUPS.map((group) => {
            const providers = PROVIDERS.filter((p) => p.group === group.id);
            if (providers.length === 0) return null;
            return (
              <Fragment key={group.id}>
                <span
                  aria-hidden
                  className="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-400"
                >
                  {group.label}
                </span>
                {providers.map((p) => {
                  const active = p.id === server;
                  const health = healthMap.get(p.id);
                  const captionsGood = captionQualityOf(p.id) === 'good';
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={`${p.name} — ${
                        health === undefined
                          ? 'not scanned yet'
                          : health === true
                            ? 'responded'
                            : health === 'unknown'
                              ? 'blocked scan, may still work'
                              : 'did not respond'
                      } — subtitles ${captionsGood ? 'usually work' : 'often broken/laggy'}`}
                      title={`${p.name} · ${
                        health === undefined
                          ? 'not scanned yet'
                          : health === true
                            ? 'online'
                            : health === 'unknown'
                              ? 'blocked the scan (may still play)'
                              : 'offline'
                      } · subtitles: ${captionsGood ? 'built-in CC menu, usually works' : 'often missing or laggy (superembed family)'}`}
                      onClick={() => {
                        manualPickRef.current = true;
                        rememberManualPick();
                        setServer(p.id);
                      }}
                      className={
                        'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ' +
                        (active
                          ? 'bg-brand text-brand-foreground'
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
                                ? 'bg-brand'
                                : 'bg-red-500')
                        }
                      />
                      {p.short}
                      {captionsGood && (
                        <span
                          aria-hidden
                          title="Subtitles usually work on this source"
                          className="rounded bg-emerald-500/15 px-1 font-mono text-[9px] font-bold leading-4 text-emerald-600 dark:text-emerald-400"
                        >
                          CC
                        </span>
                      )}
                      {dubLang && supportsDub(p.id) && (!finnishActive || confirmedMap.get(p.id)) && (
                        <span
                          aria-hidden
                          title={
                            finnishActive
                              ? 'Finnish audio confirmed on this source'
                              : `Dubbed audio requested: ${dubLang.toUpperCase()}`
                          }
                          className="rounded bg-brand/15 px-1 font-mono text-[9px] font-bold uppercase leading-4 text-brand"
                        >
                          {dubLang}
                        </span>
                      )}
                    </button>
                  );
                })}
              </Fragment>
            );
          })}
        </div>

        {/* Dub requested but the active server can't carry it → one-tap handoff
            to the dub-capable mirror (manual intent, auto-pick won't undo it).
            FI is strict: the handoff only offers scan-CONFIRMED Finnish sources,
            and when none exists the FI option shows disabled with the reason. */}
        {dubLang && dubSource && dubSource.providerId !== server && (
          <button
            type="button"
            onClick={switchToDubSource}
            title={`Switch to ${getProvider(dubSource.providerId).name} with ${dubLang.toUpperCase()} dubbed audio`}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 text-xs font-medium text-sky-600 transition-colors hover:bg-sky-500/20 dark:text-sky-400"
          >
            <Languages className="size-3.5" aria-hidden />
            {dubLang.toUpperCase()} dub on {getProvider(dubSource.providerId).short}
          </button>
        )}
        {finnishUnavailable && (
          <span
            aria-disabled
            title="Finnish audio not available for this title"
            className="flex h-9 cursor-not-allowed items-center gap-1.5 rounded-lg border border-zinc-300/70 bg-zinc-500/5 px-3 text-xs font-medium text-zinc-500 dark:border-zinc-700/70 dark:text-zinc-500"
          >
            <Languages className="size-3.5" aria-hidden />
            FI not available
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {/* Source scan status + rescan */}
          <span
            role="status"
            aria-live="polite"
            className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/70 px-3 text-xs text-zinc-600 dark:border-zinc-800/60 dark:bg-zinc-900/60 dark:text-zinc-400"
          >
            <Radar
              className={'size-3.5 text-brand' + (scanQuery.isFetching && !scanQuery.data ? ' animate-pulse' : '')}
              aria-hidden
            />
            {scanQuery.isFetching && !scanQuery.data
              ? `Scanning ${PROVIDERS.length} sources…`
              : scanQuery.data
                ? onlineCount > 0
                  ? `${onlineCount}/${scanQuery.data.length} online — ${
                      manualPick ? 'picked' : 'auto'
                    } ${provider.name}${
                      dubLang && supportsDub(server) && (!finnishActive || confirmedMap.get(server))
                        ? ' · dub'
                        : ''
                    }`
                  : 'No mirror responded yet'
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
            asChild
            aria-label={`Open ${provider.name} in a new tab`}
            title={`Open ${provider.name} in a new tab`}
            className="h-9 gap-1.5 rounded-lg px-3 text-xs text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
          >
            <a href={embedUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">New tab</span>
            </a>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Find where this title streams — Yle Areena, JustWatch, Google"
            title="Where to watch — external options"
            aria-pressed={whereOpen}
            onClick={() => setWhereOpen((v) => !v)}
            className="h-9 gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 text-xs font-medium text-sky-600 hover:bg-sky-500/20 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
          >
            <MapPin className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Where to watch</span>
          </Button>
          {/* Buy / Rent — the legal route: JustWatch lists every licensed
              service carrying the title (subscriptions, purchase, rental). */}
          <Button
            variant="ghost"
            size="sm"
            asChild
            aria-label="Buy or rent this title — see every licensed service on JustWatch"
            title="Buy / Rent — licensed services on JustWatch"
            className="h-9 gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 text-xs font-medium text-sky-600 hover:bg-sky-500/20 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
          >
            <a
              href={`https://www.justwatch.com/us/search?q=${encodeURIComponent(title || '')}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ShoppingCart className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Buy / Rent</span>
            </a>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={theater ? 'Exit theater mode' : 'Theater mode — wider player (T)'}
            title={theater ? 'Exit theater mode (T)' : 'Theater mode (T)'}
            onClick={() => setTheater((v) => !v)}
            className="h-9 gap-1.5 rounded-lg px-3 text-xs text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
          >
            {theater ? <Minimize2 className="size-3.5" aria-hidden /> : <Maximize2 className="size-3.5" aria-hidden />}
            <span className="hidden sm:inline">Theater</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen (F)'}
            title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
            onClick={toggleFullscreen}
            className="h-9 gap-1.5 rounded-lg px-3 text-xs text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
          >
            {isFullscreen ? <Minimize className="size-3.5" aria-hidden /> : <Fullscreen className="size-3.5" aria-hidden />}
            <span className="hidden sm:inline">Fullscreen</span>
          </Button>
          <PlayerSettingsMenu finnishAudioUnavailable={finnishUnavailable} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Reload the player"
            title="Reload the player (R)"
            onClick={() => setNonce((n) => n + 1)}
            className="h-9 gap-1.5 rounded-lg px-3 text-xs text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
          >
            <RotateCw className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Reload</span>
          </Button>
          {/* Skip — switch to the next online source. Use this when the
              current player shows "Playback failed" or any internal
              provider error: CineDeck can't detect those states inside a
              cross-origin iframe, so the user has to ask for a switch. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Skip to next online source"
            title="Skip to next online source (S)"
            onClick={skipSource}
            className="h-9 gap-1.5 rounded-lg border border-brand/40 bg-brand-soft px-3 text-xs font-medium text-brand hover:bg-brand-soft-strong hover:text-brand dark:text-brand dark:hover:bg-brand-soft-strong dark:hover:text-brand"
          >
            <SkipForward className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Skip</span>
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
              <SelectTrigger className="h-10 w-36 rounded-lg border-zinc-200 bg-white/80 text-sm text-zinc-800 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200">
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
          ) : !hasKey && tvmazeSeasons.length > 0 ? (
            <Select
              value={String(season)}
              onValueChange={(v) => navigateTo(Number(v), 1)}
              aria-label="Select season"
            >
              <SelectTrigger className="h-10 w-36 rounded-lg border-zinc-200 bg-white/80 text-sm text-zinc-800 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200">
                <SelectValue placeholder="Season" />
              </SelectTrigger>
              <SelectContent className="z-[60] max-h-72 border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
                {tvmazeSeasons.map((s) => (
                  <SelectItem
                    key={s}
                    value={String(s)}
                    className="focus:bg-zinc-200/80 focus:text-zinc-900 dark:focus:bg-zinc-800/80 dark:focus:text-zinc-100"
                  >
                    Season {s}
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
                className="h-10 w-16 rounded-lg border-zinc-200 bg-white/80 text-center font-mono text-sm text-zinc-800 focus-visible:border-brand/60 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200"
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
              <SelectTrigger className="h-10 w-56 rounded-lg border-zinc-200 bg-white/80 text-sm text-zinc-800 focus-visible:ring-brand/20 sm:w-72 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200">
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
          ) : !hasKey && tvmazeSeasonEpisodes.length > 0 ? (
            <Select
              value={String(episode)}
              onValueChange={(v) => navigateTo(season, Number(v))}
              aria-label="Select episode"
            >
              <SelectTrigger className="h-10 w-56 rounded-lg border-zinc-200 bg-white/80 text-sm text-zinc-800 focus-visible:ring-brand/20 sm:w-72 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200">
                <SelectValue placeholder="Episode" />
              </SelectTrigger>
              <SelectContent className="z-[60] max-h-72 border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
                {tvmazeSeasonEpisodes.map((ep) => (
                  <SelectItem
                    key={ep.number}
                    value={String(ep.number)}
                    className="focus:bg-zinc-200/80 focus:text-zinc-900 dark:focus:bg-zinc-800/80 dark:focus:text-zinc-100"
                  >
                    <span className="line-clamp-1">
                      E{ep.number} · {ep.name}
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
                className="h-10 w-16 rounded-lg border-zinc-200 bg-white/80 text-center font-mono text-sm text-zinc-800 focus-visible:border-brand/60 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200"
                aria-label="Episode number"
              />
            </label>
          )}

          {(hasKey ? episodes.length === 0 && seasonQuery.isFetching : tvmazeQuery.isPending) && (
            <Loader2 className="size-4 animate-spin text-zinc-500 dark:text-zinc-400" aria-label="Loading episodes" />
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

      {/* Player iframe — theater mode breaks out to full viewport width */}
      <div className={theater ? 'relative left-1/2 w-screen -translate-x-1/2' : undefined}>
        <div
          ref={playerBoxRef}
          className={
            'relative w-full overflow-hidden border border-zinc-200 bg-black dark:border-zinc-800 ' +
            (theater || isFullscreen
              ? isFullscreen
                ? 'size-full rounded-none border-0'
                : 'rounded-none border-x-0'
              : 'aspect-video rounded-xl')
          }
          style={
            isFullscreen
              ? undefined
              : theater
                ? { height: 'min(56.25vw, calc(100svh - 9rem))' }
                : undefined
          }
        >
          <iframe
            key={`${embedUrl}#${nonce}`}
            src={proxyUrl}
            title={`${title || `TMDB #${tmdbId}`} — ${provider.name} player`}
            allowFullScreen
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            // NO sandbox attribute on the outer iframe. The double-iframe
            // proxy trick (with outer sandbox) was the right idea but
            // 2Embed's isReallySandboxed() check still detects the inherited
            // sandbox restrictions even when window.frameElement is null —
            // so the user still saw "Sandbox not allowed". The pragmatic fix
            // is to ship without sandbox: browsers' built-in pop-up blockers
            // handle most ad hijacks; the proxy page still isolates the
            // provider from CineDeck's main window via cross-origin.
            referrerPolicy="no-referrer"
            scrolling="no"
            onLoad={() => {
              // Outer onLoad fires when the proxy HTML loads (fast). The
              // real "player actually playing" signal comes from the
              // postMessage listener above; we still set loaded here as
              // a fallback so the watchdog doesn't fire prematurely when
              // the proxy HTML is up but the inner iframe is still loading.
              setLoaded({ url: embedUrl, nonce });
              setFailover(null);
            }}
            className="absolute inset-0 size-full border-0"
          />
          {/* "Where to watch" — honest fallback when no embed carries the
              title (auto: scan ruled every source out; manual: tool button).
              Sits over the black player box, never over a playing source
              (auto-close fires once a source loads + mirrors are online). */}
          {showWhereToWatch && (
            <div
              role="dialog"
              aria-label="Where to watch this title"
              className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/90 p-4 backdrop-blur-sm sm:p-6"
            >
              <div className="w-full max-w-md text-center">
                <span
                  aria-hidden
                  className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-400"
                >
                  <MapPin className="size-6" />
                </span>
                <h3 className="mt-3 text-lg font-bold text-white">
                  {nothingIndexed ? 'No stream indexed for this title' : 'Where to watch'}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-300">
                  Free embed catalogs rarely carry small or national productions — Finnish
                  films and series in particular. These options usually have it:
                </p>
                <div className="mt-4 grid gap-2 text-left">
                  <a
                    href={`https://areena.yle.fi/haku?q=${encodeURIComponent(title || imdbId || '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2.5 transition-colors hover:bg-sky-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-white">
                        Yle Areena
                        <span className="ml-2 rounded bg-sky-500/20 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-sky-300">
                          free · Finland
                        </span>
                      </span>
                      <span className="block truncate text-xs text-zinc-400">
                        Search “{title || imdbId || 'the title'}” in the national streaming service
                      </span>
                    </span>
                    <ExternalLink className="size-4 shrink-0 text-sky-400" aria-hidden />
                  </a>
                  <a
                    href={`https://www.justwatch.com/us/search?q=${encodeURIComponent(title || imdbId || '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-white/5 px-3.5 py-2.5 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-white">JustWatch</span>
                      <span className="block truncate text-xs text-zinc-400">
                        Finds every legal service carrying it (Netflix, Viaplay, Elisa Viihde…)
                      </span>
                    </span>
                    <ExternalLink className="size-4 shrink-0 text-zinc-400" aria-hidden />
                  </a>
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(`${title || imdbId || ''} watch online stream`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-white/5 px-3.5 py-2.5 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-white">Google</span>
                      <span className="block truncate text-xs text-zinc-400">
                        Broad search across every available source
                      </span>
                    </span>
                    <ExternalLink className="size-4 shrink-0 text-zinc-400" aria-hidden />
                  </a>
                </div>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={dismissWherePanel}
                    className="h-8 rounded-lg border-white/20 bg-transparent px-3 text-xs text-zinc-200 hover:bg-white/10 hover:text-white"
                  >
                    Try anyway
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => scanQuery.refetch()}
                    className="h-8 gap-1.5 rounded-lg px-3 text-xs text-zinc-300 hover:bg-white/10 hover:text-white"
                  >
                    <RotateCw className="size-3.5" aria-hidden />
                    Rescan
                  </Button>
                </div>
                {nothingIndexed && (
                  <p className="mt-3 text-[11px] text-zinc-500">
                    The scan probed every source for this exact title — all of them came up empty.
                  </p>
                )}
              </div>
            </div>
          )}
          {/* "Up next" countdown — fires near the end of the episode */}
          {upNextSeconds != null && (
            <div
              role="alertdialog"
              aria-label="Up next episode"
              className="absolute bottom-4 right-4 z-10 flex max-w-[22rem] items-center gap-3 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-xl shadow-black/20 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-base font-bold text-brand-foreground" aria-hidden>
                {upNextSeconds}
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Up next
                </span>
                <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {title} · S{season} E{episode + 1}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setUpNextSeconds(null);
                    navigateTo(season, episode + 1);
                  }}
                  className="h-8 rounded-lg bg-brand px-2.5 text-xs font-semibold text-brand-foreground hover:bg-brand/90"
                >
                  Play now
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setUpNextSeconds(null)}
                  aria-label="Dismiss the up next prompt"
                  className="h-8 rounded-lg border-zinc-300 px-2 text-xs text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
                >
                  <X className="size-3.5" aria-hidden />
                </Button>
              </span>
            </div>
          )}
          {/* Loading state — poster with spinner, never a blank black box */}
          {!iframeReady && (
            <div
              role="status"
              aria-live="polite"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-50/85 px-6 text-center backdrop-blur-sm dark:bg-zinc-950/85"
            >
              {loadingPoster && (
                <img
                  src={loadingPoster}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 size-full scale-110 object-cover opacity-25 blur-xl brightness-50"
                />
              )}
              {failover?.forUrl === embedUrl && failover.toId === null ? (
                <>
                  <span className="flex size-14 items-center justify-center rounded-full bg-red-400/10">
                    <Unplug className="size-6 text-red-500 dark:text-red-400" aria-hidden />
                  </span>
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">No mirror responded</p>
                  <p className="max-w-sm text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    All {failover.total} mirrors timed out for this title. Hit Reload to retry,
                    or pick a server above — some sources block datacenter scans but still play in browsers.
                  </p>
                </>
              ) : (
                <>
                  <span className="flex size-14 items-center justify-center rounded-full bg-brand-soft">
                    <Loader2 className="size-6 animate-spin text-brand" aria-hidden />
                  </span>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {failover?.forUrl === embedUrl && failover.toId
                      ? `Auto-switched to ${getProvider(failover.toId).name}…`
                      : `Connecting to ${provider.name}${dubLang && supportsDub(server) ? ` · ${dubLang.toUpperCase()} dub` : ''}…`}
                  </p>
                  {failover?.forUrl === embedUrl && failover.toId ? (
                    <p className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {failover.fromName} timed out · attempt {failover.tried + 1}/{failover.total}
                    </p>
                  ) : (
                    <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {imdbId ?? `TMDB ${tmdbId}`}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {/* Skip intro — timed window while the intro would be playing */}
          {iframeReady && showSkipIntro && !upNextSeconds && (
            <button
              type="button"
              onClick={skipIntro}
              className="absolute bottom-4 left-4 z-10 flex h-10 items-center gap-2 rounded-lg border border-white/25 bg-black/70 px-4 text-sm font-semibold text-white shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <FastForward className="size-4" aria-hidden />
              Skip intro
            </button>
          )}
          {/* Black-screen escape hatch — appears once the source has "loaded"
              but might silently not be playing (cross-origin, we can't peek). */}
          {iframeReady && stuckHint && (
            <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-full border border-zinc-200/80 bg-white/90 py-1 pl-3 pr-1.5 text-xs shadow-lg backdrop-blur dark:border-zinc-700/80 dark:bg-zinc-900/90">
              <span className="text-zinc-600 dark:text-zinc-300">Not playing?</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  stuckDismiss();
                  skipSource();
                }}
                className="h-6 gap-1 rounded-full px-2 text-xs font-medium text-brand hover:bg-brand-soft hover:text-brand dark:text-brand dark:hover:bg-brand-soft dark:hover:text-brand"
              >
                <SkipForward className="size-3" aria-hidden />
                Next server
              </Button>
              <button
                type="button"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={stuckDismiss}
                className="flex size-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-200/70 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          )}
        </div>
        {theater && (
          <p className="mt-2 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
            Theater mode — press <kbd className="font-mono font-semibold">T</kbd> or hit the
            Theater button to go back
          </p>
        )}
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          CineDeck scans all {PROVIDERS.length} mirrors ({PROVIDERS.filter((p) => p.group === 'twoembed').length}× 2Embed +{' '}
          {PROVIDERS.filter((p) => p.group === 'vidsrc').length}× VidSrc +{' '}
          {PROVIDERS.filter((p) => p.group === 'modern').length}× Modern +{' '}
          {PROVIDERS.filter((p) => p.group === 'other').length} other) and auto-plays the
          healthiest source — sources with the green{' '}
          <span className="rounded bg-emerald-500/15 px-1 font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">CC</span>{' '}
          badge have working subtitles, the rest often ship broken or laggy ones
          (toggle under <strong className="font-semibold text-brand">Settings</strong>). If a stream dies mid-play, the
          watchdog switches sources automatically. Shortcuts:{' '}
          <kbd className="font-mono font-semibold text-zinc-600 dark:text-zinc-400">R</kbd> reload ·{' '}
          <kbd className="font-mono font-semibold text-zinc-600 dark:text-zinc-400">S</kbd> skip ·{' '}
          <kbd className="font-mono font-semibold text-zinc-600 dark:text-zinc-400">T</kbd> theater ·{' '}
          <kbd className="font-mono font-semibold text-zinc-600 dark:text-zinc-400">F</kbd> fullscreen ·{' '}
          <kbd className="font-mono font-semibold text-zinc-600 dark:text-zinc-400">N</kbd>/<kbd className="font-mono font-semibold text-zinc-600 dark:text-zinc-400">P</kbd> episode.
          Subtitles, audio &amp; quality live in the player's own ⚙ / CC menu. If a stray ad tab
          opens, just close it — the movie keeps playing here.
        </span>
      </p>
    </section>
  );
}
