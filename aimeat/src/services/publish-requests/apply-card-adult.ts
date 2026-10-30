/**
 * @file src/services/publish-requests/apply-card-adult.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The buyer confirmed "I paid with my own card" for a credit card payment that only the
 *   seller's own Stripe account attests (commerce/card-adult-ask.ts filed the question): the buyer is
 *   recorded as a verified adult by the credit card method. Refused before it writes when the one who
 *   pressed is not the buyer signed in themselves (policy.ts refuses that first; this is the second
 *   check), and ended `outdated` when the buyer has been recorded as an adult since the question.
 *   Not confirming writes nothing, so the kind has no decliner.
 * @structure applyCardAdultConfirm
 * @usage registered in appliers.ts under the kind 'card-adult-confirm'
 * @version-history
 *   v1.0.0 -- 2026-10-30 -- Initial (secaudit2026oct26 round 8c, commerce-07,
 *     commerce/stripe-checkout-complete:seller-paid-session-records-buyer-adult).
 */
import { readAdult, recordAdult } from '../adult-assurance.js';
import type { PublishApplyResult, PublishDecidedBy, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyCardAdultConfirm(
  ctx: PublishStoreCtx, ownerGhii: string, _request: PublishRequest, decided?: PublishDecidedBy,
): Promise<PublishApplyResult> {
  if (!decided || decided.kind !== 'human' || decided.by !== ownerGhii) {
    return { ok: false, reason: 'only the account holder, signed in themselves, can confirm the card they paid with' };
  }
  if ((await readAdult(ctx.storage, ownerGhii)).verified) {
    return { ok: false, reason: 'you are already recorded as a verified adult on this server' };
  }
  await recordAdult(ctx.storage, ownerGhii, 'credit-card');
  return { ok: true };
}
