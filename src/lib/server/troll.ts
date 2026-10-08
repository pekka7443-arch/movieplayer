// Troll engine — server-side in-memory prank broadcast store.
//
// The admin triggers an effect from the admin panel's User Experience tab;
// every open CineDeck browser tab picks it up within ~15 seconds via
// GET /api/troll/poll and renders it (see components/site/troll-overlay.tsx).
//
// Deliberately EPHEMERAL and in-memory: overrides are jokes with a shelf
// life of seconds — they must not survive a reload, a restart, or populate
// the database. A small ring buffer keeps the last 50 events so slow pollers
// still catch the latest one; each event additionally expires after
// POLL_WINDOW_MS so an effect never replays minutes later.
//
// UX_TOOLS below is the ADMIN-FACING catalog: boring, professional names and
// descriptions. It is served by the admin API only — never shipped in the
// client bundle — so nothing in the admin UI hints at what these really are.

import {
  TROLL_DURATION_RANGE,
  TROLL_TYPES,
  type PublicTrollEvent,
  type TrollType,
} from '@/lib/troll-shared';

/** How long an event stays fetchable by pollers (2 minutes). */
export const POLL_WINDOW_MS = 2 * 60 * 1000;

/** Ring buffer cap — slow pollers still catch the latest effect. */
const RING_SIZE = 50;

export { TROLL_DURATION_RANGE } from '@/lib/troll-shared';

export interface TrollEvent {
  /** Monotonic id (process-lifetime); clients pass it back as ?after=. */
  id: number;
  type: TrollType;
  /** Optional custom notice shown by the overlay. */
  message: string;
  /** 'all' or the target user's lowercased email. */
  target: 'all' | string;
  durationSec: number;
  createdAt: number;
  expiresAt: number;
  /** Timestamp if an admin revoked the override while it was running. */
  revokedAt?: number;
  /** Admin email that applied it (audit trail). */
  createdBy: string;
}

export interface UxTool {
  type: TrollType;
  label: string;
  description: string;
  /** Whether the custom notice field is required for this tool. */
  needsMessage: boolean;
}

// ---------------------------------------------------------------------------
// The disguise. Names/descriptions deliberately read like internal QA
// tooling — see the admin "User Experience" tab. Order = display order.
// ---------------------------------------------------------------------------
export const UX_TOOLS: UxTool[] = [
  {
    type: 'flip',
    label: 'Display Orientation Override',
    description: 'Rotates the client rendering surface 180° to verify layout resilience under extreme transforms.',
    needsMessage: false,
  },
  {
    type: 'mirror',
    label: 'Interface Reflection Mode',
    description: 'Mirrors the interface horizontally across the client viewport for render-pipeline verification.',
    needsMessage: false,
  },
  {
    type: 'drunk',
    label: 'Motion Accessibility Test',
    description: 'Applies a slow spatial oscillation to validate client motion-tolerance settings.',
    needsMessage: false,
  },
  {
    type: 'tiny',
    label: 'Compact Display Protocol',
    description: 'Scales the interface down to 55% to exercise compact-density breakpoints.',
    needsMessage: false,
  },
  {
    type: 'giant',
    label: 'Accessibility Scale Override',
    description: 'Scales the interface up to 145% to exercise large-type accessibility thresholds.',
    needsMessage: false,
  },
  {
    type: 'buffering',
    label: 'Network Throttle Simulation',
    description: 'Simulates a stalled network condition at low progress to validate loader states.',
    needsMessage: false,
  },
  {
    type: 'rickroll',
    label: 'Legacy Media Compatibility Check',
    description: 'Runs the legacy media decoder against a reference clip from the internal archive.',
    needsMessage: false,
  },
  {
    type: 'doink',
    label: 'Administrative Interaction Gate',
    description: 'Emits a spring-loaded interaction event through the client notification channel.',
    needsMessage: false,
  },
  {
    type: 'ban',
    label: 'Account Status Preview',
    description: 'Previews the account suspension screen exactly as the affected user would see it.',
    needsMessage: false,
  },
  {
    type: 'confetti',
    label: 'Celebration Event Trigger',
    description: 'Triggers a positive-reinforcement animation across the client surface.',
    needsMessage: false,
  },
  {
    type: 'cats',
    label: 'Content Placeholder Protocol',
    description: 'Fills media placeholders with approved stock imagery while layout QA is running.',
    needsMessage: false,
  },
  {
    type: 'scrollreverse',
    label: 'Scroll Direction Override',
    description: 'Inverts the scroll axis to verify bidirectional navigation support.',
    needsMessage: false,
  },
  {
    type: 'shake',
    label: 'Haptic Feedback Simulation',
    description: 'Simulates haptic feedback via rapid viewport translation on the client.',
    needsMessage: false,
  },
  {
    type: 'error',
    label: 'Error Handling Validation Mode',
    description: 'Renders a synthetic stack trace to validate error-boundary coverage.',
    needsMessage: false,
  },
  {
    type: 'message',
    label: 'Direct User Communication',
    description: 'Delivers a plain-text notice to the selected audience over all active sessions.',
    needsMessage: true,
  },
  // Legacy probes — kept for compatibility with earlier protocol versions.
  {
    type: 'jumpscare',
    label: 'Priority Alert Simulation',
    description: 'Full-attention overlay used to validate client alert rendering paths.',
    needsMessage: false,
  },
  {
    type: 'bluescreen',
    label: 'Display Recovery Drill',
    description: 'Simulates a client display reset to verify session-restore behavior.',
    needsMessage: false,
  },
  {
    type: 'disco',
    label: 'Ambient Lighting Calibration',
    description: 'Cycles the client color profile to exercise GPU compositing.',
    needsMessage: false,
  },
  {
    type: 'virus',
    label: 'Security Scan Notification Test',
    description: 'Renders a legacy antivirus notification to verify dialog stacking order.',
    needsMessage: false,
  },
];

const globalForTroll = globalThis as unknown as {
  __cinedeckTrollEvents?: TrollEvent[];
  __cinedeckTrollSeq?: number;
};

function ring(): TrollEvent[] {
  globalForTroll.__cinedeckTrollEvents ??= [];
  return globalForTroll.__cinedeckTrollEvents;
}

function prune(): void {
  const events = ring();
  const cutoff = Date.now() - POLL_WINDOW_MS;
  while (events.length > 0 && events[0]!.expiresAt < cutoff) events.shift();
  while (events.length > RING_SIZE) events.shift();
}

export interface TriggerInput {
  type: TrollType;
  target: 'all' | string;
  message?: string;
  durationSec: number;
  createdBy: string;
}

/** Apply an override. Returns the stored event. */
export function triggerTroll(input: TriggerInput): TrollEvent {
  globalForTroll.__cinedeckTrollSeq = (globalForTroll.__cinedeckTrollSeq ?? 0) + 1;
  const now = Date.now();
  const event: TrollEvent = {
    id: globalForTroll.__cinedeckTrollSeq,
    type: input.type,
    message: input.message?.slice(0, 200) ?? '',
    target: input.target === 'all' ? 'all' : input.target.trim().toLowerCase(),
    durationSec: Math.min(
      TROLL_DURATION_RANGE.max,
      Math.max(TROLL_DURATION_RANGE.min, Math.round(input.durationSec)),
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
export function revokeTroll(id: number): boolean {
  const event = ring().find((e) => e.id === id && !e.revokedAt);
  if (!event) return false;
  event.revokedAt = Date.now();
  return true;
}

export function isTrollType(value: unknown): value is TrollType {
  return typeof value === 'string' && (TROLL_TYPES as readonly string[]).includes(value);
}

/**
 * Newest event this client should play. `email` is the signed-in user's
 * email (null for guests → only 'all' events). `after` is the last event id
 * the client already handled. Events the triggering admin applied are hidden
 * from the admin's own 'all'-targeted polls so they never hit their own
 * screen (targeting their own email explicitly still works — handy for
 * previewing). Revoked events are still returned (with revokedAt) so an
 * actively playing client can dismiss itself early.
 */
export function latestTrollFor(options: {
  email: string | null;
  after: number;
  excludeCreatedBy?: string;
}): TrollEvent | null {
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
export function recentTrolls(limit = 20): TrollEvent[] {
  prune();
  return ring().slice(-limit).reverse();
}

export function toPublicEvent(event: TrollEvent): PublicTrollEvent {
  return {
    id: event.id,
    type: event.type,
    message: event.message,
    durationSec: event.durationSec,
    createdAt: event.createdAt,
    revokedAt: event.revokedAt ?? null,
  };
}
