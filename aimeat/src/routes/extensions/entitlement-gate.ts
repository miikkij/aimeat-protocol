/**
 * @file src/routes/extensions/entitlement-gate.ts
 * @description G2 — the metered-call GATEWAY for EXCHANGE (TARGET-045). When a cross-owner caller holds a
 *   durable {@link MeteredEntitlement} for the exact (ext, action) it is invoking, this takes over the
 *   commercial settlement instead of the per-call one-time token: it authorises against the entitlement's
 *   budget cap, moves the value, and applies the platform RAKE — all at the node (the trust boundary a
 *   client-side app could never enforce). It is purely ADDITIVE: with no entitlement it returns `null` and
 *   the existing paywall channels (one-time money token / plain morsel charge) run unchanged.
 *
 *   The PRICING MODEL ({@link computeCharge}) decides what THIS call costs (per_call → base price; bundle →
 *   0 within quota, block price on refill; subscription → 0 within a paid period + rate-limited, period fee
 *   on renewal). The SETTLEMENT RAIL (the entitlement `unit`) decides how that amount moves:
 *     - `morsels` — atomic in-repo debit/credit + rake via {@link settleMarketplaceFee}.
 *     - `money`   — real EUR/USD accrual via {@link settleEntitlementMoney} (off the morsel ledger).
 * @structure settleMeteredCoordinate · settleViaEntitlement (ext wrapper) · settleMorsels · settleMoney
 * @version-history
 *   v1.3.0 — 2026-07-21 — Generalised to a metered COORDINATE (ext, action strings) so it settles app-tool
 *     calls too (EXCHANGE cross-app selling, Gap 1); settleViaEntitlement is now the ext wrapper.
 *   v1.2.0 — 2026-07-20 — Pricing models (Phase B): computeCharge drives per-call amount (bundle/subscription + rate limit).
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
  readEntitlementForCall, budgetAllows, commitSpend, refundSpend, computeCharge,
  type MeteredEntitlement, type PricingSpec,
} from '../../services/metered-entitlements.js';
import { settleEntitlementMoney, refundEntitlementMoney } from '../../services/entitlement-money.js';
import type { PaywallOutcome } from './paywall.js';
import { logger } from '../../utils/logger.js';

type ExtAction = ExtensionRecord['actions'][number];

interface SettleArgs {
  config: AimeatConfig;
  storage: Storage;
  coordExt: string;       // metered coordinate — ext name, or `apptool:{owner}/{appId}` for an app-tool
  coordAction: string;    // metered coordinate — action id, or the tool name for an app-tool
  label: string;          // human label for messages, e.g. `prh-data/search` or `prh.html/getCompanyBrief`
  callerGaii: string;
  res: Response;
  ent: MeteredEntitlement;
  charge: number;         // amount to settle for THIS call, in the entitlement's unit (0 within quota/period)
  newPricing: PricingSpec; // advanced pricing state to persist on commit
}

/**
 * Settle a metered call at a COORDINATE (ext/action strings) through a durable entitlement, or return `null`
 * to fall through to the standard paywall. Shared by the ext raw-invoke path and the app-tool WebMCP invoke
 * path (EXCHANGE cross-app selling). On an `ok:false` outcome a 402/429/500 has already been sent.
 */
export async function settleMeteredCoordinate(args: {
  config: AimeatConfig; storage: Storage; coordExt: string; coordAction: string; label: string; callerGaii: string; res: Response;
}): Promise<PaywallOutcome | null> {
  const { config, storage, coordExt, coordAction, label, callerGaii, res } = args;
  const ent = await readEntitlementForCall(storage, callerGaii, coordExt, coordAction);
  if (!ent) return null;                       // no contract for this call → standard paywall applies

  if (ent.state !== 'active') {
    res.status(402).json({ ...error(config.nodeId, 'ENTITLEMENT_INACTIVE',
      `Your EXCHANGE entitlement for ${label} is ${ent.state} (contract ${ent.contractRef}).`),
      ...paymentChallenge(config) });
    return { ok: false };
  }

  // Pricing model decides the per-call charge (bundle quota / subscription period + rate limit).
  const decision = computeCharge(ent, Date.now());
  if (!decision.allowed) {
    res.status(429).json(error(config.nodeId, 'RATE_LIMITED',
      `Your EXCHANGE subscription for ${label} is over its rate limit — retry shortly (contract ${ent.contractRef}).`));
    return { ok: false };
  }
  // Budget cap is checked against THIS call's charge (a refill/renewal may cost a block/period fee).
  if (!budgetAllows(ent, decision.chargeUnits)) {
    const cap = ent.unit === 'money' ? `${formatMoneyMajor(ent.budget.capUnits ?? 0)} ${ent.currency ?? ''}`.trim() : `${ent.budget.capUnits} morsel`;
    res.status(402).json({ ...error(config.nodeId, 'BUDGET_EXHAUSTED',
      `Your EXCHANGE entitlement for ${label} has spent its ${cap} budget (contract ${ent.contractRef}).`),
      ...paymentChallenge(config) });
    return { ok: false };
  }

  const settleArgs: SettleArgs = { config, storage, coordExt, coordAction, label, callerGaii, res, ent, charge: decision.chargeUnits, newPricing: decision.pricing };
  return ent.unit === 'money' ? settleMoney(settleArgs) : settleMorsels(settleArgs);
}

/**
 * Settle a raw extension invoke through a durable entitlement (the ext-action path wrapper), or return
 * `null` to fall through to the standard paywall.
 */
export async function settleViaEntitlement(args: {
  config: AimeatConfig; storage: Storage; ext: ExtensionRecord; action: ExtAction; callerGaii: string; res: Response;
}): Promise<PaywallOutcome | null> {
  return settleMeteredCoordinate({
    config: args.config, storage: args.storage,
    coordExt: args.ext.name, coordAction: args.action.id, label: `${args.ext.name}/${args.action.id}`,
    callerGaii: args.callerGaii, res: args.res,
  });
}

/** Morsel rail: atomic debit caller / credit provider cut / route rake for THIS call's charge, then commit. */
async function settleMorsels({ config, storage, coordExt, coordAction, label, callerGaii, res, ent, charge, newPricing }: SettleArgs): Promise<PaywallOutcome> {
  const price = Math.max(0, charge);
  const rakePct = ent.rakePercent ?? commerceFeePercent(config);
  const fee = percentFee(price, rakePct);          // ceils — a positive charge always carries its rake
  const providerCut = price - fee;
  const track = `exchange:${coordExt}:${coordAction}:${ent.contractRef}`;
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
        logger.error('[entitlement-gate] provider credit failed; refunded caller', { label, provider: ent.providerGhii });
        res.status(500).json(error(config.nodeId, 'SETTLEMENT_FAILED', 'Payment could not be settled to the provider; you were not charged'));
        return { ok: false };
      }
      await storage.addTransaction({ id: `xchg-earn-${randomUUID()}`, gaii: ent.providerGhii, type: 'extension_earn', amount: providerCut, counterpartyGaii: callerGaii, trackingCode: track, timestamp: ts });
    }
    await storage.addTransaction({ id: `xchg-pay-${randomUUID()}`, gaii: callerGaii, type: 'extension_pay', amount: -price, counterpartyGaii: ent.providerGhii, trackingCode: track, timestamp: ts });
    await settleMarketplaceFee(storage, config, { fee, payerGhii: callerGaii, trackingCode: track, source: 'exchange' });
  }

  await commitSpend(storage, ent, price, newPricing);
  return {
    ok: true,
    refund: async () => {
      if (price > 0) {
        if (providerCut > 0) await storage.debitBalance(ent.providerGhii, providerCut);
        await storage.creditBalance(callerGaii, price);
      }
      await refundSpend(storage, callerGaii, coordExt, coordAction, price);
      logger.warn(`[entitlement-gate] refunded ${price} morsels (script threw after payment)`, { label });
    },
  };
}

/** Money rail: accrue a REAL currency obligation for THIS call's charge (buyer → provider, minus rake), then commit. */
async function settleMoney({ config, storage, coordExt, coordAction, label, callerGaii, res, ent, charge, newPricing }: SettleArgs): Promise<PaywallOutcome> {
  const price = Math.max(0, charge);   // micro-units
  const currency = ent.currency ?? 'EUR';
  const rakePct = ent.rakePercent ?? commerceFeePercent(config);
  const reference = `exchange:${coordExt}:${coordAction}:${ent.contractRef}`;
  let trackingCode = '';

  if (price > 0) {
    const settled = await settleEntitlementMoney(storage, config, {
      consumerGhii: callerGaii, providerGhii: ent.providerGhii, priceMicros: price, currency, feePct: rakePct, reference,
    });
    if (!settled.ok) {
      res.status(402).json({ ...error(config.nodeId, 'MONEY_SETTLEMENT_UNAVAILABLE',
        `This EXCHANGE call is priced ${formatMoneyMajor(price)} ${currency} but the money rail could not settle (${settled.reason}).`),
        ...paymentChallenge(config) });
      return { ok: false };
    }
    trackingCode = settled.trackingCode;
  }

  await commitSpend(storage, ent, price, newPricing);
  return {
    ok: true,
    refund: async () => {
      if (price > 0) await refundEntitlementMoney(storage, config, { consumerGhii: callerGaii, providerGhii: ent.providerGhii, priceMicros: price, currency, trackingCode });
      await refundSpend(storage, callerGaii, coordExt, coordAction, price);
      logger.warn(`[entitlement-gate] refunded ${formatMoneyMajor(price)} ${currency} (script threw after payment)`, { label });
    },
  };
}
