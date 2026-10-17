/**
 * @file src/services/publish-requests/apply-skill.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for a user skill: it becomes public, as the owner, through
 *   setSkillVisibility (services/skills.ts), the change PATCH /v1/skills/:name and aimeat_skill_update
 *   run (plan doc-mvcn6c7e4e5q, V4).
 *
 *   THE OWNER APPROVED WHAT THEY SAW. The request carries the skill's version; a skill deleted,
 *   republished or given another level since is not made public.
 * @structure applySkillPublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS.skill (appliers.ts)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4).
 */
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';
import { setSkillVisibility } from '../skills.js';
import { userSkillState } from '../skill-publish-gate.js';
import { localAccountName } from '../../utils/gaii.js';
import { emitChange } from '../event-bus.js';

export async function applySkillPublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const owner = String(request.target.owner ?? '');
  const name = String(request.target.name ?? '');
  // A user skill lives under its owner's account, and only that account's request can publish it.
  if (!owner || !name || owner !== localAccountName(ownerGhii)) return { ok: false, reason: 'the skill is not on this account' };
  const state = await userSkillState(ctx, owner, name);
  if (!state) return { ok: false, reason: 'the skill was deleted' };
  if (state.version !== String(request.target.version)) return { ok: false, reason: 'the skill changed after the request was made' };
  if (state.visibility === 'public') return { ok: true };
  if (state.visibility !== request.change.from) return { ok: false, reason: 'who may read the skill changed after the request was made' };
  const summary = await setSkillVisibility(ctx.storage, ctx.config, 'user', name, 'public', owner, { ownerName: owner });
  if (!summary) return { ok: false, reason: 'the skill was deleted' };
  // The routes emit it after the same call: an open skills view hears the new level.
  emitChange('skills');
  return { ok: true };
}
