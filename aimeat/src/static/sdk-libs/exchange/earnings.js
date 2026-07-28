/**
 * @file exchange/earnings.js
 * @description What the market OWES the caller. A money-priced metered call settles through the
 *   accrual rail: no per-call payment-processor charge and no custodial escrow — each call books the
 *   seller's net (price minus the platform rake) as a `pending` payable. This reads that book.
 *
 *   What it deliberately is NOT: a payout, an invoice, or a way to mark something settled. The
 *   figure is made READABLE here; moving money is a later phase, and a browser library that implied
 *   otherwise would be making a promise about money that nothing behind it keeps.
 *
 *   SECURITY: no payment credentials pass through here in either direction. A seller's PSP
 *   configuration is server-side and never readable; this call returns amounts and buyers, nothing
 *   that could be used to charge anyone.
 * @structure earnings(opts)
 * @usage const e = await AIMEAT.exchange.earnings();  // e.currencies.EUR.pending
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 02 — the EXCHANGE browser library, gap G19).
 */
import { authed, qs } from './client.js';

/**
 * The caller's own accrued earnings, per currency, with the per-entry breakdown behind the figure.
 *
 * Returns `{ seller, currencies: { EUR: { pending, settled, total, entries } }, entries: [{
 * tracking_code, amount, currency, method, status, at, reference, buyer }], count, note }`.
 * Amounts are NET of the platform rake, in the currency's integer micro-units — format them with
 * {@link module:exchange/format.fmtUnit}, never by dividing by hand.
 *
 * `pending` means booked as owed and not yet paid out. Owner-scoped by the server on the money
 * identity, so an owner's agent or a granted app reads the OWNER's earnings and never another
 * seller's; a non-owner principal needs the `wallet:read` scope.
 * @param {{ status?: 'pending'|'settled', currency?: string, limit?: number }} [opts]
 * @returns {Promise<any>}
 */
export function earnings(opts) {
  const o = opts || {};
  return authed('/v1/exchange/earnings' + qs({ status: o.status, currency: o.currency, limit: o.limit }),
    undefined, 'Failed to read your earnings');
}
