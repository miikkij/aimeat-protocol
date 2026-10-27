/**
 * @file src/commerce/session-claim.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two checks completeSession makes before any money moves, kept beside it because the
 *   session service is at its size limit.
 *
 *   THE CLAIM (QA audit S8-04). Completion tested `open` on the copy the route had loaded and wrote
 *   `completed` at the end with an unconditional write, so two overlapping completions, or a retry
 *   while the first was still inside the payment provider's call, each collected and each fulfilled.
 *   The session is now claimed first: its stored record moves from `open` to `completing` with a
 *   compare-and-swap on the record's version, so exactly one completion goes on. A refusal before the
 *   money moved (pacing, the agent's limit, a failed collect, a failed fulfilment that was refunded)
 *   puts it back to `open` for a retry. The collected tracking code is written on the claimed record
 *   before fulfilment, so a session that stops after the money moved shows what was charged.
 *
 *   THE INVOICE RAIL (QA audit S8-03). io.aimeat.invoice captures nothing: the order completes and the
 *   buyer's obligation is booked for the seller to bill. For a line fulfilled later (an agent task) the
 *   seller can still decline the work. For a line delivered during completion (a tool call, a package
 *   grant, a one-time pay token, a pacing pack) nothing can be withheld, so the buyer may name the
 *   invoice rail for it only when the seller has said they give credit for it: `invoiceImmediate:
 *   true` in their payment settings (commerce.psp), set with PUT /v1/commerce/payout/invoice.
 *
 *   A REFUNDED PAYMENT IS NOT TAKEN TWICE (secaudit2026oct22). A failed fulfilment that the rail
 *   refunded puts the session back to `open` with that payment's tracking code kept
 *   (releaseAfterRefund); a later collect that answers the same code is refused (refundedPaymentRefusal)
 *   and the buyer pays again.
 * @structure claimSessionForCompletion · expireOverdueSession · changeOpenSession · rememberCardPage · releaseSessionClaim · releaseAfterRefund ·
 *   refundedPaymentRefusal · recordCollected · deliversOnCompletion · sellerAcceptsImmediateInvoice ·
 *   invoiceRailRefusal
 * @usage
 *   await claimSessionForCompletion(storage, session, key);   // throws SESSION_NOT_OPEN
 *   const refusal = invoiceRailRefusal(handler?.id, sellables); if (refusal) throw refusal;
 * @version-history
 *   v1.3.0 — 2026-10-27 — changeOpenSession: the buyer's item change and cancel write the stored session
 *     only while it is open (secaudit2026oct26, commerce/session-service:stale-session-write-reopens-consumed-payment).
 *     rememberCardPage: the card pages the node opened, for the webhook completion (secaudit2026oct26,
 *     commerce/stripe-checkout-complete:seller-paid-session-records-buyer-adult).
 *   v1.2.0 — 2026-10-25 — releaseAfterRefund and refundedPaymentRefusal (secaudit2026oct22).
 *   v1.1.0 — 2026-10-18 — expireOverdueSession, for getSession's lazy expiry
 *     (wish-ei-atomisen-kirjoituksen-107-avointa-kohtaa-korjataan-raha-j).
 *   v1.0.0 — 2026-10-16 — Initial (QA audit S8-03, S8-04).
 */
import type { Storage } from '../storage/interface.js';
import type { CheckoutSessionRecord, Sellable } from './types.js';
import { CommerceError } from './errors.js';
import { PaymentError } from './payment-handlers.js';
import { putRecord } from './platform-fee.js';
import { INVOICE_HANDLER_ID } from './invoice-handler.js';
import { updateRecord, UNCHANGED } from '../services/record-cas.js';

const NOT_OPEN = (status: string) => new CommerceError('SESSION_NOT_OPEN', 409,
  status === 'completing'
    ? 'This checkout is being completed by another request right now. Read the session again in a moment to see how it ended.'
    : `Checkout session is ${status}; only open sessions can change`);

/**
 * Move the stored session from `open` to `completing`, or throw SESSION_NOT_OPEN. The swap is on the
 * record's version, so of two completions that both loaded an open session, one wins and the other
 * is refused before it charges anything.
 */
export async function claimSessionForCompletion(storage: Storage, session: CheckoutSessionRecord, key: string): Promise<void> {
  const stored = await storage.getMemory(session.buyerGhii, key);
  const current = stored?.value as unknown as CheckoutSessionRecord | undefined;
  if (!stored || !current) throw new CommerceError('SESSION_NOT_FOUND', 404, `Checkout session not found: ${session.id}`);
  if (current.status !== 'open') throw NOT_OPEN(current.status);
  const now = new Date().toISOString();
  const claimed: CheckoutSessionRecord = { ...current, status: 'completing', updatedAt: now };
  const record = {
    key, ownerGaii: session.buyerGhii, value: claimed as unknown as Record<string, unknown>, visibility: stored.visibility,
    tags: stored.tags, ttlHours: stored.ttlHours, version: stored.version + 1, createdAt: stored.createdAt, updatedAt: now,
  };
  const written = storage.setMemoryIfVersion
    ? await storage.setMemoryIfVersion(record, stored.version)
    : await storage.setMemory(record);
  if (!written) throw NOT_OPEN('completing');
}

/**
 * Move an overdue `open` session to `expired` on the record's version (services/record-cas.ts). The
 * check is made on the stored record, so of two reads at the same moment one writes it, and a
 * session another request claimed or expired meanwhile stays as that request left it. Answers the
 * session as stored, and whether this call expired it (the caller counts the stage only then).
 */
export async function expireOverdueSession(
  storage: Storage, buyerGhii: string, key: string,
): Promise<{ stored: CheckoutSessionRecord | null; expired: boolean }> {
  let expired = false;
  const stored = await updateRecord<CheckoutSessionRecord | null>(storage, buyerGhii, key, v => (v ?? null) as CheckoutSessionRecord | null, cur => {
    expired = !!cur && cur.status === 'open' && Date.now() > new Date(cur.expiresAt).getTime();
    return expired ? { ...cur!, status: 'expired' as const, updatedAt: new Date().toISOString() } : UNCHANGED;
  }, { tag: 'commerce', visibility: 'owner' });
  return { stored, expired };
}

/**
 * Change the STORED session, and only while it is open, on its version (services/record-cas.ts). The
 * buyer's item change and cancel go through here. Written from a copy read before a completion
 * claimed the session, they put it back to `open` and dropped the claim's and the refund's marks, so
 * the same payment completed it again (secaudit2026oct26). Throws SESSION_NOT_OPEN or
 * SESSION_NOT_FOUND as the stored record says.
 */
export async function changeOpenSession(
  storage: Storage, session: CheckoutSessionRecord, key: string, change: (cur: CheckoutSessionRecord) => CheckoutSessionRecord,
): Promise<CheckoutSessionRecord> {
  let refusal: CommerceError | null = null;
  const out = await updateRecord<CheckoutSessionRecord | null>(storage, session.buyerGhii, key, v => (v ?? null) as CheckoutSessionRecord | null, cur => {
    refusal = !cur ? new CommerceError('SESSION_NOT_FOUND', 404, `Checkout session not found: ${session.id}`)
      : cur.status !== 'open' ? NOT_OPEN(cur.status) : null;
    return refusal ? UNCHANGED : change(cur!);
  }, { tag: 'commerce', visibility: 'owner', tags: ['commerce'] });
  if (refusal) throw refusal;
  return out!;
}

/**
 * Keep the id of a card page the node opened for this checkout (`cardPages`, the newest 20), so the
 * webhook completion takes only those (stripe-checkout-complete.ts). updatedAt stays as it was: the
 * card page's idempotency key is built from it, and opening the page again gives the same page.
 */
export async function rememberCardPage(storage: Storage, session: CheckoutSessionRecord, stripeSession: string): Promise<void> {
  await changeOpenSession(storage, session, `commerce.session.${session.id}`, cur => (
    { ...cur, cardPages: [...(cur.cardPages ?? []).filter(id => id !== stripeSession), stripeSession].slice(-20) }));
}

/** Put a claimed session back to `open`, after a refusal that moved no money (or refunded it). */
export async function releaseSessionClaim(storage: Storage, session: CheckoutSessionRecord, key: string): Promise<void> {
  await putRecord(storage, session.buyerGhii, key, { ...session, status: 'open', updatedAt: new Date().toISOString() });
}

/**
 * Put a claimed session back to `open` after its fulfilment failed and the rail confirmed the refund.
 * The refunded payment's tracking code is kept, and the attempt counted, so a retry that reaches the
 * same payment again (a card page read back, an idempotent replay of the same charge) is not taken as
 * payment, and a keyed rail makes a new charge (secaudit2026oct22).
 */
export async function releaseAfterRefund(storage: Storage, session: CheckoutSessionRecord, key: string, trackingCode: string): Promise<void> {
  const refunded = [...(session.refundedTrackingCodes ?? []), trackingCode].slice(-20);
  await releaseSessionClaim(storage, { ...session, refundedTrackingCodes: refunded, collectAttempt: (session.collectAttempt ?? 0) + 1 }, key);
}

/** The refusal when a collect answered a payment this checkout already refunded, or null. */
export function refundedPaymentRefusal(session: CheckoutSessionRecord, trackingCode: string): PaymentError | null {
  if (!(session.refundedTrackingCodes ?? []).includes(trackingCode)) return null;
  return new PaymentError('PAYMENT_REFUNDED', 402,
    'This payment was refunded because the order could not be delivered. Pay again to complete this checkout: open the card page again or use another payment method.');
}

/** Write the tracking code of the collected payment on the claimed session, before fulfilment. */
export async function recordCollected(storage: Storage, session: CheckoutSessionRecord, key: string, trackingCode: string): Promise<void> {
  await putRecord(storage, session.buyerGhii, key, {
    ...session, status: 'completing', collectedTrackingCode: trackingCode, updatedAt: new Date().toISOString(),
  });
}

/**
 * Whether a line is delivered while the checkout completes, so that nothing can be withheld after.
 * A line with its own fulfil step is, unless the step only queues a task (fulfillsAsTask); a line
 * without one becomes a task. A new kind with a fulfil step counts as delivered at once by default.
 */
export function deliversOnCompletion(sellable: Pick<Sellable, 'fulfill' | 'fulfillsAsTask'>): boolean {
  return typeof sellable.fulfill === 'function' && sellable.fulfillsAsTask !== true;
}

/** Whether the seller's payment settings say they give invoice credit for lines delivered at once. */
export function sellerAcceptsImmediateInvoice(psp: unknown): boolean {
  return !!psp && typeof psp === 'object' && (psp as { invoiceImmediate?: unknown }).invoiceImmediate === true;
}

/** The refusal when the buyer names the invoice rail for a line delivered at once that the seller does not bill this way. */
export function invoiceRailRefusal(handlerId: string | undefined, sellables: Sellable[]): CommerceError | null {
  if (handlerId !== INVOICE_HANDLER_ID) return null;
  const immediate = sellables.filter(deliversOnCompletion);
  if (immediate.length === 0) return null;
  if (sellerAcceptsImmediateInvoice(sellables[0]?.psp)) return null;
  return new CommerceError('INVOICE_NOT_ACCEPTED', 422,
    `"${immediate[0]!.title}" is delivered as soon as the checkout completes, and its seller does not take invoice payment for that. Pay with another method, such as a card.`);
}
