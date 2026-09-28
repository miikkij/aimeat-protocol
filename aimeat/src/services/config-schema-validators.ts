/**
 * @file src/services/config-schema-validators.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The value checks that several config-schema.ts rows share. A pure move out of
 *   config-schema.ts (max-file-lines); the rows import them from here and behave as before.
 * @structure isJsonObject · isEmptyOrHttpUrl · isContactList
 * @version-history
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

/** The contact list: an array of objects with a string name and email; the other fields are optional strings. */
export function isContactList(v: unknown): boolean {
  if (!Array.isArray(v)) return false;
  return v.every(c => !!c && typeof c === 'object' && !Array.isArray(c)
    && ['name', 'role', 'email', 'phone', 'linkedin'].every(k => (c as Record<string, unknown>)[k] === undefined || typeof (c as Record<string, unknown>)[k] === 'string'));
}
