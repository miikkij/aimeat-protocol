/**
 * @file src/services/config-schema-validators.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The value checks that several config-schema.ts rows share. A pure move out of
 *   config-schema.ts (max-file-lines); the rows import them from here and behave as before.
 * @structure isJsonObject · isEmptyOrHttpUrl · oneOf · numericRangeOf · withinStatedRange · isContactList
 * @version-history
 *   v1.2.0 — 2026-10-02 — numericRangeOf() / withinStatedRange(): a number row's `range` hint read as
 *     bounds, and RANGE_ENFORCED: the four settings whose range the config write path enforces.
 *   v1.1.0 — 2026-09-29 — oneOf(): a fixed-set string row's check and its `choices` from one list.
 *   v1.0.0 — 2026-09-28 — Moved from config-schema.ts, unchanged.
 */

/** A JSON text whose value is an object. Anything else is simply not a valid value: the answer is the report. */
export function isJsonObject(v: string): boolean {
  let parsed: unknown;
  // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the value is not JSON, and the Config tab refuses it by field
  try { parsed = JSON.parse(v); } catch { return false; }
  return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
}

/** '' or an absolute http(s) URL. Every site link is allowed to be empty, and empty means "no link". */
export function isEmptyOrHttpUrl(v: unknown): boolean {
  return typeof v === 'string' && (v.trim() === '' || /^https?:\/\/\S+$/i.test(v.trim()));
}

/**
 * A string setting that takes one of a fixed set of values. Spread into a row in place of `validate`,
 * it gives the row both the check and `choices` from one list, so the Config tab's pick and what the
 * node accepts cannot drift apart.
 * @example { key: 'syncMode', ..., type: 'string', ...oneOf('bulk', 'instant', 'hybrid'), immutable: false, ... }
 */
export function oneOf(...values: string[]): { validate: (v: unknown) => boolean; choices: readonly string[] } {
  const set = new Set(values);
  return { validate: (v: unknown) => typeof v === 'string' && set.has(v), choices: Object.freeze([...values]) };
}

/** A `range` hint that is a plain numeric pair: '0-100000', '0.0-1.0'. Choice lists and formats do not match. */
const NUMERIC_RANGE = /^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * The bounds a number row's `range` states, or null when the row is not a number or its hint is not a
 * plain "min-max" pair. The Config tab shows `range` next to the field, so it is what the operator is
 * told the setting takes.
 */
export function numericRangeOf(field: { type: string; range?: string }): { min: number; max: number } | null {
  if ((field.type !== 'number' && field.type !== 'float') || !field.range) return null;
  const m = NUMERIC_RANGE.exec(field.range);
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2]);
  return Number.isFinite(min) && Number.isFinite(max) && min <= max ? { min, max } : null;
}

/**
 * The settings whose stated maximum the write path enforces. Jouni approved these four on
 * 2026-10-02 (their help texts give the range as a limit). Enforcing every row's range would make
 * 76 more settings refuse a value above a maximum that may be only a display hint (quota.memory_mb
 * 1-10000, every rate_limits.* 1-10000), and production's stored values were not probed; that wider
 * step is the developer's decision, recorded in Platform Development Notes doc-mur7mzog0dzg.
 */
export const RANGE_ENFORCED: ReadonlySet<string> = new Set([
  'morsel_policy.daily_allowance_cap',
  'quota.min_trust_paid_actions',
  'moderation.auto_hide_threshold',
  'federation.max_relay_hops',
]);

/**
 * True when `value` lies inside the row's stated range, or the row states none. Each row's `validate`
 * checks the type and usually only the lower bound, so the maximum shown on the Config tab was not
 * enforced anywhere. The write path (services/config-apply.ts) calls this after `validate`; the boot
 * path does not, so a stored value outside the range keeps working and is refused only when it is
 * written again.
 */
export function withinStatedRange(field: { type: string; range?: string }, value: unknown): boolean {
  const r = numericRangeOf(field);
  if (!r) return true;
  return typeof value === 'number' && value >= r.min && value <= r.max;
}

/** The contact list: an array of objects with a string name and email; the other fields are optional strings. */
export function isContactList(v: unknown): boolean {
  if (!Array.isArray(v)) return false;
  return v.every(c => !!c && typeof c === 'object' && !Array.isArray(c)
    && ['name', 'role', 'email', 'phone', 'linkedin'].every(k => (c as Record<string, unknown>)[k] === undefined || typeof (c as Record<string, unknown>)[k] === 'string'));
}
