/**
 * @file test/unit/value-rhythm.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rhythm rules (services/value/rhythm.ts) and the feature folding of the operator's
 *   rhythm report (services/value/usage-rhythm.ts): a burst is a day above three times the median of
 *   the days before it, the week needs four weeks of data, the season needs twelve months and does not
 *   guess before that.
 * @usage pnpm exec vitest run test/unit/value-rhythm.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 2).
 */
import { describe, it, expect } from 'vitest';
import { findBursts, weekShares, seasonOf } from '../../src/services/value/rhythm.js';
import { featureOf } from '../../src/services/value/usage-rhythm.js';

const day = (start: string, i: number): string => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);

describe('bursts', () => {
  it('a day above three times the usual is a burst; the usual is the median, so one burst does not hide the next', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ day: day('2026-10-01', i), count: 20 }));
    rows[30].count = 100;
    rows[33].count = 90;
    const bursts = findBursts(rows);
    expect(bursts.map(b => b.day)).toEqual([day('2026-10-01', 33), day('2026-10-01', 30)]);
    expect(bursts[1]).toMatchObject({ count: 100, usual: 20, times: 5 });
  });

  it('a quiet node has no burst from a handful of calls, and a missing day counts as zero', () => {
    const rows = [{ day: '2026-10-01', count: 1 }, { day: '2026-10-20', count: 8 }];
    expect(findBursts(rows)).toEqual([]);
  });
});

describe('the week', () => {
  it('says nothing with fewer than four weeks of data', () => {
    expect(weekShares(Array.from({ length: 10 }, (_, i) => ({ day: day('2026-11-02', i), count: 5 })))).toEqual({ days: 10, shares: null });
  });

  it('gives each weekday its share, Monday first', () => {
    // 2026-11-02 is a Monday; Mondays get 4, other days 1.
    const rows = Array.from({ length: 28 }, (_, i) => ({ day: day('2026-11-02', i), count: i % 7 === 0 ? 4 : 1 }));
    const w = weekShares(rows);
    expect(w.shares![0]).toBeCloseTo(16 / 40, 3);
    expect(w.shares![1]).toBeCloseTo(4 / 40, 3);
  });
});

describe('the season', () => {
  it('does not guess before twelve months', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ day: day('2026-01-01', i), count: 3 }));
    expect(seasonOf(rows)).toEqual({ months: 7, byMonth: null });
  });

  it('sets each month against the mean month once a year is there', () => {
    const rows = Array.from({ length: 365 }, (_, i) => ({ day: day('2025-01-01', i), count: day('2025-01-01', i).slice(5, 7) === '12' ? 0 : 2 }));
    const s = seasonOf(rows);
    expect(s.months).toBe(12);
    expect(s.byMonth!.find(m => m.month === '2025-12')!.vsMean).toBe(-1);
  });
});

describe('features of the tool calls', () => {
  it('folds a tool into the feature it belongs to', () => {
    expect(featureOf('aimeat_memory_write')).toBe('memory');
    expect(featureOf('aimeat_workspace_read')).toBe('workspaces');
    expect(featureOf('aimeat_goal_set')).toBe('goals');
    expect(featureOf('aimeat_v2_task_create')).toBe('tasks');
    expect(featureOf('something_else')).toBe('other');
  });
});
