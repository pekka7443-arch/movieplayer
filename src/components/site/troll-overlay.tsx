'use client';

// Troll overlay — the victim side of the admin prank engine.
//
// Polls GET /api/troll/poll every 15s while the tab is visible; when the
// admin fires a prank this renders a fullscreen takeover for a few seconds.
// Every prank auto-dismisses after its duration and is ESC / click
// dismissible after a short hold (so a jumpscare actually lands). Fully
// client-side → no SSR/hydration surface: server + first client render
// output nothing.
//
// Effect families:
//   • overlay takeovers (jumpscare, bluescreen, buffering, disco, ban, virus,
//     confetti, rickroll, doink, cats, error, message)
//   • document transforms (flip, mirror, drunk, tiny, giant, shake) — these
//     add a class to <html> so the whole page transforms
//   • scroll hijack (scrollreverse) — inverts the wheel axis
// A revoked override (admin pressed Revoke) dismisses itself on the next poll.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DOCUMENT_EFFECTS,
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

type AudioCtxCtor = typeof AudioContext;

function getAudioCtx(): AudioContext | null {
  try {
    const Ctx = (window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext) as AudioCtxCtor | undefined;
    return Ctx ? new Ctx() : null;
  } catch {
    return null;
  }
}

/** Short synthesized horror sting via WebAudio (no assets, CSP-safe). */
function playScream(): void {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
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

/** Cartoon boing — a springy pitch wobble (no assets, CSP-safe). */
function playBoing(): void {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.42);
    // wobble = the spring
    for (let i = 1; i <= 6; i++) {
      osc.frequency.setValueAtTime(i % 2 ? 300 : 170, now + 0.08 * i);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.6);
    osc.onended = () => void ctx.close().catch(() => undefined);
  } catch {
    /* silent fallback */
  }
}

// ---------------------------------------------------------------------------
// Prank renderers — originals
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
// Prank renderers — the new protocols
// ---------------------------------------------------------------------------

const RICKROLL_LINES = [
  "Never gonna give you up",
  "Never gonna let you down",
  "Never gonna run around and desert you",
  "Never gonna make you cry",
  "Never gonna say goodbye",
  "Never gonna tell a lie and hurt you",
] as const;

function RickrollPrank({ message }: { message: string }) {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setLine((l) => (l + 1) % RICKROLL_LINES.length), 2_600);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-8 bg-[#050505] px-6 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-600">
        legacy media compatibility check — reference clip 1987
      </p>
      {/* equalizer */}
      <div className="flex h-24 items-end gap-1.5" aria-hidden>
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={i}
            className="troll-eq-bar w-2 rounded-t-sm bg-[#3b82f6]"
            style={{ animationDelay: `${(i % 8) * 0.09}s`, animationDuration: `${0.5 + (i % 5) * 0.08}s` }}
          />
        ))}
      </div>
      <p key={line} className="troll-fade-in max-w-xl text-2xl font-bold text-white sm:text-3xl">
        {RICKROLL_LINES[line]}
      </p>
      <p className="text-xs text-zinc-500">{message || 'You know the rules, and so do I.'}</p>
    </div>
  );
}

function DoinkPrank({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-black/95">
      <p className="troll-doink text-[18vw] font-black tracking-tighter text-[#3b82f6] sm:text-[12vw]" aria-hidden>
        DOINK!
      </p>
      <p className="absolute bottom-10 w-full text-center text-sm font-semibold text-zinc-300">
        {message || 'The admin has doinked you. You have been doinked.'}
      </p>
    </div>
  );
}

const CAT_EMOJIS = ['🐱', '🐈', '😻', '🐈‍⬛', '😹', '😺'] as const;

function CatsPrank({ message }: { message: string }) {
  const cats = useMemo(
    () =>
      Array.from({ length: 45 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 3,
        duration: 3.5 + Math.random() * 3.5,
        size: 22 + Math.random() * 30,
        emoji: CAT_EMOJIS[i % CAT_EMOJIS.length]!,
      })),
    [],
  );
  return (
    <div className="pointer-events-none overflow-hidden bg-[#0a0a0a]">
      {cats.map((c, i) => (
        <span
          key={i}
          className="troll-confetti absolute top-[-40px]"
          style={{ left: `${c.left}%`, fontSize: c.size, animationDelay: `${c.delay}s`, animationDuration: `${c.duration}s` }}
          aria-hidden
        >
          {c.emoji}
        </span>
      ))}
      <p className="absolute top-1/3 w-full text-center text-3xl font-black text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
        {message || 'Everything is a cat now 🐈'}
      </p>
    </div>
  );
}

function ErrorPrank({ message }: { message: string }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setProgress((p) => Math.min(100, p + 4 + Math.random() * 9)), 280);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0a0a0a] p-6">
      <div className="w-full max-w-xl rounded-xl border border-red-900/60 bg-[#111111] p-6 font-mono text-[13px]">
        <div className="flex items-center gap-2 border-b border-[#1f1f1f] pb-3">
          <span className="size-2.5 rounded-full bg-[#ef4444]" aria-hidden />
          <p className="font-bold text-[#ef4444]">Unhandled exception — cinedeck.client</p>
        </div>
        <pre className="overflow-hidden pt-3 text-[11px] leading-relaxed text-zinc-400">{`Error: PLAYER_PIPELINE_COLLAPSE (0x8007DOINK)
    at StreamResolver.resolve (/app/src/lib/server/stream.ts:412:19)
    at async WatchView.bootstrap (/app/src/components/site/watch-view.tsx:88:5)
    at async Object.$$render (/app/.next/server/chunk-4f2a.js:11042:24)
    at async Session.reviveAll (/app/src/lib/server/auth.ts:233:11)
    at async HTMLVideoElement.play (<anonymous>)`}</pre>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[#1f1f1f]">
          <div className="h-full bg-[#3b82f6] transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="pt-2 text-[11px] text-zinc-500">
          {progress >= 100
            ? message || 'Just kidding — nothing is broken. The admin sends regards. 😏'
            : 'Restarting client…'}
        </p>
      </div>
    </div>
  );
}

function MessagePrank({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0a0a0a] p-8 text-center">
      <p className="troll-fade-in max-w-2xl text-2xl font-semibold leading-relaxed text-white sm:text-3xl">
        {message || 'A notice from the administrators.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlay shell: poll + lifecycle + dismissal
// ---------------------------------------------------------------------------

/** Document-level transforms: class added to <html> while active. */
const DOC_CLASS: Partial<Record<TrollType, string>> = {
  flip: 'troll-flip',
  mirror: 'troll-mirror',
  drunk: 'troll-drunk',
  tiny: 'troll-tiny',
  giant: 'troll-giant',
  shake: 'troll-shake-doc',
};

const NON_BLOCKING: readonly TrollType[] = [...DOCUMENT_EFFECTS, 'scrollreverse'];

const MODE_HINTS: Partial<Record<TrollType, string>> = {
  flip: '🙃 Upside-down mode — the admin\u2019s idea. Click anywhere to fix.',
  mirror: '🪞 Mirror mode — the admin\u2019s idea. Click anywhere to fix.',
  drunk: '🥴 Motion test in progress — click anywhere to opt out.',
  tiny: '🔍 Compact display protocol engaged. Click anywhere to restore.',
  giant: '🔭 Accessibility scale override engaged. Click anywhere to restore.',
  scrollreverse: '⇅ Scroll direction override — click anywhere to restore.',
  shake: '📳 Haptic feedback simulation — click anywhere to stop.',
};

export function TrollOverlay() {
  const [event, setEvent] = useState<PublicTrollEvent | null>(null);
  const eventRef = useRef<PublicTrollEvent | null>(null);
  const lastIdRef = useRef(0);
  const startedAtRef = useRef(0);
  const [canDismiss, setCanDismiss] = useState(false);

  const dismiss = useCallback(() => {
    eventRef.current = null;
    setEvent(null);
    setCanDismiss(false);
  }, []);

  // Poll loop — visible tabs only; immediate catch-up when the tab returns.
  // While a prank is on screen the cursor stays one behind it so a REVOKE
  // (revokedAt set on the same event id) is observed and dismisses early.
  useEffect(() => {
    let cancelled = false;
    lastIdRef.current = readLastId();

    const poll = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      const active = eventRef.current;
      const cursor = active ? active.id - 1 : lastIdRef.current;
      try {
        const res = await fetch(`/api/troll/poll?after=${cursor}`);
        if (res.ok) {
          const data = (await res.json()) as { event: PublicTrollEvent | null };
          if (cancelled || !data.event) return;
          if (active && data.event.id === active.id) {
            if (data.event.revokedAt) dismiss();
            return;
          }
          if (!active && data.event.id > lastIdRef.current && !data.event.revokedAt) {
            lastIdRef.current = data.event.id;
            writeLastId(data.event.id);
            startedAtRef.current = Date.now();
            eventRef.current = data.event;
            setEvent(data.event);
          }
        }
      } catch {
        /* offline — try again next tick */
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
  }, [dismiss]);

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

  // ESC dismiss + audio stings.
  useEffect(() => {
    if (!event) return;
    if (event.type === 'jumpscare') playScream();
    if (event.type === 'doink') playBoing();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && Date.now() - startedAtRef.current >= MIN_HOLD_MS) dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [event, dismiss]);

  // Document-transform pranks (flip / mirror / drunk / tiny / giant / shake).
  useEffect(() => {
    if (!event) return;
    const cls = DOC_CLASS[event.type];
    if (!cls) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    document.documentElement.classList.add(cls);
    return () => document.documentElement.classList.remove(cls);
  }, [event]);

  // Reversed scroll — invert the wheel axis while active.
  useEffect(() => {
    if (!event || event.type !== 'scrollreverse') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      window.scrollBy({ top: -e.deltaY, behavior: 'auto' });
    };
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => window.removeEventListener('wheel', onWheel, { capture: true });
  }, [event]);

  if (!event) return null;

  const nonBlocking = NON_BLOCKING.includes(event.type);

  return (
    <div
      role="presentation"
      onClick={() => canDismiss && dismiss()}
      className={[
        'fixed inset-0 z-[2147483647]',
        nonBlocking ? 'pointer-events-none bg-transparent' : 'bg-black',
        canDismiss && nonBlocking ? 'cursor-pointer' : '',
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
      {event.type === 'rickroll' && <RickrollPrank message={event.message} />}
      {event.type === 'doink' && <DoinkPrank message={event.message} />}
      {event.type === 'cats' && <CatsPrank message={event.message} />}
      {event.type === 'error' && <ErrorPrank message={event.message} />}
      {event.type === 'message' && <MessagePrank message={event.message} />}
      {nonBlocking && (
        <p className="troll-fade-in absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-xs font-semibold text-white">
          {event.message || MODE_HINTS[event.type] || 'Override active — click anywhere to restore.'}
        </p>
      )}
    </div>
  );
}

export type { TrollType };
