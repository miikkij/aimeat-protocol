/**
 * @file src/services/metered-settlement.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 * @structure settleMeteredCharge · resolvePacingToll · chargePacing · SettlementResult · BeneficiaryAccrual
 * @version-history
 *   v1.2.1 — 2026-10-11 — A pacing charge's tracking code says "granted" only when somebody other than
 *     the caller's owner pays; an ordinary checkout passed its own buyer as the payer and read "granted".
 *   v1.2.0 — 2026-10-11 — A morsel is pacing, never a price (decision-morseli-on-tahdistus-ei-hinta-
 *     tarjouksen-kaksi-arvoa). chargePacing replaces the all-burn toll: the payer's owner is debited,
 *     the burn rate's share burns, a flow's existing operator share is kept, and the rest is credited
 *     to the provider's owner. The morsel rail of a contract is charged through it. resolvePacingToll
 *     moved here from routes/extensions/pacing.ts and reads a legacy morsel price as pacing.
 *   v1.1.0 — 2026-07-30 — Beneficiary splitting: a second rake, taken from the provider's cut and
 *     routed to N GHIIs, accrued per call through the returned `accrue()` and unwound by `refund()`.
 *   v1.0.0 — 2026-07-28 — Extracted from routes/extensions/entitlement-gate.ts; returns a result
 *     instead of sending 402s, so every door can reach it directly.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { percentFee } from '../commerce/money.js';
import { commerceFeePercent, resolveOperatorFeeGhii } from './marketplace-fee.js';
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
 * The pacing amount of one use: the value the source declares, else the node's default, clamped to
 * the node's per-use ceiling (AIMEAT_EXT_MAX_DEBIT). Zero means unpaced.
 *
 * `legacyMorsels` is a morsel PRICE a source declared before ruling D4 (2026-10-11): `price.morsels`
 * on an offer or an app tool, `payMorsels` on an extension action, `baseMorsels` on an action,
 * `priceMorsels` on an app. A use cost the declared toll plus that price, so the pacing amount is
 * their sum: a converted source keeps the same per-use brake it had.
 */
export function resolvePacingToll(config: AimeatConfig, declared: number | undefined | null, legacyMorsels?: number | null): number {
  const toll = typeof declared === 'number' && Number.isInteger(declared) && declared >= 0 ? declared : null;
  const legacy = typeof legacyMorsels === 'number' && Number.isInteger(legacyMorsels) && legacyMorsels > 0 ? legacyMorsels : 0;
  const value = toll === null && legacy === 0 ? config.pacingTollDefault : (toll ?? 0) + legacy;
  if (!Number.isInteger(value) || value <= 0) return 0;
  return Math.min(value, config.extensionMaxDebitPerCall);
}

/** What one pacing charge moved. All amounts in whole morsels. */
export interface PacingCharge {
  morsels: number;
  /** Removed from supply: the burn rate's share, plus the operator's share when the fee mode burns. */
  burned: number;
  /** Credited to the operator (fee mode `operator`). */
  fee: number;
  providerEarned: number;
  trackingCode: string;
  /** Give it all back (the use failed after the charge). Safe to call once. */
  reverse: () => Promise<void>;
}

/** A pacing charge as a receipt shows it: the same fields, without the reverse function. */
export function pacingReceipt(c: PacingCharge): { morsels: number; burned: number; fee: number; providerEarned: number; trackingCode: string } {
  return { morsels: c.morsels, burned: c.burned, fee: c.fee, providerEarned: c.providerEarned, trackingCode: c.trackingCode };
}

const NOTHING: PacingCharge = { morsels: 0, burned: 0, fee: 0, providerEarned: 0, trackingCode: '', reverse: async () => {} };

/**
 * Charge the pacing amount for one use (ruling decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa).
 *
 * The payer's owner is debited the amount. The burn rate's share burns (config.burnRate, the node's
 * existing burn setting; rounded up, so a positive amount always burns something while the rate is
 * above zero). Where the flow had an operator share before the ruling (`feePercent`), that share
 * still goes where the marketplace fee policy sends it: to the operator, or burned. The rest is
 * credited to the provider's owner as the sign of a useful contribution. With no provider, the whole
 * amount burns. One storage transaction: the debit, the credits and every ledger row land together.
 *
 * Returns null when the payer cannot cover it, having moved nothing. `payer` overrides whose balance
 * it comes from (a provider carrying a granted member). The caller's own use of their own source is
 * the caller's business and is answered before this is called.
 */
export async function chargePacing(args: {
  config: AimeatConfig; storage: Storage; caller: string; payer?: string | null;
  providerGhii: string | null; amount: number; label: string; feePercent?: number;
}): Promise<PacingCharge | null> {
  const { config, storage, caller, providerGhii, label } = args;
  const amount = Math.max(0, Math.trunc(args.amount));
  if (amount <= 0) return NOTHING;
  const from = args.payer ?? caller;
  const payerGhii = ownerGhiiOf(from);
  const rate = Math.min(1, Math.max(0, config.burnRate ?? 0));
  let burned = providerGhii ? Math.min(amount, percentFee(amount, Math.round(rate * 10_000) / 100)) : amount;
  let fee = providerGhii && (args.feePercent ?? 0) > 0 ? Math.min(amount - burned, percentFee(amount, args.feePercent!)) : 0;
  const operatorGhii = fee > 0 && (config.marketplaceFeeMode ?? 'operator') === 'operator'
    ? await resolveOperatorFeeGhii(storage, config) : null;
  if (fee > 0 && !operatorGhii) { burned += fee; fee = 0; }
  const providerEarned = amount - burned - fee;
  // "granted" only when somebody other than the caller's owner pays (a provider carrying a member).
  const granted = !!args.payer && payerGhii !== ownerGhiiOf(caller);
  const trackingCode = `${granted ? 'pacing:granted' : 'pacing'}:${label}:${randomUUID().slice(0, 8)}`;
  const ts = new Date().toISOString();

  let ok = false;
  await storage.transaction(async () => {
    if (!await storage.debitBalance(from, amount)) return;
    if (providerEarned > 0) await storage.creditBalance(providerGhii!, providerEarned);
    if (fee > 0) await storage.creditBalance(operatorGhii!, fee);
    // The payer's rows add up to what left their balance: what went on, and what burned.
    if (amount - burned > 0) {
      await storage.addTransaction({ id: `pacing-${randomUUID()}`, gaii: payerGhii, type: 'pacing_charge', amount: -(amount - burned), counterpartyGaii: providerGhii ?? undefined, trackingCode, initiatorGaii: caller, timestamp: ts });
    }
    if (burned > 0) {
      await storage.addTransaction({ id: `pacing-burn-${randomUUID()}`, gaii: payerGhii, type: 'pacing_burn', amount: -burned, trackingCode, initiatorGaii: caller, timestamp: ts });
    }
    if (providerEarned > 0) {
      await storage.addTransaction({ id: `pacing-earn-${randomUUID()}`, gaii: providerGhii!, type: 'pacing_earn', amount: providerEarned, counterpartyGaii: payerGhii, trackingCode, initiatorGaii: caller, timestamp: ts });
    }
    if (fee > 0) {
      await storage.addTransaction({ id: `pacing-fee-${randomUUID()}`, gaii: operatorGhii!, type: 'marketplace_fee', amount: fee, counterpartyGaii: payerGhii, trackingCode, timestamp: ts });
    }
    ok = true;
  });
  if (!ok) return null;

  let reversed = false;
  return {
    morsels: amount, burned, fee, providerEarned, trackingCode,
    reverse: async () => {
      if (reversed) return;
      reversed = true;
      await storage.transaction(async () => {
        if (providerEarned > 0) await storage.debitBalance(providerGhii!, providerEarned);
        if (fee > 0) await storage.debitBalance(operatorGhii!, fee);
        await storage.creditBalance(from, amount);
        await storage.addTransaction({ id: `pacing-refund-${randomUUID()}`, gaii: payerGhii, type: 'pacing_refund', amount, counterpartyGaii: providerGhii ?? undefined, trackingCode, initiatorGaii: caller, timestamp: new Date().toISOString() });
      });
      logger.warn(`[metered-settlement] reversed a ${amount}-morsel pacing charge (the use failed after the charge)`, { label });
    },
  };
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

/**
 * Morsel rail: a contract denominated in morsels is a contract on PACING, not a price (ruling D4,
 * 2026-10-11). The per-call amount is charged as pacing: the burn rate's share burns, the contract's
 * rake keeps going where the marketplace fee policy sends it, and the rest is credited to the
 * provider. Then the meter advances.
 */
async function settleMorsels(args: Args): Promise<SettlementResult> {
  const { config, storage, ent, caller, product, charge, newPricing } = args;
  const price = Math.max(0, charge);
  const rakePct = ent.rakePercent ?? commerceFeePercent(config);
  const paced = await chargePacing({
    config, storage, caller, providerGhii: ent.providerGhii, amount: price,
    label: `exchange:${product.ext}:${product.action}:${ent.contractRef}`, feePercent: rakePct,
  });
  if (!paced) return { kind: 'insufficient', needed: price };
  try {
    await commitSpend(storage, ent, price, newPricing, caller);
  } catch (err) {
    await paced.reverse();
    throw err;
  }
  return {
    kind: 'settled', charged: price,
    // MORSELS ARE NEVER SHARED. They pace how often a capability may be called; they are not money
    // and not a proportion of anything a beneficiary could be owed. A provider who declares a split
    // gets it on their MONEY sales.
    accrue: async () => null,
    refund: async () => {
      await paced.reverse();
      await refundSpend(storage, caller, product.ext, product.action, price, caller);
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
