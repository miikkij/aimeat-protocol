/**
 * @file src/config-start-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The check loadConfig() runs on the environment before it builds the config: every
 *   setting from the environment, a config file or a command-line flag is held to the same rule the
 *   admin Config tab holds it to. A value the node does not accept is set aside: the node starts on
 *   that setting's default, says so in one log line, and records it on the Security page.
 *
 *   THE NODE ALWAYS STARTS (Jouni, 2026-10-16, reversing the refusal written earlier the same day).
 *   Operators run no scripts and the node always boots (.claude/rules/backend.md, ruled 2026-09-27):
 *   what cannot be decided becomes an incident on the Security page, with a decision on REST, MCP
 *   and the page. So for each value the node does not accept it uses the setting's default, prints
 *   one line naming the setting, what is wrong with the value and the default it uses, and
 *   services/config-setting-incidents.ts opens one incident per such setting, which closes by itself
 *   at the first start with a value the node accepts. `aimeat validate` still names every such value
 *   and exits 1. REFUSE_ON_INVALID is the short list of settings whose default would be unsafe or
 *   meaningless in place of the value the operator meant; for those the start is still refused.
 *
 *   WHY THE CHECK. The loader reads each variable with a cast or a parseInt and a default, and every
 *   consumer compares the value against its restrictive words only. So `AIMEAT_METRICS_ACCESS=Operator`
 *   matched neither `operator` nor `authenticated` and the metrics were public;
 *   `AIMEAT_REGISTRATION_MODE=invite-only` fell back to `open`; an empty
 *   `AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS` became NaN, after which no account locked; and a misspelt
 *   `AIMEAT_STORAGE` started an empty in-memory node. The same values typed into the Config tab were
 *   refused, because `services/config-schema.ts` has a validator per row that only the write paths
 *   ran. Now such a value is set aside and the default runs in the open, instead of a branch nobody
 *   chose.
 *
 *   WHAT IS CHECKED.
 *   - A schema row with a fixed set of values (`choices`): the value is one of them. Membership in the
 *     list and not the row's whole `validate`, because a few rows also refuse a value a release
 *     removed (config-schema-validators.ts refusedFrom), and for the environment the code path that
 *     reads the setting decides that and logs it; refusing the start over it is not this check's job.
 *   - A number row: the row's `validate` on the parsed value (a whole number, its lower bound, and an
 *     upper bound only where the row makes it a limit).
 *   - A free text or list row with its own validator (storage type, a URL, a date): `validate`.
 *   - A JSON-object row is not checked: several take comma-separated text in the environment and
 *     the loader parses each its own way, so the row's JSON validator does not describe that form.
 *   - A boolean row is not checked: the loader reads `=== 'true'` or `!== 'false'`, and every text
 *     has one meaning there.
 *
 *   CASE IS NOT A TYPING ERROR. A fixed-set value that matches one of its words in another case or
 *   with spaces around it (`Operator`) is written back as that word, so the loader's exact compare
 *   takes the branch meant; only a word outside the list is set aside.
 *
 *   AN EMPTY VALUE IS UNSET. A template that leaves `AIMEAT_X=` empty means "no value", so an empty
 *   number or fixed-set setting is removed from the environment before the check and the loader uses
 *   its default. That is what turns the empty lockout count back into 5 instead of NaN.
 *
 * @structure REFUSE_ON_INVALID · dropEmptySettings() · normaliseFixedSetSettings() ·
 *   startSettingProblems() · applyStartSettings() · startSettingFallbacks() · ConfigStartError
 * @usage
 *   const setAside = applyStartSettings(process.env);           // in loadConfig, before the config is built
 *   const fallbacks = startSettingFallbacks(setAside, config);  // after: one log line per setting
 * @version-history
 *   v2.1.0 — 2026-10-25 — START_ONLY_CHOICES is gone: capability publishing, capability webhooks and
 *     the package creation role have Config-tab rows with their words, so the rows' check covers them.
 *   v2.0.0 — 2026-10-16 — A value the node does not accept no longer refuses the start: it is set
 *     aside, the default is used, one log line names it, and the server records a Security page
 *     incident. REFUSE_ON_INVALID keeps the refusal for the storage type, the node type and the
 *     registration mode (Jouni, decision 2026-10-16).
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D8-02, P6-03, D6-02).
 */

import { CONFIG_FIELDS, parseConfigValue, readConfigField, type ConfigFieldDef } from './services/config-schema.js';
import type { AimeatConfig } from './config-types.js';

/**
 * The settings whose default would be unsafe or meaningless in place of the value the operator
 * meant, with the reason. A value the node does not accept in one of these still refuses the start;
 * every other setting starts on its default. Keep this list short: each entry is a node that does
 * not start, which the operator has to notice and correct by hand.
 */
export const REFUSE_ON_INVALID: Readonly<Record<string, string>> = {
  AIMEAT_STORAGE: 'its default is an in-memory database, so the node would start empty and lose everything written to it at the next restart',
  AIMEAT_NODE_TYPE: 'its default is a full node, which serves the whole API and takes accounts where a relay or a mirror was meant',
  AIMEAT_REGISTRATION_MODE: 'its default is open registration, so anyone could make an account where the value meant to limit who may',
};

/** One setting the node does not accept. */
export interface StartSettingProblem {
  variable: string;
  value: string;
  /** What the setting takes, in words an operator can act on. */
  takes: string;
}

/** A setting the node set aside at start, and the default it runs on instead. */
export interface StartSettingFallback extends StartSettingProblem {
  /** The default the node uses, as text ('' when the default is no value). */
  used: string;
  /** The schema row's dot path, for a row of CONFIG_FIELDS. */
  dotPath?: string;
}

/** The start refusal, for the settings in REFUSE_ON_INVALID. index.ts prints its message without a stack trace. */
export class ConfigStartError extends Error {
  readonly problems: StartSettingProblem[];
  constructor(problems: StartSettingProblem[]) {
    const lines = problems.map(p => `  ${p.variable}="${p.value}": ${p.takes}. The node does not start on the default here, because ${REFUSE_ON_INVALID[p.variable] ?? 'that default is not safe'}.`);
    super(
      `The node did not start because ${problems.length === 1 ? 'one setting has a value' : `${problems.length} settings have values`} it does not accept:\n`
      + `${lines.join('\n')}\n`
      + 'Correct the value in .env, the config file or the command line, and start again. `aimeat validate` checks the whole environment without starting.',
    );
    this.name = 'ConfigStartError';
    this.problems = problems;
  }
}

/** Rows whose empty value means "use the default" rather than an empty text. */
function emptyMeansUnset(field: ConfigFieldDef): boolean {
  return field.type === 'number' || field.type === 'float' || !!field.choices || field.key === 'storageProvider';
}

/**
 * Removes the empty number and fixed-set settings from `env`, so the loader's default applies.
 * Returns the variables it removed.
 */
export function dropEmptySettings(env: NodeJS.ProcessEnv = process.env): string[] {
  const dropped: string[] = [];
  const empty = (v: string | undefined): boolean => v !== undefined && v.trim() === '';
  for (const field of CONFIG_FIELDS) {
    if (emptyMeansUnset(field) && empty(env[field.envVar])) {
      delete env[field.envVar];
      dropped.push(field.envVar);
    }
  }
  return dropped;
}

/** What a row takes, for the refusal message. */
function describe(field: ConfigFieldDef): string {
  if (field.key === 'storageProvider') {
    return 'takes postgres-kysely (production; postgres and postgresql mean the same), sqlite, or memory (in-memory, nothing is kept after a restart). The MongoDB backend was removed: migrate its data with the last release that ships migrate:to-postgres-kysely';
  }
  if (field.key === 'nodeType') return 'takes one of full, relay, mirror, personal';
  if (field.choices) return `takes one of ${field.choices.join(', ')}`;
  if (field.type === 'number') return `takes a whole number${field.range ? ` (${field.range})` : ''}`;
  if (field.type === 'float') return `takes a number${field.range ? ` (${field.range})` : ''}`;
  if (field.type === 'object') return field.list ? 'takes a comma-separated list' : 'takes a JSON object';
  return `is not a value this setting takes (${field.description})`;
}

/** Every setting in `env` that the node does not accept. Empty values are skipped (see dropEmptySettings). */
export function startSettingProblems(env: NodeJS.ProcessEnv = process.env): StartSettingProblem[] {
  const problems: StartSettingProblem[] = [];
  for (const field of CONFIG_FIELDS) {
    const raw = env[field.envVar];
    if (raw === undefined || raw.trim() === '' || field.type === 'boolean') continue;
    // A JSON-object row is stored as JSON, but several of them take comma-separated text in the
    // environment (AIMEAT_SEALED_CONFIG_KEYS, AIMEAT_SEO_SAME_AS), parsed by their own loader line.
    if (field.type === 'object' && !field.list) continue;
    const ok = field.choices
      ? field.choices.includes(raw)
      : field.validate(parseConfigValue(field, raw));
    if (!ok) problems.push({ variable: field.envVar, value: raw, takes: describe(field) });
  }
  return problems;
}

/**
 * Writes a fixed-set setting that differs from one of its words only in case or surrounding spaces
 * as that word (`Operator` becomes `operator`), so the loader's exact comparison takes the branch the
 * operator meant. A few loaders already lowercase their own value (AIMEAT_AI_LABEL_PUBLIC); this does
 * it once for all of them. Returns the variables it rewrote.
 */
export function normaliseFixedSetSettings(env: NodeJS.ProcessEnv = process.env): string[] {
  const rewritten: string[] = [];
  const lists: Array<[string, readonly string[]]> =
    CONFIG_FIELDS.filter(f => f.choices).map(f => [f.envVar, f.choices!] as [string, readonly string[]]);
  for (const [variable, choices] of lists) {
    const raw = env[variable];
    if (raw === undefined || choices.includes(raw)) continue;
    const word = choices.find(c => c.toLowerCase() === raw.trim().toLowerCase());
    if (word) { env[variable] = word; rewritten.push(variable); }
  }
  return rewritten;
}

/**
 * Drops the empty settings and normalises the case of fixed-set words. Throws ConfigStartError when a
 * setting in REFUSE_ON_INVALID has a value the node does not accept; removes every other such value
 * from `env`, so the loader uses its default, and returns them.
 */
export function applyStartSettings(env: NodeJS.ProcessEnv = process.env): StartSettingProblem[] {
  dropEmptySettings(env);
  normaliseFixedSetSettings(env);
  const problems = startSettingProblems(env);
  const refused = problems.filter(p => REFUSE_ON_INVALID[p.variable] !== undefined);
  if (refused.length > 0) throw new ConfigStartError(refused);
  for (const p of problems) delete env[p.variable];
  return problems;
}

/** A config value as an operator reads it in a log line. */
function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The settings applyStartSettings set aside, each with the default the built `config` runs on, and
 * one warning line per setting: the setting, what is wrong with its value, and the default used.
 */
export function startSettingFallbacks(
  setAside: StartSettingProblem[], config: AimeatConfig, warn: (line: string) => void = (l) => console.warn(l),
): StartSettingFallback[] {
  return setAside.map((p) => {
    const field = CONFIG_FIELDS.find(f => f.envVar === p.variable);
    const used = asText(field ? readConfigField(config, field) : undefined);
    warn(`[config] ${p.variable}="${p.value}" is not a value this node accepts: it ${p.takes}. `
      + `The node uses the default, ${used === '' ? 'no value' : used}, until the value is corrected; the Security page lists it.`);
    return { ...p, used, ...(field ? { dotPath: field.dotPath } : {}) };
  });
}
