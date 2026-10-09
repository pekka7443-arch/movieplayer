'use client';

// Client experience overlay — the receiving end of the User Experience
// protocol engine.
//
// Polls GET /api/ux/poll every 15s while the tab is visible; when a protocol
// is applied this renders a fullscreen system surface for its duration.
// Everything shown MUST read like ordinary platform/system behaviour — no
// caption may hint that a person triggered it. Every surface auto-dismisses
// after its duration and is ESC / click dismissible after a short hold.
// Fully client-side → no SSR/hydration surface: server + first client render
// output nothing.
//
// Surface families:
//   • overlay takeovers (alert-override, display-recovery, throttle-simulation,
//     ambient-calibration, status-preview, security-scan, celebration-trigger,
//     media-compatibility, interaction-gate, content-placeholder,
//     error-validation, user-communication)
//   • document transforms (orientation-override, reflection-mode, motion-test,
//     compact-display, scale-override, haptic-simulation) — a class on <html>
//   • input override (scroll-override) — inverts the wheel axis
// A revoked override (operator pressed Revoke) dismisses itself on next poll.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DOCUMENT_EFFECTS,
  POLL_INTERVAL_MS,
  type PublicEffectEvent,
  type EffectId,
} from '@/lib/ux-shared';

const LAST_ID_KEY = 'cinedeck.ux.cursor';

/** Minimum time a surface stays before it can be dismissed. */
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

/** Short synthesized alert sting via WebAudio (no assets, CSP-safe). */
function playSting(): void {
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
    /* autoplay policy or missing API — the visuals still carry the surface */
  }
}

/** Springy synthesized tone (no assets, CSP-safe). */
function playSpring(): void {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.42);
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
// Surface renderers
// ---------------------------------------------------------------------------

function AlertSurface() {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-black">
      <div className="ux-shake flex h-full w-full items-center justify-center">
        <img
          src="/assets/media/overlay-alert.jpg"
          alt=""
          className="ux-zoom-in max-h-full max-w-full object-cover"
          draggable={false}
        />
      </div>
    </div>
  );
}

function RecoverySurface({ message }: { message: string }) {
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
        <p className="ux-fade-in mt-4 max-w-lg text-sm font-medium text-white/90">
          {message || 'Recovery complete. Click anywhere to continue.'}
        </p>
      )}
    </div>
  );
}

function ThrottleSurface({ message }: { message: string }) {
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
        {message || 'This is taking longer than usual. Trying to reconnect…'}
      </p>
    </div>
  );
}

function CalibrationSurface({ message }: { message: string }) {
  return (
    <div className="ux-calibration pointer-events-none flex h-full w-full flex-col items-center justify-end gap-4 pb-14">
      <p className="max-w-xl text-center text-lg font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
        {message || 'Calibrating display color profile — please keep this window open.'}
      </p>
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-white/70">
        do not power off the device
      </p>
    </div>
  );
}

function StatusSurface({ message, onRestored }: { message: string; onRestored: () => void }) {
  const [count, setCount] = useState(5);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          clearInterval(timer);
          setRestored(true);
          onRestored();
          return 0;
        }
        return c - 1;
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [onRestored]);
  return (
    <div className="flex h-full w-full items-center justify-center bg-black/95 p-6">
      {restored ? (
        <div className="ux-fade-in max-w-md rounded-xl border border-[#1f1f1f] bg-[#111111] p-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-400">Access restored</p>
          <h2 className="pt-2 text-xl font-bold text-zinc-50">Your account has been re-verified</h2>
          <p className="pt-2 text-sm leading-relaxed text-zinc-400">
            Full access has been restored to this account. No action is required — you can continue
            where you left off.
          </p>
        </div>
      ) : (
        <div className="max-w-md rounded-xl border border-red-900 bg-zinc-950 p-8 text-center">
          <h2 className="text-xl font-bold text-red-500">Account suspended</h2>
          <p className="pt-3 text-sm text-zinc-300">
            Reason: <span className="font-semibold">{message || 'Suspicious streaming activity detected.'}</span>
          </p>
          <p className="pt-4 text-xs tabular-nums text-zinc-500">Permanent suspension in {count}s…</p>
        </div>
      )}
    </div>
  );
}

const SCAN_PATHS = [
  'C:\\Users\\Public\\Downloads\\player_cache\\segment-0441.tmp',
  'C:\\ProgramData\\cinedeck\\cache\\manifest.dat',
  'C:\\Users\\Public\\Documents\\subtitle_stream\\chunk-882.vtt',
  'C:\\Windows\\Temp\\cdn_edge\\prefetch-118.bin',
  'C:\\Users\\Public\\Downloads\\media_index\\thumb-2209.webp',
] as const;

function ScanSurface({ message }: { message: string }) {
  const [pct, setPct] = useState(0);
  const [file, setFile] = useState<string>(SCAN_PATHS[0]!);
  useEffect(() => {
    const tick = setInterval(() => setPct((p) => (p >= 99 ? 0 : p + 3)), 260);
    const path = setInterval(() => setFile(SCAN_PATHS[Math.floor(Math.random() * SCAN_PATHS.length)]!), 1400);
    return () => {
      clearInterval(tick);
      clearInterval(path);
    };
  }, []);
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-800/80 p-6">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-zinc-400 bg-[#ece9d8] font-mono text-[13px] text-black shadow-2xl">
        <div className="flex items-center justify-between bg-gradient-to-r from-red-700 to-red-500 px-3 py-1.5 font-bold text-white">
          <span>⚠ SYSTEM SECURITY ALERT</span>
          <span aria-hidden>✕</span>
        </div>
        <div className="space-y-2 p-4">
          <p className="font-bold">3 threats detected on this device.</p>
          <p>Running full system scan… {pct}%</p>
          <div className="h-3 w-full border border-zinc-500 bg-white">
            <div className="h-full bg-blue-700 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="truncate pt-1 text-[11px] text-zinc-600">Scanning: {file}</p>
          {message && <p className="pt-1 text-[11px] text-zinc-600">{message}</p>}
        </div>
      </div>
    </div>
  );
}

const CONFETTI_EMOJIS = ['🎉', '🎊', '🍿', '🎬', '✨', '🍿', '🎉', '⭐️'] as const;

function CelebrationSurface({ message }: { message: string }) {
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
          className="ux-confetti absolute top-[-40px]"
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
      <p className="absolute top-1/3 w-full text-center text-2xl font-bold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)]">
        {message || 'Maintenance completed successfully. Thank you for your patience.'}
      </p>
    </div>
  );
}

const COMPAT_LINES = [
  'Never gonna give you up',
  'Never gonna let you down',
  'Never gonna run around and desert you',
  'Never gonna make you cry',
  'Never gonna say goodbye',
  'Never gonna tell a lie and hurt you',
] as const;

function CompatSurface({ message }: { message: string }) {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setLine((l) => (l + 1) % COMPAT_LINES.length), 2_600);
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
            className="ux-eq-bar w-2 rounded-t-sm bg-[#3b82f6]"
            style={{ animationDelay: `${(i % 8) * 0.09}s`, animationDuration: `${0.5 + (i % 5) * 0.08}s` }}
          />
        ))}
      </div>
      <p key={line} className="ux-fade-in max-w-xl text-2xl font-bold text-white sm:text-3xl">
        {COMPAT_LINES[line]}
      </p>
      <p className="text-xs text-zinc-500">{message}</p>
    </div>
  );
}

function GateSurface({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-black/95">
      <p className="ux-spring text-[18vw] font-black tracking-tighter text-[#3b82f6] sm:text-[12vw]" aria-hidden>
        DOINK!
      </p>
      <p className="absolute bottom-10 w-full text-center text-sm font-medium text-zinc-300">
        {message || 'Interaction gate completed. No action is required.'}
      </p>
    </div>
  );
}

const PLACEHOLDER_EMOJIS = ['🐱', '🐈', '😻', '🐈‍⬛', '😹', '😺'] as const;

function PlaceholderSurface({ message }: { message: string }) {
  const items = useMemo(
    () =>
      Array.from({ length: 45 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 3,
        duration: 3.5 + Math.random() * 3.5,
        size: 22 + Math.random() * 30,
        emoji: PLACEHOLDER_EMOJIS[i % PLACEHOLDER_EMOJIS.length]!,
      })),
    [],
  );
  return (
    <div className="pointer-events-none overflow-hidden bg-[#0a0a0a]">
      {items.map((c, i) => (
        <span
          key={i}
          className="ux-confetti absolute top-[-40px]"
          style={{ left: `${c.left}%`, fontSize: c.size, animationDelay: `${c.delay}s`, animationDuration: `${c.duration}s` }}
          aria-hidden
        >
          {c.emoji}
        </span>
      ))}
      <p className="absolute top-1/3 w-full text-center text-2xl font-bold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
        {message || 'Revalidating media placeholders…'}
      </p>
    </div>
  );
}

const TRACE = `Error: PLAYER_PIPELINE_COLLAPSE (0x80070057)
    at StreamResolver.resolve (/app/src/lib/server/stream.ts:412:19)
    at async WatchView.bootstrap (/app/src/components/site/watch-view.tsx:88:5)
    at async Object.$$render (/app/.next/server/chunk-4f2a.js:11042:24)
    at async Session.reviveAll (/app/src/lib/server/auth.ts:233:11)
    at async HTMLVideoElement.play (<anonymous>)` as const;

function ValidationSurface({ message }: { message: string }) {
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
        <pre className="overflow-hidden pt-3 text-[11px] leading-relaxed text-zinc-400">{TRACE}</pre>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[#1f1f1f]">
          <div className="h-full bg-[#3b82f6] transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="pt-2 text-[11px] text-zinc-500">
          {progress >= 100
            ? message || 'Recovery options exhausted. The client will restart shortly…'
            : 'Restarting client…'}
        </p>
      </div>
    </div>
  );
}

function NoticeSurface({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0a0a0a] p-8 text-center">
      <p className="ux-fade-in max-w-2xl text-2xl font-semibold leading-relaxed text-white sm:text-3xl">
        {message || 'A notice from the CineDeck team.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlay shell: poll + lifecycle + dismissal
// ---------------------------------------------------------------------------

/** Document-level transforms: class added to <html> while active. */
const DOC_CLASS: Partial<Record<EffectId, string>> = {
  'orientation-override': 'ux-orientation',
  'reflection-mode': 'ux-reflection',
  'motion-test': 'ux-motion',
  'compact-display': 'ux-compact',
  'scale-override': 'ux-scale',
  'haptic-simulation': 'ux-shake-doc',
};

const NON_BLOCKING: readonly EffectId[] = [...DOCUMENT_EFFECTS, 'scroll-override'];

/** Neutral system-style hints for the non-blocking modes. */
const MODE_HINTS: Partial<Record<EffectId, string>> = {
  'orientation-override': 'Display compatibility mode is active — click anywhere to restore.',
  'reflection-mode': 'Interface reflection mode is active — click anywhere to restore.',
  'motion-test': 'Motion calibration in progress — click anywhere to opt out.',
  'compact-display': 'Compact display protocol is active — click anywhere to restore.',
  'scale-override': 'Accessibility scale override is active — click anywhere to restore.',
  'scroll-override': 'Scroll direction override is active — click anywhere to restore.',
  'haptic-simulation': 'Haptic feedback simulation is active — click anywhere to stop.',
};

export function UxOverlay() {
  const [event, setEvent] = useState<PublicEffectEvent | null>(null);
  const eventRef = useRef<PublicEffectEvent | null>(null);
  const lastIdRef = useRef(0);
  const startedAtRef = useRef(0);
  const [canDismiss, setCanDismiss] = useState(false);

  const dismiss = useCallback(() => {
    eventRef.current = null;
    setEvent(null);
    setCanDismiss(false);
  }, []);

  // Poll loop — visible tabs only; immediate catch-up when the tab returns.
  // While a surface is on screen the cursor stays one behind it so a REVOKE
  // (revokedAt set on the same event id) is observed and dismisses early.
  useEffect(() => {
    let cancelled = false;
    lastIdRef.current = readLastId();

    const poll = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      const active = eventRef.current;
      const cursor = active ? active.id - 1 : lastIdRef.current;
      try {
        const res = await fetch(`/api/ux/poll?after=${cursor}`);
        if (res.ok) {
          const data = (await res.json()) as { event: PublicEffectEvent | null };
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

    const timer = setInterval(poll, POLL_INTERVAL_MS);
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

  // Auto-dismiss after the surface's duration + allow dismissal after a hold.
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
    if (event.effect === 'alert-override') playSting();
    if (event.effect === 'interaction-gate') playSpring();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && Date.now() - startedAtRef.current >= MIN_HOLD_MS) dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [event, dismiss]);

  // Document-transform surfaces (orientation / reflection / motion / compact / scale / haptic).
  useEffect(() => {
    if (!event) return;
    const cls = DOC_CLASS[event.effect];
    if (!cls) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    document.documentElement.classList.add(cls);
    return () => document.documentElement.classList.remove(cls);
  }, [event]);

  // Scroll override — invert the wheel axis while active.
  useEffect(() => {
    if (!event || event.effect !== 'scroll-override') return;
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

  const nonBlocking = NON_BLOCKING.includes(event.effect);
  const message = event.message;

  return (
    <div
      role="presentation"
      onClick={() => canDismiss && dismiss()}
      className={[
        'fixed inset-0 z-[2147483647]',
        nonBlocking ? 'pointer-events-none bg-transparent' : 'bg-black',
        canDismiss && nonBlocking ? 'cursor-pointer' : '',
      ].join(' ')}
      aria-label="System overlay — click or press Escape to dismiss"
    >
      {event.effect === 'alert-override' && <AlertSurface />}
      {event.effect === 'display-recovery' && <RecoverySurface message={message} />}
      {event.effect === 'throttle-simulation' && <ThrottleSurface message={message} />}
      {event.effect === 'ambient-calibration' && <CalibrationSurface message={message} />}
      {event.effect === 'status-preview' && <StatusSurface message={message} onRestored={() => setCanDismiss(true)} />}
      {event.effect === 'security-scan' && <ScanSurface message={message} />}
      {event.effect === 'celebration-trigger' && <CelebrationSurface message={message} />}
      {event.effect === 'media-compatibility' && <CompatSurface message={message} />}
      {event.effect === 'interaction-gate' && <GateSurface message={message} />}
      {event.effect === 'content-placeholder' && <PlaceholderSurface message={message} />}
      {event.effect === 'error-validation' && <ValidationSurface message={message} />}
      {event.effect === 'user-communication' && <NoticeSurface message={message} />}
      {nonBlocking && (
        <p className="ux-fade-in absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-xs font-medium text-white">
          {message || MODE_HINTS[event.effect] || 'Override active — click anywhere to restore.'}
        </p>
      )}
    </div>
  );
}

export type { EffectId };
