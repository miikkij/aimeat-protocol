/**
 * @file src/config-start-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The check loadConfig() runs on the environment before it builds the config: every
 *   setting from the environment, a config file or a command-line flag is held to the same rule the
 *   admin Config tab holds it to, and a value the node does not accept refuses the start.
 *
 *   WHY A REFUSAL. The loader reads each variable with a cast or a parseInt and a default, and every
 *   consumer compares the value against its restrictive words only. So `AIMEAT_METRICS_ACCESS=Operator`
 *   matched neither `operator` nor `authenticated` and the metrics were public;
 *   `AIMEAT_REGISTRATION_MODE=invite-only` fell back to `open`; an empty
 *   `AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS` became NaN, after which no account locked; and a misspelt
 *   `AIMEAT_STORAGE` started an empty in-memory node. The same values typed into the Config tab were
 *   refused, because `services/config-schema.ts` has a validator per row that only the write paths
 *   ran. The node type has always refused an unknown value at start; every other setting now does too.
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
 *   - START_ONLY_CHOICES: the fixed-set settings that have no schema row yet.
 *
 *   CASE IS NOT A TYPING ERROR. A fixed-set value that matches one of its words in another case or
 *   with spaces around it (`Operator`) is written back as that word, so the loader's exact compare
 *   takes the branch meant; only a word outside the list refuses the start.
 *
 *   AN EMPTY VALUE IS UNSET. A template that leaves `AIMEAT_X=` empty means "no value", so an empty
 *   number or fixed-set setting is removed from the environment before the check and the loader uses
 *   its default. That is what turns the empty lockout count back into 5 instead of NaN.
 *
 * @structure START_ONLY_CHOICES · dropEmptySettings() · normaliseFixedSetSettings() · startSettingProblems() · assertStartSettings() · ConfigStartError
 * @usage called from loadConfig() before the config object is built, beside the node-type refusal
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D8-02, P6-03, D6-02).
 */

import { CONFIG_FIELDS, parseConfigValue, type ConfigFieldDef } from './services/config-schema.js';

/**
 * Fixed-set settings the loader reads that have no CONFIG_FIELDS row (they are listed in
 * security/config-coverage-exemptions.json as not in the Config tab). Each list is the set of words
 * the loader and its consumers know; anything else used to mean the open setting.
 */
export const START_ONLY_CHOICES: Readonly<Record<string, readonly string[]>> = {
  AIMEAT_CAPABILITY_PUBLISHING: ['disabled', 'self_only', 'moderated', 'open'],
  AIMEAT_CAPABILITY_WEBHOOKS: ['disabled', 'allowlist_only', 'open'],
  AIMEAT_PACKAGE_CREATE_ROLE: ['operator', 'owner'],
};

/** One setting the node does not accept. */
export interface StartSettingProblem {
  variable: string;
  value: string;
  /** What the setting takes, in words an operator can act on. */
  takes: string;
}

/** The start refusal. index.ts prints its message without a stack trace. */
export class ConfigStartError extends Error {
  readonly problems: StartSettingProblem[];
  constructor(problems: StartSettingProblem[]) {
    const lines = problems.map(p => `  ${p.variable}="${p.value}": ${p.takes}`);
    super(
      `The node did not start because ${problems.length === 1 ? 'one setting has a value' : `${problems.length} settings have values`} it does not accept:\n`
      + `${lines.join('\n')}\n`
      + 'Correct the value in .env, the config file or the command line, or remove it to use the default, and start again. `aimeat validate` checks the whole environment without starting.',
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
  for (const variable of Object.keys(START_ONLY_CHOICES)) {
    if (empty(env[variable])) {
      delete env[variable];
      dropped.push(variable);
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
  for (const [variable, choices] of Object.entries(START_ONLY_CHOICES)) {
    const raw = env[variable];
    if (raw === undefined || raw.trim() === '') continue;
    if (!choices.includes(raw)) problems.push({ variable, value: raw, takes: `takes one of ${choices.join(', ')}` });
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
  const lists: Array<[string, readonly string[]]> = [
    ...CONFIG_FIELDS.filter(f => f.choices).map(f => [f.envVar, f.choices!] as [string, readonly string[]]),
    ...Object.entries(START_ONLY_CHOICES),
  ];
  for (const [variable, choices] of lists) {
    const raw = env[variable];
    if (raw === undefined || choices.includes(raw)) continue;
    const word = choices.find(c => c.toLowerCase() === raw.trim().toLowerCase());
    if (word) { env[variable] = word; rewritten.push(variable); }
  }
  return rewritten;
}

/**
 * Drops the empty settings and normalises the case of fixed-set words, then throws ConfigStartError
 * when any setting has a value the node does not accept.
 */
export function assertStartSettings(env: NodeJS.ProcessEnv = process.env): void {
  dropEmptySettings(env);
  normaliseFixedSetSettings(env);
  const problems = startSettingProblems(env);
  if (problems.length > 0) throw new ConfigStartError(problems);
}
