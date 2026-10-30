/**
 * @file src/commerce/card-adult-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who a credit card payment records as a verified adult, and when it asks the buyer first
 *   (secaudit2026oct26 round 8c, commerce-07,
 *   commerce/stripe-checkout-complete:seller-paid-session-records-buyer-adult; Jouni's option A,
 *   2026-10-30).
 *
 *   WHY. A credit card payment shows the buyer is an adult (Comicland v3 A-4), and the node reads the
 *   card's funding type back from Stripe. Every card payment is made on the SELLER's own Stripe account
 *   (commerce/stripe-handler.ts), so the seller controls that account and everything it answers: a
 *   seller could make the node record any buyer who opened a checkout with them as an adult.
 *
 *   THE RULE. A payment on an operator's own Stripe account (the seller's account holds the operator
 *   role) records the adult check at once, as before. A payment that only another seller's account
 *   attests records nothing by itself: the buyer gets a one-press question, "I paid with my own card",
 *   filed in their own request store under the approval standard (kind `card-adult-confirm`). Only the
 *   buyer, signed in themselves, can allow it (`in_person`); allowing it records the adult check
 *   (publish-requests/apply-card-adult.ts), and not allowing it leaves the adult status as it was. The
 *   purchase itself completes either way. A buyer already recorded as an adult, or with the question
 *   already waiting, is not asked again; a buyer without an account on this node is not asked.
 * @structure CardPaymentFacts · sellerIsOperator · askBuyerCardAdult
 * @usage
 *   if (await sellerIsOperator(storage, seller)) await recordAdult(storage, buyer, 'credit-card');
 *   else await askBuyerCardAdult(ctx, buyerGhii, { seller, checkout, payment });
 * @version-history
 *   v1.0.0 -- 2026-10-30 -- Initial (secaudit2026oct26 round 8c, commerce-07).
 */
import type { Storage } from '../storage/interface.js';
import type { PaymentContext } from './types.js';
import { isOperatorAccount } from '../utils/operator-account.js';
import { localAccountName, localAccountOf, ownerGhiiOf } from '../utils/gaii.js';
import { readAdult } from '../services/adult-assurance.js';
import { filePublishRequest, listPublishRequests, effectiveState } from '../services/publish-requests/store.js';
import { logger } from '../utils/logger.js';

/** The request kind the buyer answers. */
export const CARD_ADULT_KIND = 'card-adult-confirm';

/** The payment a credit card adult check follows: whose Stripe account took it, for which checkout. */
export interface CardPaymentFacts {
  seller?: { ghii: string; owner: string };
  /** The AIMEAT checkout (or other reference) the payment was for. */
  checkout: string;
  /** The payment's id at Stripe (a PaymentIntent). */
  payment: string;
}

/** True when the seller's account, whose Stripe key took the payment, is an operator of this node. */
export async function sellerIsOperator(storage: Storage, seller: CardPaymentFacts['seller']): Promise<boolean> {
  const name = localAccountOf(seller?.owner || seller?.ghii || '');
  if (!name) return false;
  return isOperatorAccount(await storage.getOwner(name));
}

/**
 * Ask the buyer whether they paid with their own card. Files nothing for a buyer without an account
 * here, one already recorded as an adult, or one whose question still waits. Never throws past a log
 * line: the payment has been made, and a question that cannot be filed records nothing.
 * @returns the request id filed, or null when nothing was asked
 */
export async function askBuyerCardAdult(ctx: PaymentContext, buyerGhii: string, paid: CardPaymentFacts): Promise<string | null> {
  const buyer = buyerGhii ? ownerGhiiOf(buyerGhii) : '';
  const name = buyer ? localAccountOf(buyer) : null;
  if (!name || !(await ctx.storage.getOwner(name))) return null;
  if ((await readAdult(ctx.storage, buyer)).verified) return null;
  const now = Date.now();
  const waiting = (await listPublishRequests(ctx.storage, buyer))
    .find(r => r.kind === CARD_ADULT_KIND && effectiveState(r, now) === 'awaiting_owner');
  if (waiting) return null;
  const seller = localAccountName(paid.seller?.owner || paid.seller?.ghii || '') || 'the seller';
  const filed = await filePublishRequest(ctx, buyer, {
    kind: CARD_ADULT_KIND,
    target: { seller: paid.seller?.ghii ?? '', checkout: paid.checkout, payment: paid.payment },
    title: 'whether you paid with your own card',
    name: seller,
    change: { field: 'adult', from: false, to: 'credit-card' },
    // The node asks on the buyer's own account: the seller did not ask and hears no answer, and the
    // buyer hears no answer from themselves (approval-standard.ts tellAsker).
    requested_by: { principal: buyer, kind: 'person', sub: buyer },
    approval: {
      approver: 'owner',
      asks: 'confirm that you paid with your own card, which records you as a verified adult on this server',
      why: `You paid ${seller} with a credit card. The payment went through the seller's own card payment account, and only that account says the card was a credit card. If you confirm that you paid with your own card, this server records you as a verified adult, and apps can then show you content meant for adults. If you do not confirm, your adult status stays as it was. Your answer does not change your purchase.`,
      // A fact about the buyer, so the buyer in person allows it; an agent or an app may not (policy.ts).
      in_person: true,
      labels: { allow: 'I paid with my own card', deny: 'Leave it as it is', key: 'approval_card_adult' },
      i18n: { key: 'approval_card_adult', vars: { seller } },
    },
  });
  if (!filed.ok) {
    logger.warn('[stripe] the buyer could not be asked to confirm the card; no adult check recorded', { buyer, seller: paid.seller?.ghii, error: filed.message });
    return null;
  }
  return filed.request.id;
}
