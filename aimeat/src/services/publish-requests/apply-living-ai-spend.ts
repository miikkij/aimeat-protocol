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
 *   v1.1.0 -- 2026-11-08 -- The request's `content` (the config content it asked about) goes to the
 *     allowance, which then holds for that content only (secaudit2026nov08 round 14).
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit2026oct31w2 round 10, f-2026aug-ai-paths-3).
 */
import { allowLivingSpend } from '../living-pulse-spend.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyLivingAiSpend(ctx: PublishStoreCtx, _ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const key = String(request.target.key ?? '');
  const holder = String(request.target.holder ?? '');
  const spender = String(request.target.spender ?? '');
  if (!key || !holder || !spender) return { ok: false, reason: 'the request names no living document' };
  // The content the owner was asked about, when the writer is of another account: the allowance holds for it.
  const content = typeof request.target.content === 'string' && request.target.content ? request.target.content : undefined;
  const changed = await allowLivingSpend(ctx, holder, key, spender, request.id, content);
  return changed ? { ok: true } : { ok: false, reason: 'the living document is gone or no longer waits for this answer' };
}
