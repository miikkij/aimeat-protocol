/**
 * @file src/services/classification/label-audience-fields.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A label's reader audience (roles, sharing groups by id, people) read from input and
 *   compared: is it empty, the readers two audiences both admit, and is one within the other. Moved
 *   unchanged out of levels.ts for the 800-line limit when a label gained its audience cap (plan
 *   doc-mvdipuyqraas, L3.1); levels.ts is the only caller. Pure: nothing here reads storage.
 * @structure GROUP_ID · readAudience() · audienceEmpty() · intersectAudience() · audienceWithin() ·
 *   storedAudience()
 * @usage const audience = readAudience(v.audience, where, problems);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Extracted unchanged from levels.ts (plan doc-mvdipuyqraas, L3.1).
 */
import type { LabelAudience } from './defaults.js';

const MAX_LIST = 50;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function strList(v: unknown, field: string, problems: string[]): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > MAX_LIST || v.some(x => typeof x !== 'string' || !x.trim() || x.length > 200)) {
    problems.push(`${field} is a list of at most ${MAX_LIST} names.`);
    return undefined;
  }
  return [...new Set(v.map(x => (x as string).trim()))];
}

/** A sharing group's id (services/sharing-group-members.ts mints a v4 UUID). */
export const GROUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readAudience(v: unknown, where: string, problems: string[]): LabelAudience | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!isObj(v)) { problems.push(`${where}.audience is an object with roles, groups and people.`); return undefined; }
  const a: LabelAudience = {};
  const roles = strList(v.roles, `${where}.audience.roles`, problems);
  let groups = strList(v.groups, `${where}.audience.groups`, problems);
  // A group is named by its id only. Anyone may create a group and call it anything, so a name
  // in the audience let whoever chose that name in (TARGET-082 review finding 6).
  if (groups?.some(g => !GROUP_ID.test(g))) {
    problems.push(`${where}.audience.groups lists sharing group ids, not names: anyone may give a group any name.`);
    groups = undefined;
  }
  const people = strList(v.people, `${where}.audience.people`, problems);
  if (roles?.length) a.roles = roles;
  if (groups?.length) a.groups = groups;
  if (people?.length) a.people = people;
  return audienceEmpty(a) ? null : a;
}

export function audienceEmpty(a: LabelAudience | null | undefined): boolean {
  return !a || (!a.roles?.length && !a.groups?.length && !a.people?.length);
}

/**
 * The readers both audiences admit, list by list, so the answer is never wider than either. An empty
 * audience admits everyone. When the lists share nothing, `base` stands: the node's list is the one
 * a lower level may not widen, and an empty result would read as "everyone".
 */
export function intersectAudience(base: LabelAudience | null | undefined, over: LabelAudience | null | undefined): LabelAudience | null {
  if (audienceEmpty(over)) return audienceEmpty(base) ? null : base!;
  if (audienceEmpty(base)) return over!;
  const both = (a?: string[], b?: string[]) => (a ?? []).filter(x => (b ?? []).includes(x));
  const out: LabelAudience = {};
  const roles = both(over!.roles, base!.roles);
  const groups = both(over!.groups, base!.groups);
  const people = both(over!.people, base!.people);
  if (roles.length) out.roles = roles;
  if (groups.length) out.groups = groups;
  if (people.length) out.people = people;
  return audienceEmpty(out) ? base! : out;
}

/** Is `inner` no wider than `outer`? An empty outer admits everyone, so anything is within it. */
export function audienceWithin(inner: LabelAudience | null | undefined, outer: LabelAudience | null | undefined): boolean {
  if (audienceEmpty(outer)) return true;
  if (audienceEmpty(inner)) return false;
  const sub = (a?: string[], b?: string[]) => (a ?? []).every(x => (b ?? []).includes(x));
  return sub(inner!.roles, outer!.roles) && sub(inner!.groups, outer!.groups) && sub(inner!.people, outer!.people);
}

/** A stored audience, read leniently: what does not parse admits no one extra. */
export function storedAudience(v: unknown): LabelAudience | null {
  return readAudience(v, '', []) ?? null;
}
