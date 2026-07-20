/**
 * @file src/routes/extensions/entitlement-gate.ts
 * @description G2 — the metered-call GATEWAY for EXCHANGE (TARGET-045). When a cross-owner caller holds a
 *   durable {@link MeteredEntitlement} for the exact (ext, action) it is invoking, this takes over the
 *   commercial settlement instead of the per-call one-time token: it authorises against the entitlement's
 *   budget cap, moves the money, and applies the platform RAKE — all at the node (the trust boundary a
 *   client-side app could never enforce). It is purely ADDITIVE: with no entitlement it returns `null` and
 *   the existing paywall channels (one-time money token / plain morsel charge) run unchanged.
 *
 *   Slice-1 settles the `morsels` unit only — fully in-repo and atomic (debit caller `price`, credit
 *   provider `price − fee`, route `fee` via {@link settleMarketplaceFee}). A `money`-unit entitlement
 *   returns `null` for now (its drawdown rides the Stripe-Connect/EE rail, wired when EE is present) so the
 *   one-time money-token channel still applies — the seam is identical, only the settlement handler differs.
 * @structure settleViaEntitlement
 * @usage
 *   const out = await settleViaEntitlement({ config, storage, ext, action, callerGaii, res });
 *   if (out) { if (!out.ok) return; ...proceed, calling out.refund on a post-payment script throw... }
 * @version-history
 *   v1.0.0 — 2026-07-20 — Initial G2 gateway: entitlement authorise + morsel settlement + platform rake.
 */
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, ExtensionRecord } from '../../storage/interface.js';
import { error } from '../../middleware/envelope.js';
import { paymentChallenge } from '../../commerce/x402.js';
import { percentFee } from '../../commerce/money.js';
import { commerceFeePercent, settleMarketplaceFee } from '../../services/marketplace-fee.js';
import {
  readEntitlementForCall, budgetAllows, commitSpend, refundSpend,
} from '../../services/metered-entitlements.js';
import type { PaywallOutcome } from './paywall.js';
import { logger } from '../../utils/logger.js';

type ExtAction = ExtensionRecord['actions'][number];

/**
 * Settle a raw invoke through a durable entitlement, or return `null` to fall through to the standard
 * paywall. On an `ok:false` outcome a 402/500 has already been sent (the caller must `return`).
 */
export async function settleViaEntitlement(args: {
  config: AimeatConfig;
  storage: Storage;
  ext: ExtensionRecord;
  action: ExtAction;
  callerGaii: string;
  res: Response;
}): Promise<PaywallOutcome | null> {
  const { config, storage, ext, action, callerGaii, res } = args;
  const ent = await readEntitlementForCall(storage, callerGaii, ext.name, action.id);
  if (!ent) return null;                       // no contract for this call → standard paywall applies
  if (ent.unit !== 'morsels') return null;     // money rail (Stripe/EE) not wired yet — token channel applies

  // Paused / revoked / exhausted → the contract no longer authorises this call.
  if (ent.state !== 'active') {
    res.status(402).json({ ...error(config.nodeId, 'ENTITLEMENT_INACTIVE',
      `Your EXCHANGE entitlement for ${ext.name}/${action.id} is ${ent.state} (contract ${ent.contractRef}).`),
      ...paymentChallenge(config) });
    return { ok: false };
  }
  // Budget cap reached (a prior call exhausted it, or the cap was renegotiated below spend) → deny.
  if (!budgetAllows(ent)) {
    res.status(402).json({ ...error(config.nodeId, 'BUDGET_EXHAUSTED',
      `Your EXCHANGE entitlement for ${ext.name}/${action.id} has spent its ${ent.budget.capUnits}-morsel budget (contract ${ent.contractRef}).`),
      ...paymentChallenge(config) });
    return { ok: false };
  }

  const price = Math.max(0, ent.pricePerCall);
  const rakePct = ent.rakePercent ?? commerceFeePercent(config);
  const fee = percentFee(price, rakePct);          // ceils — a positive price always carries its rake
  const providerCut = price - fee;
  const track = `exchange:${ext.name}:${action.id}:${ent.contractRef}`;
  const ts = new Date().toISOString();

  // 1. Debit the caller the full price (morsels). No funds yet moved to anyone else.
  if (price > 0) {
    const debited = await storage.debitBalance(callerGaii, price);
    if (!debited) {
      res.status(402).json({ ...error(config.nodeId, 'INSUFFICIENT_MORSELS',
        `This EXCHANGE call costs ${price} morsels and your balance does not cover it`), ...paymentChallenge(config) });
      return { ok: false };
    }
    // 2. Credit the provider its cut. On failure, never keep the debit — refund and fail loudly.
    if (providerCut > 0) {
      const credited = await storage.creditBalance(ent.providerGhii, providerCut);
      if (!credited) {
        await storage.creditBalance(callerGaii, price);
        logger.error('[entitlement-gate] provider credit failed; refunded caller', { ext: ext.name, action: action.id, provider: ent.providerGhii });
        res.status(500).json(error(config.nodeId, 'SETTLEMENT_FAILED', 'Payment could not be settled to the provider; you were not charged'));
        return { ok: false };
      }
      await storage.addTransaction({ id: `xchg-earn-${randomUUID()}`, gaii: ent.providerGhii, type: 'extension_earn', amount: providerCut, counterpartyGaii: callerGaii, trackingCode: track, timestamp: ts });
    }
    await storage.addTransaction({ id: `xchg-pay-${randomUUID()}`, gaii: callerGaii, type: 'extension_pay', amount: -price, counterpartyGaii: ent.providerGhii, trackingCode: track, timestamp: ts });
    // 3. Route the platform rake (operator credit or burn, per config).
    await settleMarketplaceFee(storage, config, { fee, payerGhii: callerGaii, trackingCode: track, source: 'exchange' });
  }

  // 4. Commit the spend ONLY now that money has moved (a failed debit above never reached here).
  await commitSpend(storage, ent);

  return {
    ok: true,
    refund: async () => {
      if (price > 0) {
        if (providerCut > 0) await storage.debitBalance(ent.providerGhii, providerCut);
        await storage.creditBalance(callerGaii, price);
      }
      await refundSpend(storage, callerGaii, ext.name, action.id);
      logger.warn(`[entitlement-gate] refunded ${price} morsels (script threw after payment)`, { ext: ext.name, action: action.id });
    },
  };
}
