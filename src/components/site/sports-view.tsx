'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  MonitorPlay,
  Radio,
  RefreshCw,
  Search,
  Trophy,
  Tv,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

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

function EventCard({
  event,
  selected,
  onWatch,
}: {
  event: SportsEvent;
  selected: boolean;
  onWatch: (event: SportsEvent) => void;
}) {
  return (
    <article
      className={cn(
        'group relative flex min-w-0 flex-col rounded-xl border bg-white/80 p-4 transition-shadow hover:shadow-md dark:bg-zinc-900/60',
        selected
          ? 'border-brand/60 ring-2 ring-brand/30'
          : 'border-zinc-200 dark:border-zinc-800/70',
        event.state === 'live' && 'border-red-500/30 dark:border-red-500/30',
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        {event.leagueBadge ? (
           
          <img
            src={event.leagueBadge}
            alt=""
            width={22}
            height={22}
            loading="lazy"
            className="size-[22px] shrink-0 rounded object-contain"
          />
        ) : (
          <Trophy className="size-4 shrink-0 text-brand" aria-hidden />
        )}
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
          {event.league}
        </span>
        <span className="ml-auto shrink-0">
          <StatusPill event={event} />
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'truncate text-sm font-semibold',
              event.state === 'finished' &&
                event.homeScore !== null &&
                event.awayScore !== null &&
                event.homeScore < event.awayScore
                ? 'text-zinc-500 dark:text-zinc-500'
                : 'text-zinc-900 dark:text-zinc-100',
            )}
          >
            {event.home}
          </span>
          {event.homeScore !== null && (
            <span
              className={cn(
                'ml-auto rounded-md px-1.5 py-0.5 font-mono text-sm font-bold',
                event.state === 'live'
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
              )}
            >
              {event.homeScore}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'truncate text-sm font-semibold',
              event.state === 'finished' &&
                event.awayScore !== null &&
                event.homeScore !== null &&
                event.awayScore < event.homeScore
                ? 'text-zinc-500 dark:text-zinc-500'
                : 'text-zinc-900 dark:text-zinc-100',
            )}
          >
            {event.away}
          </span>
          {event.awayScore !== null && (
            <span
              className={cn(
                'ml-auto rounded-md px-1.5 py-0.5 font-mono text-sm font-bold',
                event.state === 'live'
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
              )}
            >
              {event.awayScore}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-600">
          {[SPORT_LABELS[event.sport] ?? event.sport, event.venue].filter(Boolean).join(' · ')}
        </span>
        <Button
          type="button"
          size="sm"
          onClick={() => onWatch(event)}
          className={cn(
            'h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs font-semibold',
            event.state === 'live'
              ? 'bg-red-500 text-white hover:bg-red-400'
              : 'bg-brand text-brand-foreground hover:bg-brand/90',
          )}
        >
          {event.state === 'live' ? <Radio className="size-3.5" aria-hidden /> : <MonitorPlay className="size-3.5" aria-hidden />}
          {event.state === 'live' ? 'Watch live' : event.state === 'upcoming' ? 'Preview' : 'Watch'}
        </Button>
      </div>
    </article>
  );
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

function WatchPanel({
  event,
  onClose,
  onBrowseChannels,
}: {
  event: SportsEvent;
  onClose: () => void;
  onBrowseChannels: () => void;
}) {
  const now = useNow();

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      aria-label={`Watch ${event.home} vs ${event.away}`}
      className="relative scroll-mt-24 overflow-hidden rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80 sm:p-6"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 right-0 -z-10 h-48 w-96 rounded-full bg-brand-soft blur-3xl"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Close watch panel"
        onClick={onClose}
        className="absolute right-3 top-3 size-8 rounded-lg text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100"
      >
        <X className="size-4" aria-hidden />
      </Button>

      <div className="flex flex-wrap items-center gap-3">
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
          <h2 className="truncate text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {event.home} <span className="font-normal text-zinc-400">vs</span> {event.away}
          </h2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusPill event={event} />
          {event.state === 'upcoming' && event.start && (
            <span className="rounded-lg bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">
              {countdownParts(event.start, now)}
            </span>
          )}
        </div>
      </div>

      {event.state === 'live' && (
        <p className="mt-4 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          <strong className="font-semibold text-red-600 dark:text-red-400">This match is live right now.</strong>{' '}
          Free event streams rotate constantly — grab a working feed from the links below, or play an
          always-on sports channel from the TV Channels tab.
        </p>
      )}
      {event.state === 'upcoming' && (
        <p className="mt-4 rounded-xl border border-brand/25 bg-brand-soft/60 px-4 py-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          Not started yet. When it kicks off, grab a feed from the links below — or keep an
          always-on sports channel playing from the TV Channels tab.
        </p>
      )}
      {event.state === 'finished' && (
        <p className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Finished. Full replays usually appear on the source sites a few hours after the final whistle.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
          Where to watch
        </span>
        {WATCH_LINKS(event).map((link) => (
          <Button
            key={link.label}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.open(link.href, '_blank', 'noopener,noreferrer')}
            className="h-9 gap-1.5 rounded-lg border-zinc-200 bg-white/70 text-xs text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            {link.label}
            <ExternalLink className="size-3.5" aria-hidden />
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          onClick={onBrowseChannels}
          className="h-9 gap-1.5 rounded-lg bg-brand px-3.5 text-xs font-semibold text-brand-foreground hover:bg-brand/90"
        >
          <Tv className="size-4" aria-hidden />
          Browse TV channels
        </Button>
      </div>
    </motion.section>
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
        { }
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
// Main view
// ---------------------------------------------------------------------------

export function SportsView() {
  const router = useRouter();
  const [tab, setTab] = useState<SportsTab>('today');
  const [sport, setSport] = useState('All');
  const [date, setDate] = useState(todayUtc);
  const [selected, setSelected] = useState<SportsEvent | null>(null);
  const [channel, setChannel] = useState<SportsChannel | null>(null);
  const [channelQuery, setChannelQuery] = useState('');

  const eventsQuery = useSportsEvents(date, tab === 'today' ? sport : 'All');
  const upcomingQuery = useUpcomingEvents(tab === 'upcoming');
  const channelsQuery = useSportsChannels();

  const events = eventsQuery.data ?? [];
  const liveCount = useMemo(() => events.filter((e) => e.state === 'live').length, [events]);
  const isToday = date === todayUtc();

  const filteredChannels = useMemo(() => {
    const q = channelQuery.trim().toLowerCase();
    const list = channelsQuery.data ?? [];
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [channelsQuery.data, channelQuery]);

  const openWatch = (event: SportsEvent) => {
    setChannel(null);
    setSelected(event);
    requestAnimationFrame(() => {
      document.getElementById('sports-watch-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

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
            Live scores, schedules and free sports TV channels — keyless via TheSportsDB &amp; iptv-org.
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
            {SPORT_CHIPS.map((chip) => (
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
              </button>
            ))}
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

      {/* Watch panel (event selected) */}
      {selected && tab !== 'channels' && (
        <div id="sports-watch-panel">
          <WatchPanel
            event={selected}
            onClose={() => setSelected(null)}
            onBrowseChannels={() => {
              setTab('channels');
              setSelected(null);
            }}
          />
        </div>
      )}

      {/* Content per tab */}
      {tab === 'today' && (
        eventsQuery.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl bg-zinc-200 dark:bg-zinc-900" />
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} selected={selected?.id === event.id} onWatch={openWatch} />
            ))}
          </div>
        )
      )}

      {tab === 'upcoming' && (
        upcomingQuery.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl bg-zinc-200 dark:bg-zinc-900" />
            ))}
          </div>
        ) : upcomingQuery.isError || (upcomingQuery.data ?? []).length === 0 ? (
          <p className="rounded-xl border border-zinc-200 bg-white/70 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-500">
            No upcoming fixtures available right now — check back later.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {upcomingQuery.data!.map((event) => (
              <EventCard key={event.id} event={event} selected={selected?.id === event.id} onWatch={openWatch} />
            ))}
          </div>
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
