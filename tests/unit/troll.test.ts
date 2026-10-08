// Unit tests for the in-memory troll broadcast store (server side).
// Covers: trigger clamping, ring/expiry pruning, targeting rules
// (all vs email), admin self-exclusion and the ?after dedupe cursor.

import { describe, expect, it } from 'vitest';

import {
  latestTrollFor,
  recentTrolls,
  TROLL_DURATION_RANGE,
  triggerTroll,
} from '../../src/lib/server/troll';

const BASE = { createdBy: 'admin@example.com', durationSec: 8 };

describe('troll store', () => {
  it('fires an event with an incrementing id and sane defaults', () => {
    const a = triggerTroll({ ...BASE, type: 'jumpscare', target: 'all' });
    const b = triggerTroll({ ...BASE, type: 'disco', target: 'all' });
    expect(b.id).toBeGreaterThan(a.id);
    expect(a.type).toBe('jumpscare');
    expect(a.message).toBe('');
    expect(a.durationSec).toBe(8);
    expect(a.expiresAt).toBeGreaterThanOrEqual(a.createdAt);
  });

  it('clamps duration into the allowed range', () => {
    const lo = triggerTroll({ ...BASE, type: 'flip', target: 'all', durationSec: 1 });
    const hi = triggerTroll({ ...BASE, type: 'flip', target: 'all', durationSec: 999 });
    expect(lo.durationSec).toBe(TROLL_DURATION_RANGE.min);
    expect(hi.durationSec).toBe(TROLL_DURATION_RANGE.max);
  });

  it('normalizes email targets', () => {
    const e = triggerTroll({ ...BASE, type: 'ban', target: '  Friend@Example.COM ' });
    expect(e.target).toBe('friend@example.com');
  });

  it('delivers all-targeted events to guests and users', () => {
    triggerTroll({ ...BASE, type: 'virus', target: 'all' });
    expect(latestTrollFor({ email: null, after: 0 })?.type).toBe('virus');
    expect(latestTrollFor({ email: 'friend@example.com', after: 0 })?.type).toBe('virus');
  });

  it('delivers email-targeted events only to that user', () => {
    // Marker keeps the shared ring's older events behind the cursor.
    const marker = triggerTroll({ ...BASE, type: 'buffering', target: 'all' });
    const ban = triggerTroll({ ...BASE, type: 'ban', target: 'friend@example.com' });
    expect(latestTrollFor({ email: 'friend@example.com', after: ban.id - 1 })?.type).toBe('ban');
    // Everyone else is already caught up to the ban → nothing for them.
    expect(latestTrollFor({ email: 'other@example.com', after: ban.id })).toBeNull();
    expect(latestTrollFor({ email: null, after: ban.id })).toBeNull();
    // …while a slightly-behind guest only ever sees the 'all' event.
    expect(latestTrollFor({ email: null, after: marker.id - 1 })?.type).toBe('buffering');
  });

  it('never shows the triggering admin their own all-targeted prank', () => {
    triggerTroll({ ...BASE, type: 'bluescreen', target: 'all', createdBy: 'admin@example.com' });
    expect(
      latestTrollFor({ email: 'admin@example.com', after: 0, excludeCreatedBy: 'admin@example.com' }),
    ).toBeNull();
    // …but members still get it.
    expect(latestTrollFor({ email: 'friend@example.com', after: 0 })?.type).toBe('bluescreen');
    // …and an explicit self-target DOES reach the admin (preview mode).
    triggerTroll({ ...BASE, type: 'confetti', target: 'admin@example.com', createdBy: 'admin@example.com' });
    expect(
      latestTrollFor({ email: 'admin@example.com', after: 0, excludeCreatedBy: 'admin@example.com' })?.type,
    ).toBe('confetti');
  });

  it('respects the after cursor for one-play-per-tab semantics', () => {
    const first = triggerTroll({ ...BASE, type: 'buffering', target: 'all' });
    expect(latestTrollFor({ email: null, after: first.id - 1 })?.id).toBe(first.id);
    expect(latestTrollFor({ email: null, after: first.id })).toBeNull();
  });

  it('returns the newest matching event', () => {
    triggerTroll({ ...BASE, type: 'jumpscare', target: 'all' });
    const newest = triggerTroll({ ...BASE, type: 'disco', target: 'all' });
    expect(latestTrollFor({ email: null, after: 0 })?.id).toBe(newest.id);
  });

  it('lists history newest-first with metadata', () => {
    const e = triggerTroll({ ...BASE, type: 'virus', target: 'friend@example.com', message: 'hi' });
    const history = recentTrolls(5);
    expect(history[0]!.id).toBe(e.id);
    expect(history[0]!.createdBy).toBe('admin@example.com');
    expect(history[0]!.target).toBe('friend@example.com');
  });
});
