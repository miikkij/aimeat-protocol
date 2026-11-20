/**
 * @file src/services/value/rhythm.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rhythm of a day series: its bursts, its week and its season. Pure functions over
 *   `{ day, count }` rows, so the value report and the admin's usage page read one rule.
 *
 *   A BURST is a day whose count is more than BURST_FACTOR times the median of the BURST_WINDOW days
 *   before it, and at least BURST_MIN. The median, not the mean, so one earlier burst does not lift the
 *   bar for the next. THE WEEK is each weekday's share of the whole, shown once WEEK_MIN_DAYS days of
 *   data exist. THE SEASON is each calendar month against the mean month, shown once SEASON_MIN_MONTHS
 *   months of data exist; before that it says how many months there are and does not guess.
 * @structure BURST_FACTOR · BURST_WINDOW · BURST_MIN · WEEK_MIN_DAYS · SEASON_MIN_MONTHS · findBursts ·
 *   weekShares · seasonOf · rhythmOf
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 2).
 */

export const BURST_FACTOR = 3;
export const BURST_WINDOW = 28;
export const BURST_MIN = 10;
export const WEEK_MIN_DAYS = 28;
export const SEASON_MIN_MONTHS = 12;

export interface DayCount { day: string; count: number }

export interface Burst {
  day: string;
  count: number;
  /** The median of the days before it. */
  usual: number;
  /** count / usual, one decimal. */
  times: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Every day of the span between the first and last row, a missing day as 0. */
function filled(rows: DayCount[]): DayCount[] {
  if (rows.length === 0) return [];
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.count);
  const days = [...byDay.keys()].sort();
  const out: DayCount[] = [];
  for (let t = Date.parse(`${days[0]}T00:00:00Z`), end = Date.parse(`${days[days.length - 1]}T00:00:00Z`); t <= end; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, count: byDay.get(day) ?? 0 });
  }
  return out;
}

/** The bursts of a day series, newest first. */
export function findBursts(rows: DayCount[]): Burst[] {
  const days = filled(rows);
  const out: Burst[] = [];
  for (let i = 0; i < days.length; i++) {
    const before = days.slice(Math.max(0, i - BURST_WINDOW), i).map(d => d.count);
    if (before.length < 7) continue;
    const usual = median(before);
    const c = days[i].count;
    if (c >= BURST_MIN && c > BURST_FACTOR * Math.max(usual, 1)) {
      out.push({ day: days[i].day, count: c, usual, times: Math.round((c / Math.max(usual, 1)) * 10) / 10 });
    }
  }
  return out.reverse();
}

/** Each weekday's share of the whole (Monday first), or null with too few days. */
export function weekShares(rows: DayCount[]): { days: number; shares: number[] | null } {
  const days = filled(rows);
  if (days.length < WEEK_MIN_DAYS) return { days: days.length, shares: null };
  const sums = [0, 0, 0, 0, 0, 0, 0];
  let total = 0;
  for (const d of days) {
    const wd = (new Date(`${d.day}T00:00:00Z`).getUTCDay() + 6) % 7;
    sums[wd] += d.count;
    total += d.count;
  }
  return { days: days.length, shares: total ? sums.map(s => Math.round((s / total) * 1000) / 1000) : sums };
}

/** Each calendar month's total against the mean month, or how many months there are when too few. */
export function seasonOf(rows: DayCount[]): { months: number; byMonth: Array<{ month: string; count: number; vsMean: number }> | null } {
  const byMonth = new Map<string, number>();
  for (const r of rows) byMonth.set(r.day.slice(0, 7), (byMonth.get(r.day.slice(0, 7)) ?? 0) + r.count);
  const months = [...byMonth.keys()].sort();
  if (months.length < SEASON_MIN_MONTHS) return { months: months.length, byMonth: null };
  const mean = [...byMonth.values()].reduce((a, b) => a + b, 0) / months.length;
  return {
    months: months.length,
    byMonth: months.map(m => ({ month: m, count: byMonth.get(m)!, vsMean: mean ? Math.round(((byMonth.get(m)! - mean) / mean) * 1000) / 1000 : 0 })),
  };
}

/** All three, for one series. */
export function rhythmOf(rows: DayCount[]): { bursts: Burst[]; week: ReturnType<typeof weekShares>; season: ReturnType<typeof seasonOf> } {
  return { bursts: findBursts(rows), week: weekShares(rows), season: seasonOf(rows) };
}
