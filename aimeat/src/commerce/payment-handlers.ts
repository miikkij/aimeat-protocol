/**
 * @file src/commerce/payment-handlers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Payment-handler registry for the commerce core (TARGET-033) + the built-in morsel
 *   handler. Core registers every handler at mount: `io.aimeat.morsels` (this node's ledger),
 *   `com.stripe.spt` (cards on the SELLER's own account), `io.aimeat.invoice` (settled offline) and,
 *   when enabled, `com.coinbase.x402` (stablecoin). One registry, so the checkout flow and the
 *   /.well-known/ucp profile treat every payment method uniformly. Handlers
 *   implement collect / payout / refund — the session service orchestrates the legs (including
 *   commission splits and the operator-or-burn fee leg).
 * @structure registerPaymentHandler · getPaymentHandler · listPaymentHandlers ·
 *   resetPaymentHandlers (tests) · PaymentError · morselPaymentHandler
 * @usage
 *   registerPaymentHandler(morselPaymentHandler());
 *   const handler = getPaymentHandler('io.aimeat.morsels');
 * @version-history
 *   v2.0.0 — 2026-07-13 — collect/payout/refund contract (phase 4: custom distributions + money handlers)
 *   v1.0.0 — 2026-07-13 — Initial registry + morsel handler (TARGET-033 phase 1)
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { PaymentHandler, PaymentContext } from './types.js';
import { logger } from '../utils/logger.js';

const registry = new Map<string, PaymentHandler>();

export function registerPaymentHandler(handler: PaymentHandler): void {
  registry.set(handler.id, handler);
}

export function getPaymentHandler(id: string): PaymentHandler | undefined {
  return registry.get(id);
}

export function listPaymentHandlers(): PaymentHandler[] {
  return [...registry.values()];
}

/** Test seam: clear the module-level registry between embedded server boots. */
export function resetPaymentHandlers(): void {
  registry.clear();
}

/** Error shape the checkout adapters map straight onto their envelopes. */
export class PaymentError extends Error {
  constructor(public code: string, public statusCode: number, message: string) {
    super(message);
  }
}

export const MORSEL_HANDLER_ID = 'io.aimeat.morsels';

/**
 * The Community payment method: settle in morsels on the node's own ledger. Collect debits the
 * buyer owner's GHII, payout credits a recipient, refund returns a collect — each leg writes the
 * matching wallet transaction (`commerce_spend` / `commerce_earn` / `commerce_refund`).
 */
export function morselPaymentHandler(): PaymentHandler {
  return {
    id: MORSEL_HANDLER_ID,
    title: 'AIMEAT morsels',
    currencies: ['morsel'],

    async collect(ctx: PaymentContext, { buyerGhii, amount, reference }) {
      const { storage } = ctx;
      const debited = await storage.debitBalance(buyerGhii, amount);
      if (!debited) {
        throw new PaymentError('INSUFFICIENT_BALANCE', 402, `This purchase costs ${amount} morsels and the balance does not cover it`);
      }
      const trackingCode = `comtx_${Date.now()}_${randomBytes(6).toString('hex')}`;
      await storage.addTransaction({
        id: `tx-${randomUUID()}`, gaii: buyerGhii, type: 'commerce_spend', amount: -amount,
        trackingCode: `${trackingCode}:${reference}`, timestamp: new Date().toISOString(),
      });
      return { trackingCode };
    },

    async payout(ctx: PaymentContext, { toGhii, amount, buyerGhii, trackingCode, reference }) {
      if (amount <= 0) return;
      const { storage } = ctx;
      await storage.creditBalance(toGhii, amount);
      await storage.addTransaction({
        id: `tx-${randomUUID()}`, gaii: toGhii, type: 'commerce_earn', amount,
        counterpartyGaii: buyerGhii, trackingCode: `${trackingCode}:${reference}`, timestamp: new Date().toISOString(),
      });
    },

    async refund(ctx: PaymentContext, { buyerGhii, amount, trackingCode }) {
      try {
        await ctx.storage.creditBalance(buyerGhii, amount);
        await ctx.storage.addTransaction({
          id: `tx-${randomUUID()}`, gaii: buyerGhii, type: 'commerce_refund', amount,
          trackingCode, timestamp: new Date().toISOString(),
        });
      } catch (err) { logger.warn('refund: refund must never throw — the caller already carries the primary error', { error: String(err) }); }
    },
  };
}
