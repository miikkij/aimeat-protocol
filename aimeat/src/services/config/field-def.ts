/**
 * @file src/services/config/field-def.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape of one tunable config row: what src/services/config/schema.ts lists for
 *   every field. Moved out of config-schema.ts when that file reached the 800-line ceiling. It
 *   imports nothing: the key's type is a parameter, and config-schema.ts, which already reads the
 *   config types, names it (`ConfigFieldDef`), so this file adds no import cycle.
 * @structure TightenOnly · ConfigFieldShape<K>
 * @usage import type { ConfigFieldDef } from './schema.js';
 * @version-history
 *   2026-11-04 — `aiMayOnlyTighten`: an AI credential may only make the setting stricter, judged by the
 *     order of its values on every write and reset path (services/config-strictness.ts; codebase
 *     analysis 2026-11-03, item B4).
 *   2026-10-25 — `applies: 'restart'`: a row stored in the database that takes effect at the next start.
 *   2026-10-16 — `refusal`: the reason a row's check gives for a value it refuses on principle (QA audit D6-01).
 *   v1.2.0 — 2026-10-11 — `list`: a setting whose running value is a list of strings.
 *   v1.1.0 — 2026-09-29 — `choices`: the fixed values of a string setting, for the Config tab's pick.
 *   v1.0.0 — 2026-09-24 — Moved from config-schema.ts; the key's type became a parameter.
 */

/**
 * A setting an AI credential may only make stricter. A person's own session (classification/
 * reader-kind.ts answers 'human') changes it either way; an agent, a narrow personal access token, an
 * unattended run, a visitor and a write that names nobody are refused a looser value and the removal of
 * its saved value, with PERSON_REQUIRED, on every path that writes settings (services/config/strictness.ts).
 */
export interface TightenOnly {
  /** The values from the most open to the strictest. A value outside the list is left to `validate`. */
  order: readonly string[];
  /**
   * Settings judged as one: in a request that changes several of them, the first looser one in the
   * request's order is the one answered. Without it the setting is its own group. Groups are asked in
   * the order their first setting stands in the schema.
   */
  group?: string;
  /** What the AI is told when a change from `from` to `to` is refused; a general sentence when absent. */
  refusal?: (from: string, to: string) => { message: string; details?: Record<string, unknown> };
}

export interface ConfigFieldShape<K extends string> {
  /** AimeatConfig property name (e.g. 'welcomeBonus'), or a site link as 'siteLinks.<name>'. */
  key: K;
  /** Dot-path notation for admin API (e.g. 'morsel_policy.welcome_bonus') */
  dotPath: string;
  /** AIMEAT_* environment variable name */
  envVar: string;
  /** Value type for raw-string parsing */
  type: 'number' | 'boolean' | 'string' | 'float' | 'object';
  /** Validation function */
  validate: (v: unknown) => boolean;
  /**
   * What the operator is told when `validate` refuses a value for a reason other than its type or
   * range, in place of "Invalid value". A switch that a release does not allow on says why here.
   */
  refusal?: string;
  /** true = cannot be changed after startup */
  immutable: boolean;
  /**
   * When a saved value takes effect, for a row that is not immutable. Absent: at once, because the
   * code that uses the setting reads the config on every use. 'restart': the code reads it once when
   * the node starts, so a save is stored in the database and takes effect at the next start
   * (config/overrides.ts applies it before anything reads it). The Config tab and the admin API say
   * so, and until then the running value is the old one (ConfigProvenance.awaitsRestart).
   */
  applies?: 'restart';
  /** Human-readable description */
  description: string;
  /** Valid range hint for numbers (e.g. '0-10000') */
  range?: string;
  /**
   * The only values a string setting takes, when `validate` accepts a fixed set. Served with the
   * schema (GET /v1/admin/config), so the Config tab offers a pick instead of a free text field.
   * The stored value stays the raw string; `validate` still decides what is accepted.
   */
  choices?: readonly string[];
  /**
   * The setting is a list of strings (CORS origins, scopes, STUN servers). Its running value is
   * string[] and its `type` is 'object'. Wherever the value is raw text (an environment variable, a
   * config file, Consul, a stored row, a request that sends text) it is comma-separated, and
   * parseConfigValue / serializeFieldValue convert in both directions. Until 2026-10-11 such a row
   * was typed 'string', so a save wrote the text into a field the code reads as an array, and every
   * `.includes(x)` on it became a substring test.
   */
  list?: boolean;
  /** An AI credential may only make this setting stricter (TightenOnly above). */
  aiMayOnlyTighten?: TightenOnly;
  /**
   * Admin API display mode:
   * - undefined / 'visible': shown with actual value
   * - 'configured': shown as dotPath_configured boolean (for secrets)
   * - 'hidden': omitted entirely (internal bootstrap fields)
   */
  adminDisplay?: 'visible' | 'configured' | 'hidden';
}
