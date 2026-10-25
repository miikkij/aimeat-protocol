/**
 * @file src/services/publish-requests/apply-subscription-price.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The buyer allowed a subscription to renew at the raised price they were asked about
 *   (commerce/subscription-price-ask.ts filed it). The asked price becomes the amount the buyer agreed
 *   to, and the period renews at once (commerce/subscriptions.ts allowRaisedPrice). A subscription
 *   that no longer renews, is in another period, or whose plan price changed again since the question
 *   ends the request `outdated` with the reason, and nothing is charged.
 * @structure applySubscriptionPrice
 * @usage registered in appliers.ts under the kind 'subscription-price'
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, renewal-skips-agent-limit, the price part).
 */
import { allowRaisedPrice } from '../../commerce/subscriptions.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applySubscriptionPrice(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const t = request.target;
  const out = await allowRaisedPrice(ctx.storage, ctx.config, ownerGhii, {
    ext: String(t.ext ?? ''), plan: String(t.plan ?? ''), period: String(t.period ?? ''),
    amount: Number(t.amount), currency: String(t.currency ?? ''),
  });
  return out.ok ? { ok: true } : { ok: false, reason: out.reason };
}
