/**
 * @file src/routes/extensions/entitlement-gate.ts
 * @description G2 — the metered-call GATEWAY for EXCHANGE (TARGET-045). When a cross-owner caller holds a
 *   durable {@link MeteredEntitlement} for the exact (ext, action) it is invoking, this takes over the
 *   commercial settlement instead of the per-call one-time token: it authorises against the entitlement's
 *   budget cap, moves the value, and applies the platform RAKE — all at the node (the trust boundary a
 *   client-side app could never enforce). It is purely ADDITIVE: with no entitlement it returns `null` and
 *   the existing paywall channels (one-time money token / plain morsel charge) run unchanged.
 *
 *   Two settlement rails, chosen by the entitlement's `unit` (the pricing MODEL is orthogonal — per-call
 *   here; bundle/subscription build on the same rails):
 *     - `morsels` — fully in-repo, atomic (debit caller `price`, credit provider `price − fee`, route
 *       `fee` via {@link settleMarketplaceFee}).
 *     - `money`   — REAL currency via the ACCRUAL rail ({@link settleEntitlementMoney}): each call records
 *       a real EUR/USD obligation (buyer → seller, minus rake) through a money PaymentHandler
 *       (`io.aimeat.invoice` in prod / `test.money` in E2E), off the morsel ledger.
 * @structure settleViaEntitlement · settleMorsels · settleMoney
 * @usage
 *   const out = await settleViaEntitlement({ config, storage, ext, action, callerGaii, res });
 *   if (out) { if (!out.ok) return; ...proceed, calling out.refund on a post-payment script throw... }
 * @version-history
 *   v1.1.0 — 2026-07-20 — Wire the money unit to the accrual rail (real EUR/USD); split morsel/money settlement.
 *   v1.0.0 — 2026-07-20 — Initial G2 gateway: entitlement authorise + morsel settlement + platform rake.
 */
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, ExtensionRecord } from '../../storage/interface.js';
import { error } from '../../middleware/envelope.js';
import { paymentChallenge } from '../../commerce/x402.js';
import { percentFee, formatMoneyMajor } from '../../commerce/money.js';
import { commerceFeePercent, settleMarketplaceFee } from '../../services/marketplace-fee.js';
import {
  readEntitlementForCall, budgetAllows, commitSpend, refundSpend, type MeteredEntitlement,
} from '../../services/metered-entitlements.js';
import { settleEntitlementMoney, refundEntitlementMoney } from '../../services/entitlement-money.js';
import type { PaywallOutcome } from './paywall.js';
import { logger } from '../../utils/logger.js';

type ExtAction = ExtensionRecord['actions'][number];

interface SettleArgs {
  config: AimeatConfig;
  storage: Storage;
  ext: ExtensionRecord;
  action: ExtAction;
  callerGaii: string;
  res: Response;
  ent: MeteredEntitlement;
}

/**
 * Settle a raw invoke through a durable entitlement, or return `null` to fall through to the standard
 * paywall. On an `ok:false` outcome a 402/500 has already been sent (the caller must `return`).
 */
export async function settleViaEntitlement(args: {
  config: AimeatConfig; storage: Storage; ext: ExtensionRecord; action: ExtAction; callerGaii: string; res: Response;
}): Promise<PaywallOutcome | null> {
  const { config, storage, ext, action, callerGaii, res } = args;
  const ent = await readEntitlementForCall(storage, callerGaii, ext.name, action.id);
  if (!ent) return null;                       // no contract for this call → standard paywall applies

  // Paused / revoked / exhausted → the contract no longer authorises this call (unit-agnostic).
  if (ent.state !== 'active') {
    res.status(402).json({ ...error(config.nodeId, 'ENTITLEMENT_INACTIVE',
      `Your EXCHANGE entitlement for ${ext.name}/${action.id} is ${ent.state} (contract ${ent.contractRef}).`),
      ...paymentChallenge(config) });
    return { ok: false };
  }
  // Budget cap reached (a prior call exhausted it, or the cap was renegotiated below spend) → deny.
  if (!budgetAllows(ent)) {
    const cap = ent.unit === 'money' ? `${formatMoneyMajor(ent.budget.capUnits ?? 0)} ${ent.currency ?? ''}`.trim() : `${ent.budget.capUnits} morsel`;
    res.status(402).json({ ...error(config.nodeId, 'BUDGET_EXHAUSTED',
      `Your EXCHANGE entitlement for ${ext.name}/${action.id} has spent its ${cap} budget (contract ${ent.contractRef}).`),
      ...paymentChallenge(config) });
    return { ok: false };
  }

  const settleArgs: SettleArgs = { config, storage, ext, action, callerGaii, res, ent };
  return ent.unit === 'money' ? settleMoney(settleArgs) : settleMorsels(settleArgs);
}

/** Morsel rail: atomic debit caller / credit provider cut / route rake, then commit the spend. */
async function settleMorsels({ config, storage, ext, action, callerGaii, res, ent }: SettleArgs): Promise<PaywallOutcome> {
  const price = Math.max(0, ent.pricePerCall);
  const rakePct = ent.rakePercent ?? commerceFeePercent(config);
  const fee = percentFee(price, rakePct);          // ceils — a positive price always carries its rake
  const providerCut = price - fee;
  const track = `exchange:${ext.name}:${action.id}:${ent.contractRef}`;
  const ts = new Date().toISOString();

  if (price > 0) {
    const debited = await storage.debitBalance(callerGaii, price);
    if (!debited) {
      res.status(402).json({ ...error(config.nodeId, 'INSUFFICIENT_MORSELS',
        `This EXCHANGE call costs ${price} morsels and your balance does not cover it`), ...paymentChallenge(config) });
      return { ok: false };
    }
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
    await settleMarketplaceFee(storage, config, { fee, payerGhii: callerGaii, trackingCode: track, source: 'exchange' });
  }

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

/** Money rail: accrue a REAL currency obligation (buyer → provider, minus rake) via a money handler, then commit. */
async function settleMoney({ config, storage, ext, action, callerGaii, res, ent }: SettleArgs): Promise<PaywallOutcome> {
  const price = Math.max(0, ent.pricePerCall);   // micro-units
  const currency = ent.currency ?? 'EUR';
  const rakePct = ent.rakePercent ?? commerceFeePercent(config);
  const reference = `exchange:${ext.name}:${action.id}:${ent.contractRef}`;

  const settled = await settleEntitlementMoney(storage, config, {
    consumerGhii: callerGaii, providerGhii: ent.providerGhii, priceMicros: price, currency, feePct: rakePct, reference,
  });
  if (!settled.ok) {
    res.status(402).json({ ...error(config.nodeId, 'MONEY_SETTLEMENT_UNAVAILABLE',
      `This EXCHANGE call is priced ${formatMoneyMajor(price)} ${currency} but the money rail could not settle (${settled.reason}).`),
      ...paymentChallenge(config) });
    return { ok: false };
  }

  await commitSpend(storage, ent);
  return {
    ok: true,
    refund: async () => {
      await refundEntitlementMoney(storage, config, { consumerGhii: callerGaii, providerGhii: ent.providerGhii, priceMicros: price, currency, trackingCode: settled.trackingCode });
      await refundSpend(storage, callerGaii, ext.name, action.id);
      logger.warn(`[entitlement-gate] refunded ${formatMoneyMajor(price)} ${currency} (script threw after payment)`, { ext: ext.name, action: action.id });
    },
  };
}
