/**
 * @file src/services/publish-requests/apply-living-ai-spend.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner allowed a living document whose config a writer without ai:use set up to
 *   refresh itself with the owner's AI (services/living-pulse-spend.ts filed it). That writer may
 *   spend for this config from now on, and the next pulse calls the model as it did before the rule.
 *   A config deleted since, or a writer no longer waiting on this request, ends the request `outdated`.
 * @structure applyLivingAiSpend
 * @usage registered in appliers.ts under the kind 'living-ai-spend'
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit2026oct31w2 round 10, f-2026aug-ai-paths-3).
 */
import { allowLivingSpend } from '../living-pulse-spend.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyLivingAiSpend(ctx: PublishStoreCtx, _ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const key = String(request.target.key ?? '');
  const holder = String(request.target.holder ?? '');
  const spender = String(request.target.spender ?? '');
  if (!key || !holder || !spender) return { ok: false, reason: 'the request names no living document' };
  const changed = await allowLivingSpend(ctx, holder, key, spender, request.id);
  return changed ? { ok: true } : { ok: false, reason: 'the living document is gone or no longer waits for this answer' };
}
