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
 *
 *   THE THIRD PARTY. A provider may owe part of what they just earned to beneficiaries who are neither
 *   the consumer nor themselves (`commerce/beneficiary-split.ts`). That obligation is booked AFTER the
 *   provider has been paid in full, out of their own cut, so nothing here holds anyone's money and the
 *   consumer is never billed for a relationship they are not part of. It is deferred to `accrue()`
 *   rather than done inline because who deserves a share can depend on what the call turned out to be
 *   about, which is knowable only once the capability has run. `accrue` and `refund` are the same
 *   contract from opposite ends: the door calls one of them, never both.
 * @structure settleMeteredCharge · burnPacingTollFor · SettlementResult · BeneficiaryAccrual
 * @version-history
 *   v1.1.0 — 2026-07-30 — Beneficiary splitting: a second rake, taken from the provider's cut and
 *     routed to N GHIIs, accrued per call through the returned `accrue()` and unwound by `refund()`.
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
import { readSplit, computeSplit, type DynamicDesignation, type SplitResult } from '../commerce/beneficiary-split.js';
import { bookBeneficiaryShares, reverseAccrual } from '../commerce/beneficiary-book.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/**
 * Book this call's beneficiary shares, optionally including destinations the capability named for
 * this call. Returns what was split, or null when the provider declared no split, the call was free,
 * or nobody was designated — all three of which mean the provider simply keeps their whole cut.
 *
 * Safe to call more than once: the book is idempotent per `(trackingCode, beneficiary)`.
 */
export type BeneficiaryAccrual = (designations?: DynamicDesignation[]) => Promise<SplitResult | null>;

/** What settling produced. `charged` may legitimately be 0 — a grant, or a bundle within its quota. */
export type SettlementResult =
  | { kind: 'settled'; charged: number; refund: () => Promise<void>; accrue: BeneficiaryAccrual }
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

/**
 * Build the deferred accrual for one settled call.
 *
 * `providerCut` is what the provider actually received — after the platform rake, never before it.
 * Splitting the gross instead would have the provider paying beneficiaries a percentage of money that
 * went to the operator, which is how a 70 % share quietly becomes more than the provider kept.
 */
function beneficiaryAccrualFor(
  { storage, ent, caller, product }: Args,
  args: { providerCut: number; trackingCode: string; currency: string; reference: string },
): BeneficiaryAccrual {
  return async (designations = []) => {
    if (args.providerCut <= 0) return null;
    try {
      const split = await readSplit(storage, ent.providerGhii, product.ext, product.action);
      const result = computeSplit(args.providerCut, split, designations);
      if (!result.lines.length) return null;
      await bookBeneficiaryShares(storage, {
        lines: result.lines, trackingCode: args.trackingCode, fromGhii: ent.providerGhii,
        currency: args.currency, buyerGhii: ownerGhiiOf(caller), reference: args.reference,
      });
      return result;
    } catch (err) {
      // A book entry, not a payment: the provider already has the money and the consumer already has
      // their answer. Failing the call now would undo a good delivery to fix a bookkeeping problem.
      logger.error('[metered-settlement] beneficiary accrual failed; the provider keeps the whole cut for this call', {
        label: product.label, provider: ent.providerGhii, trackingCode: args.trackingCode, error: String(err),
      });
      return null;
    }
  };
}

/** Morsel rail: atomic debit caller / credit provider cut / route rake, then commit. */
async function settleMorsels(args: Args): Promise<SettlementResult> {
  const { config, storage, ent, caller, product, charge, newPricing } = args;
  const price = Math.max(0, charge);
  const rakePct = ent.rakePercent ?? commerceFeePercent(config);
  const fee = percentFee(price, rakePct);          // ceils — a positive charge always carries its rake
  const providerCut = price - fee;
  const track = `exchange:${product.ext}:${product.action}:${ent.contractRef}`;
  const ts = new Date().toISOString();

  // The whole settlement is ONE transaction: debit, provider credit, both ledger rows, the
  // marketplace fee and the spend commit land together or not at all. Before this a crash between
  // them could leave a caller debited with no provider credit and no ledger row to find it by.
  // The hand-written refund below is kept deliberately: it handles a provider credit that REPORTS
  // failure (a business outcome the transaction cannot see), and with the rollback around it the two
  // agree rather than conflict.
  let earlyExit: SettlementResult | null = null;
  await storage.transaction(async () => {
    if (price > 0) {
      if (!await storage.debitBalance(caller, price)) { earlyExit = { kind: 'insufficient', needed: price }; return; }
      if (providerCut > 0) {
        if (!await storage.creditBalance(ent.providerGhii, providerCut)) {
          await storage.creditBalance(caller, price);
          logger.error('[metered-settlement] provider credit failed; refunded caller', { label: product.label, provider: ent.providerGhii });
          earlyExit = { kind: 'failed', reason: 'provider_credit_failed' };
          return;
        }
        await storage.addTransaction({ id: `xchg-earn-${randomUUID()}`, gaii: ent.providerGhii, type: 'extension_earn', amount: providerCut, counterpartyGaii: caller, trackingCode: track, initiatorGaii: caller, timestamp: ts });
      }
      // Filed under the human whose balance moved; the caller is named beside it.
      await storage.addTransaction({ id: `xchg-pay-${randomUUID()}`, gaii: ownerGhiiOf(caller), type: 'extension_pay', amount: -price, counterpartyGaii: ent.providerGhii, trackingCode: track, initiatorGaii: caller, timestamp: ts });
      await settleMarketplaceFee(storage, config, { fee, payerGhii: ownerGhiiOf(caller), trackingCode: track, source: 'exchange' });
    }

    await commitSpend(storage, ent, price, newPricing, caller);
  });
  if (earlyExit) return earlyExit;
  return {
    kind: 'settled', charged: price,
    // MORSELS ARE NEVER SHARED. They are the node's pacing meter: they bound how often a capability
    // may be called. They are not money, not convertible to it, and not a proportion of anything a
    // beneficiary could be owed — so there is nothing here to divide. A provider who declares a
    // split gets it on their MONEY sales; a morsel-priced call simply paces and settles.
    accrue: async () => null,
    refund: async () => {
      if (price > 0) {
        if (providerCut > 0) await storage.debitBalance(ent.providerGhii, providerCut);
        await storage.creditBalance(caller, price);
      }
      await refundSpend(storage, caller, product.ext, product.action, price, caller);
      // Nothing to reverse: the morsel rail books no beneficiary share in the first place.
      logger.warn(`[metered-settlement] refunded ${price} morsels (the call failed after payment)`, { label: product.label });
    },
  };
}

/** Money rail: accrue a REAL currency obligation (buyer → provider, minus rake), then commit. */
async function settleMoney(args: Args): Promise<SettlementResult> {
  const { config, storage, ent, caller, product, charge, newPricing } = args;
  const price = Math.max(0, charge);   // micro-units
  const currency = ent.currency ?? 'EUR';
  const rakePct = ent.rakePercent ?? commerceFeePercent(config);
  const reference = `exchange:${product.ext}:${product.action}:${ent.contractRef}`;
  let trackingCode = '';
  let providerNet = 0;

  if (price > 0) {
    const settled = await settleEntitlementMoney(storage, config, {
      consumerGhii: ownerGhiiOf(caller), providerGhii: ent.providerGhii, priceMicros: price, currency, feePct: rakePct, reference,
    });
    if (!settled.ok) return { kind: 'failed', reason: settled.reason };
    trackingCode = settled.trackingCode;
    // What the accrual rail actually credited the provider. Taken from the settlement rather than
    // recomputed, so the two can never disagree about the rake.
    providerNet = settled.net;
  }

  await commitSpend(storage, ent, price, newPricing, caller);
  return {
    kind: 'settled', charged: price,
    accrue: beneficiaryAccrualFor(args, {
      providerCut: providerNet, trackingCode, currency, reference,
    }),
    refund: async () => {
      if (price > 0) await refundEntitlementMoney(storage, config, { consumerGhii: ownerGhiiOf(caller), providerGhii: ent.providerGhii, priceMicros: price, currency, trackingCode });
      await refundSpend(storage, caller, product.ext, product.action, price, caller);
      // Undo any beneficiary share booked for this call. Reachable: three of the call paths book
      // the share inside the same try whose catch refunds, so a failure after the booking (rendering
      // the response, for one) lands here with something real to reverse. Only touches entries still
      // `accrued` — a released share is a debt the provider has taken on, and a refund of the
      // underlying call does not reach into that.
      if (trackingCode) await reverseAccrual(storage, trackingCode, ent.providerGhii);
      logger.warn('[metered-settlement] refunded a money charge (the call failed after payment)', { label: product.label, currency });
    },
  };
}
