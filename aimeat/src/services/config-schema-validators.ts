/**
 * @file src/services/config-schema-validators.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The value checks that several config-schema.ts rows share. A pure move out of
 *   config-schema.ts (max-file-lines); the rows import them from here and behave as before.
 * @structure isJsonObject · isEmptyOrHttpUrl · oneOf · refusedFrom · relayClaimSetting · REMOVAL_SWITCHES ·
 *   numericRangeOf · withinStatedRange · rangeKindOf · listFromText · isStringList · asList · isContactList
 * @version-history
 *   v1.5.0 — 2026-10-12 — refusedFrom(), relayClaimSetting() and REMOVAL_SWITCHES: a live config change
 *     refuses the value that kept a 4.0.0 removal alive, from that release (Core 2026-11 HTTP-08).
 *   v1.4.0 — 2026-10-11 — listFromText(), isStringList(), asList(): the value of a `list` row, as a
 *     list wherever it arrives as text.
 *   v1.3.0 — 2026-10-11 — rangeKindOf(): a number row's range is a limit or a recommendation, read
 *     from what the write path accepts.
 *   v1.2.0 — 2026-10-02 — numericRangeOf() / withinStatedRange(): a number row's `range` hint read as
 *     bounds, and RANGE_ENFORCED: the four settings whose range the config write path enforces.
 *   v1.1.0 — 2026-09-29 — oneOf(): a fixed-set string row's check and its `choices` from one list.
 *   v1.0.0 — 2026-09-28 — Moved from config-schema.ts, unchanged.
 */
import { getSoftwareVersion, versionAtLeast } from '../utils/version.js';
import { RELAY_CLAIM_OPTIONAL_REMOVED_IN, UNPROVEN_FORMAT_REMOVED_IN } from '../config-federation.js';
import { OWNER_KEY_LOGIN_REMOVED_IN, WS_QUERY_TOKEN_REMOVED_IN } from '../config-security.js';
import { AI_LEGACY_SETTINGS_ROUTES_REMOVED_IN } from '../config-ai-models.js';

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

/**
 * A live config change may not bring back what a release removed (Core 2026-11 HTTP-08): from
 * `release` on, the row refuses `refused`, the value that kept the old form alive. The environment
 * cannot either: the code path asks the version again (config-security.ts, config-federation.ts,
 * config-ai-models.ts). Before the release the row's own check decides.
 */
export function refusedFrom(release: string, refused: unknown, validate: (v: unknown) => boolean): (v: unknown) => boolean {
  return (v: unknown) => validate(v) && !(v === refused && versionAtLeast(getSoftwareVersion(), release));
}

/** federation.relay_claim: `optional` or `required`, and `required` alone from RELAY_CLAIM_OPTIONAL_REMOVED_IN. */
export function relayClaimSetting(): { validate: (v: unknown) => boolean; choices: readonly string[] } {
  const row = oneOf('optional', 'required');
  return { ...row, validate: refusedFrom(RELAY_CLAIM_OPTIONAL_REMOVED_IN, 'optional', row.validate) };
}

const isBoolean = (v: unknown): boolean => typeof v === 'boolean';

/** The boolean rows that kept a removed form alive, each refusing that value from its own release. */
export const REMOVAL_SWITCHES = {
  /** federation.audience_required: `false` let a message without the proof in. */
  audienceRequired: refusedFrom(UNPROVEN_FORMAT_REMOVED_IN, false, isBoolean),
  /** security.ws_query_token: `true` took a session token in a WebSocket URL. */
  wsQueryToken: refusedFrom(WS_QUERY_TOKEN_REMOVED_IN, true, isBoolean),
  /** security.owner_key_login: `true` signed an owner in with the account key. */
  ownerKeyLogin: refusedFrom(OWNER_KEY_LOGIN_REMOVED_IN, true, isBoolean),
  /** ai.legacy_settings_routes: `true` kept the AI settings routes from before providers. */
  aiLegacySettingsRoutes: refusedFrom(AI_LEGACY_SETTINGS_ROUTES_REMOVED_IN, true, isBoolean),
} as const;

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
 * 2026-10-02 (their help texts give the range as a limit). The wider step, enforcing every row's
 * range, was decided the other way on 2026-10-11: a range is a recommendation unless the row's own
 * `validate` or this set makes it a limit, and the schema says which (rangeKindOf).
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

/**
 * Whether a number row's `range` is a limit or a recommendation, or null when the row states no
 * numeric range. A limit: the write path refuses a value above the maximum (the row's `validate`
 * does, or the path is in RANGE_ENFORCED). A recommendation: a larger value is accepted and applied.
 * The answer comes from asking `validate` about the first value above the maximum, so it cannot
 * drift from what the node accepts. Served with the schema (GET /v1/admin/config) as `rangeKind`,
 * and the Config tab words the range by it. Jouni, 2026-10-11: a range is a recommended range, and
 * the operator may set a larger number.
 */
export function rangeKindOf(
  field: { dotPath: string; type: string; range?: string; validate: (v: unknown) => boolean },
): 'limit' | 'recommended' | null {
  const r = numericRangeOf(field);
  if (!r) return null;
  if (RANGE_ENFORCED.has(field.dotPath)) return 'limit';
  return field.validate(r.max + 1) ? 'recommended' : 'limit';
}

/** A comma-separated text as a list: each part trimmed, empty parts dropped. */
export function listFromText(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/** The check of a `list` row: at least one entry, every entry a non-empty string with no comma in it. */
export function isStringList(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && v.every(s => typeof s === 'string' && s.trim() !== '' && !s.includes(','));
}

/**
 * A `list` row's value as a list, whatever arrived: a list stays, a text is split at its commas (a
 * JSON array text is read as the array it is). Anything else is returned unchanged, for the row's
 * check to refuse. The write path normalizes with this BEFORE the check, so the check and the
 * running config see the same value.
 */
export function asList(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (text.startsWith('[')) {
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the text is not a JSON array, so it is read as comma-separated
    try { const parsed: unknown = JSON.parse(text); if (Array.isArray(parsed)) return parsed; } catch { /* comma-separated below */ }
  }
  return listFromText(text);
}

/** The contact list: an array of objects with a string name and email; the other fields are optional strings. */
export function isContactList(v: unknown): boolean {
  if (!Array.isArray(v)) return false;
  return v.every(c => !!c && typeof c === 'object' && !Array.isArray(c)
    && ['name', 'role', 'email', 'phone', 'linkedin'].every(k => (c as Record<string, unknown>)[k] === undefined || typeof (c as Record<string, unknown>)[k] === 'string'));
}
