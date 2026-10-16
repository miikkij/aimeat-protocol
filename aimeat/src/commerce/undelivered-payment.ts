/**
 * @file src/commerce/undelivered-payment.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What happens when a checkout collected the money and then could not deliver.
 *
 *   The session service asks the payment handler to refund (`refundCollected`), words the buyer's
 *   message from what the handler answered (`refundSentence`), and, for every payment that was taken
 *   and NOT returned, keeps a durable record and tells the people who can act on it
 *   (`recordUndeliveredPayment`). Before this, the buyer was always told "Payment refunded": the x402
 *   refund cannot reverse an onchain transfer and a failed Stripe refund was only logged, so the
 *   sentence was false on both rails and nothing tied the payment to the failed delivery.
 *
 *   The record lives under the SELLER's account, because the seller holds the money and is the one
 *   who can send it back: `commerce.undelivered.{sessionId}`, one key per failed checkout (a rare
 *   event, so the key budget is not at risk). `commerce.` is a service-owned prefix
 *   (utils/reserved-keys.ts), so no memory route can rewrite it. The operator gets a node message of
 *   kind `system-fault`, and the seller a notification. The record carries `status: 'open'`; settling
 *   it is the seller's out-of-band act, and the record says so in `about`.
 * @structure RefundOutcome (re-export) · UNDELIVERED_PREFIX · refundCollected · refundSentence ·
 *   recordUndeliveredPayment
 * @usage
 *   const refund = await refundCollected(ctx, handler, { buyerGhii, amount, trackingCode, seller });
 *   if (refund.outcome === 'failed' || refund.outcome === 'not_possible') await recordUndeliveredPayment(ctx, {...});
 *   throw new CommerceError('FULFILLMENT_FAILED', 502, `... ${refundSentence(refund, session.id)}`);
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F5-01, F7e-01, S8-05).
 */
import type { CheckoutSessionRecord, PaymentContext, PaymentHandler, RefundOutcome } from './types.js';
import { putRecord } from './platform-fee.js';
import { logger } from '../utils/logger.js';
import { findOperatorGhii } from '../services/operators.js';
import { sendDirectMessage } from '../services/message-send.js';
import { notify } from '../services/notify.js';

export type { RefundOutcome };

/** Key prefix of the undelivered-payment record under the seller's GHII. */
export const UNDELIVERED_PREFIX = 'commerce.undelivered.';

const OUTCOMES = new Set<RefundOutcome['outcome']>(['refunded', 'not_possible', 'failed', 'nothing_captured']);

/**
 * Ask the handler to reverse a collect and return what it did. Never throws. A handler that throws
 * anyway, or answers nothing a RefundOutcome can be read from, counts as `failed`: a refund nobody
 * confirmed is not a refund.
 */
export async function refundCollected(
  ctx: PaymentContext,
  handler: PaymentHandler,
  args: Parameters<PaymentHandler['refund']>[1],
): Promise<RefundOutcome> {
  try {
    const answer = await handler.refund(ctx, args) as RefundOutcome | undefined;
    if (answer && OUTCOMES.has(answer.outcome)) return answer;
    return { outcome: 'failed', detail: `The payment method ${handler.id} did not say whether it refunded.` };
  } catch (err) {
    return { outcome: 'failed', detail: `The refund call failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
  }
}

/**
 * The sentence the buyer reads about their money. Only `refunded` says the payment came back; a
 * payment taken and not returned says so, and says what to do, with the checkout reference the
 * seller's record is filed under.
 */
export function refundSentence(refund: RefundOutcome, sessionId: string): string {
  switch (refund.outcome) {
    case 'refunded':
      return 'The payment was refunded.';
    case 'nothing_captured':
      return 'No payment was taken, so nothing is owed.';
    case 'not_possible':
      return 'The payment was taken and this payment method cannot return it, so the money was NOT refunded. '
        + `Contact the seller, or the people who run this node, and give them the checkout reference ${sessionId}: `
        + 'the seller has a record of this payment. Do not pay for this checkout again until it is settled.';
    case 'failed':
    default:
      return 'The payment was taken and the refund did not go through, so the money was NOT returned. '
        + `Contact the seller, or the people who run this node, and give them the checkout reference ${sessionId}: `
        + 'the seller has a record of this payment. Do not pay for this checkout again until it is settled.';
  }
}

export interface UndeliveredPaymentInput {
  session: CheckoutSessionRecord;
  trackingCode: string;
  /** The payment handler id that collected. */
  rail: string;
  refund: RefundOutcome;
  /** Why the fulfilment failed, as the error said it. */
  reason: string;
}

/**
 * Keep and announce a payment that was collected and not delivered and not returned. Writes the
 * record under the seller's GHII, logs at error level, tells the operator and notifies the seller.
 * Never throws: the buyer's answer must still go out if any of these fail, and each failure is logged.
 */
export async function recordUndeliveredPayment(ctx: PaymentContext, input: UndeliveredPaymentInput): Promise<void> {
  const { session, trackingCode, rail, refund } = input;
  const reason = input.reason.slice(0, 500);
  const buyer = session.buyerGhii || (session.guest ? `guest:${session.guest.platform}${session.guest.email ? `:${session.guest.email}` : ''}` : '');
  const record = {
    type: 'aimeat:UndeliveredPayment',
    about: 'A checkout collected this payment and could not deliver the order, and the payment was not returned. '
      + 'The seller holds the money. Return it to the buyer, or deliver the order, then mark this record settled.',
    sessionId: session.id,
    trackingCode,
    buyer,
    seller: session.sellerGhii,
    amount: session.total,
    currency: session.currency,
    rail,
    refund: { outcome: refund.outcome, ...(refund.detail ? { detail: refund.detail } : {}) },
    reason,
    items: session.items.map(i => i.title).filter(Boolean).slice(0, 20),
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  logger.error('[commerce] payment collected, order not delivered, payment not returned', {
    session: session.id, trackingCode, buyer, seller: session.sellerGhii, amount: session.total,
    currency: session.currency, rail, refund: refund.outcome, detail: refund.detail, reason,
  });

  try {
    await putRecord(ctx.storage, session.sellerGhii, `${UNDELIVERED_PREFIX}${session.id}`, record);
  } catch (err) {
    logger.error('[commerce] the undelivered-payment record could not be stored', { session: session.id, trackingCode, error: String(err) });
  }

  const money = `${(session.total / 1_000_000).toFixed(2)} ${session.currency}`;
  try {
    const operator = await findOperatorGhii(ctx.storage, ctx.config);
    if (operator) {
      await sendDirectMessage({ storage: ctx.storage, config: ctx.config, peers: new Map() }, {
        senderGhii: operator,
        recipientGhii: operator,
        subject: `Payment not returned: checkout ${session.id}`,
        body: [
          `A checkout collected **${money}** and could not deliver the order, and the payment was **not returned** (${refund.outcome}).`,
          '',
          `- Checkout: \`${session.id}\``,
          `- Payment reference: \`${trackingCode}\` (${rail})`,
          `- Buyer: ${buyer || 'unknown'}`,
          `- Seller: ${session.sellerGhii}`,
          `- Why the delivery failed: ${reason}`,
          refund.detail ? `- Why it was not returned: ${refund.detail}` : '',
          '',
          `The seller has the record under \`${UNDELIVERED_PREFIX}${session.id}\` and was notified. The buyer was told the money was not returned and to contact the seller or you.`,
        ].filter(Boolean).join('\n'),
        kind: 'system-fault',
        skipContactGate: true,
        sendLimit: 'exempt',
      });
    }
  } catch (err) {
    logger.warn('[commerce] the operator could not be told about an undelivered payment', { session: session.id, error: String(err) });
  }

  // notify() is best-effort and never throws.
  await notify(ctx.storage, session.sellerGhii, {
    type: 'payment_not_delivered',
    title: `A payment of ${money} was taken and the order was not delivered`,
    body: `The order could not be delivered and the payment did not go back to the buyer, so you hold it. Return the payment to the buyer or deliver the order. Checkout reference: ${session.id}.`,
    i18n: { key: 'payment_not_delivered', vars: { amount: money, session: session.id } },
  });
}
