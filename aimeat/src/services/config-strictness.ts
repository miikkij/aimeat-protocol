/**
 * @file src/services/config-strictness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "An AI may only make this setting stricter", read from the setting's own row. A row
 *   with `aiMayOnlyTighten` (services/config-field-def.ts) names the order of its values from open to
 *   strict; this file judges a change against that order, and every path that writes settings asks it
 *   through services/config-apply.ts: applyConfigChanges (PUT /v1/admin/config, aimeat_admin_config_set
 *   and its CLI twin, the classification switch, Themes & Styles) and resetConfigValue (DELETE
 *   /v1/admin/config/:path). Until 2026-11-04 the rule was a hand list of five paths in
 *   config-admin-view.ts and three checks of their own, and a write path that did not call the list
 *   did not apply it (security-architecture finding 5: DELETE reset such a setting for an AI while PUT
 *   refused it, d1f37bb4a).
 *
 *   WHO. A person's own session, and an owner-level personal access token, is 'human' in
 *   classification/reader-kind.ts and changes the setting either way. An agent, a narrower token, an
 *   unattended run, a visitor and a write that names nobody are refused a looser value with
 *   PERSON_REQUIRED, and the removal of the saved value too, because the value it falls back to (the
 *   server's files, the environment or the default) can be less strict. A stricter value applies from
 *   anyone who may change settings.
 *
 *   ONE REQUEST, SEVERAL CHANGES. Each change is judged from the value the change before it in the same
 *   request leaves (a stricter value and then a looser one is a loosening). The groups of settings are
 *   asked in the order their first row stands in the schema, and within a group in the request's order,
 *   so a request with two refusals is answered with the same one as before the rule moved here.
 * @structure TightenRefusal · tightenOnlyOf · settingLoosens · looseningRefusal · requestLooseningRefusal ·
 *   resetRefusal
 * @usage
 *   const refused = requestLooseningRefusal(caller, config, changes);
 *   if (refused) return { status: refused.status, code: refused.code, message: refused.message };
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial: the rule moved from config-admin-view.ts, sign-in-policy.ts,
 *     mcp-client/capability-use-setting.ts and classification/switch.ts onto the setting's row
 *     (codebase analysis 2026-11-03, item B4).
 */
import type { AimeatConfig } from '../config.js';
import type { TightenOnly } from './config-field-def.js';
import { CONFIG_FIELDS, MUTABLE_CONFIG_MAP, readConfigField } from './config-schema.js';
import { readerKindOf, type ReaderCredential } from './classification/reader-kind.js';

/** The refusal an AI credential gets, with the setting it is about and where its group is asked. */
export interface TightenRefusal {
  status: 403;
  code: 'PERSON_REQUIRED';
  message: string;
  details?: Record<string, unknown>;
  /** The setting the refused change named. */
  path: string;
  /** Where the setting's group is asked in a request: the schema position of the group's first row. */
  rank: number;
}

/** The setting's tighten-only rule, or undefined when an AI may move it either way. */
export function tightenOnlyOf(path: string): TightenOnly | undefined {
  return MUTABLE_CONFIG_MAP[path]?.aiMayOnlyTighten;
}

/** Whether moving the setting from `from` to `to` makes it less strict. False for a value outside its order. */
export function settingLoosens(path: string, from: unknown, to: unknown): boolean {
  const order = tightenOnlyOf(path)?.order;
  if (!order) return false;
  const a = typeof from === 'string' ? order.indexOf(from) : -1;
  const b = typeof to === 'string' ? order.indexOf(to) : -1;
  return a >= 0 && b >= 0 && b < a;
}

/** Where each group is asked: the schema position of its first row. Built on first use. */
let ranks: Map<string, number> | null = null;
function rankOf(path: string): number {
  if (!ranks) {
    ranks = new Map();
    const firstOfGroup = new Map<string, number>();
    CONFIG_FIELDS.forEach((field, i) => {
      const rule = field.aiMayOnlyTighten;
      if (!rule) return;
      const group = rule.group ?? field.dotPath;
      if (!firstOfGroup.has(group)) firstOfGroup.set(group, i);
      ranks!.set(field.dotPath, firstOfGroup.get(group)!);
    });
  }
  return ranks.get(path) ?? Number.MAX_SAFE_INTEGER;
}

/** The position of a setting's group among the tighten-only settings, for a caller that keeps a check of its own between groups. */
export function tightenOnlyRank(path: string): number {
  return rankOf(path);
}

/**
 * The refusal an AI credential gets for moving one setting from `from` to `to`, or null: when the
 * setting is not tighten-only, the change is not looser, or the caller is a person.
 */
export function looseningRefusal(caller: ReaderCredential | null | undefined, path: string, from: unknown, to: unknown): TightenRefusal | null {
  if (!settingLoosens(path, from, to) || readerKindOf(caller) === 'human') return null;
  const rule = tightenOnlyOf(path)!;
  const worded = rule.refusal?.(String(from), String(to)) ?? {
    details: { setting: path, from, to },
    message: `Changing ${path} from ${String(from)} to ${String(to)} makes this server less strict, so an AI does not make it. `
      + 'The operator makes it on the admin Config page, signed in themselves. An AI may still make it stricter.',
  };
  return { status: 403, code: 'PERSON_REQUIRED', message: worded.message, ...(worded.details ? { details: worded.details } : {}), path, rank: rankOf(path) };
}

/**
 * The refusal for a whole request, or null. Each change is judged from the value the one before it
 * leaves; a value the setting does not take moves nothing and is left to the row's check. Groups are
 * asked by rank, each in the request's order (see the file header).
 */
export function requestLooseningRefusal(
  caller: ReaderCredential | null | undefined, config: AimeatConfig, changes: ReadonlyArray<{ path?: unknown; value?: unknown }>,
): TightenRefusal | null {
  const at = new Map<string, unknown>();
  let first: TightenRefusal | null = null;
  for (const change of changes) {
    const path = change?.path;
    if (typeof path !== 'string' || !tightenOnlyOf(path)) continue;
    const field = MUTABLE_CONFIG_MAP[path]!;
    const from = at.has(path) ? at.get(path) : readConfigField(config, field);
    const refusal = looseningRefusal(caller, path, from, change.value);
    if (refusal) {
      // The first refusal of the lowest rank: a later group never displaces an earlier one, and in one
      // group the request's order decides. A refused change moves nothing, as before.
      if (!first || refusal.rank < first.rank) first = refusal;
      continue;
    }
    if (field.validate(change.value)) at.set(path, change.value);
  }
  return first;
}

/**
 * The refusal an AI credential gets for removing the saved value of a tighten-only setting, or null.
 * Asked whatever the value would fall back to: the fallback (the server's files, the environment or
 * the default) is not known here for certain, and the AI may still set a stricter value.
 */
export function resetRefusal(caller: ReaderCredential | null | undefined, path: string): { status: 403; code: 'PERSON_REQUIRED'; message: string; details: Record<string, unknown> } | null {
  if (!tightenOnlyOf(path) || readerKindOf(caller) === 'human') return null;
  return { status: 403, code: 'PERSON_REQUIRED', details: { setting: path },
    message: `Removing the saved value of ${path} puts it back to the value in the server's files or its default, which can be less safe, so an AI does not do it. `
      + 'An AI may still set a stricter value. The operator removes the saved value on the admin Config page, signed in themselves.' };
}
