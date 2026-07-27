/**
 * @file src/services/metered-settlement.ts
 * @description Moving the value for one authorised metered call — the half of the chokepoint that
 *   touches wallets. `metered-access.ts` decides; this settles what it decided.
 *
 *   Two rails, one shape:
 *     - `morsels` — atomic in-repo debit caller / credit provider / route the platform rake.
 *     - `money`   — a real EUR/USD obligation through the accrual rail, off the morsel ledger.
 *   Both return a value. Neither writes an HTTP response, which is what lets the MCP and checkout
 *   doors share them instead of faking an Express `Response` to get at them.
 *
 *   INVARIANTS. A charge is filed under the human whose balance moved (`debitBalance` resolves any
 *   agent to its owner, so filing it under the agent left the payer's history unable to explain a
 *   debit), and names the caller as `initiatorGaii`. A positive charge always carries its rake. Money
 *   never leaves without delivery: every success hands back a `refund` the door calls if the work throws.
 * @structure settleMeteredCharge · burnPacingTollFor · SettlementResult
 * @version-history
 *   v1.0.0 — 2026-07-28 — Extracted from routes/extensions/entitlement-gate.ts; returns a result
 *     instead of sending 402s, so every door can reach it directly.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { percentFee } from '../commerce/money.js';
import { commerceFeePercent, settleMarketplaceFee } from './marketplace-fee.js';
import { settleEntitlementMoney, refundEntitlementMoney } from './entitlement-money.js';
import { commitSpend, refundSpend, type MeteredEntitlement, type PricingSpec } from './metered-entitlements.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** What settling produced. `charged` may legitimately be 0 — a grant, or a bundle within its quota. */
export type SettlementResult =
  | { kind: 'settled'; charged: number; refund: () => Promise<void> }
  | { kind: 'insufficient'; needed: number }
  | { kind: 'failed'; reason: string };

/**
 * Burn the pacing toll. Returns false when the payer cannot cover it — the caller has moved no money
 * yet, so a paced-out call costs an attempt rather than a reversal.
 *
 * `payer` overrides whose balance it comes from: set to the provider under a grant, because the morsel
 * is half of a declared price and a member told their access is carried should not be paying half of it.
 */
export async function burnPacingTollFor(args: {
  config: AimeatConfig; storage: Storage; caller: string; label: string; toll: number; payer: string | null;
}): Promise<boolean> {
  const { storage, caller, label, toll, payer } = args;
  if (toll <= 0) return true;
  const from = payer ?? caller;
  const carried = !!payer;
  if (!await storage.debitBalance(from, toll)) return false;
  await storage.addTransaction({
    id: `pacing-${randomUUID()}`, gaii: ownerGhiiOf(from), type: 'extension_toll', amount: -toll,
    trackingCode: carried ? `pacing:granted:${label}` : `pacing:${label}`,
    initiatorGaii: caller, timestamp: new Date().toISOString(),
  });
  return true;
}

/** Settle one call on whichever rail the right is denominated in, then advance its meter. */
export async function settleMeteredCharge(args: {
  config: AimeatConfig; storage: Storage; ent: MeteredEntitlement; caller: string;
  product: { ext: string; action: string; label: string };
  charge: number; newPricing: PricingSpec;
}): Promise<SettlementResult> {
  return args.ent.unit === 'money' ? settleMoney(args) : settleMorsels(args);
}

type Args = Parameters<typeof settleMeteredCharge>[0];

/** Morsel rail: atomic debit caller / credit provider cut / route rake, then commit. */
async function settleMorsels({ config, storage, ent, caller, product, charge, newPricing }: Args): Promise<SettlementResult> {
  const price = Math.max(0, charge);
  const rakePct = ent.rakePercent ?? commerceFeePercent(config);
  const fee = percentFee(price, rakePct);          // ceils — a positive charge always carries its rake
  const providerCut = price - fee;
  const track = `exchange:${product.ext}:${product.action}:${ent.contractRef}`;
  const ts = new Date().toISOString();

  if (price > 0) {
    if (!await storage.debitBalance(caller, price)) return { kind: 'insufficient', needed: price };
    if (providerCut > 0) {
      if (!await storage.creditBalance(ent.providerGhii, providerCut)) {
        await storage.creditBalance(caller, price);
        logger.error('[metered-settlement] provider credit failed; refunded caller', { label: product.label, provider: ent.providerGhii });
        return { kind: 'failed', reason: 'provider_credit_failed' };
      }
      await storage.addTransaction({ id: `xchg-earn-${randomUUID()}`, gaii: ent.providerGhii, type: 'extension_earn', amount: providerCut, counterpartyGaii: caller, trackingCode: track, initiatorGaii: caller, timestamp: ts });
    }
    // Filed under the human whose balance moved; the caller is named beside it.
    await storage.addTransaction({ id: `xchg-pay-${randomUUID()}`, gaii: ownerGhiiOf(caller), type: 'extension_pay', amount: -price, counterpartyGaii: ent.providerGhii, trackingCode: track, initiatorGaii: caller, timestamp: ts });
    await settleMarketplaceFee(storage, config, { fee, payerGhii: ownerGhiiOf(caller), trackingCode: track, source: 'exchange' });
  }

  await commitSpend(storage, ent, price, newPricing, caller);
  return {
    kind: 'settled', charged: price,
    refund: async () => {
      if (price > 0) {
        if (providerCut > 0) await storage.debitBalance(ent.providerGhii, providerCut);
        await storage.creditBalance(caller, price);
      }
      await refundSpend(storage, caller, product.ext, product.action, price, caller);
      logger.warn(`[metered-settlement] refunded ${price} morsels (the call failed after payment)`, { label: product.label });
    },
  };
}

/** Money rail: accrue a REAL currency obligation (buyer → provider, minus rake), then commit. */
async function settleMoney({ config, storage, ent, caller, product, charge, newPricing }: Args): Promise<SettlementResult> {
  const price = Math.max(0, charge);   // micro-units
  const currency = ent.currency ?? 'EUR';
  const rakePct = ent.rakePercent ?? commerceFeePercent(config);
  const reference = `exchange:${product.ext}:${product.action}:${ent.contractRef}`;
  let trackingCode = '';

  if (price > 0) {
    const settled = await settleEntitlementMoney(storage, config, {
      consumerGhii: ownerGhiiOf(caller), providerGhii: ent.providerGhii, priceMicros: price, currency, feePct: rakePct, reference,
    });
    if (!settled.ok) return { kind: 'failed', reason: settled.reason };
    trackingCode = settled.trackingCode;
  }

  await commitSpend(storage, ent, price, newPricing, caller);
  return {
    kind: 'settled', charged: price,
    refund: async () => {
      if (price > 0) await refundEntitlementMoney(storage, config, { consumerGhii: ownerGhiiOf(caller), providerGhii: ent.providerGhii, priceMicros: price, currency, trackingCode });
      await refundSpend(storage, caller, product.ext, product.action, price, caller);
      logger.warn('[metered-settlement] refunded a money charge (the call failed after payment)', { label: product.label, currency });
    },
  };
}
