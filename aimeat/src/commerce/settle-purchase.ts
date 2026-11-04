/**
 * @file src/commerce/settle-purchase.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one place a sale is booked: the platform fee record and the seller's beneficiary
 *   shares are written here, in one `Storage.transaction()` with the purchase's last write.
 *
 *   EVERY MONEY PATH ENDS THE SAME WAY. A purchase moves through the same states whichever door sold
 *   it (a checkout session, a party purchase, a UCP order, an A2A payment, a renewal, a metered call):
 *
 *     opened -> paid -> delivered -> booked
 *                  \-> refunded            (the delivery failed and the money went back)
 *
 *   The payment (PSP collect, refund, payout) is an outside call and happens BETWEEN states, never
 *   inside the transaction. settlePurchase is the step from `paid` (or `delivered`) to `booked`: the
 *   caller's `deliver` write moves its own record to delivered, and the bookings follow it in the same
 *   transaction. So a delivery write that fails leaves no fee and no share on anybody's books, and a
 *   booking is never made for a purchase whose record does not say it was delivered (round 13:
 *   19bfaaadf part 3, 7f5cf113d, 49f509cf5).
 *
 *   THE STORED RECORDS KEEP THEIR OWN WORDS. A checkout session says `completed`, a party purchase
 *   `completed`, a subscription its `last_order`; buyers and sellers read those, so they are not
 *   renamed. Each caller's `deliver` is the compare-and-set on its own record that it already had.
 *
 *   TOLERANT AND STRICT BOOKINGS. Most bookings never fail the sale: the money moved and the buyer has
 *   what they paid for, so a booking failure is logged and the seller keeps the whole cut. Such a step
 *   carries `tolerant` (its log line); each booking in it runs in a savepoint, so a failed one leaves
 *   nothing and the steps after it still commit on PostgreSQL. A step without `tolerant` is strict:
 *   its failure rolls back the delivery too and is thrown, as the checkout's fee leg always was.
 *
 *   PRIVATE WRITERS. bookBeneficiaryShares and recordMoneyPlatformFee are called only from this file
 *   (`pnpm check:single-entry`, rule sale-booking).
 *
 *   THE CONTRACT OF Storage.transaction() APPLIES: `deliver` does storage calls only (no HTTP, no
 *   notification, no event), because SQLite holds every other writer while the transaction is open.
 * @structure PurchaseState · PURCHASE_TRANSITIONS · SaleBooking · BookingStep · StepOutcome · settlePurchase
 * @usage
 *   await settlePurchase(storage, config, {
 *     from: 'paid',
 *     deliver: () => changePurchase(storage, nodeId, id, p => ({ ...p, status: 'completed' })),
 *     steps: [{ books: [{ kind: 'fee', ... }, { kind: 'shares', ... }], tolerant: { message, context } }],
 *   });
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial: one settle step for every sale booking, inside the purchase's
 *     transaction (codebase analysis 2026-11-03, item B2).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { readSplit, computeSplit, type DynamicDesignation, type SplitResult } from './beneficiary-split.js';
import { bookBeneficiaryShares } from './beneficiary-book.js';
import { recordMoneyPlatformFee } from './platform-fee.js';
import { logger } from '../utils/logger.js';

/** Where a purchase is, whichever door sold it. */
export type PurchaseState = 'opened' | 'paid' | 'delivered' | 'booked' | 'refunded';

/** The moves a purchase may make. `booked` and `refunded` are final. */
export const PURCHASE_TRANSITIONS: Readonly<Record<PurchaseState, readonly PurchaseState[]>> = {
  opened: ['paid'],
  paid: ['delivered', 'refunded'],
  delivered: ['booked'],
  booked: [],
  refunded: [],
};

/** The operator's platform fee on a money sale (commerce.platform-fee.{trackingCode}). Skipped at 0. */
export interface FeeBooking {
  kind: 'fee';
  fee: number;
  currency: string;
  sellerGhii: string;
  /** A GHII on a local sale; a foreign identity or a label on a sale without an account here. */
  buyerRef: string;
  trackingCode: string;
  handler: string;
}

/**
 * The seller's beneficiary shares of one sale: the split the seller declared on (ext, action), applied
 * to their net. Skipped when the net is 0. Its outcome is the computed split.
 */
export interface SharesBooking {
  kind: 'shares';
  sellerGhii: string;
  ext: string;
  action: string;
  /** The seller's net, after the platform fee: the share is a part of their real revenue. */
  net: number;
  currency: string;
  /** The book's tracking code (commerce.benefit.{trackingCode}), as the path names it. */
  trackingCode: string;
  designations?: DynamicDesignation[];
  buyerRef?: string;
  reference?: string;
}

export type SaleBooking = FeeBooking | SharesBooking;

/** Bookings made together, in order. */
export interface BookingStep {
  books: SaleBooking[];
  /**
   * Present: a failure is logged with this message and context (plus the error), the failed booking
   * leaves nothing, the bookings after it in this step are not made, and the purchase stays settled.
   * Absent: a failure rolls the whole settlement back, the delivery write included, and is thrown.
   */
  tolerant?: { message: string; context: Record<string, unknown> };
}

/** What one step did. `splits` has one entry per booking made: the split for shares, null for a fee. */
export type StepOutcome = { ok: true; splits: Array<SplitResult | null> } | { ok: false };

function advance(state: PurchaseState, to: PurchaseState): PurchaseState {
  if (!PURCHASE_TRANSITIONS[state].includes(to)) throw new Error(`A purchase cannot move from ${state} to ${to}`);
  return to;
}

async function book(storage: Storage, config: AimeatConfig | null, b: SaleBooking): Promise<SplitResult | null> {
  if (b.kind === 'fee') {
    if (b.fee > 0) {
      // The fee record's owner is the operator's account, which the node configuration names.
      if (!config) throw new Error('A platform fee is booked with the node configuration');
      await recordMoneyPlatformFee(storage, config, {
        fee: b.fee, currency: b.currency, sellerGhii: b.sellerGhii, buyerGhii: b.buyerRef, trackingCode: b.trackingCode, handler: b.handler,
      });
    }
    return null;
  }
  if (b.net <= 0) return null;
  const split = await readSplit(storage, b.sellerGhii, b.ext, b.action);
  const result = computeSplit(b.net, split, b.designations ?? []);
  if (result.lines.length) {
    await bookBeneficiaryShares(storage, {
      lines: result.lines, trackingCode: b.trackingCode, fromGhii: b.sellerGhii, currency: b.currency,
      buyerGhii: b.buyerRef, reference: b.reference,
    });
  }
  return result;
}

async function runStep(storage: Storage, config: AimeatConfig | null, step: BookingStep): Promise<StepOutcome> {
  const splits: Array<SplitResult | null> = [];
  if (!step.tolerant) {
    for (const b of step.books) splits.push(await book(storage, config, b));
    return { ok: true, splits };
  }
  try {
    // One savepoint per booking: a failed one leaves nothing, and on PostgreSQL the transaction stays
    // usable for the delivery write and the steps after it (Storage.savepoint).
    for (const b of step.books) splits.push(await storage.savepoint(() => book(storage, config, b)));
    return { ok: true, splits };
  } catch (err) {
    logger.error(step.tolerant.message, { ...step.tolerant.context, error: String(err) });
    return { ok: false };
  }
}

/**
 * Settle one purchase: from `paid`, run `deliver` (the last write of the purchase's own record), then
 * book every step; from `delivered` (the delivery was written earlier, as a spent token or a committed
 * meter), book only. All of it in one transaction; a nested call joins the open one. `config` may be
 * null only when no step books a fee.
 */
export async function settlePurchase<T = undefined>(
  storage: Storage,
  config: AimeatConfig | null,
  args: { from: 'paid'; deliver: () => Promise<T>; steps: BookingStep[] } | { from: 'delivered'; steps: BookingStep[] },
): Promise<{ state: PurchaseState; delivered: T | undefined; steps: StepOutcome[] }> {
  return storage.transaction(async () => {
    let state: PurchaseState = args.from;
    let delivered: T | undefined;
    if (args.from === 'paid') {
      delivered = await args.deliver();
      state = advance(state, 'delivered');
    }
    const steps: StepOutcome[] = [];
    for (const step of args.steps) steps.push(await runStep(storage, config, step));
    state = advance(state, 'booked');
    return { state, delivered, steps };
  });
}
