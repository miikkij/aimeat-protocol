/**
 * @file src/services/publish-requests/apply-crew-model.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner allowed a crew model choice with its own address that an app set
 *   (services/crew-model-ask.ts filed it). The choice that was asked is written as the owner, through
 *   writeLlmChoice, which checks it again: an address that is no longer public https, or a key
 *   variable that is not a provider key, ends the request `outdated` with the check's own words. An
 *   agent removed since ends it the same way.
 * @structure applyCrewModel
 * @usage registered in appliers.ts under the kind 'crew-model'
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, lead 228 reworked; the approval standard).
 */
import { localAccountName } from '../../utils/gaii.js';
import { writeLlmChoice } from '../crew-menu.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyCrewModel(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  let choice: unknown;
  try {
    choice = JSON.parse(String(request.target.choice ?? ''));
  } catch {
    return { ok: false, reason: 'the asked choice could not be read' };
  }
  const owner = localAccountName(ownerGhii);
  const agent = String(request.target.agent ?? '');
  if (agent && !(await ctx.storage.getAgent(`${agent}#${owner}@${ctx.config.nodeId}`))) {
    return { ok: false, reason: `the agent ${agent} was removed` };
  }
  // As the owner: the owner's own choice is written at once, and with the same checks.
  const out = await writeLlmChoice(ctx, {
    principal: ownerGhii, owner, scopes: ['*'], roles: ['owner'], pipeline: 'approval.crew-model',
  }, agent || null, choice);
  if (!out.ok) return { ok: false, reason: out.message };
  return { ok: true };
}
