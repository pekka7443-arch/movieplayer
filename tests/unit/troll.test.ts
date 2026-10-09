// Unit tests for the in-memory troll broadcast store (server side).
// Covers: trigger clamping, ring/expiry pruning, targeting rules
// (all vs email), admin self-exclusion, the ?after dedupe cursor,
// the extended protocol catalog and revocation.

import { describe, expect, it } from 'vitest';

import {
  TROLL_TYPES,
} from '../../src/lib/troll-shared';
import {
  latestTrollFor,
  recentTrolls,
  revokeTroll,
  TROLL_DURATION_RANGE,
  triggerTroll,
  UX_TOOLS,
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

describe('troll catalog (User Experience disguise)', () => {
  it('accepts every registered type including the new protocols', () => {
    expect(TROLL_TYPES.length).toBe(19);
    for (const type of TROLL_TYPES) {
      const e = triggerTroll({ ...BASE, type, target: 'all' });
      expect(e.type).toBe(type);
    }
  });

  it('exposes a boring label + description for every type', () => {
    expect(UX_TOOLS.length).toBe(TROLL_TYPES.length);
    const labels = new Set(UX_TOOLS.map((t) => t.label));
    expect(labels.size).toBe(TROLL_TYPES.length);
    for (const tool of UX_TOOLS) {
      expect(tool.label.length).toBeGreaterThan(3);
      expect(tool.description.length).toBeGreaterThan(10);
      // The disguise must never leak the fun words into admin UI strings.
      expect(tool.label.toLowerCase()).not.toMatch(/troll|prank|joke/);
      expect(tool.description.toLowerCase()).not.toMatch(/troll|prank|joke/);
    }
  });

  it('keeps the canonical disguise names from the spec', () => {
    const byType = new Map(UX_TOOLS.map((t) => [t.type, t.label]));
    expect(byType.get('flip')).toBe('Display Orientation Override');
    expect(byType.get('mirror')).toBe('Interface Reflection Mode');
    expect(byType.get('drunk')).toBe('Motion Accessibility Test');
    expect(byType.get('tiny')).toBe('Compact Display Protocol');
    expect(byType.get('giant')).toBe('Accessibility Scale Override');
    expect(byType.get('buffering')).toBe('Network Throttle Simulation');
    expect(byType.get('rickroll')).toBe('Legacy Media Compatibility Check');
    expect(byType.get('doink')).toBe('Administrative Interaction Gate');
    expect(byType.get('ban')).toBe('Account Status Preview');
    expect(byType.get('confetti')).toBe('Celebration Event Trigger');
    expect(byType.get('cats')).toBe('Content Placeholder Protocol');
    expect(byType.get('scrollreverse')).toBe('Scroll Direction Override');
    expect(byType.get('shake')).toBe('Haptic Feedback Simulation');
    expect(byType.get('error')).toBe('Error Handling Validation Mode');
    expect(byType.get('message')).toBe('Direct User Communication');
  });
});

describe('troll revocation', () => {
  it('marks an active override revoked exactly once', () => {
    const e = triggerTroll({ ...BASE, type: 'mirror', target: 'friend@example.com' });
    expect(e.revokedAt).toBeUndefined();
    expect(revokeTroll(e.id)).toBe(true);
    const again = recentTrolls(10).find((x) => x.id === e.id)!;
    expect(typeof again.revokedAt).toBe('number');
    // Second revoke is a no-op.
    expect(revokeTroll(e.id)).toBe(false);
  });

  it('returns false for unknown ids', () => {
    expect(revokeTroll(987654321)).toBe(false);
  });

  it('still delivers revoked events to pollers (with revokedAt) so clients dismiss', () => {
    const e = triggerTroll({ ...BASE, type: 'tiny', target: 'all' });
    revokeTroll(e.id);
    const delivered = latestTrollFor({ email: null, after: e.id - 1 });
    expect(delivered?.id).toBe(e.id);
    expect(typeof delivered?.revokedAt).toBe('number');
  });
});
