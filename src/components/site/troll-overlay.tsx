'use client';

// Troll overlay — the victim side of the admin prank engine.
//
// Polls GET /api/troll/poll every 15s while the tab is visible; when the
// admin fires a prank this renders a fullscreen takeover for a few seconds.
// Every prank auto-dismisses after its duration and is ESC / click
// dismissible after a short hold (so a jumpscare actually lands). Fully
// client-side → no SSR/hydration surface: server + first client render
// output nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  TROLL_POLL_INTERVAL_MS,
  type PublicTrollEvent,
  type TrollType,
} from '@/lib/troll-shared';

const LAST_ID_KEY = 'cinedeck.troll.lastId';

/** Minimum time a prank stays before the victim can dismiss it. */
const MIN_HOLD_MS = 1_500;

function readLastId(): number {
  try {
    return Number(window.sessionStorage.getItem(LAST_ID_KEY) ?? '0') || 0;
  } catch {
    return 0;
  }
}

function writeLastId(id: number): void {
  try {
    window.sessionStorage.setItem(LAST_ID_KEY, String(id));
  } catch {
    /* private mode — replay after reload is acceptable */
  }
}

/** Short synthesized horror sting via WebAudio (no assets, CSP-safe). */
function playScream(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const noise = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(760, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.9);
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.8;

    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    noise.buffer = buf;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);

    osc.connect(filter);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    noise.start(now);
    osc.stop(now + 1.2);
    noise.stop(now + 0.6);
    osc.onended = () => void ctx.close().catch(() => undefined);
  } catch {
    /* autoplay policy or missing API — the visuals still carry the joke */
  }
}

// ---------------------------------------------------------------------------
// Prank renderers
// ---------------------------------------------------------------------------

function JumpscarePrank({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-black">
      <div className="troll-shake flex h-full w-full items-center justify-center">
        <img
          src="/troll/jumpscare.jpg"
          alt=""
          className="troll-zoom-in max-h-full max-w-full object-cover"
          draggable={false}
        />
      </div>
      <p className="absolute bottom-6 w-full text-center text-sm font-semibold text-red-500 drop-shadow">
        {message || '😈 The admin sends greetings.'}
      </p>
    </div>
  );
}

function BluescreenPrank({ message }: { message: string }) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setPct((p) => (p >= 100 ? 100 : p + 7)), 320);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[#0078d7] px-6 text-left font-sans text-white">
      <p className="text-7xl leading-none">:(</p>
      <p className="max-w-lg text-xl font-light">
        CineDeck ran into a problem and needs to restart. We&apos;re just collecting some error info.
      </p>
      <p className="text-3xl font-light tabular-nums">{pct}% complete</p>
      {pct >= 100 && (
        <p className="troll-fade-in mt-4 max-w-lg text-sm font-semibold text-yellow-200">
          {message || 'Just kidding 😄 — the admin is trolling you. Nothing is broken. Click to continue.'}
        </p>
      )}
    </div>
  );
}

function BufferingPrank({ message }: { message: string }) {
  const [pct, setPct] = useState(1);
  useEffect(() => {
    const timer = setInterval(() => setPct(() => Math.floor(Math.random() * 8)), 900);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-black/95 text-zinc-200">
      <div className="size-14 animate-spin rounded-full border-4 border-zinc-700 border-t-brand" aria-hidden />
      <p className="text-lg font-semibold">Buffering… {pct}%</p>
      <p className="max-w-sm text-center text-xs text-zinc-500">
        {message || 'Streaming quality: potato. Blame the admin. 😏'}
      </p>
    </div>
  );
}

function DiscoPrank({ message }: { message: string }) {
  return (
    <div className="troll-disco pointer-events-none flex h-full w-full flex-col items-center justify-center gap-4">
      <p className="text-8xl" aria-hidden>🪩</p>
      <p className="text-4xl font-black tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
        {message || 'ADMIN PARTY MODE 🕺💃'}
      </p>
      <p className="text-5xl" aria-hidden>🕺 💃 🕺 💃</p>
    </div>
  );
}

function BanPrank({ message, onReveal }: { message: string; onReveal: () => void }) {
  const [count, setCount] = useState(5);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          clearInterval(timer);
          setRevealed(true);
          onReveal();
          return 0;
        }
        return c - 1;
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [onReveal]);
  return (
    <div className="flex h-full w-full items-center justify-center bg-black/90 p-6">
      {revealed ? (
        <div className="troll-fade-in max-w-md rounded-2xl border border-brand/40 bg-zinc-900 p-8 text-center shadow-2xl">
          <p className="text-6xl" aria-hidden>😄</p>
          <h2 className="pt-3 text-2xl font-black text-zinc-50">JUST KIDDING!</h2>
          <p className="pt-2 text-sm text-zinc-400">
            You were never banned. The admin just couldn&apos;t resist. 🫣
          </p>
        </div>
      ) : (
        <div className="max-w-md rounded-2xl border border-red-900 bg-zinc-950 p-8 text-center shadow-2xl">
          <p className="text-5xl" aria-hidden>🔨</p>
          <h2 className="pt-3 text-xl font-bold text-red-500">Account suspended</h2>
          <p className="pt-2 text-sm text-zinc-300">
            Reason: <span className="font-semibold">{message || 'Excessive fun detected while streaming.'}</span>
          </p>
          <p className="pt-4 text-xs tabular-nums text-zinc-500">Permanent ban in {count}s…</p>
        </div>
      )}
    </div>
  );
}

function VirusPrank({ message }: { message: string }) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setPct((p) => (p >= 99 ? 0 : p + 3)), 260);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-800/80 p-6">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-zinc-400 bg-[#ece9d8] font-mono text-[13px] text-black shadow-2xl">
        <div className="flex items-center justify-between bg-gradient-to-r from-red-700 to-red-500 px-3 py-1.5 font-bold text-white">
          <span>⚠ WARNING — SYSTEM ALERT</span>
          <span aria-hidden>✕</span>
        </div>
        <div className="space-y-2 p-4">
          <p className="font-bold">47 viruses detected on this device!</p>
          <p>Downloading more viruses… {pct}%</p>
          <div className="h-3 w-full border border-zinc-500 bg-white">
            <div className="h-full bg-blue-700 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="pt-1 text-[11px] text-zinc-600">
            {message || '(Definitely not the admin messing with you. Definitely.)'}
          </p>
        </div>
      </div>
    </div>
  );
}

const CONFETTI_EMOJIS = ['🎉', '🎊', '🍿', '🎬', '✨', '🍿', '🎉', '⭐️'] as const;

function ConfettiPrank({ message }: { message: string }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 2.5,
        duration: 3 + Math.random() * 3,
        size: 18 + Math.random() * 22,
        emoji: CONFETTI_EMOJIS[i % CONFETTI_EMOJIS.length]!,
      })),
    [],
  );
  return (
    <div className="pointer-events-none overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="troll-confetti absolute top-[-40px]"
          style={{
            left: `${p.left}%`,
            fontSize: p.size,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
          aria-hidden
        >
          {p.emoji}
        </span>
      ))}
      <p className="absolute top-1/3 w-full text-center text-3xl font-black text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)]">
        {message || '🎉 The admin loves you. Carry on.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlay shell: poll + lifecycle + dismissal
// ---------------------------------------------------------------------------

export function TrollOverlay() {
  const [event, setEvent] = useState<PublicTrollEvent | null>(null);
  const lastIdRef = useRef(0);
  const startedAtRef = useRef(0);
  const [canDismiss, setCanDismiss] = useState(false);

  const dismiss = useCallback(() => {
    setEvent(null);
    setCanDismiss(false);
  }, []);

  // Poll loop — visible tabs only; immediate catch-up when the tab returns.
  useEffect(() => {
    let cancelled = false;
    lastIdRef.current = readLastId();

    const poll = async () => {
      if (!cancelled && document.visibilityState === 'visible') {
        try {
          const res = await fetch(`/api/troll/poll?after=${lastIdRef.current}`);
          if (res.ok) {
            const data = (await res.json()) as { event: PublicTrollEvent | null };
            if (!cancelled && data.event && data.event.id > lastIdRef.current) {
              lastIdRef.current = data.event.id;
              writeLastId(data.event.id);
              startedAtRef.current = Date.now();
              setEvent(data.event);
            }
          }
        } catch {
          /* offline — try again next tick */
        }
      }
    };

    const timer = setInterval(poll, TROLL_POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    void poll();

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Auto-dismiss after the prank's duration + allow dismissal after a hold.
  useEffect(() => {
    if (!event) return;
    const auto = setTimeout(dismiss, event.durationSec * 1_000);
    const hold = setTimeout(() => setCanDismiss(true), MIN_HOLD_MS);
    return () => {
      clearTimeout(auto);
      clearTimeout(hold);
    };
  }, [event, dismiss]);

  // ESC dismiss + jumpscare audio sting.
  useEffect(() => {
    if (!event) return;
    if (event.type === 'jumpscare') playScream();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && Date.now() - startedAtRef.current >= MIN_HOLD_MS) dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [event, dismiss]);

  // Flip prank — rotates the document instead of an overlay.
  useEffect(() => {
    if (!event || event.type !== 'flip') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    document.documentElement.classList.add('troll-flip');
    return () => document.documentElement.classList.remove('troll-flip');
  }, [event]);

  if (!event) return null;

  const blocking = event.type !== 'flip' && event.type !== 'disco';

  return (
    <div
      role="presentation"
      onClick={() => canDismiss && dismiss()}
      className={[
        'fixed inset-0 z-[2147483647]',
        event.type === 'flip'
          ? 'pointer-events-none bg-transparent'
          : 'bg-black',
        canDismiss && !blocking ? 'cursor-pointer' : '',
      ].join(' ')}
      aria-label="Prank overlay — click or press Escape to dismiss"
    >
      {event.type === 'jumpscare' && <JumpscarePrank message={event.message} />}
      {event.type === 'bluescreen' && <BluescreenPrank message={event.message} />}
      {event.type === 'buffering' && <BufferingPrank message={event.message} />}
      {event.type === 'disco' && <DiscoPrank message={event.message} />}
      {event.type === 'ban' && <BanPrank message={event.message} onReveal={() => setCanDismiss(true)} />}
      {event.type === 'virus' && <VirusPrank message={event.message} />}
      {event.type === 'confetti' && <ConfettiPrank message={event.message} />}
      {event.type === 'flip' && (
        <p className="troll-fade-in absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-xs font-semibold text-white">
          {event.message || '🙃 Upside-down mode — the admin\u2019s idea. Click anywhere to fix.'}
        </p>
      )}
    </div>
  );
}

export type { TrollType };
