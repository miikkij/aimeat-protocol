/**
 * @file src/commerce/invoice-handler.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The manual-invoice PaymentHandler: completes a MONEY checkout without any payment
 *   service provider by booking what the buyer owes and letting the seller collect it out of band
 *   (invoice, bank transfer, an existing customer agreement). Nothing is captured online, so the
 *   node holds no funds and needs no credentials — this is the rail for B2B selling and for anyone
 *   who bills separately but wants the order, the receipt and the obligation recorded here.
 *
 *   collect mints a tracking code, payout books a PENDING payable entry, refund is a no-op because
 *   nothing was ever captured.
 * @structure INVOICE_HANDLER_ID · invoicePaymentHandler
 * @usage registerPaymentHandler(invoicePaymentHandler());
 * @version-history
 *   v1.0.0 — 2026-07-28 — Promoted into core from the removed ee/ module (single edition).
 */
import { randomUUID } from 'node:crypto';
import type { PaymentHandler } from './types.js';
import { bookPayable } from './payable-book.js';
import { MONEY_CURRENCIES } from './money.js';

/** Reverse-DNS id advertised in the /.well-known/ucp payment_handlers list. */
export const INVOICE_HANDLER_ID = 'io.aimeat.invoice';

export function invoicePaymentHandler(): PaymentHandler {
  return {
    id: INVOICE_HANDLER_ID,
    title: 'Manual invoice (settle offline)',
    currencies: [...MONEY_CURRENCIES],

    async collect(_ctx, { reference }) {
      // No external processing: the obligation is the settlement. The tracking code ties the order,
      // the receipt and the payable entry together.
      return { trackingCode: `inv_${reference}_${randomUUID().slice(0, 8)}` };
    },

    async payout(ctx, { toGhii, amount, currency, buyerGhii, trackingCode, reference }) {
      await bookPayable(ctx, toGhii, trackingCode, {
        amount, currency, buyerGhii, reference, method: 'invoice', status: 'pending',
      });
    },

    async refund() {
      // Nothing was captured externally, so there is nothing to reverse.
    },
  };
}
