/**
 * @file src/commerce/possible-payment.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An x402 settlement whose outcome is not known: the facilitator's /settle call timed
 *   out, failed on the network or answered a server error, so the stablecoin transfer from the buyer
 *   to the seller may or may not have been sent.
 *
 *   WHY. The checkout treated any collect error as "nothing was taken": the session opened again and
 *   nothing kept the proof's nonce or payer. If the transfer had gone out, the buyer had paid the
 *   seller, a retry with the same proof failed on the used nonce, so the buyer had to pay a second
 *   time, and neither the seller nor the operator heard of the first payment (secaudit2026oct22,
 *   x402-facilitator.settle-error-releases-claim-without-reconciliation; developer decision
 *   2026-10-25). Now the handler throws PossiblePaymentError, and the checkout (and the A2A route)
 *   keeps a "possible payment" record under the seller, notifies the seller in their language and
 *   tells the operator, and the buyer is told not to pay again yet.
 *
 *   NOT DONE HERE. Asking the facilitator, or the chain, whether the nonce settled, and closing the
 *   record from that answer, is later work; until then the seller and the operator check it by hand.
 *
 *   THE RECORD. `commerce.possible.{reference}` under the seller's GHII: the checkout session id, or
 *   `a2a:<work id>` on the A2A route. `commerce.` is a service-owned prefix (utils/reserved-keys.ts),
 *   so no memory route can rewrite it, and the seller reads it with GET /v1/memory/<key>.
 * @structure POSSIBLE_PREFIX · PossiblePayment · PossiblePaymentError · recordPossiblePayment · recordPossiblePaymentOf
 * @usage
 *   try { settled = await facilitator.settle(p, r); } catch (e) { throw new PossiblePaymentError(reference, {...}); }
 *   if (err instanceof PossiblePaymentError) await recordPossiblePayment(ctx, { reference, sellerGhii, buyer, amount, currency, rail, possible: err.possible });
 * @version-history
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22, lead 4432).
 */
import type { CheckoutSessionRecord, PaymentContext } from './types.js';
import { PaymentError } from './payment-handlers.js';
import { putRecord } from './platform-fee.js';
import { logger } from '../utils/logger.js';
import { findOperatorGhii } from '../services/operators.js';
import { sendDirectMessage } from '../services/message-send.js';
import { notify } from '../services/notify.js';

/** Key prefix of the possible-payment record under the seller's GHII. */
export const POSSIBLE_PREFIX = 'commerce.possible.';

/** What the node knows of a settlement it did not hear back about. */
export interface PossiblePayment {
  /** The proof's single-use EIP-3009 nonce: what the facilitator and the chain know the transfer by. */
  nonce: string;
  /** The buyer's wallet address the proof pays from. */
  payer: string;
  /** The seller's payout address the proof pays to. */
  payTo: string;
  /** The amount in the asset's micro units, as signed. */
  amountMicros: number;
  /** USDC or EURC. */
  asset: string;
  network: string;
  /** What the facilitator call answered instead: the timeout or the error. */
  reason: string;
}

/**
 * The facilitator did not answer the settlement, so whether money moved is not known. Status 502,
 * code X402_SETTLE_UNKNOWN; the message is the buyer's, in plain words, with the reference.
 */
export class PossiblePaymentError extends PaymentError {
  constructor(public reference: string, public possible: PossiblePayment) {
    super('X402_SETTLE_UNKNOWN', 502,
      'The payment service did not answer in time, so it is not known whether your stablecoin payment went through. '
      + `Do not pay again yet. The seller and the people who run this node were told, with the reference ${reference}, `
      + 'and they can check whether the payment arrived.');
  }
}

export interface PossiblePaymentInput {
  /** The checkout session id, or `a2a:<work id>`. */
  reference: string;
  sellerGhii: string;
  /** Who bought: a GHII, a peer's GAII, or a guest's description. */
  buyer: string;
  /** The price in micros of `currency`. */
  amount: number;
  currency: string;
  rail: string;
  possible: PossiblePayment;
}

/** recordPossiblePayment for a checkout session: its id is the reference, its buyer and price are what was paid. */
export function recordPossiblePaymentOf(ctx: PaymentContext, session: CheckoutSessionRecord, rail: string, err: PossiblePaymentError): Promise<void> {
  const buyer = session.buyerGhii || (session.guest ? `guest:${session.guest.platform}${session.guest.email ? `:${session.guest.email}` : ''}` : '');
  return recordPossiblePayment(ctx, {
    reference: session.id, sellerGhii: session.sellerGhii, buyer, amount: session.total, currency: session.currency, rail, possible: err.possible,
  });
}

/**
 * Keep and announce a possible payment. Writes the record under the seller's GHII, logs at error
 * level, tells the operator and notifies the seller. Never throws: the buyer's answer must still go
 * out if any of these fail, and each failure is logged.
 */
export async function recordPossiblePayment(ctx: PaymentContext, input: PossiblePaymentInput): Promise<void> {
  const { reference, sellerGhii, buyer, rail, possible } = input;
  const money = `${(input.amount / 1_000_000).toFixed(2)} ${input.currency}`;
  const record = {
    type: 'aimeat:PossiblePayment',
    about: 'The payment service did not answer when this payment was settled, so it is not known whether the money moved. '
      + 'Check your payout address for a transfer from the payer with this nonce. If it arrived, deliver the order or return the payment; '
      + 'if not, nothing is owed. The buyer was told not to pay again until this is checked.',
    reference,
    buyer,
    seller: sellerGhii,
    amount: input.amount,
    currency: input.currency,
    rail,
    payer: possible.payer,
    payTo: possible.payTo,
    nonce: possible.nonce,
    asset: possible.asset,
    network: possible.network,
    reason: possible.reason.slice(0, 300),
    status: 'unconfirmed',
    createdAt: new Date().toISOString(),
  };
  logger.error('[commerce] x402 settlement outcome unknown: possible payment kept for the seller', {
    reference, seller: sellerGhii, buyer, amount: input.amount, currency: input.currency, nonce: possible.nonce, payer: possible.payer, reason: record.reason,
  });

  try {
    await putRecord(ctx.storage, sellerGhii, `${POSSIBLE_PREFIX}${reference}`, record);
  } catch (err) {
    logger.error('[commerce] the possible-payment record could not be stored', { reference, nonce: possible.nonce, error: String(err) });
  }

  try {
    const operator = await findOperatorGhii(ctx.storage, ctx.config);
    if (operator) {
      await sendDirectMessage({ storage: ctx.storage, config: ctx.config, peers: new Map() }, {
        senderGhii: operator,
        recipientGhii: operator,
        subject: `Possible payment, not confirmed: ${reference}`,
        body: [
          `The x402 payment service did not answer when **${money}** was settled, so it is not known whether the money moved to the seller.`,
          '',
          `- Reference: \`${reference}\``,
          `- Buyer: ${buyer || 'unknown'}, paying from ${possible.payer}`,
          `- Seller: ${sellerGhii}, payout address ${possible.payTo}`,
          `- ${possible.asset} on ${possible.network}, proof nonce \`${possible.nonce}\``,
          `- What the payment service answered: ${record.reason}`,
          '',
          `The seller has the record under \`${POSSIBLE_PREFIX}${reference}\` and was notified. The buyer was told not to pay again until it is checked. `
            + 'Look for the transfer with this nonce at the payment service or on the chain.',
        ].join('\n'),
        kind: 'system-fault',
        skipContactGate: true,
        sendLimit: 'exempt',
      });
    }
  } catch (err) {
    logger.warn('[commerce] the operator could not be told about a possible payment', { reference, error: String(err) });
  }

  // notify() is best-effort and never throws.
  await notify(ctx.storage, sellerGhii, {
    type: 'payment_possible',
    title: `A payment of ${money} may have arrived`,
    body: `The payment service did not answer when a buyer paid you, so it is not known whether the money arrived. Check your payout address for a transfer from ${possible.payer}. If it arrived, deliver the order or return the payment. Reference: ${reference}.`,
    i18n: { key: 'payment_possible', vars: { amount: money, payer: possible.payer, reference } },
  });
}
