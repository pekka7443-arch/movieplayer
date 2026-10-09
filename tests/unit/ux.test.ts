// Unit tests for the in-memory user-experience broadcast store (server side).
// Covers: apply clamping, ring/expiry pruning, targeting rules (all vs email),
// admin self-exclusion + self-preview, the ?after dedupe cursor, the extended
// protocol catalog, revocation — and a HYGIENE SUITE that guarantees the
// client-facing surface never reveals that an operator is behind the effects
// (no troll/prank wording, no admin mentions, dull protocol ids only).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { EFFECT_IDS, EFFECT_DURATION_RANGE } from '../../src/lib/ux-shared';
import {
  latestEffectFor,
  recentEffects,
  revokeEffect,
  triggerEffect,
  UX_TOOLS,
} from '../../src/lib/server/ux';

const BASE = { createdBy: 'admin@example.com', durationSec: 8 } as const;

describe('ux store', () => {
  it('applies an event with an incrementing id and sane defaults', () => {
    const a = triggerEffect({ ...BASE, effect: 'alert-override', target: 'all' });
    const b = triggerEffect({ ...BASE, effect: 'ambient-calibration', target: 'all' });
    expect(b.id).toBeGreaterThan(a.id);
    expect(a.effect).toBe('alert-override');
    expect(a.message).toBe('');
    expect(a.durationSec).toBe(8);
    expect(a.expiresAt).toBeGreaterThanOrEqual(a.createdAt);
  });

  it('clamps duration into the allowed range', () => {
    const lo = triggerEffect({ ...BASE, effect: 'orientation-override', target: 'all', durationSec: 1 });
    const hi = triggerEffect({ ...BASE, effect: 'orientation-override', target: 'all', durationSec: 999 });
    expect(lo.durationSec).toBe(EFFECT_DURATION_RANGE.min);
    expect(hi.durationSec).toBe(EFFECT_DURATION_RANGE.max);
  });

  it('normalizes email targets', () => {
    const e = triggerEffect({ ...BASE, effect: 'status-preview', target: '  Friend@Example.COM ' });
    expect(e.target).toBe('friend@example.com');
  });

  it('delivers all-targeted events to guests and users', () => {
    triggerEffect({ ...BASE, effect: 'security-scan', target: 'all' });
    expect(latestEffectFor({ email: null, after: 0 })?.effect).toBe('security-scan');
    expect(latestEffectFor({ email: 'friend@example.com', after: 0 })?.effect).toBe('security-scan');
  });

  it('delivers email-targeted events only to that user', () => {
    const marker = triggerEffect({ ...BASE, effect: 'throttle-simulation', target: 'all' });
    const ban = triggerEffect({ ...BASE, effect: 'status-preview', target: 'friend@example.com' });
    expect(latestEffectFor({ email: 'friend@example.com', after: ban.id - 1 })?.effect).toBe('status-preview');
    // Everyone already caught up to the ban gets nothing.
    expect(latestEffectFor({ email: 'other@example.com', after: ban.id })).toBeNull();
    expect(latestEffectFor({ email: null, after: ban.id })).toBeNull();
    // A slightly-behind guest only ever sees the 'all' event.
    expect(latestEffectFor({ email: null, after: marker.id - 1 })?.effect).toBe('throttle-simulation');
  });

  it('never shows the operator their own all-targeted override (self-target reaches them)', () => {
    triggerEffect({ ...BASE, effect: 'display-recovery', target: 'all', createdBy: 'admin@example.com' });
    expect(
      latestEffectFor({ email: 'admin@example.com', after: 0, excludeCreatedBy: 'admin@example.com' }),
    ).toBeNull();
    // …but members still get it.
    expect(latestEffectFor({ email: 'friend@example.com', after: 0 })?.effect).toBe('display-recovery');
    // …and an explicit self-target DOES reach the operator (preview mode).
    triggerEffect({ ...BASE, effect: 'celebration-trigger', target: 'admin@example.com', createdBy: 'admin@example.com' });
    expect(
      latestEffectFor({ email: 'admin@example.com', after: 0, excludeCreatedBy: 'admin@example.com' })?.effect,
    ).toBe('celebration-trigger');
  });

  it('respects the after cursor for one-play-per-tab semantics', () => {
    const first = triggerEffect({ ...BASE, effect: 'throttle-simulation', target: 'all' });
    expect(latestEffectFor({ email: null, after: first.id - 1 })?.id).toBe(first.id);
    expect(latestEffectFor({ email: null, after: first.id })).toBeNull();
  });

  it('returns the newest matching event', () => {
    triggerEffect({ ...BASE, effect: 'alert-override', target: 'all' });
    const newest = triggerEffect({ ...BASE, effect: 'ambient-calibration', target: 'all' });
    expect(latestEffectFor({ email: null, after: 0 })?.id).toBe(newest.id);
  });

  it('lists history newest-first with metadata', () => {
    const e = triggerEffect({ ...BASE, effect: 'security-scan', target: 'friend@example.com', message: 'hi' });
    const history = recentEffects(5);
    expect(history[0]!.id).toBe(e.id);
    expect(history[0]!.createdBy).toBe('admin@example.com');
    expect(history[0]!.target).toBe('friend@example.com');
  });
});

describe('ux catalog (User Experience disguise)', () => {
  it('accepts every registered effect id', () => {
    expect(EFFECT_IDS.length).toBe(19);
    for (const effect of EFFECT_IDS) {
      const e = triggerEffect({ ...BASE, effect, target: 'all' });
      expect(e.effect).toBe(effect);
    }
  });

  it('covers every effect id exactly once with a dry label + description + effect note', () => {
    expect(UX_TOOLS.length).toBe(EFFECT_IDS.length);
    const labels = new Set(UX_TOOLS.map((t) => t.label));
    expect(labels.size).toBe(EFFECT_IDS.length);
    for (const tool of UX_TOOLS) {
      expect(tool.label.length).toBeGreaterThan(3);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.effectNote.length).toBeGreaterThan(15);
      for (const field of [tool.label, tool.description, tool.effectNote]) {
        expect(field.toLowerCase()).not.toMatch(/troll|prank|joke/);
      }
    }
  });

  it('keeps the canonical disguise names from the spec', () => {
    const byEffect = new Map(UX_TOOLS.map((t) => [t.effect, t.label]));
    expect(byEffect.get('orientation-override')).toBe('Display Orientation Override');
    expect(byEffect.get('reflection-mode')).toBe('Interface Reflection Mode');
    expect(byEffect.get('motion-test')).toBe('Motion Accessibility Test');
    expect(byEffect.get('compact-display')).toBe('Compact Display Protocol');
    expect(byEffect.get('scale-override')).toBe('Accessibility Scale Override');
    expect(byEffect.get('throttle-simulation')).toBe('Network Throttle Simulation');
    expect(byEffect.get('media-compatibility')).toBe('Legacy Media Compatibility Check');
    expect(byEffect.get('interaction-gate')).toBe('Administrative Interaction Gate');
    expect(byEffect.get('status-preview')).toBe('Account Status Preview');
    expect(byEffect.get('celebration-trigger')).toBe('Celebration Event Trigger');
    expect(byEffect.get('content-placeholder')).toBe('Content Placeholder Protocol');
    expect(byEffect.get('scroll-override')).toBe('Scroll Direction Override');
    expect(byEffect.get('haptic-simulation')).toBe('Haptic Feedback Simulation');
    expect(byEffect.get('error-validation')).toBe('Error Handling Validation Mode');
    expect(byEffect.get('user-communication')).toBe('Direct User Communication');
  });
});

describe('ux revocation', () => {
  it('marks an active override revoked exactly once', () => {
    const e = triggerEffect({ ...BASE, effect: 'reflection-mode', target: 'friend@example.com' });
    expect(e.revokedAt).toBeUndefined();
    expect(revokeEffect(e.id)).toBe(true);
    const again = recentEffects(10).find((x) => x.id === e.id)!;
    expect(typeof again.revokedAt).toBe('number');
    // Second revoke is a no-op.
    expect(revokeEffect(e.id)).toBe(false);
  });

  it('returns false for unknown ids', () => {
    expect(revokeEffect(987654321)).toBe(false);
  });

  it('still delivers revoked events to pollers (with revokedAt) so clients dismiss', () => {
    const e = triggerEffect({ ...BASE, effect: 'compact-display', target: 'all' });
    revokeEffect(e.id);
    const delivered = latestEffectFor({ email: null, after: e.id - 1 });
    expect(delivered?.id).toBe(e.id);
    expect(typeof delivered?.revokedAt).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// The no-tell guarantee: nothing in the SHIPPED client surface may reveal
// that the effects are operator-triggered jokes. Protocol ids are dull,
// overlay copy is system-neutral, and the words "troll"/"prank"/"admin" never
// appear in the files that compile into the client bundle.
// ---------------------------------------------------------------------------
describe('client surface hygiene (no-tell guarantee)', () => {
  const BANNED = [
    'troll',
    'prank',
    'joke',
    'jumpscare',
    'rickroll',
    'victim',
    'admin',
    'just kidding',
    '😈',
    '😏',
    '🫣',
  ];

  const clientFiles = [
    'src/lib/ux-shared.ts',
    'src/components/site/ux-overlay.tsx',
  ];

  for (const rel of clientFiles) {
    it(`keeps ${rel} free of giveaway wording`, () => {
      const src = readFileSync(path.join(process.cwd(), rel), 'utf8').toLowerCase();
      for (const word of BANNED) {
        expect(src).not.toContain(word);
      }
    });
  }

  it('uses dull, kebab-case protocol ids only', () => {
    const forbidden = /troll|prank|joke|scare|rick|doink|disco|virus|ban|confetti|drunk|mirror|tiny|giant|flip|cats/;
    for (const id of EFFECT_IDS) {
      expect(id).toMatch(/^[a-z][a-z-]{3,40}$/);
      expect(forbidden.test(id)).toBe(false);
    }
  });

  it('polls a neutral endpoint and stores a neutral cursor key', () => {
    const overlay = readFileSync(path.join(process.cwd(), 'src/components/site/ux-overlay.tsx'), 'utf8');
    expect(overlay).toContain('/api/ux/poll');
    expect(overlay).not.toContain('/api/troll');
    expect(overlay).toContain('cinedeck.ux.cursor');
  });
});
