/**
 * @file src/services/config-schema-validators.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The value checks that several config-schema.ts rows share. A pure move out of
 *   config-schema.ts (max-file-lines); the rows import them from here and behave as before.
 * @structure isJsonObject · isEmptyOrHttpUrl · oneOf · isContactList
 * @version-history
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

/** The contact list: an array of objects with a string name and email; the other fields are optional strings. */
export function isContactList(v: unknown): boolean {
  if (!Array.isArray(v)) return false;
  return v.every(c => !!c && typeof c === 'object' && !Array.isArray(c)
    && ['name', 'role', 'email', 'phone', 'linkedin'].every(k => (c as Record<string, unknown>)[k] === undefined || typeof (c as Record<string, unknown>)[k] === 'string'));
}
