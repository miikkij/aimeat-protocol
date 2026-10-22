/**
 * @file src/services/publish-requests/apply-skill.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for a user skill: it becomes public, as the owner, through
 *   setSkillVisibility (services/skills.ts), the change PATCH /v1/skills/:name and aimeat_skill_update
 *   run (plan doc-mvcn6c7e4e5q, V4).
 *
 *   THE OWNER APPROVED WHAT THEY SAW. The request carries the skill's version and the digest of its
 *   files (content-digests.ts); a skill deleted, republished, created again or given another level
 *   since is not made public.
 * @structure applySkillPublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS.skill (appliers.ts)
 * @version-history
 *   2026-10-22 — The applier compares the request's content digest (`target.digest`) with the
 *     skill's files as well as the version: an agent deleted the skill, published other text under
 *     the same name at 1.0.0 again, and the owner's approval of the old request published it
 *     (secaudit 2026-10, apply-skill.ts:applySkillPublish:semver-restarts-on-delete-recreate).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4).
 */
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';
import { setSkillVisibility } from '../skills.js';
import { userSkillState } from '../skill-publish-gate.js';
import { userSkillContent } from './content-digests.js';
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
  // The version restarts at 1.0.0 when a skill is deleted and created again, so the digest of the
  // files the request was filed with is compared too. A request filed before the digest existed
  // carries none and is held to its version alone, as it was; deleteSkill settles those.
  if (typeof request.target.digest === 'string' && (await userSkillContent(ctx, owner, name))?.digest !== request.target.digest) {
    return { ok: false, reason: 'the skill changed after the request was made' };
  }
  if (state.visibility === 'public') return { ok: true };
  if (state.visibility !== request.change.from) return { ok: false, reason: 'who may read the skill changed after the request was made' };
  const summary = await setSkillVisibility(ctx.storage, ctx.config, 'user', name, 'public', owner, { ownerName: owner });
  if (!summary) return { ok: false, reason: 'the skill was deleted' };
  // The routes emit it after the same call: an open skills view hears the new level.
  emitChange('skills');
  return { ok: true };
}
