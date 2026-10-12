// Simulated growth engine — determinism, monotonicity and payload invariants.

import { describe, expect, it } from 'vitest';

import {
  dayIndexFor,
  diurnalProgress,
  growthSnapshot,
  signupsOnDay,
  totalAtEndOfDay,
} from '@/lib/server/growth';

// Fixed reference instants so day indices are stable regardless of when the
// suite runs. 2026-10-12 is ~577 days after the simulated launch.
const NOON = new Date('2026-10-12T12:00:00.000Z');
const EVENING = new Date('2026-10-12T22:30:00.000Z');

describe('growth curve', () => {
  it('is deterministic — same instant, identical snapshot', () => {
    const a = growthSnapshot(NOON);
    const b = growthSnapshot(NOON);
    expect(a).toEqual(b);
  });

  it('never reports zero-signup days', () => {
    for (let d = 0; d < 800; d += 7) {
      expect(signupsOnDay(d)).toBeGreaterThanOrEqual(1);
    }
  });

  it('has a strictly increasing cumulative base', () => {
    let prev = totalAtEndOfDay(0);
    for (let d = 1; d < 800; d += 13) {
      const next = totalAtEndOfDay(d);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }
  });

  it('grows over real time — later snapshot is strictly larger', () => {
    const earlier = growthSnapshot(NOON);
    const later = growthSnapshot(new Date(NOON.getTime() + 3 * 86_400_000));
    expect(later.totalUsers).toBeGreaterThan(earlier.totalUsers);
    expect(later.newPrevWeek).toBeGreaterThan(0);
  });

  it('accumulates intraday along the diurnal curve', () => {
    const morning = growthSnapshot(new Date('2026-10-12T03:00:00.000Z'));
    const night = growthSnapshot(EVENING);
    expect(night.newToday).toBeGreaterThan(morning.newToday);
    expect(night.totalUsers).toBeGreaterThanOrEqual(morning.totalUsers);
  });
});

describe('day math', () => {
  it('maps calendar dates to day indices', () => {
    expect(dayIndexFor(new Date('2025-03-14T00:00:00.000Z'))).toBe(0);
    expect(dayIndexFor(new Date('2025-03-15T00:00:00.000Z'))).toBe(1);
    expect(dayIndexFor(new Date('2025-03-13T00:00:00.000Z'))).toBe(0);
  });

  it('diurnal progress rises through the day within [0,1]', () => {
    let prev = 0;
    for (let h = 0; h < 24; h++) {
      const p = diurnalProgress(new Date(`2026-10-12T${String(h).padStart(2, '0')}:30:00.000Z`));
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('overview payload invariants', () => {
  const snap = growthSnapshot(EVENING);

  it('emits 30-day series with ascending unique day keys', () => {
    for (const series of [snap.signupSeries, snap.dauSeries, snap.wauSeries, snap.mauSeries]) {
      expect(series).toHaveLength(30);
      const keys = series.map((p) => p.day);
      expect(new Set(keys).size).toBe(30);
      expect([...keys].sort()).toEqual(keys);
      expect(keys[29]).toBe('2026-10-12');
      for (const p of series) expect(p.count).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps actives ordered DAU < WAU < MAU <= cumulative base per day', () => {
    for (let i = 0; i < snap.dauSeries.length; i++) {
      const day = snap.dauSeries[i].day;
      const dau = snap.dauSeries[i].count;
      const wau = snap.wauSeries[i].count;
      const mau = snap.mauSeries[i].count;
      const base = totalAtEndOfDay(dayIndexFor(new Date(`${day}T00:00:00.000Z`)));
      expect(dau).toBeLessThan(wau);
      expect(wau).toBeLessThan(mau);
      expect(mau).toBeLessThanOrEqual(base);
    }
  });

  it('puts Finland on top of the country list', () => {
    expect(snap.countries[0]?.name).toBe('Finland');
    expect(snap.countries.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < snap.countries.length; i++) {
      expect(snap.countries[i].count).toBeLessThanOrEqual(snap.countries[i - 1].count);
    }
  });

  it('feed users have no future timestamps, unique ids and ascii emails', () => {
    expect(snap.recentUsers.length).toBeGreaterThan(0);
    const ids = new Set(snap.recentUsers.map((u) => u.id));
    expect(ids.size).toBe(snap.recentUsers.length);
    for (const u of snap.recentUsers) {
      expect(new Date(u.createdAt).getTime()).toBeLessThanOrEqual(EVENING.getTime());
      expect(u.email).toMatch(/^[a-z0-9.]+@[a-z0-9.]+$/);
      expect(u.name).toMatch(/^[A-Za-zÄäÖöÜüÉé.\- ]+$/);
      expect(u.role).toBe('user');
    }
  });

  it('verified count stays below total', () => {
    expect(snap.verified).toBeLessThan(snap.totalUsers);
    expect(snap.active24h).toBeLessThan(snap.totalUsers);
    expect(snap.activeNow).toBeLessThan(snap.active24h);
  });
});
