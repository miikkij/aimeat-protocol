/**
 * @file src/services/skill-publish-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate at the doors that make a user skill public (plan doc-mvcn6c7e4e5q,
 *   V4): POST /v1/skills, PATCH /v1/skills/:name, aimeat_skill_publish (inline and its ZIP upload)
 *   and aimeat_skill_update. A user skill is one person's operating guide; `public` lets anyone read
 *   it without signing in. An agent without publish:public (an app grant too when the gate covers
 *   apps) publishes or keeps the skill at the level it has, `owner` for a new one, and the owner gets
 *   a request to approve.
 *
 *   Node and workspace skills are not asked about: a node skill is the operator's, and a workspace
 *   skill is always read by its workspace.
 *
 *   Kept apart from skills.ts, which is close to the 800-line limit.
 * @structure SkillGateAsk · skillPublishAsk · closedSkillLevel · userSkillState · fileSkillAsk
 * @usage
 *   const closed = await closedSkillLevel(ctx, scope, visibility, owner, { skillMd });  // closed node first
 *   const ask = skillPublishAsk(ctx, gate, scope, closed.visibility);  // before the first write
 *   if (ask?.kind === 'refused') → 403
 *   const summary = await publishSkill(..., { visibility: ask ? undefined : visibility });
 *   const asked = ask ? await fileSkillAsk(ctx, gate, ask, summary) : {};
 * @version-history
 *   v1.1.0 — 2026-10-18 — closedSkillLevel: on a node that shows its content to signed-in accounts
 *     only, a user skill asked as public is stored at 'members' with PUBLIC_IS_SIGNED_IN_HERE (plan V1.6).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { isRaiseToPublic } from './publish-gate.js';
import { publishAskOf, type PublishAsk } from './publish-requests/ask.js';
import { fileAskForDoor, type DoorAsk, type PublishGateInput } from './publish-requests/door.js';
import { resolveSkillRef, formatSkillRef, SkillAccessError } from './skills.js';
import { SkillValidationError, parseSkillMd } from './skill-md.js';
import { signedInOnly } from '../config-visibility.js';
import { closedNodeLevel, type ClosedNodeWarning } from './closed-node-level.js';

export type SkillGateAsk = Extract<PublishAsk, { kind: 'ask' | 'refused' }>;
type Ctx = { storage: Storage; config: AimeatConfig };

/**
 * Ask the gate when a user skill is to become public from `current` (unknown on a publish, which
 * reads the level it keeps from the summary afterwards). Null: go ahead as asked.
 */
export function skillPublishAsk(
  ctx: Ctx, gate: PublishGateInput | undefined, scope: string, requested: unknown, current?: string,
): SkillGateAsk | null {
  if (!gate || scope !== 'user' || !isRaiseToPublic(current, requested)) return null;
  const ask = publishAskOf(ctx, gate.caller, gate.app);
  return ask.kind === 'allowed' ? null : ask;
}

/** The name SKILL.md declares, or undefined when it does not parse (the publish answers that itself). */
function declaredSkillName(skillMd: unknown): string | undefined {
  if (typeof skillMd !== 'string') return undefined;
  try {
    return parseSkillMd(skillMd).frontmatter.name;
  } catch (err) {
    // An invalid SKILL.md names no skill here; the publish that follows refuses it with its own 422.
    if (err instanceof SkillValidationError) return undefined;
    throw err;
  }
}

/**
 * The level of a user skill asked as public on a node that shows its content to signed-in accounts
 * only (services/closed-node-level.ts, plan V1.6): 'members' with the warning, unless the skill is
 * public already. `current` is the level now when the door knows it (a visibility change); a publish
 * names the skill by its SKILL.md and the level is read here. Asked before skillPublishAsk.
 */
export async function closedSkillLevel<V>(
  ctx: Ctx, scope: string, requested: V, owner: string | null | undefined,
  skill: { current?: string; name?: string; skillMd?: unknown },
): Promise<{ visibility: V | 'members'; warning: ClosedNodeWarning | null }> {
  if (scope !== 'user' || requested !== 'public' || !signedInOnly(ctx.config)) return { visibility: requested, warning: null };
  let from = skill.current;
  const name = skill.name ?? declaredSkillName(skill.skillMd);
  if (from === undefined && owner && name) from = (await userSkillState(ctx, owner, name))?.visibility;
  const closed = closedNodeLevel(ctx.config, requested, 'members' as const, { from });
  return { visibility: closed.level, warning: closed.warning };
}

/**
 * A user skill's level and version now, read as its owner through the registry's one resolve
 * (resolveSkillRef, manifest only), or null when there is no such skill.
 */
export async function userSkillState(ctx: Ctx, owner: string, name: string): Promise<{ visibility: string; version: string } | null> {
  try {
    const skill = await resolveSkillRef(ctx.storage, ctx.config, formatSkillRef({ scope: 'user', owner, name }), { ownerName: owner }, { manifestOnly: true });
    return { visibility: skill.visibility, version: skill.version };
  } catch (err) {
    // No such skill (or a name that is not one): the door answers its own 404.
    if (err instanceof SkillAccessError || err instanceof SkillValidationError) return null;
    throw err;
  }
}

/**
 * File the request once the skill is stored at the level it kept. A skill that was public already
 * needs none: the publish changed nothing about who reads it.
 */
export async function fileSkillAsk(
  ctx: Ctx, gate: PublishGateInput, ask: SkillGateAsk,
  skill: { owner: string | null; name: string; version: string; visibility: string },
): Promise<DoorAsk> {
  if (ask.kind !== 'ask' || !skill.owner || skill.visibility === 'public') return {};
  return fileAskForDoor(ctx, gate, ask.requester, {
    kind: 'skill',
    // The skill's version: a republish since makes the approval outdated (apply-skill.ts).
    target: { owner: skill.owner, name: skill.name, version: skill.version },
    title: `the skill ${skill.name}`, name: skill.name,
    change: { field: 'visibility', from: skill.visibility, to: 'public' },
  }, skill.visibility);
}
