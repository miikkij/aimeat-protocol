import { describe, it, expect, vi, afterEach } from 'vitest';
import { runDateIn } from '../../src/services/workflow/engine-util.js';

/**
 * The run date is the date where the SCHEDULE lives.
 *
 * A workflow's cron is evaluated in `trigger.timezone`; `<run-date>` was computed in UTC. They agree
 * for most of the day and disagree exactly at night, which is why nobody saw it: the (L)AIMEAT
 * Sanomat pipeline ran at 17:00 Europe/Helsinki (14:00 UTC, same date) for months. Moving it to
 * 00:17 would have fired at 21:17 UTC the previous date, stamping the run with YESTERDAY — and with
 * `skip_done` on, yesterday's deliverables are already present, so every step greens without
 * dispatching and the run reports `done` having published nothing.
 */
afterEach(() => { vi.useRealTimers(); });

/** 00:17 in Helsinki on 2 Aug 2026 is 21:17 UTC on 1 Aug — the exact instant that used to lie. */
const NIGHT = new Date('2026-08-01T21:17:00.000Z');

describe('runDateIn', () => {
  it('the night case: a Helsinki small-hours trigger is stamped with the LOCAL date, not the UTC one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NIGHT);
    expect(runDateIn('Europe/Helsinki')).toBe('2026-08-02');
    // The old behaviour, kept here as the thing being ruled out rather than described in a comment.
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('the daytime case is unchanged — this is why the bug stayed invisible', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T14:00:00.000Z')); // 17:00 Helsinki, the old schedule
    expect(runDateIn('Europe/Helsinki')).toBe('2026-08-01');
    expect(runDateIn(undefined)).toBe('2026-08-01');
  });

  it('a zone BEHIND UTC is the mirror image: still the local date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T03:30:00.000Z')); // 23:30 on the 1st in New York
    expect(runDateIn('America/New_York')).toBe('2026-08-01');
    expect(runDateIn('Europe/Helsinki')).toBe('2026-08-02');
  });

  it('no timezone on the trigger keeps the previous UTC behaviour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NIGHT);
    expect(runDateIn(undefined)).toBe('2026-08-01');
  });

  it('an unusable timezone falls back to UTC rather than failing the run', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NIGHT);
    // A bad config string must not be able to stop a scheduled pipeline.
    expect(runDateIn('Not/AZone')).toBe('2026-08-01');
    expect(runDateIn('')).toBe('2026-08-01');
  });

  it('always returns an ISO date, which is what key templates splice in', () => {
    for (const tz of ['Europe/Helsinki', 'America/New_York', 'Asia/Tokyo', 'UTC']) {
      expect(runDateIn(tz)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
