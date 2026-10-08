// Troll engine — server-side in-memory prank broadcast store.
//
// The admin triggers a prank from the admin panel; every open CineDeck
// browser tab picks it up within ~15 seconds via GET /api/troll/poll and
// renders it fullscreen for a few seconds (see components/site/troll-overlay.tsx).
//
// Deliberately EPHEMERAL and in-memory: pranks are jokes with a shelf life
// of seconds — they must not survive a reload, a restart, or populate the
// database. A small ring buffer keeps the last 50 events so slow pollers
// still catch the latest one; each event additionally expires after
// POLL_WINDOW_MS so a prank never replays minutes later.

import {
  TROLL_DURATION_RANGE,
  TROLL_TYPES,
  type PublicTrollEvent,
  type TrollType,
} from '@/lib/troll-shared';

/** How long an event stays fetchable by pollers (2 minutes). */
export const POLL_WINDOW_MS = 2 * 60 * 1000;

/** Ring buffer cap — slow pollers still catch the latest prank. */
const RING_SIZE = 50;

export { TROLL_DURATION_RANGE } from '@/lib/troll-shared';

export interface TrollEvent {
  /** Monotonic id (process-lifetime); clients pass it back as ?after=. */
  id: number;
  type: TrollType;
  /** Optional custom punchline shown by the overlay. */
  message: string;
  /** 'all' or the target user's lowercased email. */
  target: 'all' | string;
  durationSec: number;
  createdAt: number;
  expiresAt: number;
  /** Admin email that fired it (audit + the "who got me" reveal). */
  createdBy: string;
}

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

/** Fire a prank. Returns the stored event. */
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

export function isTrollType(value: unknown): value is TrollType {
  return typeof value === 'string' && (TROLL_TYPES as readonly string[]).includes(value);
}

/**
 * Newest event this client should play. `email` is the signed-in user's
 * email (null for guests → only 'all' events). `after` is the last event id
 * the client already handled. Events the triggering admin fired are hidden
 * from the admin's own 'all'-targeted polls so they never troll themselves
 * (targeting their own email explicitly still works — handy for testing).
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

/** Recent events for the admin history table (newest first). */
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
  };
}
