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
 * @structure claimSessionForCompletion · expireOverdueSession · releaseSessionClaim · recordCollected ·
 *   deliversOnCompletion · sellerAcceptsImmediateInvoice · invoiceRailRefusal
 * @usage
 *   await claimSessionForCompletion(storage, session, key);   // throws SESSION_NOT_OPEN
 *   const refusal = invoiceRailRefusal(handler?.id, sellables); if (refusal) throw refusal;
 * @version-history
 *   v1.1.0 — 2026-10-18 — expireOverdueSession, for getSession's lazy expiry
 *     (wish-ei-atomisen-kirjoituksen-107-avointa-kohtaa-korjataan-raha-j).
 *   v1.0.0 — 2026-10-16 — Initial (QA audit S8-03, S8-04).
 */
import type { Storage } from '../storage/interface.js';
import type { CheckoutSessionRecord, Sellable } from './types.js';
import { CommerceError } from './errors.js';
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

/** Put a claimed session back to `open`, after a refusal that moved no money (or refunded it). */
export async function releaseSessionClaim(storage: Storage, session: CheckoutSessionRecord, key: string): Promise<void> {
  await putRecord(storage, session.buyerGhii, key, { ...session, status: 'open', updatedAt: new Date().toISOString() });
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
