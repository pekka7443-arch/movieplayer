import { describe, expect, it } from 'vitest';

import {
  EMOJI_QUIZ,
  buildDailyRounds,
  buildRounds,
  buildYearRounds,
  dailySeed,
} from '@/lib/arcade-data';
import { teamKey } from '@/lib/sports-favorites';
import { recentLogs, clearRecentLogs, pushRecentLog } from '@/lib/server/logger';

describe('arcade quiz builders', () => {
  it('buildRounds picks distinct titles with 4 options including the answer', () => {
    const rounds = buildRounds(10);
    expect(rounds).toHaveLength(10);
    const seen = new Set<string>();
    for (const round of rounds) {
      seen.add(round.item.answer);
      expect(round.options).toHaveLength(4);
      expect(round.options).toContain(round.item.answer);
      expect(new Set(round.options).size).toBe(4);
    }
    expect(seen.size).toBe(10);
  });

  it('buildYearRounds keeps the real year and 3 distinct distractors', () => {
    for (const round of buildYearRounds(10)) {
      expect(round.options).toHaveLength(4);
      expect(round.options).toContain(round.year);
      expect(new Set(round.options).size).toBe(4);
      for (const option of round.options) {
        expect(option).toBeGreaterThanOrEqual(1950);
        expect(option).toBeLessThanOrEqual(2100);
      }
    }
  });

  it('daily rounds are deterministic per date and vary across dates', () => {
    const a1 = buildDailyRounds('2026-10-07');
    const a2 = buildDailyRounds('2026-10-07');
    const b = buildDailyRounds('2026-10-08');
    expect(a1).toEqual(a2);
    const a1Titles = a1.map((r) => r.item.answer).join('|');
    const bTitles = b.map((r) => r.item.answer).join('|');
    expect(a1Titles).not.toBe(bTitles);
    // Same finite pool — every daily round must exist in EMOJI_QUIZ
    const pool = new Set(EMOJI_QUIZ.map((q) => q.answer));
    for (const round of a1) expect(pool.has(round.item.answer)).toBe(true);
  });

  it('dailySeed is stable per input and spread across dates', () => {
    expect(dailySeed('2026-10-07')).toBe(dailySeed('2026-10-07'));
    expect(dailySeed('2026-10-07')).not.toBe(dailySeed('2026-10-08'));
    expect(dailySeed('x', 'salt')).not.toBe(dailySeed('x', 'other-salt'));
  });
});

describe('sports favorites team key', () => {
  it('normalizes casing and punctuation for matching', () => {
    expect(teamKey('Boston Celtics')).toBe(teamKey('boston  celtics!'));
    expect(teamKey('Ilves Tampere')).not.toBe(teamKey('Ilves Helsinki'));
  });
});

describe('logger ring buffer', () => {
  it('keeps newest entries and respects the take limit', () => {
    clearRecentLogs();
    for (let i = 0; i < 30; i++) {
      pushRecentLog({ time: `t${i}`, level: 'info', msg: 'request', path: `/p${i}`, status: 200 });
    }
    const last10 = recentLogs(10);
    expect(last10).toHaveLength(10);
    expect(last10[0].path).toBe('/p20');
    expect(last10[9].path).toBe('/p29');
  });
});
