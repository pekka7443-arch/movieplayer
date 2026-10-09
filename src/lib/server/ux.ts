// User Experience protocol engine — server-side in-memory broadcast store.
//
// The admin applies a protocol from the admin panel's User Experience tab;
// every open CineDeck browser tab picks it up within ~15 seconds via
// GET /api/ux/poll and renders it (see components/site/ux-overlay.tsx).
//
// Deliberately EPHEMERAL and in-memory: overrides are transient with a shelf
// life of minutes — they must not survive a reload, a restart, or populate
// the database. A small ring buffer keeps the last 50 events so slow pollers
// still catch the latest one; each event additionally expires after
// POLL_WINDOW_MS so an effect never replays later.
//
// UX_TOOLS below is the ADMIN-FACING catalog: boring, professional names and
// descriptions, plus an `effect` line that spells out technically what the
// client will render (operator clarity). It is served by the admin API only —
// never shipped in the client bundle.

import {
  EFFECT_DURATION_RANGE,
  EFFECT_IDS,
  type EffectId,
  type PublicEffectEvent,
} from '@/lib/ux-shared';

/** How long an event stays fetchable by pollers (2 minutes). */
export const POLL_WINDOW_MS = 2 * 60 * 1000;

/** Ring buffer cap — slow pollers still catch the latest effect. */
const RING_SIZE = 50;

export { EFFECT_DURATION_RANGE } from '@/lib/ux-shared';

export interface UxEvent {
  /** Monotonic id (process-lifetime); clients pass it back as ?after=. */
  id: number;
  effect: EffectId;
  /** Optional custom notice rendered by the overlay. */
  message: string;
  /** 'all' or the target user's lowercased email. */
  target: 'all' | string;
  durationSec: number;
  createdAt: number;
  expiresAt: number;
  /** Timestamp if an operator revoked the override while it was running. */
  revokedAt?: number;
  /** Admin email that applied it (audit trail). */
  createdBy: string;
}

export interface UxTool {
  effect: EffectId;
  label: string;
  description: string;
  /** One dry technical line stating exactly what the client renders. */
  effectNote: string;
  /** Whether the custom notice field is required for this tool. */
  needsMessage: boolean;
}

// ---------------------------------------------------------------------------
// The catalog. Names/descriptions deliberately read like internal QA tooling —
// see the admin "User Experience" tab. Order = display order.
// ---------------------------------------------------------------------------
export const UX_TOOLS: UxTool[] = [
  {
    effect: 'orientation-override',
    label: 'Display Orientation Override',
    description: 'Rotates the client rendering surface 180° to verify layout resilience under extreme transforms.',
    effectNote: 'Client transform: rotate(180deg) — the entire viewport turns upside down.',
    needsMessage: false,
  },
  {
    effect: 'reflection-mode',
    label: 'Interface Reflection Mode',
    description: 'Mirrors the interface horizontally across the client viewport for render-pipeline verification.',
    effectNote: 'Client transform: scale(-1, 1) — the viewport mirrors horizontally.',
    needsMessage: false,
  },
  {
    effect: 'motion-test',
    label: 'Motion Accessibility Test',
    description: 'Applies a slow spatial oscillation to validate client motion-tolerance settings.',
    effectNote: 'Client transform: slow ±1.5° viewport sway on a 5s loop.',
    needsMessage: false,
  },
  {
    effect: 'compact-display',
    label: 'Compact Display Protocol',
    description: 'Scales the interface down to exercise compact-density breakpoints.',
    effectNote: 'Client transform: scale(0.55) — the whole interface shrinks.',
    needsMessage: false,
  },
  {
    effect: 'scale-override',
    label: 'Accessibility Scale Override',
    description: 'Scales the interface up to exercise large-type accessibility thresholds.',
    effectNote: 'Client transform: scale(1.45) — the whole interface enlarges.',
    needsMessage: false,
  },
  {
    effect: 'throttle-simulation',
    label: 'Network Throttle Simulation',
    description: 'Simulates a stalled network condition at low progress to validate loader states.',
    effectNote: 'Client surface: fullscreen loader pinned at a random 0–8%.',
    needsMessage: false,
  },
  {
    effect: 'media-compatibility',
    label: 'Legacy Media Compatibility Check',
    description: 'Runs the legacy media decoder against a reference clip from the internal archive.',
    effectNote: 'Client surface: fullscreen reference clip playback (muted archive embed) with a synthesized audio bed, equalizer bars and lyric captions.',
    needsMessage: false,
  },
  {
    effect: 'interaction-gate',
    label: 'Administrative Interaction Gate',
    description: 'Emits a spring-loaded interaction event through the client notification channel.',
    effectNote: 'Client surface: oversized spring-animated word with a synthesized tone.',
    needsMessage: false,
  },
  {
    effect: 'status-preview',
    label: 'Account Status Preview',
    description: 'Previews the account suspension screen exactly as the affected user would see it, then auto-restores.',
    effectNote: 'Client surface: suspension screen with countdown, ending in a believable "access restored" notice.',
    needsMessage: false,
  },
  {
    effect: 'celebration-trigger',
    label: 'Celebration Event Trigger',
    description: 'Triggers a positive-reinforcement animation across the client surface.',
    effectNote: 'Client surface: falling particle overlay over a completion notice.',
    needsMessage: false,
  },
  {
    effect: 'content-placeholder',
    label: 'Content Placeholder Protocol',
    description: 'Fills media placeholders with approved stock imagery while layout QA is running.',
    effectNote: 'Client surface: falling cat pictures with a revalidation notice.',
    needsMessage: false,
  },
  {
    effect: 'scroll-override',
    label: 'Scroll Direction Override',
    description: 'Inverts the scroll axis to verify bidirectional navigation support.',
    effectNote: 'Client input: wheel axis inverted for the duration.',
    needsMessage: false,
  },
  {
    effect: 'haptic-simulation',
    label: 'Haptic Feedback Simulation',
    description: 'Simulates haptic feedback via rapid viewport translation on the client.',
    effectNote: 'Client transform: rapid viewport shake on a 0.35s loop.',
    needsMessage: false,
  },
  {
    effect: 'error-validation',
    label: 'Error Handling Validation Mode',
    description: 'Renders a synthetic stack trace to validate error-boundary coverage.',
    effectNote: 'Client surface: synthetic stack trace with a recovery progress bar.',
    needsMessage: false,
  },
  {
    effect: 'user-communication',
    label: 'Direct User Communication',
    description: 'Delivers a plain-text notice to the selected audience over all active sessions.',
    effectNote: 'Client surface: fullscreen plain-text notice (your message body).',
    needsMessage: true,
  },
  // Legacy probes — kept for compatibility with earlier protocol versions.
  {
    effect: 'alert-override',
    label: 'Priority Alert Simulation',
    description: 'Full-attention overlay used to validate client alert rendering paths.',
    effectNote: 'Client surface: short standby hold, then a fullscreen alert image with a loud synthesized sting and viewport quiver; ends in a second brief flash.',
    needsMessage: false,
  },
  {
    effect: 'display-recovery',
    label: 'Display Recovery Drill',
    description: 'Simulates a client display reset to verify session-restore behavior.',
    effectNote: 'Client surface: simulated OS crash with a progress counter, ending in a recovery notice.',
    needsMessage: false,
  },
  {
    effect: 'ambient-calibration',
    label: 'Ambient Lighting Calibration',
    description: 'Cycles the client color profile to exercise GPU compositing.',
    effectNote: 'Client surface: full-color cycling overlay with a calibration caption.',
    needsMessage: false,
  },
  {
    effect: 'security-scan',
    label: 'Security Scan Notification Test',
    description: 'Renders a legacy antivirus notification to verify dialog stacking order.',
    effectNote: 'Client surface: legacy security dialog with scan progress and file paths.',
    needsMessage: false,
  },
];

const globalForUx = globalThis as unknown as {
  __cinedeckUxEvents?: UxEvent[];
  __cinedeckUxSeq?: number;
};

function ring(): UxEvent[] {
  globalForUx.__cinedeckUxEvents ??= [];
  return globalForUx.__cinedeckUxEvents;
}

function prune(): void {
  const events = ring();
  const cutoff = Date.now() - POLL_WINDOW_MS;
  while (events.length > 0 && events[0]!.expiresAt < cutoff) events.shift();
  while (events.length > RING_SIZE) events.shift();
}

export interface TriggerInput {
  effect: EffectId;
  target: 'all' | string;
  message?: string;
  durationSec: number;
  createdBy: string;
}

/** Apply an override. Returns the stored event. */
export function triggerEffect(input: TriggerInput): UxEvent {
  globalForUx.__cinedeckUxSeq = (globalForUx.__cinedeckUxSeq ?? 0) + 1;
  const now = Date.now();
  const event: UxEvent = {
    id: globalForUx.__cinedeckUxSeq,
    effect: input.effect,
    message: input.message?.slice(0, 200) ?? '',
    target: input.target === 'all' ? 'all' : input.target.trim().toLowerCase(),
    durationSec: Math.min(
      EFFECT_DURATION_RANGE.max,
      Math.max(EFFECT_DURATION_RANGE.min, Math.round(input.durationSec)),
    ),
    createdAt: now,
    expiresAt: now + POLL_WINDOW_MS,
    createdBy: input.createdBy,
  };
  const events = ring();
  events.push(event);
  prune();
  return event;
}

/** Revoke a still-running override. Returns true when an event was revoked. */
export function revokeEffect(id: number): boolean {
  const event = ring().find((e) => e.id === id && !e.revokedAt);
  if (!event) return false;
  event.revokedAt = Date.now();
  return true;
}

export function isEffectType(value: unknown): value is EffectId {
  return typeof value === 'string' && (EFFECT_IDS as readonly string[]).includes(value);
}

/**
 * Newest event this client should play. `email` is the signed-in user's
 * email (null for guests → only 'all' events). `after` is the last event id
 * the client already handled. Events the applying admin triggered are hidden
 * from the admin's own 'all'-targeted polls so they never hit their own
 * screen (self-targeting still works — used by Preview). Revoked events are
 * still returned (with revokedAt) so an actively playing client can dismiss
 * itself early.
 */
export function latestEffectFor(options: {
  email: string | null;
  after: number;
  excludeCreatedBy?: string;
}): UxEvent | null {
  prune();
  const { email, after, excludeCreatedBy } = options;
  const candidates = ring().filter(
    (e) =>
      e.id > after &&
      e.expiresAt > Date.now() &&
      (e.target === 'all' || (email !== null && e.target === email)) &&
      !(e.target === 'all' && excludeCreatedBy && e.createdBy === excludeCreatedBy),
  );
  return candidates.length > 0 ? candidates[candidates.length - 1]! : null;
}

/** Recent events for the admin overrides table (newest first). */
export function recentEffects(limit = 20): UxEvent[] {
  prune();
  return ring().slice(-limit).reverse();
}

export function toPublicEffect(event: UxEvent): PublicEffectEvent {
  return {
    id: event.id,
    effect: event.effect,
    message: event.message,
    durationSec: event.durationSec,
    createdAt: event.createdAt,
    revokedAt: event.revokedAt ?? null,
  };
}
