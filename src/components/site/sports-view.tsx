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
  ExternalLink,
  Info,
  ListOrdered,
  Loader2,
  MonitorPlay,
  Radio,
  RefreshCw,
  Search,
  SkipForward,
  Trophy,
  Tv,
  Volume2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useSettings } from '@/lib/settings';

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

type SportsTab = 'today' | 'upcoming' | 'channels';

const SPORT_CHIPS = [
  'All',
  'Soccer',
  'Ice Hockey',
  'Basketball',
  'American Football',
  'Baseball',
  'Motorsport',
  'Fighting',
];

const SPORT_LABELS: Record<string, string> = {
  Soccer: 'Soccer',
  'Ice Hockey': 'Ice hockey',
  Basketball: 'Basketball',
  'American Football': 'Am. football',
  Baseball: 'Baseball',
  Motorsport: 'Motorsport',
  Fighting: 'Fighting',
};

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

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
      const res = await fetch(`/api/sports/events?${params.toString()}`);
      if (!res.ok) throw new Error('sports_unreachable');
      const json = (await res.json()) as { events: SportsEvent[] };
      return json.events;
    },
    staleTime: 30_000,
    // Live scores change — keep polling while the user is on the sports view.
    refetchInterval: 60_000,
  });
}

function useUpcomingEvents(enabled: boolean) {
  return useQuery<SportsEvent[]>({
    queryKey: ['sports-upcoming'],
    queryFn: async () => {
      const res = await fetch('/api/sports/events?upcoming=1');
      if (!res.ok) throw new Error('sports_unreachable');
      const json = (await res.json()) as { upcoming: SportsEvent[] };
      return json.upcoming;
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

function useSportsChannels() {
  return useQuery<SportsChannel[]>({
    queryKey: ['sports-channels'],
    queryFn: async () => {
      const res = await fetch('/api/sports/channels');
      if (!res.ok) throw new Error('iptv_unreachable');
      const json = (await res.json()) as { channels: SportsChannel[] };
      return json.channels;
    },
    staleTime: 30 * 60_000,
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
    enabled: !!event && event.state !== 'finished',
    queryFn: async () => {
      const p = new URLSearchParams({
        sport: event!.sport,
        league: event!.league,
        home: event!.home,
        away: event!.away,
      });
      const res = await fetch(`/api/sports/match?${p.toString()}`);
      if (!res.ok) throw new Error('match_unreachable');
      const json = (await res.json()) as { candidates: SportsChannel[] };
      return json.candidates;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/** Single-event lookup — powers deep links like /?view=sports&watch=<id>. */
function useSportsEvent(id: string | null, enabled: boolean) {
  return useQuery<SportsEvent | null>({
    queryKey: ['sports-event', id],
    enabled: enabled && !!id,
    queryFn: async () => {
      const res = await fetch(`/api/sports/events?id=${id}`);
      if (!res.ok) throw new Error('event_unreachable');
      const json = (await res.json()) as { event: SportsEvent | null };
      return json.event;
    },
    staleTime: 60_000,
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
        className="border-zinc-300 bg-transparent text-[10px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-500"
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
      className="border-zinc-300 bg-transparent text-[10px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-500"
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
      <span className="text-[11px] font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
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
  return <span className="text-[11px] font-bold uppercase text-zinc-400 dark:text-zinc-600">TBD</span>;
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

const WATCH_LINKS = (event: SportsEvent): { label: string; href: string }[] => {
  const q = encodeURIComponent(`${event.home} vs ${event.away} live stream`);
  const links = [
    { label: 'Sportsurge', href: 'https://sportsurge.net/' },
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
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-600">
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
// Schedule — league-grouped, morningstreams-style dense list
// ---------------------------------------------------------------------------

const STATE_RANK = { live: 0, upcoming: 1, unknown: 2, finished: 3 } as const;

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
          aria-label={`Watch ${event.home} vs ${event.away}`}
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
                    ? 'text-zinc-500 dark:text-zinc-500'
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
                    ? 'text-zinc-500 dark:text-zinc-500'
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
          </span>

          {/* sm+ — classic single line: home score away */}
          <span className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
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
                  ? 'text-zinc-500 dark:text-zinc-500'
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
              <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-600">vs</span>
            )}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm font-semibold',
                event.state === 'finished'
                  ? 'text-zinc-500 dark:text-zinc-500'
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
          </span>
        </button>

        <span className="hidden w-40 shrink-0 truncate text-[11px] text-zinc-400 lg:block dark:text-zinc-600">
          {event.venue ?? ''}
        </span>

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
          <header className="mb-1.5 flex items-center gap-2 px-1">
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
            <span className="text-[11px] text-zinc-400 dark:text-zinc-600">
              {SPORT_LABELS[sport] ?? sport} · {list.length}
            </span>
            <span aria-hidden className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800/70" />
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
// HLS channel player (hls.js, dynamically imported — Safari plays natively)
// ---------------------------------------------------------------------------

function ChannelPlayer({ channel, onClose }: { channel: SportsChannel; onClose: () => void }) {
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
}: {
  event: SportsEvent;
  candidates: SportsChannel[];
  loading: boolean;
  onBrowseChannels: () => void;
}) {
  const { autoFailover, failoverSeconds } = useSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeUrlRef = useRef<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);

  const current = candidates[idx] ?? null;
  const phase: LivePhase = current
    ? (liveUrl === current.url ? 'live' : 'connecting')
    : (loading ? 'finding' : 'exhausted');

  /** Watchdog / error fallback — jump to the next ranked candidate. */
  const advance = useCallback(() => setIdx((i) => i + 1), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current) return;
    let destroyed = false;
    let hls: { destroy: () => void } | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    activeUrlRef.current = current.url;

    const disarm = () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };
    const armWatchdog = () => {
      disarm();
      if (!autoFailover) return;
      watchdog = setTimeout(() => {
        if (!destroyed) advance();
      }, Math.max(4, failoverSeconds) * 1000);
    };

    const setup = async () => {
      // Playback goes through CineDeck's HLS proxy (fixes CORS + mixed content).
      const playUrl = `/api/sports/stream?u=${encodeURIComponent(current.url)}`;
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
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [current, autoFailover, failoverSeconds, advance]);

  /** Manual pick from the ranked feeds list. */
  const pick = (i: number) => {
    if (!candidates[i] || i === idx) return;
    setLiveUrl(null);
    setIdx(i);
  };

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        aria-label={`Live player for ${event.home} vs ${event.away}`}
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
            onPlaying={() => setLiveUrl(activeUrlRef.current)}
            onError={(e) => {
              const el = e.currentTarget;
              if (el.error && el.readyState === 0 && current) advance();
            }}
          />

          {phase === 'finding' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
              <span className="flex items-center gap-2 rounded-full bg-black/75 px-4 py-2 text-xs font-medium text-white">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Scanning live feeds for {event.home} vs {event.away}…
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
        <span className="hidden truncate text-[11px] text-zinc-500 sm:inline dark:text-zinc-500">
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
                  <span className="block truncate text-[10px] text-zinc-500 dark:text-zinc-600">
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
        <p className="px-4 py-4 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
          {loading
            ? 'Scanning every free sports channel for this match…'
            : 'No ranked feeds available right now — browse all TV channels instead.'}
        </p>
      )}
      <footer className="flex items-center justify-between gap-2 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800/70">
        <span className="text-[11px] text-zinc-400 dark:text-zinc-600">
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
  upNext,
  onSelectEvent,
}: {
  event: SportsEvent;
  candidates: SportsChannel[];
  loading: boolean;
  onBack: () => void;
  onBrowseChannels: () => void;
  upNext: SportsEvent[];
  onSelectEvent: (event: SportsEvent) => void;
}) {
  const now = useNow();
  const hasScore = event.homeScore !== null && event.awayScore !== null;

  return (
    <div id="sports-watch" className="space-y-4 scroll-mt-24">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 right-0 -z-10 h-48 w-96 rounded-full bg-brand-soft blur-3xl"
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
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
              {event.league}
              {event.round ? ` · Round ${event.round}` : ''}
            </p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-600">
              {[SPORT_LABELS[event.sport] ?? event.sport, event.venue, event.start ? `${dayFmt.format(new Date(event.start))} · ${timeFmt.format(new Date(event.start))}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>

        {/* Teams + score */}
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
            <span className="shrink-0 text-sm text-zinc-400 dark:text-zinc-600">vs</span>
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
      </div>

      {/* Body — finished events get links, everything else plays live now */}
      {event.state === 'finished' ? (
        <div className="rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Match finished</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
            Full replays usually appear on the source sites a few hours after the final whistle.
          </p>
          <div className="mt-4">
            <LinksRow event={event} dense />
          </div>
          <div className="mt-3">
            <Button
              type="button"
              size="sm"
              onClick={onBrowseChannels}
              className="h-8 gap-1.5 rounded-lg bg-brand px-3.5 text-xs font-semibold text-brand-foreground hover:bg-brand/90"
            >
              <Tv className="size-3.5" aria-hidden />
              Browse sports channels
            </Button>
          </div>
        </div>
      ) : (
        <>
          <LivePlayer
            event={event}
            candidates={candidates}
            loading={loading}
            onBrowseChannels={onBrowseChannels}
          />

          <LinksRow event={event} />

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
                        {e.home} <span className="font-normal text-zinc-400">vs</span> {e.away}
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function SportsView() {
  const router = useRouter();
  const params = useSearchParams();
  const watchId = params.get('watch');
  const [tab, setTab] = useState<SportsTab>('today');
  const [sport, setSport] = useState('All');
  const [date, setDate] = useState(todayUtc());
  const [channel, setChannel] = useState<SportsChannel | null>(null);
  const [channelQuery, setChannelQuery] = useState('');

  const eventsQuery = useSportsEvents(date, tab === 'today' ? sport : 'All');
  const upcomingQuery = useUpcomingEvents(tab === 'upcoming' || watchId !== null);
  const channelsQuery = useSportsChannels();
  // Always keeps a full all-sports day list around — powers the live counts
  // on the sport chips and the up-next rail (deduped by react-query).
  const allDayQuery = useSportsEvents(date, 'All');

  const events = eventsQuery.data ?? [];
  const allKnown = useMemo(
    () => [...events, ...(upcomingQuery.data ?? [])],
    [events, upcomingQuery.data],
  );

  const localWatch = useMemo(
    () => allKnown.find((e) => e.id === watchId) ?? null,
    [allKnown, watchId],
  );
  const lookupQuery = useSportsEvent(watchId, watchId !== null && localWatch === null);
  const watchEvent = localWatch ?? (lookupQuery.data ?? null);
  const watchLoading = watchId !== null && localWatch === null && lookupQuery.isPending;

  const matchQuery = useMatchCandidates(watchEvent);

  const liveCount = useMemo(() => allDayQuery.data?.filter((e) => e.state === 'live').length ?? 0, [allDayQuery.data]);
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
            event={watchEvent}
            candidates={matchQuery.data ?? []}
            loading={matchQuery.isPending}
            onBack={closeWatch}
            onBrowseChannels={browseChannels}
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
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
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
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-500">
            The full day&apos;s schedule — press Watch on any event and it starts playing instantly.
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-600">
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
          <p className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-500">
            The sports schedule didn&apos;t load right now — TheSportsDB may be briefly unreachable.
            It will retry automatically.
          </p>
        ) : events.length === 0 ? (
          <p className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-500">
            No {sport !== 'All' ? SPORT_LABELS[sport] ?? sport : ''} events listed for this day.
            Try another day or check the Upcoming tab.
          </p>
        ) : (
          <ScheduleList events={events} watchId={watchId} onWatch={openWatch} />
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
          <p className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-500">
            No upcoming fixtures available right now — check back later.
          </p>
        ) : (
          <ScheduleList events={upcomingQuery.data!} watchId={watchId} onWatch={openWatch} />
        )
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
                onChange={(e) => setChannelQuery(e.target.value)}
                placeholder="Search 280+ free sports channels…"
                aria-label="Search sports channels"
                className="h-10 rounded-xl border-zinc-200 bg-white/80 pl-9 text-sm text-zinc-800 placeholder:text-zinc-400 focus-visible:border-brand/60 focus-visible:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200 dark:placeholder:text-zinc-600"
              />
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-600">
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
            <p className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-500">
              The channel list didn&apos;t load — iptv-org may be briefly unreachable. It will retry
              automatically.
            </p>
          ) : filteredChannels.length === 0 ? (
            <p className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-500">
              No channels match “{channelQuery}”.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {filteredChannels.map((c) => (
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
                      <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-600">
                        {c.group}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
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


