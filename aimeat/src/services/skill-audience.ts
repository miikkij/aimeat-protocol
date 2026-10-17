/**
 * @file src/services/skill-audience.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may read a node or user skill: the registry's visibility gate, with the
 *   organisation level (plan doc-mvcn6c7e4e5q, V3.9).
 *
 *   A user skill may be read by `organism:<id>`, the active members of one organism and their agents,
 *   as services/audience.ts audienceAllows decides. The memory layer has no such level, so the skill's
 *   records are stored at 'owner' (no generic memory read reaches them) and the audience is written on
 *   the manifest value as `audience`. A reader sees `organism:<id>` as the skill's visibility.
 *
 *   Kept apart from skills.ts, which is at the 800-line limit, and typed structurally so it imports
 *   nothing from skills.ts (no import cycle).
 * @structure SkillVisibility · parseSkillVisibility · storedSkillVisibility · skillVisibilityOf ·
 *   skillAudienceAuth · publisherMayName · mayReadSkill
 * @usage
 *   const v = parseSkillVisibility(req.body.visibility);    // null → 400
 *   if (!(await mayReadSkill(storage, record, 'user', owner, accessor))) → refuse
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial: mayRead moved here from skills.ts and made asynchronous for the
 *     organisation level (plan doc-mvcn6c7e4e5q, V3.9).
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { parseAudience, audienceAllows, formatAudience, type Audience, type AudienceAuth } from './audience.js';

/** What a node or user skill's visibility may be set to. */
export type SkillVisibility = 'owner' | 'members' | 'public' | `organism:${string}`;

/** The sentence a refused visibility answers with. */
export const SKILL_VISIBILITY_HINT = 'visibility must be owner, members, public, or organism:<organism id>';

/** A requested visibility in its stored form, or null when it is none of the four. */
export function parseSkillVisibility(value: unknown): SkillVisibility | null {
  if (value === 'owner' || value === 'members' || value === 'public') return value;
  const audience = parseAudience(value);
  return audience?.level === 'organism' ? formatAudience(audience) as SkillVisibility : null;
}

/** How a visibility is stored: the memory records' level, and the manifest's `audience` when there is one. */
export function storedSkillVisibility(v: SkillVisibility): { record: 'owner' | 'members' | 'public'; audience?: string } {
  return v === 'owner' || v === 'members' || v === 'public' ? { record: v } : { record: 'owner', audience: v };
}

/** The organism audience on a manifest record, or null. */
function organismAudienceOf(record: Pick<MemoryRecord, 'value'>): Audience | null {
  const raw = (record.value as { audience?: unknown } | null)?.audience;
  const audience = parseAudience(raw);
  return audience?.level === 'organism' ? audience : null;
}

/** The visibility a reader sees for a manifest record: its organism audience, or the record's level. */
export function skillVisibilityOf(record: Pick<MemoryRecord, 'value' | 'visibility'>): string {
  const audience = organismAudienceOf(record);
  return audience ? formatAudience(audience) : record.visibility;
}

/** The accessor fields this file reads. services/skills.ts SkillAccessor fits. */
export interface SkillAudienceAccessor {
  ownerName: string | null;
  sub?: string;
  /** The session's auth, when the caller has one; made from ownerName and sub when absent. */
  auth?: AudienceAuth | null;
}

/**
 * The auth audienceAllows reads. A caller without an owner (anonymous, or a visitor from another
 * node, which the skills route turns into one) has none.
 */
export function skillAudienceAuth(accessor: SkillAudienceAccessor): AudienceAuth | null {
  if (accessor.auth !== undefined) return accessor.auth;
  if (!accessor.ownerName) return null;
  return { sub: accessor.sub ?? accessor.ownerName, owner: accessor.ownerName };
}

/**
 * May the publisher give a skill this visibility? Every level but the organisation one passes;
 * `organism:<id>` passes when the publisher is in that organism (audienceAllows). Asked before the
 * first write.
 */
export async function publisherMayName(storage: Storage, v: SkillVisibility, accessor: SkillAudienceAccessor): Promise<boolean> {
  const audience = parseAudience(v);
  if (audience?.level !== 'organism') return true;
  return audienceAllows(storage, audience, skillAudienceAuth(accessor));
}

/**
 * The visibility gate shared by resolve and list. The owner of a skill always reads their own. A
 * node skill is the node-wide library: any signed-in identity, and 'public' anyone. A user skill at
 * an organisation level admits exactly what audienceAllows admits; 'members' any account of this
 * node; 'public' anyone.
 */
export async function mayReadSkill(
  storage: Storage,
  record: Pick<MemoryRecord, 'value' | 'visibility'>,
  scope: 'node' | 'user' | 'workspace',
  skillOwner: string | null,
  accessor: SkillAudienceAccessor,
): Promise<boolean> {
  if (scope === 'node') {
    if (record.visibility === 'public') return true;
    return accessor.ownerName !== null;
  }
  if (accessor.ownerName !== null && accessor.ownerName === skillOwner) return true;
  const audience = organismAudienceOf(record);
  if (audience) return audienceAllows(storage, audience, skillAudienceAuth(accessor));
  if (record.visibility === 'public') return true;
  if (record.visibility === 'members') return accessor.ownerName !== null;
  return false;
}
