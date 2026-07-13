/**
 * @file src/commerce/payment-handlers.ts
 * @description Payment-handler registry for the commerce core (TARGET-033) + the built-in morsel
 *   handler. Core registers `io.aimeat.morsels` at mount; the EE module's handlers (real money)
 *   arrive through `EnterpriseProvider.getPaymentHandlers()` and land in the same registry, so the
 *   checkout flow and the /.well-known/ucp profile treat every payment method uniformly.
 * @structure registerPaymentHandler · getPaymentHandler · listPaymentHandlers ·
 *   resetPaymentHandlers (tests) · morselPaymentHandler
 * @usage
 *   registerPaymentHandler(morselPaymentHandler());
 *   const handler = getPaymentHandler('io.aimeat.morsels');
 * @version-history
 *   v1.0.0 — 2026-07-13 — Initial registry + morsel handler (TARGET-033 phase 1)
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { PaymentHandler, PaymentContext, PaymentResult } from './types.js';
import { commerceFeePercent, settleMarketplaceFee, resolveOperatorFeeGhii } from '../services/marketplace-fee.js';

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

/** Error shape the checkout route maps straight onto the envelope. */
export class PaymentError extends Error {
  constructor(public code: string, public statusCode: number, message: string) {
    super(message);
  }
}

export const MORSEL_HANDLER_ID = 'io.aimeat.morsels';

/**
 * The Community payment method: settle in morsels on the node's own ledger. Debits the buyer
 * owner's GHII balance, credits the seller minus the marketplace fee, and writes the same
 * wallet-transaction pair the offer-invoke settlement writes (`commerce_spend`/`commerce_earn`).
 */
export function morselPaymentHandler(): PaymentHandler {
  return {
    id: MORSEL_HANDLER_ID,
    title: 'AIMEAT morsels',
    currencies: ['morsel'],

    async charge(ctx: PaymentContext, { buyerGhii, sellerGhii, amount, reference }): Promise<PaymentResult> {
      const { storage, config } = ctx;
      const debited = await storage.debitBalance(buyerGhii, amount);
      if (!debited) {
        throw new PaymentError('INSUFFICIENT_BALANCE', 402, `This purchase costs ${amount} morsels and the balance does not cover it`);
      }
      const fee = Math.ceil(amount * commerceFeePercent(config) / 100);
      const earnings = amount - fee;
      await storage.creditBalance(sellerGhii, earnings);
      const now = new Date().toISOString();
      const trackingCode = `comtx_${Date.now()}_${randomBytes(6).toString('hex')}`;
      await storage.addTransaction({ id: `tx-${randomUUID()}`, gaii: buyerGhii, type: 'commerce_spend', amount: -amount, counterpartyGaii: sellerGhii, trackingCode: `${trackingCode}:${reference}`, timestamp: now });
      await storage.addTransaction({ id: `tx-${randomUUID()}`, gaii: sellerGhii, type: 'commerce_earn', amount: earnings, counterpartyGaii: buyerGhii, trackingCode: `${trackingCode}:${reference}`, timestamp: now });
      // Fee leg: credited to the operator or burned, per AIMEAT_MARKETPLACE_FEE_MODE.
      await settleMarketplaceFee(storage, config, { fee, payerGhii: buyerGhii, trackingCode, source: 'commerce' });
      return { charged: amount, earned: earnings, fee, trackingCode };
    },

    async refund(ctx: PaymentContext, { buyerGhii, sellerGhii, result }): Promise<void> {
      const { storage, config } = ctx;
      // Best effort: return the full charge to the buyer, claw the earnings back from the seller
      // and (operator mode) the fee back from the operator. Burned fees re-enter supply via the
      // buyer credit — the burn tx already records the destruction, this records the re-issue.
      try {
        await storage.creditBalance(buyerGhii, result.charged);
        await storage.debitBalance(sellerGhii, result.earned);
        if (result.fee > 0 && config.marketplaceFeeMode === 'operator') {
          const operatorGhii = await resolveOperatorFeeGhii(storage, config);
          if (operatorGhii) await storage.debitBalance(operatorGhii, result.fee);
        }
        const now = new Date().toISOString();
        await storage.addTransaction({ id: `tx-${randomUUID()}`, gaii: buyerGhii, type: 'commerce_refund', amount: result.charged, counterpartyGaii: sellerGhii, trackingCode: result.trackingCode, timestamp: now });
      } catch { /* refund must never throw — the caller already carries the primary error */ }
    },
  };
}
