/**
 * @file src/commerce/checkout-shares.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The beneficiary booking of one settled checkout line, as a step settlePurchase makes
 *   with the session's completion write (commerce/settle-purchase.ts). Moved out of
 *   commerce/session-service.ts (bookCheckoutBeneficiaries) to keep that file under 800 lines.
 * @structure checkoutBeneficiaryStep
 * @usage
 *   const step = checkoutBeneficiaryStep({ sellable, session, net, trackingCode, designations });
 *   if (step) bookings.push(step);
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial: bookCheckoutBeneficiaries became a booking step of settlePurchase,
 *     with the same coordinate, tracking code, reference and log line (codebase analysis 2026-11-03, item B2).
 */
import type { CheckoutSessionRecord, Sellable } from './types.js';
import type { DynamicDesignation } from './beneficiary-split.js';
import type { BookingStep } from './settle-purchase.js';
import { meteredCoordinateOf } from './metered-coordinate.js';
import { isMoneyCurrency } from './money.js';

/**
 * Book the seller's beneficiary shares for one settled checkout line.
 *
 * THE SAME SPLIT AS A CONTRACTED CALL. A buyer can reach a priced capability two ways: by holding an
 * EXCHANGE contract, or by paying for it once through a checkout. Both are sales, both hand the
 * seller their cut, and a split declared on the coordinate has to apply to both — otherwise a
 * provider who promised a company a share of every lookup quietly stops paying it the moment
 * somebody buys the same lookup through the other route.
 *
 * `net` is what the seller actually received, after the platform fee, so the share is a percentage
 * of their real revenue rather than of the buyer's gross. Money only: morsels are the pacing meter
 * and are never shared.
 *
 * Never fails the purchase: the money has already moved and the buyer already has their answer. A
 * bookkeeping failure is logged, not turned into a failed purchase (a tolerant step of
 * commerce/settle-purchase.ts, booked with the session's completion write).
 */
export function checkoutBeneficiaryStep(
  args: {
    sellable: Sellable; session: CheckoutSessionRecord; net: number;
    trackingCode: string; designations: DynamicDesignation[];
  },
): BookingStep | null {
  if (args.net <= 0) return null;
  // MONEY ONLY. Morsels pace usage; they are not revenue and a fraction of them is not a share, so
  // a morsel-priced checkout line books nothing here, exactly as a morsel-priced contract does not.
  if (!isMoneyCurrency(args.session.currency)) return null;
  const coord = meteredCoordinateOf(args.sellable);
  if (!coord || args.sellable.sharesAtUse) return null;   // split when the paid call names its payees
  return {
    books: [{
      kind: 'shares', sellerGhii: args.sellable.sellerGhii, ext: coord.ext, action: coord.action, net: args.net,
      currency: args.session.currency, designations: args.designations,
      trackingCode: `chk_${args.trackingCode}_${coord.action}`,
      buyerRef: args.session.buyerGhii,
      reference: `checkout:${args.session.id}:${coord.ext}:${coord.action}`,
    }],
    tolerant: {
      message: '[commerce] checkout beneficiary accrual failed; the seller keeps the whole cut for this line',
      context: { session: args.session.id, seller: args.sellable.sellerGhii },
    },
  };
}
