/**
 * @file src/services/app-size-health.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How big this app has become, how fast it is growing, and when that meets the ceiling
 *   this node accepts.
 *
 *   WHY IT EXISTS. An app on this node is one HTML file, and a file has no natural brake. The app
 *   that prompted this reached 3.18 MB across 369 publishes: 43 000 lines, 1550 functions, 477 kB of
 *   base64 images inlined into the source, one line 294 490 characters long. Its author noticed only
 *   as a feeling — that changes had started taking half an hour — and the numbers that would have
 *   explained it were all on our side and shown to nobody. The publish response is the one surface a
 *   publisher always reads, so the numbers go there.
 *
 *   TWO DIFFERENT FAILURES, ONE MEASUREMENT. The hard one is the node's ceiling: past
 *   `AIMEAT_APP_MAX_SIZE_MB` the publish is refused outright, and an author who learns that at the
 *   wall has already written the version that cannot land. The soft one arrives long before, and it
 *   is the one that actually hurts: every AI edit costs what has to be read to make it, so a file
 *   this size slows every round trip whatever the ceiling says.
 *
 *   QUIET UNTIL IT IS NOT. A 40 kB app (the median here) hears nothing; the numbers are still in the
 *   response for anyone who wants them, but no sentence is spent on a non-problem. Advice nobody
 *   needed is how a response stops being read.
 *
 *   PURE. No storage, no clock: the caller passes the version line and `at`, so the same input
 *   always yields the same answer and a unit test can assert the sentence.
 * @structure appSizeHealth(input) → AppSizeHealth · levelFor · rateOver
 * @usage
 *   const health = appSizeHealth({ bytes, ceilingBytes, history, at });
 *   if (health.note) tell the publisher
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial. Written after the drum-slicer measurement.
 */
import type { AppVersionSize } from '../storage/interface.js';

/** How loudly to say it. `quiet` means the numbers travel and no sentence does. */
export type AppSizeLevel = 'quiet' | 'watch' | 'warn' | 'at-the-wall';

export interface AppSizeHealthInput {
  /** Size of the version just published, in bytes. */
  bytes: number;
  /** What this node accepts, in bytes (config.appMaxSizeMb × 1024 × 1024). */
  ceilingBytes: number;
  /**
   * The app's version line, newest first, as listAppVersionSizes returns it. May be empty (a first
   * publish, or a lookup that failed) — then only the ceiling half of the answer is available.
   */
  history: AppVersionSize[];
  /** ISO timestamp of the publish being reported on. */
  at: string;
}

export interface AppSizeHealth {
  bytes: number;
  ceiling_bytes: number;
  /** bytes ÷ ceiling, two decimals. 0.64 means "two thirds of the way there". */
  share_of_ceiling: number;
  /** Growth against the previous published version. Absent on a first publish. */
  grew_bytes?: number;
  /** Bytes per day across the measured window. Absent when there is nothing to measure. */
  per_day_bytes?: number;
  /** Days the rate was measured over, one decimal. */
  measured_days?: number;
  /** Versions the rate was measured over, this one included. */
  measured_versions?: number;
  /** ISO date this rate meets the ceiling. Absent when it is not growing, or the date is over a year out. */
  full_on?: string;
  level: AppSizeLevel;
  /** One or two sentences. Present whenever the level is not `quiet`. */
  note?: string;
}

/** Versions to measure the growth rate over. Long enough to survive one quiet day, short enough
 *  that a rewrite six months ago does not decide today's rate. */
const WINDOW_VERSIONS = 12;
/** Below this the window is too short to divide by: two publishes an hour apart say nothing about
 *  a day. */
const MIN_WINDOW_DAYS = 0.5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const mb = (bytes: number): string => `${round2(bytes / MB)} MB`;

/** kB or MB, whichever reads as a number a person can hold. */
function human(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs >= MB) return mb(bytes);
  return `${Math.round(bytes / 1024)} kB`;
}

/**
 * Growth per day across the recent window.
 *
 * Measured from the OLDEST version in the window to the newest rather than by averaging the
 * per-publish deltas: a day with twenty publishes and a day with one then count the same, which is
 * what "per day" is supposed to mean.
 */
function rateOver(history: AppVersionSize[], at: string): { perDay: number; days: number; versions: number } | undefined {
  if (history.length < 2) return undefined;
  const window = history.slice(0, WINDOW_VERSIONS);
  const newest = window[0]!;
  const oldest = window[window.length - 1]!;
  const newestAt = Date.parse(newest.createdAt) || Date.parse(at);
  const oldestAt = Date.parse(oldest.createdAt);
  if (!Number.isFinite(newestAt) || !Number.isFinite(oldestAt)) return undefined;
  const days = (newestAt - oldestAt) / MS_PER_DAY;
  if (days < MIN_WINDOW_DAYS) return undefined;
  return { perDay: (newest.size - oldest.size) / days, days, versions: window.length };
}

/**
 * The level.
 *
 * Two independent triggers, because an app can be in trouble either way round: a big app that has
 * stopped growing still has to be edited, and a small app growing 300 kB a day will be a big app
 * next week. Whichever speaks louder wins.
 */
function levelFor(share: number, daysToFull: number | undefined): AppSizeLevel {
  if (share >= 0.9) return 'at-the-wall';
  if (share >= 0.6 || (daysToFull !== undefined && daysToFull <= 45)) return 'warn';
  if (share >= 0.3 || (daysToFull !== undefined && daysToFull <= 120)) return 'watch';
  return 'quiet';
}

/** The sentence, in the words of someone who has to act on it rather than the words of the check. */
function noteFor(level: AppSizeLevel, h: AppSizeHealth, ceilingMb: number, fullPhrase: string): string | undefined {
  if (level === 'quiet') return undefined;
  const where = `This app is ${mb(h.bytes)}, ${Math.round(h.share_of_ceiling * 100)}% of the ${ceilingMb} MB this node accepts.`;
  const speed = h.per_day_bytes !== undefined && h.per_day_bytes > 0
    ? ` It has grown about ${human(h.per_day_bytes)} a day over the last ${Math.round(h.measured_days ?? 0)} days${fullPhrase}.`
    : '';
  const what = level === 'at-the-wall'
    ? ' The next version may be refused. Move the images and other assets out of the file into storage and reference them by URL — that is usually most of the weight.'
    : level === 'warn'
      ? ' Move the images and other assets out of the file into storage and reference them by URL, and keep the sources split on your own machine with a build step that assembles the one file. Both are in the skill node:aimeat-app-workstation.'
      : ' Worth knowing now rather than at the ceiling: assets belong in storage rather than inlined, and past about a megabyte every AI edit pays for the whole file. The skill node:aimeat-app-workstation is the way that is worked.';
  return `${where}${speed}${what}`;
}

/**
 * Weigh a freshly published app.
 *
 * Never throws and never refuses anything: this describes a publish that has already happened.
 */
export function appSizeHealth(input: AppSizeHealthInput): AppSizeHealth {
  const { bytes, ceilingBytes, history, at } = input;
  const ceiling = ceilingBytes > 0 ? ceilingBytes : 5 * MB;
  const health: AppSizeHealth = {
    bytes,
    ceiling_bytes: ceiling,
    share_of_ceiling: round2(bytes / ceiling),
    level: 'quiet',
  };

  // `history` is the version line as stored, newest first, and the publish path writes the row
  // before it asks — so entry 0 is the version being reported on and entry 1 is what it replaced.
  // A caller that asks before the row exists (a draft preview, a test) gets the same answer: the
  // line is treated as the history BEHIND `bytes` and the new size is put in front of it.
  const line: AppVersionSize[] = history[0]?.size === bytes
    ? history
    : [{ versionNumber: (history[0]?.versionNumber ?? 0) + 1, size: bytes, createdAt: at }, ...history];
  const previous = line[1];
  if (previous) health.grew_bytes = bytes - previous.size;

  const rate = rateOver(line, at);
  if (rate && rate.perDay > 0) {
    health.per_day_bytes = Math.round(rate.perDay);
    health.measured_days = Math.round(rate.days * 10) / 10;
    health.measured_versions = rate.versions;
  }

  const daysToFull = health.per_day_bytes && health.per_day_bytes > 0
    ? (ceiling - bytes) / health.per_day_bytes
    : undefined;
  let fullPhrase = '';
  if (daysToFull !== undefined && daysToFull <= 365) {
    const fullAt = new Date(Date.parse(at) + daysToFull * MS_PER_DAY);
    if (!Number.isNaN(fullAt.getTime())) {
      health.full_on = fullAt.toISOString().slice(0, 10);
      fullPhrase = `, which meets the ceiling around ${health.full_on}`;
    }
  }

  health.level = levelFor(health.share_of_ceiling, daysToFull);
  const note = noteFor(health.level, health, Math.round(ceiling / MB), fullPhrase);
  if (note) health.note = note;
  return health;
}
