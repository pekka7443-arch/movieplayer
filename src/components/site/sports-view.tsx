'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns2,
  ExternalLink,
  History,
  Info,
  ListOrdered,
  Loader2,
  Maximize,
  MonitorPlay,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  SkipForward,
  Star,
  Trophy,
  Tv,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useSettings } from '@/lib/settings';
import { useFavoriteTeams, teamKey } from '@/lib/sports-favorites';
import { broadcastsForEvent, serviceById, STREAMING_SERVICES, type StreamingService } from '@/lib/sports-broadcasts';
import { useUiStrings } from '@/lib/ui-strings';
import { GuestPlayLock, usePlaybackLocked } from '@/components/site/sign-in-gate';

// ---------------------------------------------------------------------------
// Types (mirror the server routes)
// ---------------------------------------------------------------------------

interface SportsEvent {
  id: string;
  sport: string;
  league: string;
  leagueId: string;
  leagueBadge: string | null;
  home: string;
  away: string;
  homeBadge: string | null;
  awayBadge: string | null;
  start: string | null;
  status: string;
  state: 'upcoming' | 'live' | 'finished' | 'unknown';
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  round: string | null;
}

interface SportsChannel {
  id: string;
  name: string;
  url: string;
  logo: string | null;
  group: string;
}

type SportsTab = 'today' | 'upcoming' | 'services' | 'channels' | 'standings' | 'multiview';

const SPORT_CHIPS = [
  'All',
  'Soccer',
  'Ice Hockey',
  'Basketball',
  'American Football',
  'Baseball',
  'Motorsport',
  'Rally',
  'Fighting',
];

const SPORT_LABELS: Record<string, string> = {
  Soccer: 'Soccer',
  'Ice Hockey': 'Ice hockey',
  Basketball: 'Basketball',
  'American Football': 'Am. football',
  Baseball: 'Baseball',
  Motorsport: 'Motorsport',
  Rally: 'Rally · WRC',
  Fighting: 'Fighting',
};

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** Display title — team events read "A vs B", stage/GP events read as-is. */
function eventTitle(event: SportsEvent): string {
  return event.away ? `${event.home} vs ${event.away}` : event.home;
}

/** "1:47:10" / "23:45" for replay durations. */
function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/** "1.2M views" for replay meta. */
function fmtViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(views >= 10_000_000 ? 0 : 1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(views >= 10_000 ? 0 : 1)}K`;
  return String(views);
}

/** Pass through upstream labels like "2 years ago"; prettify ISO dates. */
function fmtPublished(published: string | null): string {
  if (!published) return '';
  if (/\d{4}-\d{2}-\d{2}/.test(published)) {
    const t = Date.parse(published);
    if (Number.isFinite(t)) return dayFmt.format(new Date(t));
  }
  return published;
}

/**
 * Hard client-side cap on every sports API call. A hung response must NEVER
 * leave the UI spinning — the fetch aborts, React Query settles, and the
 * failover / fallback UI takes over within seconds.
 */
function fetchCapped(url: string, ms = 12_000): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(ms) });
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Starts in 1h 05m" / "2 days" from now until the kickoff. */
function countdownParts(startIso: string, now: number): string {
  const diff = Date.parse(startIso) - now;
  if (diff <= 0) return 'Starting…';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Starting now';
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h ${String(mins % 60).padStart(2, '0')}m`;
  return `in ${Math.floor(hours / 24)} day${hours >= 48 ? 's' : ''}`;
}

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

function useSportsEvents(date: string, sport: string) {
  return useQuery<SportsEvent[]>({
    queryKey: ['sports-events', date, sport],
    queryFn: async () => {
      const params = new URLSearchParams({ date });
      if (sport !== 'All') params.set('sport', sport);
      const res = await fetchCapped(`/api/sports/events?${params.toString()}`);
      if (!res.ok) throw new Error('sports_unreachable');
      const json = (await res.json()) as { events: SportsEvent[] };
      return json.events;
    },
    staleTime: 30_000,
    // Live scores change — 30s poll while the user is on the sports view.
    refetchInterval: 30_000,
    retry: 1,
  });
}

function useUpcomingEvents(enabled: boolean) {
  return useQuery<SportsEvent[]>({
    queryKey: ['sports-upcoming'],
    queryFn: async () => {
      const res = await fetchCapped('/api/sports/events?upcoming=1');
      if (!res.ok) throw new Error('sports_unreachable');
      const json = (await res.json()) as { upcoming: SportsEvent[] };
      return json.upcoming;
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

function useSportsChannels() {
  return useQuery<SportsChannel[]>({
    queryKey: ['sports-channels'],
    queryFn: async () => {
      const res = await fetchCapped('/api/sports/channels');
      if (!res.ok) throw new Error('iptv_unreachable');
      const json = (await res.json()) as { channels: SportsChannel[] };
      return json.channels;
    },
    staleTime: 30 * 60_000,
    retry: 1,
  });
}

// ---------------------------------------------------------------------------
// Standings — league tables via the keyless ESPN standings endpoint
// ---------------------------------------------------------------------------

interface StandingsRow {
  team: string;
  logo: string | null;
  stats: { label: string; value: string }[];
  note: string | null;
}

const STANDINGS_LEAGUE_OPTIONS: { path: string; label: string }[] = [
  { path: 'soccer/eng.1', label: 'Premier League' },
  { path: 'soccer/esp.1', label: 'LaLiga' },
  { path: 'soccer/ita.1', label: 'Serie A' },
  { path: 'soccer/ger.1', label: 'Bundesliga' },
  { path: 'soccer/fra.1', label: 'Ligue 1' },
  { path: 'soccer/fin.1', label: 'Veikkausliiga' },
  { path: 'soccer/swe.1', label: 'Allsvenskan' },
  { path: 'soccer/nor.1', label: 'Eliteserien' },
  { path: 'soccer/den.1', label: 'Superliga' },
  { path: 'soccer/usa.1', label: 'MLS' },
  { path: 'soccer/mex.1', label: 'Liga MX' },
  { path: 'soccer/uefa.champions', label: 'Champions League' },
  { path: 'football/nfl', label: 'NFL' },
  { path: 'basketball/nba', label: 'NBA' },
  { path: 'basketball/wnba', label: 'WNBA' },
  { path: 'hockey/nhl', label: 'NHL' },
  { path: 'baseball/mlb', label: 'MLB' },
];

function useStandings(path: string, enabled: boolean) {
  return useQuery<StandingsRow[]>({
    queryKey: ['sports-standings', path],
    queryFn: async () => {
      const res = await fetchCapped(`/api/sports/standings?league=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error('standings_unreachable');
      const json = (await res.json()) as { rows: StandingsRow[] };
      return json.rows;
    },
    enabled,
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

/**
 * Ranked + probed live feeds for the selected event. The server ranks every
 * iptv-org sports channel against the event (teams, league, sport) and probes
 * the top candidates so the browser starts with ones that actually respond.
 */
function useMatchCandidates(event: SportsEvent | null) {
  return useQuery<SportsChannel[]>({
    queryKey: ['sports-match', event?.id ?? null],
    // Enabled for FINISHED events too — the watch page's "Live TV" tab plays
    // live channels that replay matches all day.
    enabled: !!event,
    queryFn: async () => {
      const p = new URLSearchParams({
        sport: event!.sport,
        league: event!.league,
        home: event!.home,
        away: event!.away,
      });
      // 10s cap × 1 retry ⇒ the scan always resolves within ~20s — the
      // "Scanning live feeds…" phase can never stick around for minutes.
      const res = await fetchCapped(`/api/sports/match?${p.toString()}`, 10_000);
      if (!res.ok) throw new Error('match_unreachable');
      const json = (await res.json()) as { candidates: SportsChannel[] };
      return json.candidates;
    },
    staleTime: 30 * 60_000,
    gcTime: 30 * 60_000,
    // Frozen while watching: an automatic refetch (window focus, staleness…)
    // would hand the player a NEW candidate array — same channels, fresh
    // object identity — which re-ranked feeds mid-playback. "Retry scan"
    // refetches explicitly; that's the only path that refreshes this query.
    refetchOnWindowFocus: false,
    refetchInterval: false,
    refetchOnReconnect: false,
    retry: 1,
  });
}

/** Single-event lookup — powers deep links like /?view=sports&watch=<id>. */
function useSportsEvent(id: string | null, enabled: boolean) {
  return useQuery<SportsEvent | null>({
    queryKey: ['sports-event', id],
    enabled: enabled && !!id,
    queryFn: async () => {
      const res = await fetchCapped(`/api/sports/events?id=${id}`);
      if (!res.ok) throw new Error('event_unreachable');
      const json = (await res.json()) as { event: SportsEvent | null };
      return json.event;
    },
    staleTime: 60_000,
    retry: 1,
  });
}

// ---------------------------------------------------------------------------
// Replays — for finished events, searched on YouTube via keyless Piped APIs
// ---------------------------------------------------------------------------

interface ReplayVideo {
  videoId: string;
  title: string;
  channel: string;
  thumb: string;
  durationSec: number;
  views: number | null;
  published: string | null;
  kind: 'full' | 'highlights' | 'other';
  score: number;
}

/** Ranked YouTube replays (full matches + highlights) for one event. */
function useReplayVideos(event: SportsEvent | null, enabled = true) {
  return useQuery<ReplayVideo[]>({
    queryKey: ['sports-replay', event?.id ?? null],
    enabled: enabled && !!event && event.state === 'finished',
    queryFn: async () => {
      const p = new URLSearchParams({
        sport: event!.sport,
        league: event!.league,
        home: event!.home,
        away: event!.away,
      });
      if (event!.start) p.set('date', event!.start.slice(0, 10));
      // 12s cap × 1 retry — a slow Piped instance can never pin the UI.
      const res = await fetchCapped(`/api/sports/replay?${p.toString()}`, 12_000);
      if (!res.ok) throw new Error('replay_unreachable');
      const json = (await res.json()) as { videos: ReplayVideo[] };
      return json.videos;
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function LiveDot() {
  return (
    <span className="relative flex size-2" aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-red-500" />
    </span>
  );
}

function StatusPill({ event }: { event: SportsEvent }) {
  if (event.state === 'live') {
    return (
      <Badge className="gap-1.5 border-red-500/30 bg-red-500/10 text-red-600 hover:bg-red-500/10 dark:text-red-400">
        <LiveDot />
        LIVE
        {event.status && !['LIVE', 'IN PLAY', 'INPLAY', 'DELAYED'].includes(event.status.toUpperCase()) ? (
          <span className="font-mono text-[10px] opacity-80">{event.status}</span>
        ) : null}
      </Badge>
    );
  }
  if (event.state === 'finished') {
    return (
      <Badge
        variant="outline"
        className="border-zinc-300 bg-transparent text-[10px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
      >
        FT
      </Badge>
    );
  }
  if (event.start) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-brand/30 bg-brand-soft text-[10px] text-brand dark:text-brand"
      >
        <CalendarDays className="size-3" aria-hidden />
        {timeFmt.format(new Date(event.start))}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-zinc-300 bg-transparent text-[10px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
    >
      TBD
    </Badge>
  );
}

/** Compact one-column status for schedule rows. */
function RowStatus({ event }: { event: SportsEvent }) {
  if (event.state === 'live') return <StatusPill event={event} />;
  if (event.state === 'finished') {
    return (
      <span className="text-[11px] font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-400">
        FT
      </span>
    );
  }
  if (event.start) {
    return (
      <span className="font-mono text-xs font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
        {timeFmt.format(new Date(event.start))}
      </span>
    );
  }
  return <span className="text-[11px] font-bold uppercase text-zinc-400 dark:text-zinc-400">TBD</span>;
}

/** Countdown ticker — ticks only while an upcoming event is selected. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Sport-specific Sportsurge sections (their per-sport pages list every
 * live stream they aggregate — works in a real browser, one tap away). */
const SPORTSURGE_SLUGS: Record<string, string> = {
  Soccer: 'soccer',
  'Ice Hockey': 'hockey',
  Basketball: 'basketball',
  'American Football': 'nfl',
  Baseball: 'mlb',
  Motorsport: 'motorsport',
  Rally: 'motorsport',
  Fighting: 'mma',
};

const WATCH_LINKS = (event: SportsEvent): { label: string; href: string }[] => {
  const q = encodeURIComponent(`${eventTitle(event)} live stream`);
  const slug = SPORTSURGE_SLUGS[event.sport];
  const links = [
    {
      label: 'Sportsurge',
      href: slug
        ? `https://sportsurge.net/${slug}/`
        : 'https://sportsurge.net/',
    },
    { label: 'Reddit streams', href: `https://www.reddit.com/search/?q=${q}` },
    { label: 'Google', href: `https://www.google.com/search?q=${q}` },
  ];
  if (event.sport === 'Soccer') {
    links.splice(1, 0, { label: 'TotalSportek', href: 'https://www.totalsportek.com/' });
  }
  return links;
};

/** Row of external fallback links (finished events + "more feeds" rows). */
function LinksRow({ event, dense }: { event: SportsEvent; dense?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!dense && (
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          More places to watch
        </span>
      )}
      {WATCH_LINKS(event).map((link) => (
        <Button
          key={link.label}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => window.open(link.href, '_blank', 'noopener,noreferrer')}
          className="h-8 gap-1.5 rounded-lg border-zinc-200 bg-white/70 text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          {link.label}
          <ExternalLink className="size-3" aria-hidden />
        </Button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Streaming services — curated Finland rights map (2025–26 season).
// Sources: mtv.fi/urheilu, mtv.fi/ohjelmat/liiga, hbomax.com/fi/fi/sports,
// viaplay.fi, ruutu.fi, areena.yle.fi, veikkaus.fi (VeikkausTV).
// ---------------------------------------------------------------------------

/** Compact "shown on" pills for a schedule group header (max 3, brand chip). */
function LeagueServicePills({ sport, league }: { sport: string; league: string }) {
  const broadcasts = useMemo(() => broadcastsForEvent({ sport, league }), [sport, league]);
  if (broadcasts.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {broadcasts.slice(0, 3).map((b) => {
        const svc = serviceById(b.serviceId);
        if (!svc) return null;
        return (
          <a
            key={b.serviceId}
            href={b.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${svc.name} — ${svc.kind === 'free' ? 'free' : 'subscription'}`}
            className="flex h-5 shrink-0 items-center gap-1 rounded-full border border-zinc-200 bg-white px-1.5 text-[10px] font-bold text-zinc-600 transition-colors hover:border-brand/40 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: svc.color }} />
            {svc.shortName}
          </a>
        );
      })}
    </span>
  );
}

/** Watch-page card — the official streaming homes of this event's league. */
function StreamingPanel({ event }: { event: SportsEvent }) {
  const t = useUiStrings();
  const broadcasts = useMemo(() => broadcastsForEvent(event), [event]);
  if (broadcasts.length === 0) return null;
  return (
    <section
      aria-label={t.watchOnServices}
      className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80"
    >
      <header className="mb-3 flex items-center gap-2">
        <MonitorPlay className="size-4 shrink-0 text-brand" aria-hidden />
        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{t.watchOnServices}</h3>
        <span className="ml-auto hidden max-w-44 truncate text-[10px] font-semibold uppercase tracking-wider text-zinc-400 sm:block">
          {event.league}
        </span>
      </header>
      <div className="flex flex-wrap gap-2">
        {broadcasts.map((b) => {
          const svc = serviceById(b.serviceId);
          if (!svc) return null;
          return (
            <a
              key={b.serviceId}
              href={b.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex min-w-44 flex-1 items-center gap-3 rounded-xl border border-zinc-200 bg-white/70 px-3.5 py-2.5 transition-colors hover:border-brand/40 hover:bg-zinc-100/80 sm:flex-none dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:bg-zinc-800/70"
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-black text-white"
                style={{ backgroundColor: svc.color }}
              >
                {svc.monogram}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-zinc-800 dark:text-zinc-100">{svc.name}</span>
                <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                  {svc.kind === 'free' ? t.freeLabel : t.paidLabel}
                </span>
              </span>
              <ExternalLink
                className="ml-1 size-3.5 shrink-0 text-zinc-400 transition-colors group-hover:text-brand"
                aria-hidden
              />
            </a>
          );
        })}
      </div>
      <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        <Info className="size-3.5 shrink-0" aria-hidden />
        {t.servicesDisclaimer}
      </p>
    </section>
  );
}

/** Streaming tab — every curated service with its league coverage. */
function ServicesTab() {
  const t = useUiStrings();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{t.streamingServices}</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t.servicesSubtitle}</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STREAMING_SERVICES.map((svc) => (
          <li
            key={svc.id}
            className="flex flex-col rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm transition-colors hover:border-brand/40 dark:border-zinc-800 dark:bg-zinc-900/70"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-[11px] font-black text-white"
                style={{ backgroundColor: svc.color }}
              >
                {svc.monogram}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{svc.name}</p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {svc.kind === 'free' ? t.freeLabel : t.paidLabel} · Finland
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-1 flex-wrap content-start gap-1.5">
              {svc.coverage.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {c}
                </span>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => window.open(svc.url, '_blank', 'noopener,noreferrer')}
              className="mt-3 h-8 w-full gap-1.5 rounded-lg bg-brand text-xs font-semibold text-brand-foreground hover:bg-brand/90"
            >
              {t.openService}
              <ExternalLink className="size-3.5" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        <Info className="size-3.5 shrink-0" aria-hidden />
        {t.servicesDisclaimer}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule — league-grouped, morningstreams-style dense list
// ---------------------------------------------------------------------------

const STATE_RANK = { live: 0, upcoming: 1, unknown: 2, finished: 3 } as const;

// ---------------------------------------------------------------------------
// Favorite teams (device-local) — star toggle on every schedule row
// ---------------------------------------------------------------------------

function FavoriteStar({ home, away }: { home: string; away: string }) {
  const { favorites, toggle } = useFavoriteTeams();
  const isFav = favorites.has(teamKey(home)) || favorites.has(teamKey(away));
  return (
    <button
      type="button"
      aria-label={isFav ? `Remove ${home} / ${away} from favorites` : `Add ${home} vs ${away} to favorites`}
      aria-pressed={isFav}
      onClick={(e) => {
        e.stopPropagation();
        // Toggle whichever side is not yet starred; both starred → unstar both.
        if (favorites.has(teamKey(home)) && favorites.has(teamKey(away))) {
          toggle(home);
          toggle(away);
        } else if (favorites.has(teamKey(home))) {
          toggle(home);
        } else if (favorites.has(teamKey(away))) {
          toggle(away);
        } else {
          toggle(home);
          toggle(away);
        }
      }}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
        isFav ? 'text-brand' : 'text-zinc-300 hover:text-brand dark:text-zinc-600',
      )}
    >
      <Star className={cn('size-4', isFav && 'fill-brand')} aria-hidden />
    </button>
  );
}

function ScheduleRow({
  event,
  active,
  onWatch,
}: {
  event: SportsEvent;
  active: boolean;
  onWatch: (event: SportsEvent) => void;
}) {
  const hasScore = event.homeScore !== null && event.awayScore !== null;
  const teamless = !event.away;
  return (
    <li
      className={cn(
        'border-b border-zinc-100 last:border-b-0 dark:border-zinc-800/60',
        event.state === 'live' && 'border-l-2 border-l-red-500',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2.5 px-3 py-2.5 transition-colors sm:px-4',
          event.state === 'live'
            ? 'bg-red-500/[0.04] hover:bg-red-500/[0.08] dark:bg-red-500/[0.06]'
            : 'hover:bg-zinc-100/70 dark:hover:bg-zinc-800/50',
          active && 'bg-brand-soft/70',
        )}
      >
        <span className="flex w-12 shrink-0 items-center sm:w-20">
          <RowStatus event={event} />
        </span>

        <button
          type="button"
          onClick={() => onWatch(event)}
          aria-label={`Watch ${eventTitle(event)}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          {/* Mobile — two stacked team lines so names stay readable */}
          <span className="flex min-w-0 flex-col gap-0.5 sm:hidden">
            <span className="flex min-w-0 items-center gap-1.5">
              {event.homeBadge ? (
                <img
                  src={event.homeBadge}
                  alt=""
                  width={16}
                  height={16}
                  loading="lazy"
                  className="size-4 shrink-0 object-contain"
                  onError={(e) => {
                    e.currentTarget.style.visibility = 'hidden';
                  }}
                />
              ) : null}
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[13px] font-semibold',
                  event.state === 'finished'
                    ? 'text-zinc-500 dark:text-zinc-400'
                    : 'text-zinc-900 dark:text-zinc-100',
                )}
              >
                {event.home}
              </span>
              {event.homeScore !== null && (
                <span
                  className={cn(
                    'shrink-0 font-mono text-xs font-bold tabular-nums',
                    event.state === 'live' ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-300',
                  )}
                >
                  {event.homeScore}
                </span>
              )}
            </span>
            {!teamless && (
              <span className="flex min-w-0 items-center gap-1.5">
              {event.awayBadge ? (
                <img
                  src={event.awayBadge}
                  alt=""
                  width={16}
                  height={16}
                  loading="lazy"
                  className="size-4 shrink-0 object-contain"
                  onError={(e) => {
                    e.currentTarget.style.visibility = 'hidden';
                  }}
                />
              ) : null}
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[13px] font-semibold',
                  event.state === 'finished'
                    ? 'text-zinc-500 dark:text-zinc-400'
                    : 'text-zinc-900 dark:text-zinc-100',
                )}
              >
                {event.away}
              </span>
              {event.awayScore !== null && (
                <span
                  className={cn(
                    'shrink-0 font-mono text-xs font-bold tabular-nums',
                    event.state === 'live' ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-300',
                  )}
                >
                  {event.awayScore}
                </span>
              )}
              </span>
            )}
          </span>

          {/* sm+ — classic single line: home score away */}
          <span className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
            {teamless ? (
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-sm font-semibold',
                  event.state === 'finished'
                    ? 'text-zinc-500 dark:text-zinc-400'
                    : 'text-zinc-900 dark:text-zinc-100',
                )}
              >
                {event.home}
              </span>
            ) : (
              <>
                {event.homeBadge ? (
                  <img
                    src={event.homeBadge}
                    alt=""
                    width={18}
                    height={18}
                    loading="lazy"
                    className="size-[18px] shrink-0 object-contain"
                    onError={(e) => {
                      e.currentTarget.style.visibility = 'hidden';
                    }}
                  />
                ) : null}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-right text-sm font-semibold',
                event.state === 'finished'
                  ? 'text-zinc-500 dark:text-zinc-400'
                  : 'text-zinc-900 dark:text-zinc-100',
              )}
            >
              {event.home}
            </span>
            {hasScore ? (
              <span
                className={cn(
                  'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums',
                  event.state === 'live'
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
                )}
              >
                {event.homeScore}–{event.awayScore}
              </span>
            ) : (
              <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-400">vs</span>
            )}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm font-semibold',
                event.state === 'finished'
                  ? 'text-zinc-500 dark:text-zinc-400'
                  : 'text-zinc-900 dark:text-zinc-100',
              )}
            >
              {event.away}
            </span>
            {event.awayBadge ? (
              <img
                src={event.awayBadge}
                alt=""
                width={18}
                height={18}
                loading="lazy"
                className="size-[18px] shrink-0 object-contain"
                onError={(e) => {
                  e.currentTarget.style.visibility = 'hidden';
                }}
              />
            ) : null}
              </>
            )}
          </span>
        </button>

        <span className="hidden w-40 shrink-0 truncate text-[11px] text-zinc-400 lg:block dark:text-zinc-400">
          {event.venue ?? ''}
        </span>

        <FavoriteStar home={event.home} away={event.away} />

        <Button
          type="button"
          size="sm"
          onClick={() => onWatch(event)}
          className={cn(
            'h-8 shrink-0 gap-1 rounded-lg px-2.5 text-[11px] font-semibold sm:gap-1.5 sm:px-3 sm:text-xs',
            event.state === 'live'
              ? 'bg-red-500 text-white hover:bg-red-400'
              : 'bg-brand text-brand-foreground hover:bg-brand/90',
          )}
        >
          {event.state === 'live' ? (
            <Radio className="size-3.5" aria-hidden />
          ) : (
            <MonitorPlay className="size-3.5" aria-hidden />
          )}
          {event.state === 'live' ? 'Watch live' : event.state === 'finished' ? 'Replay' : 'Watch'}
        </Button>
      </div>
    </li>
  );
}

function ScheduleList({
  events,
  watchId,
  onWatch,
}: {
  events: SportsEvent[];
  watchId: string | null;
  onWatch: (event: SportsEvent) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, SportsEvent[]>();
    for (const e of events) {
      const list = map.get(e.league);
      if (list) list.push(e);
      else map.set(e.league, [e]);
    }
    return [...map.entries()]
      .map(([league, list]) => {
        // Groups with live action first, then by earliest kickoff.
        const top = Math.min(...list.map((e) => STATE_RANK[e.state]));
        const anchor = list.find((e) => STATE_RANK[e.state] === top);
        const t = anchor?.start ? Date.parse(anchor.start) : Number.MAX_SAFE_INTEGER;
        const badge = list.find((e) => e.leagueBadge)?.leagueBadge ?? null;
        const sport = list[0]?.sport ?? '';
        return { league, list, top, t, badge, sport };
      })
      .sort((a, b) => (a.top !== b.top ? a.top - b.top : a.t - b.t));
  }, [events]);

  return (
    <div className="space-y-5" aria-label="Schedule by league">
      {groups.map(({ league, list, badge, sport }) => (
        <section key={league || 'other'} aria-label={league || 'Other events'}>
          <header className="mb-1.5 flex flex-wrap items-center gap-2 px-1">
            {badge ? (
              <img
                src={badge}
                alt=""
                width={20}
                height={20}
                loading="lazy"
                className="size-5 shrink-0 rounded object-contain"
                onError={(e) => {
                  e.currentTarget.style.visibility = 'hidden';
                }}
              />
            ) : (
              <Trophy className="size-4 shrink-0 text-brand" aria-hidden />
            )}
            <h2 className="truncate text-[13px] font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              {league || 'Other events'}
            </h2>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-400">
              {SPORT_LABELS[sport] ?? sport} · {list.length}
            </span>
            <LeagueServicePills sport={sport} league={league} />
            <span aria-hidden className="h-px min-w-6 flex-1 bg-zinc-200 dark:bg-zinc-800/70" />
          </header>
          <ul className="overflow-hidden rounded-xl border border-zinc-200 bg-white/80 shadow-sm dark:border-zinc-800/70 dark:bg-zinc-900/60">
            {list.map((e) => (
              <ScheduleRow key={e.id} event={e} active={watchId === e.id} onWatch={onWatch} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-view — watch two live games side by side (each cell resolves its own
// feeds via its own useMatchCandidates instance)
// ---------------------------------------------------------------------------

function MultiViewCell({
  event,
  onBrowseChannels,
}: {
  event: SportsEvent;
  onBrowseChannels: () => void;
}) {
  const candidates = useMatchCandidates(event);
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white/70 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/60">
        {event.state === 'live' && <LiveDot />}
        <span className="min-w-0 truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
          {event.home} vs {event.away}
        </span>
        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          {event.league}
        </span>
      </div>
      <LivePlayer
        event={event}
        candidates={candidates.data ?? []}
        loading={candidates.isPending}
        onBrowseChannels={onBrowseChannels}
        onRetryScan={() => void candidates.refetch()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// HLS channel player (hls.js, dynamically imported — Safari plays natively)
// ---------------------------------------------------------------------------

function ChannelPlayer({ channel, onClose }: { channel: SportsChannel; onClose: () => void }) {
  const playbackLocked = usePlaybackLocked();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'idle' | 'error'>('connecting');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let destroyed = false;
    let hls: { destroy: () => void } | null = null;

    const setup = async () => {
      setStatus('connecting');
      // All playback goes through CineDeck's HLS proxy — it fixes CORS and
      // mixed content for the third-party iptv-org CDNs.
      const playUrl = `/api/sports/stream?u=${encodeURIComponent(channel.url)}`;
      const canNative = video.canPlayType('application/vnd.apple.mpegurl');
      if (canNative) {
        video.src = playUrl;
        video.play().catch(() => undefined); // autoplay policy — user presses play
        return;
      }
      try {
        const { default: Hls } = await import('hls.js');
        if (destroyed) return;
        if (!Hls.isSupported()) {
          setStatus('error');
          return;
        }
        const instance = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 60 });
        hls = instance;
        instance.loadSource(playUrl);
        instance.attachMedia(video);
        instance.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && !destroyed) setStatus('error');
        });
        video.play().catch(() => undefined); // autoplay policy — user presses play
      } catch {
        if (!destroyed) setStatus('error');
      }
    };
    void setup();

    return () => {
      destroyed = true;
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [channel.url]);

  if (playbackLocked) {
    return <GuestPlayLock title={channel.name} returnTo={typeof window !== 'undefined' ? window.location.href : undefined} />;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      aria-label={`Playing ${channel.name}`}
      className="relative scroll-mt-24 overflow-hidden rounded-2xl border border-zinc-200 bg-black shadow-sm dark:border-zinc-800"
    >
      <div className="relative aspect-video w-full">
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          className="absolute inset-0 size-full bg-black"
          onPlaying={() => setStatus('live')}
          onCanPlay={() =>
            setStatus((s) => (s === 'error' ? 'error' : 'idle'))
          }
          onError={(e) => {
            const el = e.currentTarget;
            // Only trust real media errors that left us with nothing to show.
            if (el.error && el.readyState === 0) setStatus('error');
          }}
        />
        {(status === 'connecting' || status === 'error') && (
          <div
            className={
              'pointer-events-none absolute inset-x-0 flex justify-center p-4 ' +
              (status === 'error' ? 'inset-y-0 items-center' : 'bottom-0 items-end')
            }
          >
            {status === 'connecting' ? (
              <span className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-xs text-white">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Connecting to {channel.name}…
              </span>
            ) : (
              <span className="max-w-md rounded-xl bg-black/80 px-4 py-3 text-center text-xs leading-relaxed text-white">
                This channel didn&apos;t load — it may be geo-blocked or offline. Try another
                channel, or{' '}
                <a
                  href={channel.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  open the stream directly
                </a>
                .
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 border-t border-zinc-800 bg-zinc-950 px-4 py-3">
        {channel.logo ? (
          <img src={channel.logo} alt="" width={28} height={28} className="size-7 rounded object-contain" />
        ) : (
          <Tv className="size-5 text-brand" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-100">{channel.name}</p>
          <p className="text-[11px] text-zinc-500">Free live channel via iptv-org</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => window.open(channel.url, '_blank', 'noopener,noreferrer')}
          className="ml-auto h-8 gap-1.5 rounded-lg px-3 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">Open stream</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close channel player"
          onClick={onClose}
          className="size-8 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// Live event player — "Watch" auto-plays the best probed feed for the event
// and watchdogs through the ranked candidates until one actually plays.
// ---------------------------------------------------------------------------

type LivePhase = 'finding' | 'connecting' | 'live' | 'exhausted';

function LivePlayer({
  event,
  candidates,
  loading,
  onBrowseChannels,
  onRetryScan,
}: {
  event: SportsEvent;
  candidates: SportsChannel[];
  loading: boolean;
  onBrowseChannels: () => void;
  onRetryScan: () => void;
}) {
  // PHASE 2 gate: live streams are playback → accounts only.
  const playbackLocked = usePlaybackLocked();
  const { autoFailover, failoverSeconds } = useSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeUrlRef = useRef<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);

  const current = candidates[idx] ?? null;
  const currentUrl = current?.url ?? null;
  const phase: LivePhase = current
    ? (liveUrl === current.url ? 'live' : 'connecting')
    : (loading ? 'finding' : 'exhausted');

  /** Watchdog / error fallback — jump to the next ranked candidate. */
  const advance = useCallback(() => setIdx((i) => i + 1), []);

  // NOTE: the effect depends on the primitive `currentUrl`, NOT the candidate
  // object — a refetch that produces a fresh array (same channels, new
  // identity) must never tear down a playing stream.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentUrl) return;
    let destroyed = false;
    let hls: { destroy: () => void } | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let hasPlayed = false;
    let lastTime = -1;
    activeUrlRef.current = currentUrl;

    const disarm = () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };
    /**
     * (Re)arm the failover watchdog. While the stream is healthy every
     * `timeupdate` (≈4×/s) rearms this, so the timeout only ever fires when
     * playback has genuinely gone quiet for `failoverSeconds`. A feed that
     * PLAYS is never switched away from — that was the "working stream
     * randomly jumps to another one" bug: the watchdog used to keep running
     * to completion even after the video had started.
     */
    const armWatchdog = () => {
      disarm();
      if (!autoFailover) return;
      watchdog = setTimeout(() => {
        if (destroyed) return;
        if (video.paused) {
          // Paused before ever playing → autoplay was blocked → try the next
          // feed. Paused after playing → the user paused it on purpose; the
          // `playing` event rearms the watchdog on resume.
          if (!hasPlayed) advance();
          return;
        }
        advance();
      }, Math.max(4, failoverSeconds) * 1000);
    };

    const onPlaying = () => {
      hasPlayed = true;
      lastTime = video.currentTime;
      setLiveUrl(activeUrlRef.current);
      armWatchdog();
    };
    const onTimeUpdate = () => {
      if (video.paused || video.currentTime === lastTime) return; // no progress → let the watchdog run
      lastTime = video.currentTime;
      armWatchdog(); // healthy progress → push the deadline out again
    };
    const onWaiting = () => {
      if (hasPlayed) armWatchdog(); // brief stall — give it a full window to recover
    };
    const onMediaError = () => {
      // Only trust real media errors that left us with nothing to render.
      if (video.error && video.readyState === 0 && !destroyed) {
        disarm();
        advance();
      }
    };
    video.addEventListener('playing', onPlaying);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onMediaError);

    const setup = async () => {
      // Playback goes through CineDeck's HLS proxy (fixes CORS + mixed content).
      const playUrl = `/api/sports/stream?u=${encodeURIComponent(currentUrl)}`;
      video.muted = true;
      const canNative = video.canPlayType('application/vnd.apple.mpegurl');
      if (canNative) {
        video.src = playUrl;
        video.play().catch(() => undefined);
        armWatchdog();
        return;
      }
      try {
        const { default: Hls } = await import('hls.js');
        if (destroyed) return;
        if (!Hls.isSupported()) {
          advance();
          return;
        }
        const instance = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 60 });
        hls = instance;
        instance.loadSource(playUrl);
        instance.attachMedia(video);
        instance.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal && !destroyed) {
            disarm();
            advance();
          }
        });
        video.play().catch(() => undefined);
        armWatchdog();
      } catch {
        if (!destroyed) advance();
      }
    };
    void setup();

    return () => {
      destroyed = true;
      disarm();
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onMediaError);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [currentUrl, autoFailover, failoverSeconds, advance]);

  /** Manual pick from the ranked feeds list. */
  const pick = (i: number) => {
    if (!candidates[i] || i === idx) return;
    setLiveUrl(null);
    setIdx(i);
  };

  /** Re-run the scan from the best feed — also used by the exhausted panel. */
  const retryScan = () => {
    setLiveUrl(null);
    setIdx(0);
    onRetryScan();
  };

  if (playbackLocked) {
    return (
      <GuestPlayLock
        title={`${event.home} vs ${event.away}`}
        returnTo={typeof window !== 'undefined' ? window.location.href : undefined}
      />
    );
  }

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        aria-label={`Live player for ${eventTitle(event)}`}
        className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-black shadow-sm dark:border-zinc-800"
      >
        <div className="relative aspect-video w-full">
          <video
            ref={videoRef}
            controls
            autoPlay
            muted
            playsInline
            className="absolute inset-0 size-full bg-black"
          />

          {phase === 'finding' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
              <span className="flex items-center gap-2 rounded-full bg-black/75 px-4 py-2 text-xs font-medium text-white">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Scanning live feeds for {eventTitle(event)}…
              </span>
            </div>
          )}

          {phase === 'connecting' && current && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
              <span className="flex items-center gap-2 rounded-full bg-black/75 px-4 py-2 text-xs font-medium text-white">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Connecting to {current.name}
                {candidates.length > 0 && (
                  <span className="opacity-70">
                    ({Math.min(idx + 1, candidates.length)}/{candidates.length})
                  </span>
                )}
              </span>
            </div>
          )}

          {phase === 'live' && muted && (
            <button
              type="button"
              onClick={() => {
                const v = videoRef.current;
                if (v) {
                  v.muted = false;
                  setMuted(false);
                  v.play().catch(() => undefined);
                }
              }}
              className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-brand px-5 py-3 text-sm font-semibold text-brand-foreground shadow-lg transition-transform hover:scale-105"
            >
              <Volume2 className="size-4" aria-hidden />
              Tap for sound
            </button>
          )}

          {phase === 'exhausted' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center">
              <Info className="size-6 text-brand" aria-hidden />
              <p className="text-sm font-semibold text-white">
                No free live feed found for this match right now
              </p>
              <p className="max-w-md text-xs leading-relaxed text-zinc-400">
                Feeds rotate constantly — try again at kickoff, check the sites below, or play any
                always-on sports channel.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retryScan}
                  className="h-8 gap-1.5 rounded-lg border-zinc-700 bg-transparent text-xs text-zinc-200 hover:bg-zinc-800 hover:text-white"
                >
                  <RefreshCw className="size-3" aria-hidden />
                  Retry scan
                </Button>
                {WATCH_LINKS(event).slice(0, 3).map((link) => (
                  <Button
                    key={link.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(link.href, '_blank', 'noopener,noreferrer')}
                    className="h-8 gap-1.5 rounded-lg border-zinc-700 bg-transparent text-xs text-zinc-200 hover:bg-zinc-800 hover:text-white"
                  >
                    {link.label}
                    <ExternalLink className="size-3" aria-hidden />
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  onClick={onBrowseChannels}
                  className="h-8 gap-1.5 rounded-lg bg-brand text-xs font-semibold text-brand-foreground hover:bg-brand/90"
                >
                  <Tv className="size-3.5" aria-hidden />
                  Browse channels
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-zinc-800 bg-zinc-950 px-4 py-3">
          {current?.logo ? (
            <img
              src={current.logo}
              alt=""
              width={28}
              height={28}
              className="size-7 rounded object-contain"
              onError={(e) => {
                e.currentTarget.style.visibility = 'hidden';
              }}
            />
          ) : (
            <Tv className="size-5 shrink-0 text-brand" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-100">
              {current ? current.name : 'Looking for a live feed…'}
            </p>
            <p className="truncate text-[11px] text-zinc-500">
              {current ? `${current.group} · live via iptv-org` : 'Auto-switching feeds until one plays'}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={advance}
            disabled={!current}
            className="ml-auto h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <SkipForward className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Next feed</span>
          </Button>
        </div>
      </motion.section>

      <FeedList
        candidates={candidates}
        currentId={current?.id ?? null}
        loading={loading}
        onPick={pick}
        onBrowseChannels={onBrowseChannels}
      />
    </>
  );
}

/** Numbered live-feeds list — pick any ranked feed with one click. */
function FeedList({
  candidates,
  currentId,
  loading,
  onPick,
  onBrowseChannels,
}: {
  candidates: SportsChannel[];
  currentId: string | null;
  loading: boolean;
  onPick: (i: number) => void;
  onBrowseChannels: () => void;
}) {
  return (
    <section
      aria-label="Live feeds"
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white/90 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80"
    >
      <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800/70">
        <ListOrdered className="size-4 shrink-0 text-brand" aria-hidden />
        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Live feeds</h3>
        <span className="hidden truncate text-[11px] text-zinc-500 sm:inline dark:text-zinc-400">
          {loading
            ? 'Checking which feeds are alive…'
            : candidates.length > 0
              ? `${candidates.length} ranked & pre-checked — click to switch`
              : 'Ranked for this match'}
        </span>
      </header>
      {candidates.length > 0 ? (
        <ul className="grid gap-1.5 overflow-y-auto p-2 sm:grid-cols-2">
          {candidates.map((c, i) => (
            <li key={`${c.id}-${i}`}>
              <button
                type="button"
                onClick={() => onPick(i)}
                aria-pressed={currentId === c.id}
                className={cn(
                  'flex h-11 w-full items-center gap-2.5 rounded-xl border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
                  currentId === c.id
                    ? 'border-brand/60 bg-brand-soft ring-1 ring-brand/40'
                    : 'border-zinc-200 bg-white/60 hover:border-brand/40 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:bg-zinc-800/60',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold tabular-nums',
                    currentId === c.id
                      ? 'bg-brand text-brand-foreground'
                      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
                  )}
                >
                  {i + 1}
                </span>
                {c.logo ? (
                  <img
                    src={c.logo}
                    alt=""
                    width={20}
                    height={20}
                    loading="lazy"
                    className="size-5 shrink-0 rounded object-contain"
                    onError={(e) => {
                      e.currentTarget.style.visibility = 'hidden';
                    }}
                  />
                ) : (
                  <Tv className="size-4 shrink-0 text-brand" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">
                    {c.name}
                  </span>
                  <span className="block truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                    {c.group}
                  </span>
                </span>
                {currentId === c.id && (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-brand">
                    <LiveDot />
                    playing
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          {loading
            ? 'Scanning every free sports channel for this match…'
            : 'No ranked feeds available right now — browse all TV channels instead.'}
        </p>
      )}
      <footer className="flex items-center justify-between gap-2 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800/70">
        <span className="text-[11px] text-zinc-400 dark:text-zinc-400">
          Free-to-air channels via iptv-org · auto-failover keeps the picture alive
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBrowseChannels}
          className="h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100"
        >
          All channels
          <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Replay player — YouTube via the IFrame API with CineDeck's own seek bar
// (keyboard: ←/→ ±10s, J/L, K/space, M, F), speed control and fullscreen.
// If the YT API script can't load, falls back to a plain embed with native
// controls — which are still fully seekable.
// ---------------------------------------------------------------------------

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoLoadedFraction(): number;
  setPlaybackRate(rate: number): void;
  destroy(): void;
}
interface YTPlayerEvent {
  target: YTPlayer;
  data?: number;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement | string,
    opts: {
      videoId?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: YTPlayerEvent) => void;
        onStateChange?: (e: YTPlayerEvent) => void;
        onError?: (e: YTPlayerEvent) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace | null> | null = null;

/** Load https://www.youtube.com/iframe_api once; null after ~6s of silence. */
function loadYtApi(): Promise<YTNamespace | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(window.YT ?? null), 6_000);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      clearTimeout(timer);
      resolve(window.YT ?? null);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return ytApiPromise;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

function YtPlayer({
  videoId,
  title,
  onUnavailable,
}: {
  videoId: string;
  title: string;
  /** Fired when YouTube reports THIS video can't play in an embed. */
  onUnavailable?: (videoId: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [rate, setRate] = useState(1);
  const [showRates, setShowRates] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Callback identity must never retrigger the player effect — read it via ref.
  const unavailableRef = useRef(onUnavailable);
  useEffect(() => {
    unavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  // Create the YT player once the API resolves; poll time/buffer while ready.
  // (YtPlayer is keyed by videoId upstream — a new video remounts this whole
  // component, so state starts fresh and the effect needs no resets.)
  useEffect(() => {
    let destroyed = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    void loadYtApi().then((YT) => {
      if (destroyed) return;
      const host = hostRef.current;
      if (!YT?.Player || !host) {
        setFailed(true);
        return;
      }
      const player = new YT.Player(host, {
        videoId,
        playerVars: {
          autoplay: 1,
          mute: 1, // autoplay policy — unmute button in the control bar
          controls: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          iv_load_policy: 3,
        },
        events: {
          onReady: (e) => {
            if (destroyed) return;
            playerRef.current = e.target;
            setReady(true);
            setMuted(e.target.isMuted());
            setDuration(e.target.getDuration());
            e.target.playVideo();
          },
          onStateChange: (e) => {
            if (destroyed) return;
            setPlaying(e.data === YT.PlayerState.PLAYING);
            setDuration(e.target.getDuration());
          },
          onError: () => {
            // 2/5/100/101/150 — invalid, HTML5, not-found or embedding
            // disallowed. Skip to the next ranked replay instead of showing
            // a dead player. Report THIS instance's videoId — the ref may
            // already point at a newer closure for a different video.
            if (destroyed) return;
            setFailed(true);
            unavailableRef.current?.(videoId);
          },
        },
      });
      playerRef.current = player;
      poll = setInterval(() => {
        const p = playerRef.current;
        if (!p) return;
        try {
          setTime(p.getCurrentTime());
          setDuration(p.getDuration());
          setBuffered(p.getVideoLoadedFraction());
        } catch {
          // iframe not ready this tick
        }
      }, 500);
    });

    return () => {
      destroyed = true;
      if (poll) clearInterval(poll);
      try {
        playerRef.current?.destroy();
      } catch {
        // already gone
      }
      playerRef.current = null;
    };
  }, [videoId]);

  // Fullscreen state sync (Esc key etc.).
  useEffect(() => {
    const onFsChange = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (playing) p.pauseVideo();
    else p.playVideo();
  };
  const seekTo = (sec: number) => {
    const p = playerRef.current;
    if (!p || duration <= 0) return;
    p.seekTo(Math.min(Math.max(0, sec), duration - 0.5), true);
    setTime(Math.min(Math.max(0, sec), duration));
  };
  const nudge = (delta: number) => seekTo((playerRef.current?.getCurrentTime() ?? 0) + delta);
  const toggleMute = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isMuted()) {
      p.unMute();
      setMuted(false);
    } else {
      p.mute();
      setMuted(true);
    }
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
      case 'j':
        e.preventDefault();
        nudge(-10);
        break;
      case 'ArrowRight':
      case 'l':
        e.preventDefault();
        nudge(10);
        break;
      case 'm':
        toggleMute();
        break;
      case 'f':
        toggleFullscreen();
        break;
    }
  };

  // Fallback: plain embed with YouTube's own (seekable) controls.
  if (failed) {
    return (
      <div className="relative aspect-video w-full bg-black">
        <iframe
          key={videoId}
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&controls=1&rel=0&modestbranding=1&playsinline=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute inset-0 size-full border-0"
        />
      </div>
    );
  }

  const pct = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`Replay player: ${title}`}
      className={
        'group relative aspect-video w-full bg-black outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-inset ' +
        (fullscreen ? 'flex h-screen items-center justify-center' : '')
      }
    >
      <div className={fullscreen ? 'h-full w-full' : 'absolute inset-0'}>
        {/* YT.Player replaces this div with the iframe */}
        <div ref={hostRef} className="size-full" />
      </div>

      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex items-center gap-2 rounded-full bg-black/75 px-4 py-2 text-xs font-medium text-white">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Loading replay…
          </span>
        </div>
      )}

      {ready && muted && (
        <button
          type="button"
          onClick={() => {
            const p = playerRef.current;
            if (p) {
              p.unMute();
              setMuted(false);
              p.playVideo();
            }
          }}
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-brand px-5 py-3 text-sm font-semibold text-brand-foreground shadow-lg transition-transform hover:scale-105"
        >
          <Volume2 className="size-4" aria-hidden />
          Tap for sound
        </button>
      )}

      {/* Custom control bar — the "kelaa" bar */}
      {ready && (
        <div
          className={
            'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pb-2 pt-6 opacity-100 transition-opacity sm:px-4 ' +
            (playing ? 'opacity-0 group-hover:opacity-100 focus-within:opacity-100' : '')
          }
        >
          <div
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration)}
            aria-valuenow={Math.floor(time)}
            tabIndex={-1}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const rect = e.currentTarget.getBoundingClientRect();
              seekTo(((e.clientX - rect.left) / rect.width) * duration);
            }}
            onPointerMove={(e) => {
              if (e.buttons !== 1) return;
              const rect = e.currentTarget.getBoundingClientRect();
              seekTo(((e.clientX - rect.left) / rect.width) * duration);
            }}
            className="group/bar relative h-4 cursor-pointer touch-none select-none"
          >
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
              <div className="h-full bg-white/35" style={{ width: `${buffered * 100}%` }} />
            </div>
            <div
              className="absolute inset-y-0 left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand"
              style={{ width: `${pct}%` }}
            />
            <div
              className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand shadow transition-transform group-hover/bar:scale-125"
              style={{ left: `${pct}%` }}
            />
          </div>

          <div className="mt-0.5 flex items-center gap-1.5 text-white">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              className="flex size-9 items-center justify-center rounded-full hover:bg-white/15"
            >
              {playing ? <Pause className="size-4.5" aria-hidden /> : <Play className="size-4.5" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="flex size-9 items-center justify-center rounded-full hover:bg-white/15"
            >
              {muted ? <VolumeX className="size-4.5" aria-hidden /> : <Volume2 className="size-4.5" aria-hidden />}
            </button>
            <span className="ml-1 font-mono text-[11px] tabular-nums text-white/90">
              {fmtDuration(time)} / {fmtDuration(duration)}
            </span>

            <div className="relative ml-auto">
              <button
                type="button"
                onClick={() => setShowRates((v) => !v)}
                aria-label="Playback speed"
                className="flex h-9 items-center gap-1 rounded-full px-2.5 text-xs font-bold hover:bg-white/15"
              >
                {rate}×
              </button>
              {showRates && (
                <div className="absolute bottom-11 right-0 z-10 w-20 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/95 py-1 shadow-xl">
                  {PLAYBACK_RATES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        playerRef.current?.setPlaybackRate(r);
                        setRate(r);
                        setShowRates(false);
                      }}
                      className={cn(
                        'block w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-800',
                        r === rate ? 'font-bold text-brand' : 'text-zinc-200',
                      )}
                    >
                      {r}×
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="flex size-9 items-center justify-center rounded-full hover:bg-white/15"
            >
              <Maximize className="size-4.5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type ReplayFilter = 'all' | 'full' | 'highlights';

/** Replay browser — ranked YouTube replays with filters + the seekable player. */
function ReplayPlayer({ event }: { event: SportsEvent }) {
  const playbackLocked = usePlaybackLocked();
  const videosQuery = useReplayVideos(event, playbackLocked);
  const [filter, setFilter] = useState<ReplayFilter>('all');
  const [picked, setPicked] = useState<ReplayVideo | null>(null);
  // Videos YouTube refused to play (embedding disabled, gone…) — auto-skipped.
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const videos = useMemo(() => videosQuery.data ?? [], [videosQuery.data]);
  const playable = useMemo(() => {
    const pool = videos.filter((v) => !skipped.has(v.videoId));
    return pool.length > 0 ? pool : videos; // never empty the player completely
  }, [videos, skipped]);
  // Derived selection — when the list lands, the top-ranked replay plays;
  // once the user picks one, their choice wins until the event changes.
  const active =
    picked && playable.some((v) => v.videoId === picked.videoId) ? picked : (playable[0] ?? null);
  const shown = useMemo(
    () => (filter === 'all' ? playable : playable.filter((v) => v.kind === filter)),
    [playable, filter],
  );
  const fullCount = playable.filter((v) => v.kind === 'full').length;
  const hlCount = playable.filter((v) => v.kind === 'highlights').length;

  const skipCurrent = useCallback((failedVideoId: string) => {
    setPicked(null);
    setSkipped((prev) => {
      const next = new Set(prev);
      next.add(failedVideoId);
      return next;
    });
  }, []);
  // Every video refused → stop auto-skipping (it would loop); the player
  // shows YouTube's own "watch on YouTube" UI for the top pick instead.
  const allSkipped = videos.length > 0 && videos.every((v) => skipped.has(v.videoId));

  if (playbackLocked) {
    return (
      <GuestPlayLock
        title={`${event.home} vs ${event.away}`}
        returnTo={typeof window !== 'undefined' ? window.location.href : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        aria-label={`Replay player for ${eventTitle(event)}`}
        className="overflow-hidden rounded-2xl border border-zinc-200 bg-black shadow-sm dark:border-zinc-800"
      >
        {active ? (
          <YtPlayer
            key={active.videoId}
            videoId={active.videoId}
            title={active.title}
            onUnavailable={allSkipped ? undefined : skipCurrent}
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-black">
            {videosQuery.isPending ? (
              <span className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Searching for replays of {eventTitle(event)}…
              </span>
            ) : (
              <div className="max-w-md p-6 text-center">
                <History className="mx-auto size-6 text-brand" aria-hidden />
                <p className="mt-2 text-sm font-semibold text-white">No replay found yet</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  Full replays usually surface on YouTube a few hours after the final whistle —
                  check back soon, watch the live channels (they replay matches all day), or try
                  one of the sites below.
                </p>
              </div>
            )}
          </div>
        )}

        {active && (
          <div className="flex items-center gap-3 border-t border-zinc-800 bg-zinc-950 px-4 py-3">
            <History className="size-5 shrink-0 text-brand" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-100">{active.title}</p>
              <p className="truncate text-[11px] text-zinc-500">
                {active.channel}
                {active.views ? ` · ${fmtViews(active.views)} views` : ''}
                {active.published ? ` · ${fmtPublished(active.published)}` : ''}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                window.open(`https://www.youtube.com/watch?v=${active.videoId}`, '_blank', 'noopener,noreferrer')
              }
              className="ml-auto h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">YouTube</span>
            </Button>
          </div>
        )}
      </motion.section>

      {/* Replay list */}
      <section
        aria-label="Replays"
        className="overflow-hidden rounded-2xl border border-zinc-200 bg-white/90 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80"
      >
        <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800/70">
          <History className="size-4 shrink-0 text-brand" aria-hidden />
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Replays</h3>
          <span className="hidden text-[11px] text-zinc-500 sm:inline dark:text-zinc-400">
            Found on YouTube · full replays &amp; highlights · seek with the bar or ←/→
          </span>
          <div className="ml-auto flex items-center gap-1">
            {(
              [
                { id: 'all' as const, label: `All ${videos.length || ''}` },
                { id: 'full' as const, label: `Full ${fullCount || ''}` },
                { id: 'highlights' as const, label: `Highlights ${hlCount || ''}` },
              ]
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={cn(
                  'h-7 rounded-full border px-2.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
                  filter === id
                    ? 'border-brand bg-brand text-brand-foreground'
                    : 'border-zinc-200 bg-white/70 text-zinc-500 hover:border-brand/40 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:text-zinc-100',
                )}
              >
                {label.trim()}
              </button>
            ))}
          </div>
        </header>

        {shown.length > 0 ? (
          <ul className="grid gap-1.5 p-2 sm:grid-cols-2">
            {shown.map((v) => (
              <li key={v.videoId}>
                <button
                  type="button"
                  onClick={() => setPicked(v)}
                  aria-pressed={active?.videoId === v.videoId}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
                    active?.videoId === v.videoId
                      ? 'border-brand/60 bg-brand-soft ring-1 ring-brand/40'
                      : 'border-zinc-200 bg-white/60 hover:border-brand/40 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:bg-zinc-800/60',
                  )}
                >
                  <span className="relative w-28 shrink-0 overflow-hidden rounded-lg bg-zinc-200 sm:w-32 dark:bg-zinc-800">
                    <img
                      src={v.thumb}
                      alt=""
                      width={128}
                      height={72}
                      loading="lazy"
                      className="aspect-video size-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.visibility = 'hidden';
                      }}
                    />
                    <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1 py-0.5 font-mono text-[10px] font-bold tabular-nums text-white">
                      {fmtDuration(v.durationSec)}
                    </span>
                    {v.kind === 'full' && (
                      <span className="absolute left-1 top-1 rounded bg-brand px-1 py-0.5 text-[9px] font-black uppercase tracking-wide text-brand-foreground">
                        Full
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-zinc-800 dark:text-zinc-200">
                      {v.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {v.channel}
                      {v.views ? ` · ${fmtViews(v.views)} views` : ''}
                      {v.published ? ` · ${fmtPublished(v.published)}` : ''}
                    </span>
                  </span>
                  {active?.videoId === v.videoId && (
                    <span className="flex shrink-0 items-center gap-1 pr-1 text-[10px] font-bold uppercase tracking-wide text-brand">
                      <Play className="size-3" aria-hidden />
                      playing
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-4 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {videosQuery.isPending
              ? 'Searching YouTube for full replays and highlights…'
              : videos.length === 0
                ? 'Nothing uploaded for this event yet — replays usually appear within a few hours. Live sports channels replay matches all day too.'
                : `No ${filter === 'full' ? 'full replays' : 'highlights'} in this list — switch back to All.`}
          </p>
        )}

        {videosQuery.isError && (
          <p className="px-4 py-3 text-xs text-zinc-500">
            Replay search hit a snag —{' '}
            <button
              type="button"
              onClick={() => void videosQuery.refetch()}
              className="font-semibold text-brand underline underline-offset-2"
            >
              retry
            </button>
            .
          </p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Watch page — the focused, URL-driven view for one event (like a dedicated
// /watch page: big player on top, feeds + context below, back returns to the
// schedule).
// ---------------------------------------------------------------------------

function WatchPage({
  event,
  candidates,
  loading,
  onBack,
  onBrowseChannels,
  onRetryScan,
  upNext,
  onSelectEvent,
}: {
  event: SportsEvent;
  candidates: SportsChannel[];
  loading: boolean;
  onBack: () => void;
  onBrowseChannels: () => void;
  onRetryScan: () => void;
  upNext: SportsEvent[];
  onSelectEvent: (event: SportsEvent) => void;
}) {
  const now = useNow();
  const hasScore = event.homeScore !== null && event.awayScore !== null;
  const teamless = !event.away;
  const [mode, setMode] = useState<'replay' | 'live'>(event.state === 'finished' ? 'replay' : 'live');

  return (
    <div id="sports-watch" className="space-y-4 scroll-mt-24">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
        <div
          aria-hidden
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="-ml-2 h-8 gap-1 rounded-lg px-2 text-xs text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100"
          >
            <ChevronLeft className="size-4" aria-hidden />
            All events
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <StatusPill event={event} />
            {event.state === 'upcoming' && event.start && (
              <span className="rounded-lg bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">
                {countdownParts(event.start, now)}
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {event.leagueBadge ? (
            <img src={event.leagueBadge} alt="" width={36} height={36} className="size-9 rounded object-contain" />
          ) : (
            <Trophy className="size-6 text-brand" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {event.league}
              {event.round ? ` · Round ${event.round}` : ''}
            </p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {[SPORT_LABELS[event.sport] ?? event.sport, event.venue, event.start ? `${dayFmt.format(new Date(event.start))} · ${timeFmt.format(new Date(event.start))}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>

        {/* Teams + score — team-less events (WRC stage / F1 GP) get a centered title */}
        {teamless ? (
          <div className="mt-4 text-center">
            <p className="text-lg font-bold text-zinc-900 sm:text-xl dark:text-zinc-100">{event.home}</p>
          </div>
        ) : (
        <div className="mt-4 flex items-center justify-center gap-3 sm:gap-6">
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5 sm:gap-3">
            <span className="min-w-0 truncate text-right text-base font-bold text-zinc-900 sm:text-xl dark:text-zinc-100">
              {event.home}
            </span>
            {event.homeBadge ? (
              <img
                src={event.homeBadge}
                alt=""
                width={40}
                height={40}
                className="size-8 shrink-0 object-contain sm:size-10"
                onError={(e) => {
                  e.currentTarget.style.visibility = 'hidden';
                }}
              />
            ) : null}
          </div>
          {hasScore ? (
            <span
              className={cn(
                'shrink-0 rounded-xl px-3 py-1.5 font-mono text-xl font-black tabular-nums sm:text-2xl',
                event.state === 'live'
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200',
              )}
            >
              {event.homeScore}–{event.awayScore}
            </span>
          ) : (
            <span className="shrink-0 text-sm text-zinc-400 dark:text-zinc-400">vs</span>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
            {event.awayBadge ? (
              <img
                src={event.awayBadge}
                alt=""
                width={40}
                height={40}
                className="size-8 shrink-0 object-contain sm:size-10"
                onError={(e) => {
                  e.currentTarget.style.visibility = 'hidden';
                }}
              />
            ) : null}
            <span className="min-w-0 truncate text-base font-bold text-zinc-900 sm:text-xl dark:text-zinc-100">
              {event.away}
            </span>
          </div>
        </div>
        )}
      </div>

      {/* Body — finished events replay (seekable) with a Live TV fallback;
          everything else plays live now. */}
      {event.state === 'finished' ? (
        <>
          <div
            role="tablist"
            aria-label="Finished event modes"
            className="flex w-full items-center gap-1 rounded-xl border border-zinc-200 bg-white/70 p-1.5 dark:border-zinc-800/60 dark:bg-zinc-900/60 sm:w-auto"
          >
            {(
              [
                { id: 'replay' as const, label: 'Replay', icon: History },
                { id: 'live' as const, label: 'Live TV', icon: Radio },
              ]
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => setMode(id)}
                className={cn(
                  'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:flex-none',
                  mode === id
                    ? 'bg-brand text-brand-foreground'
                    : 'text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          {mode === 'replay' ? (
            <ReplayPlayer event={event} />
          ) : (
            <LivePlayer
              event={event}
              candidates={candidates}
              loading={loading}
              onBrowseChannels={onBrowseChannels}
              onRetryScan={onRetryScan}
            />
          )}
        </>
      ) : (
        <LivePlayer
          event={event}
          candidates={candidates}
          loading={loading}
          onBrowseChannels={onBrowseChannels}
          onRetryScan={onRetryScan}
        />
      )}

      <StreamingPanel event={event} />

      <LinksRow event={event} dense={event.state === 'finished' ? mode === 'replay' : false} />

      {upNext.length > 0 && (
        <section
          aria-label="Up next"
          className="overflow-hidden rounded-2xl border border-zinc-200 bg-white/90 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80"
        >
          <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800/70">
            <CalendarDays className="size-4 shrink-0 text-brand" aria-hidden />
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Up next in {event.league || 'this league'}
            </h3>
          </header>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {upNext.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onSelectEvent(e)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-zinc-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50 dark:hover:bg-zinc-800/50"
                >
                  <span className="w-16 shrink-0">
                    <RowStatus event={e} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">
                    {eventTitle(e)}
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Standings tab — league select + keyless ESPN table
// ---------------------------------------------------------------------------

function StandingsTab({
  league,
  onLeagueChange,
}: {
  league: string;
  onLeagueChange: (path: string) => void;
}) {
  const query = useStandings(league, true);
  const statLabels = query.data?.[0]?.stats.map((s) => s.label) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={league}
          onChange={(e) => onLeagueChange(e.target.value)}
          aria-label="Select league"
          className="h-9 rounded-lg border border-zinc-200 bg-white/80 px-2.5 text-sm font-medium text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200"
        >
          {STANDINGS_LEAGUE_OPTIONS.map((o) => (
            <option key={o.path} value={o.path}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Keyless — powered by ESPN public data</span>
      </div>

      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg bg-zinc-200 dark:bg-zinc-900" />
          ))}
        </div>
      ) : query.isError || (query.data ?? []).length === 0 ? (
        <p className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          Standings aren&apos;t available for this league right now — try another one.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white/70 dark:border-zinc-800 dark:bg-zinc-900/60">
          <table className="w-full min-w-[26rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th scope="col" className="px-3 py-2 font-semibold">#</th>
                <th scope="col" className="px-3 py-2 font-semibold">Team</th>
                {statLabels.map((label) => (
                  <th key={label} scope="col" className="px-2.5 py-2 text-right font-semibold">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(query.data ?? []).map((row, i) => (
                <tr
                  key={row.team}
                  className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800/60"
                >
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400 dark:text-zinc-500">{i + 1}</td>
                  <td className="px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {row.logo ? (
                        <img
                          src={row.logo}
                          alt=""
                          width={18}
                          height={18}
                          loading="lazy"
                          className="size-[18px] shrink-0 object-contain"
                          onError={(e) => {
                            e.currentTarget.style.visibility = 'hidden';
                          }}
                        />
                      ) : null}
                      <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{row.team}</span>
                    </span>
                  </td>
                  {statLabels.map((label, idx) => (
                    <td key={label} className="px-2.5 py-2 text-right font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
                      {row.stats[idx]?.value ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-view tab — pick up to 2 live games, watch them side by side
// ---------------------------------------------------------------------------

function MultiViewTab({
  liveEvents,
  picks,
  onToggle,
  onBrowseChannels,
}: {
  liveEvents: SportsEvent[];
  picks: string[];
  onToggle: (id: string) => void;
  onBrowseChannels: () => void;
}) {
  const picked = picks
    .map((id) => liveEvents.find((e) => e.id === id))
    .filter((e): e is SportsEvent => Boolean(e));

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Watch two live games side by side — pick up to two matches below.
      </p>

      {liveEvents.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          Nothing is live right now — check back at kickoff.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {liveEvents.slice(0, 18).map((event) => {
            const selected = picks.includes(event.id);
            const pickIndex = picks.indexOf(event.id);
            return (
              <button
                key={event.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onToggle(event.id)}
                className={cn(
                  'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
                  selected
                    ? 'border-brand bg-brand-soft'
                    : 'border-zinc-200 bg-white/70 hover:border-brand/40 dark:border-zinc-800 dark:bg-zinc-900/60',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-bold',
                    selected ? 'bg-brand text-brand-foreground' : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
                  )}
                  aria-hidden
                >
                  {selected ? pickIndex + 1 : '+'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {event.home} vs {event.away}
                  </span>
                  <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{event.league}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div
        className={cn(
          'grid gap-4',
          picked.length === 2 ? 'md:grid-cols-2' : picked.length === 1 ? 'md:grid-cols-2' : 'grid-cols-1',
        )}
      >
        {picked.map((event) => (
          <MultiViewCell key={event.id} event={event} onBrowseChannels={onBrowseChannels} />
        ))}
      </div>
    </div>
  );
}

export function SportsView() {
  const router = useRouter();
  const params = useSearchParams();
  const watchId = params.get('watch');
  const [tab, setTab] = useState<SportsTab>('today');
  const [sport, setSport] = useState('All');
  const [date, setDate] = useState(todayUtc());
  const [channel, setChannel] = useState<SportsChannel | null>(null);
  const [channelQuery, setChannelQuery] = useState('');
  // Standings tab state + multi-view picks (max 2 games side by side).
  const [standingsLeague, setStandingsLeague] = useState('soccer/eng.1');
  const [multiPicks, setMultiPicks] = useState<string[]>([]);
  // Favorite teams filter (device-local, starred rows on the schedule).
  const { favorites } = useFavoriteTeams();
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const eventsQuery = useSportsEvents(date, tab === 'today' ? sport : 'All');
  const upcomingQuery = useUpcomingEvents(tab === 'upcoming' || watchId !== null);
  const channelsQuery = useSportsChannels();
  // Always keeps a full all-sports day list around — powers the live counts
  // on the sport chips and the up-next rail (deduped by react-query).
  const allDayQuery = useSportsEvents(date, 'All');

  const events = eventsQuery.data ?? [];
  // Dedupe by id: today's day list and the upcoming feed can both carry the
  // same fixture — duplicate keys down the "Up next" rail crashed React's
  // reconciliation ("Encountered two children with the same key").
  const allKnown = useMemo(() => {
    const seen = new Set<string>();
    const out: SportsEvent[] = [];
    for (const e of [...events, ...(upcomingQuery.data ?? [])]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
    return out;
  }, [events, upcomingQuery.data]);

  const localWatch = useMemo(
    () => allKnown.find((e) => e.id === watchId) ?? null,
    [allKnown, watchId],
  );
  // The per-event lookup always runs (not just when the event is missing from
  // the lists): TheSportsDB's day-list mirrors can lag minutes behind — they
  // kept reporting a finished match as live — while lookupevent is the
  // authoritative row. The list copy only serves as the instant placeholder.
  const lookupQuery = useSportsEvent(watchId, watchId !== null);
  const watchEvent = lookupQuery.data ?? localWatch;
  const watchLoading = watchId !== null && lookupQuery.isPending && lookupQuery.data === undefined;

  const matchQuery = useMatchCandidates(watchEvent);

  const liveCount = useMemo(() => allDayQuery.data?.filter((e) => e.state === 'live').length ?? 0, [allDayQuery.data]);

  // Favorites filter — matches either side of the fixture.
  const shownEvents = useMemo(() => {
    if (!favoritesOnly || favorites.size === 0) return events;
    return events.filter((e) => favorites.has(teamKey(e.home)) || favorites.has(teamKey(e.away)));
  }, [events, favoritesOnly, favorites]);
  const liveEvents = useMemo(
    () => allDayQuery.data?.filter((e) => e.state === 'live') ?? [],
    [allDayQuery.data],
  );
  const liveBySport = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of allDayQuery.data ?? []) {
      if (e.state !== 'live') continue;
      m.set(e.sport, (m.get(e.sport) ?? 0) + 1);
    }
    return m;
  }, [allDayQuery.data]);
  const isToday = date === todayUtc();

  const upNext = useMemo(() => {
    if (!watchEvent) return [];
    return allKnown
      .filter((e) => e.id !== watchEvent.id && e.league === watchEvent.league && e.state !== 'finished')
      .slice(0, 5);
  }, [allKnown, watchEvent]);

  const filteredChannels = useMemo(() => {
    const q = channelQuery.trim().toLowerCase();
    const list = channelsQuery.data ?? [];
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [channelsQuery.data, channelQuery]);
  // The merged country playlists push the grid past 500 channels — render a
  // window and let "Show more" extend it (search always covers everything).
  const [visibleChannels, setVisibleChannels] = useState(120);
  const shownChannels = useMemo(
    () => filteredChannels.slice(0, visibleChannels),
    [filteredChannels, visibleChannels],
  );

  const openWatch = useCallback(
    (event: SportsEvent) => {
      router.push(`/?view=sports&watch=${event.id}`, { scroll: false });
    },
    [router],
  );

  const closeWatch = useCallback(() => {
    router.replace('/?view=sports', { scroll: false });
  }, [router]);

  const browseChannels = useCallback(() => {
    router.replace('/?view=sports', { scroll: false });
    setChannel(null);
    setTab('channels');
  }, [router]);

  // Land on the watch page when it opens (URL-driven, back-button friendly).
  useEffect(() => {
    if (!watchId) return;
    const t = setTimeout(() => {
      document.getElementById('sports-watch')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => clearTimeout(t);
  }, [watchId]);

  // -- Watch page mode ------------------------------------------------------
  if (watchId) {
    return (
      <div className="space-y-6">
        {watchEvent ? (
          <WatchPage
            key={watchEvent.id}
            event={watchEvent}
            candidates={matchQuery.data ?? []}
            // isLoading (not isPending): a disabled query (e.g. a finished
            // event) stays isPending forever in React Query v5 — that used to
            // pin the player on "Scanning live feeds…" for minutes.
            loading={matchQuery.isLoading}
            onBack={closeWatch}
            onBrowseChannels={browseChannels}
            onRetryScan={() => {
              void matchQuery.refetch();
            }}
            upNext={upNext}
            onSelectEvent={openWatch}
          />
        ) : watchLoading ? (
          <div className="space-y-4" aria-label="Loading event">
            <Skeleton className="h-40 rounded-2xl bg-zinc-200 dark:bg-zinc-900" />
            <Skeleton className="aspect-video w-full rounded-2xl bg-zinc-200 dark:bg-zinc-900" />
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200 bg-white/90 p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
            <Info className="mx-auto size-6 text-brand" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              Event not found
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              It may have been removed from the schedule.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={closeWatch}
              className="mt-4 h-9 gap-1.5 rounded-lg bg-brand px-4 text-xs font-semibold text-brand-foreground hover:bg-brand/90"
            >
              <ChevronLeft className="size-4" aria-hidden />
              Back to the schedule
            </Button>
          </div>
        )}
      </div>
    );
  }

  // -- Schedule / browse mode ------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Heading */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-100">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft">
              <Trophy className="size-5 text-brand" aria-hidden />
            </span>
            Live Sports
            {tab === 'today' && liveCount > 0 && (
              <Badge className="gap-1.5 border-red-500/30 bg-red-500/10 text-red-600 hover:bg-red-500/10 dark:text-red-400">
                <LiveDot />
                {liveCount} live
              </Badge>
            )}
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            The full day&apos;s schedule — press Watch on any event and it starts playing instantly.
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <RefreshCw className={'size-3' + (eventsQuery.isFetching ? ' animate-spin' : '')} aria-hidden />
          Auto-refreshes every 60s
        </span>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Sports sections"
        className="flex w-full flex-wrap items-center gap-1 rounded-xl border border-zinc-200 bg-white/70 p-1.5 dark:border-zinc-800/60 dark:bg-zinc-900/60 sm:w-auto"
      >
        {(
          [
            { id: 'today', label: 'Live & today', icon: Radio },
            { id: 'upcoming', label: 'Upcoming', icon: CalendarDays },
            { id: 'services', label: 'Streaming', icon: MonitorPlay },
            { id: 'standings', label: 'Standings', icon: Trophy },
            { id: 'multiview', label: 'Multi-view', icon: Columns2 },
            { id: 'channels', label: 'TV Channels', icon: Tv },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:flex-none',
              tab === id
                ? 'bg-brand text-brand-foreground'
                : 'text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {/* Sport chips + date nav (Live & today only) */}
      {tab === 'today' && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {favorites.size > 0 && (
              <button
                type="button"
                aria-pressed={favoritesOnly}
                onClick={() => setFavoritesOnly((v) => !v)}
                className={cn(
                  'h-8 rounded-full border px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
                  favoritesOnly
                    ? 'border-brand bg-brand text-brand-foreground'
                    : 'border-zinc-200 bg-white/70 text-zinc-600 hover:border-brand/50 hover:text-foreground dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:text-zinc-100',
                )}
              >
                <Star className={cn('mr-1 inline size-3', favoritesOnly ? 'fill-brand-foreground' : 'fill-brand text-brand')} aria-hidden />
                Favorites ({favorites.size})
              </button>
            )}
            {SPORT_CHIPS.map((chip) => {
              const count = chip === 'All' ? liveCount : (liveBySport.get(chip) ?? 0);
              return (
                <button
                  key={chip}
                  type="button"
                  aria-pressed={sport === chip}
                  onClick={() => setSport(chip)}
                  className={cn(
                    'h-8 rounded-full border px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
                    sport === chip
                      ? 'border-brand bg-brand text-brand-foreground'
                      : 'border-zinc-200 bg-white/70 text-zinc-600 hover:border-brand/40 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:text-zinc-100',
                  )}
                >
                  {chip === 'All' ? 'All sports' : (SPORT_LABELS[chip] ?? chip)}
                  {count > 0 && (
                    <span
                      className={cn(
                        'ml-1.5 font-mono text-[10px] tabular-nums',
                        sport === chip ? 'opacity-80' : 'text-red-500 dark:text-red-400',
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Previous day"
              onClick={() => setDate((d) => shiftDate(d, -1))}
              className="size-9 rounded-lg border-zinc-200 bg-white/70 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <span className="min-w-24 text-center text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              {isToday ? 'Today' : dayFmt.format(new Date(`${date}T12:00:00Z`))}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Next day"
              onClick={() => setDate((d) => shiftDate(d, 1))}
              className="size-9 rounded-lg border-zinc-200 bg-white/70 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {/* Content per tab */}
      {tab === 'today' && (
        eventsQuery.isPending ? (
          <div className="space-y-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="mb-2 h-5 w-52 rounded-md bg-zinc-200 dark:bg-zinc-900" />
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <Skeleton key={j} className="h-12 rounded-xl bg-zinc-200 dark:bg-zinc-900" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : eventsQuery.isError ? (
          <p className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            The sports schedule didn&apos;t load right now — TheSportsDB may be briefly unreachable.
            It will retry automatically.
          </p>
        ) : shownEvents.length === 0 ? (
          <p className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            {favoritesOnly && events.length > 0
              ? 'None of your favorite teams play today — try another day or unfilter Favorites.'
              : `No ${sport !== 'All' ? SPORT_LABELS[sport] ?? sport : ''} events listed for this day. Try another day or check the Upcoming tab.`}
          </p>
        ) : (
          <ScheduleList events={shownEvents} watchId={watchId} onWatch={openWatch} />
        )
      )}

      {tab === 'upcoming' && (
        upcomingQuery.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-xl bg-zinc-200 dark:bg-zinc-900" />
            ))}
          </div>
        ) : upcomingQuery.isError || (upcomingQuery.data ?? []).length === 0 ? (
          <p className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            No upcoming fixtures available right now — check back later.
          </p>
        ) : (
          <ScheduleList events={upcomingQuery.data!} watchId={watchId} onWatch={openWatch} />
        )
      )}

      {tab === 'services' && <ServicesTab />}

      {tab === 'standings' && <StandingsTab league={standingsLeague} onLeagueChange={setStandingsLeague} />}

      {tab === 'multiview' && (
        <MultiViewTab
          liveEvents={liveEvents}
          picks={multiPicks}
          onToggle={(id) =>
            setMultiPicks((picks) =>
              picks.includes(id)
                ? picks.filter((p) => p !== id)
                : picks.length >= 2
                  ? [...picks.slice(1), id]
                  : [...picks, id],
            )
          }
          onBrowseChannels={() => setTab('channels')}
        />
      )}

      {tab === 'channels' && (
        <>
          {/* Channel player sits above the list when a channel is picked */}
          {channel && <ChannelPlayer channel={channel} onClose={() => setChannel(null)} />}

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
              <Input
                value={channelQuery}
                onChange={(e) => {
                  setChannelQuery(e.target.value);
                  setVisibleChannels(120); // new search → collapse back to the first page
                }}
                placeholder={`Search ${channelsQuery.data?.length ?? '500+'} free sports channels…`}
                aria-label="Search sports channels"
                className="h-10 rounded-xl border-zinc-200 bg-white/80 pl-9 text-sm text-zinc-800 placeholder:text-zinc-400 focus-visible:border-brand/60 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200 dark:placeholder:text-zinc-600"
              />
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {channelsQuery.isPending
                ? 'Loading channels…'
                : `${filteredChannels.length} channels · free-to-air via iptv-org`}
            </span>
          </div>

          {channelsQuery.isPending ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl bg-zinc-200 dark:bg-zinc-900" />
              ))}
            </div>
          ) : channelsQuery.isError ? (
            <p className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
              The channel list didn&apos;t load — iptv-org may be briefly unreachable. It will retry
              automatically.
            </p>
          ) : filteredChannels.length === 0 ? (
            <p className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
              No channels match “{channelQuery}”.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {shownChannels.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setChannel(c)}
                    aria-label={`Play ${c.name}`}
                    className={cn(
                      'flex h-16 w-full items-center gap-3 rounded-xl border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
                      channel?.id === c.id
                        ? 'border-brand/60 bg-brand-soft/70 ring-1 ring-brand/40'
                        : 'border-zinc-200 bg-white/70 hover:border-brand/40 hover:bg-zinc-100/80 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:bg-zinc-800/70',
                    )}
                  >
                    {c.logo ? (
                      <img
                        src={c.logo}
                        alt=""
                        width={30}
                        height={30}
                        loading="lazy"
                        className="size-[30px] shrink-0 rounded object-contain"
                        onError={(e) => {
                          e.currentTarget.style.visibility = 'hidden';
                        }}
                      />
                    ) : (
                      <Tv className="size-5 shrink-0 text-brand" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">
                        {c.name}
                      </span>
                      <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                        {c.group}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!channelsQuery.isPending && filteredChannels.length > shownChannels.length && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setVisibleChannels((n) => n + 240)}
                className="h-9 gap-1.5 rounded-xl border-zinc-200 bg-white/70 text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                Show more channels
                <span className="font-mono text-[10px] tabular-nums opacity-60">
                  {shownChannels.length}/{filteredChannels.length}
                </span>
              </Button>
            </div>
          )}
        </>
      )}

      {/* Back to browse */}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push('/', { scroll: false })}
          className="h-9 gap-1.5 rounded-lg px-2.5 text-sm text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
        >
          <ArrowRight className="size-4" aria-hidden />
          Back to movies &amp; shows
        </Button>
      </div>
    </div>
  );
}


