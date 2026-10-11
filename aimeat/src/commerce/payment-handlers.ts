/**
 * @file src/commerce/payment-handlers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Payment-handler registry for the commerce core (TARGET-033). Core registers every
 *   money handler at mount: `com.stripe.spt` (cards on the SELLER's own account), `io.aimeat.invoice`
 *   (settled offline) and, when enabled, `com.coinbase.x402` (stablecoin). One registry, so the
 *   checkout flow and the /.well-known/ucp profile treat every payment method uniformly. Handlers
 *   implement collect / payout / refund — the session service orchestrates the legs (including
 *   commission splits and the operator fee leg). A morsel is pacing, not a payment, so no handler
 *   settles morsels: the session service charges the pacing itself (ruling
 *   decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa).
 * @structure registerPaymentHandler · getPaymentHandler · listPaymentHandlers ·
 *   resetPaymentHandlers (tests) · PaymentError · LEGACY_MORSEL_HANDLER_ID
 * @usage
 *   registerPaymentHandler(stripePaymentHandler(config));
 *   const handler = getPaymentHandler('com.stripe.spt');
 * @version-history
 *   v3.0.0 — 2026-10-11 — The morsel payment handler is removed: a morsel is pacing, charged by the
 *                         session service beside the money price. LEGACY_MORSEL_HANDLER_ID names the id
 *                         a 3.x client may still send, so the checkout can refuse it with a reason.
 *   v2.0.0 — 2026-07-13 — collect/payout/refund contract (phase 4: custom distributions + money handlers)
 *   v1.0.0 — 2026-07-13 — Initial registry + morsel handler (TARGET-033 phase 1)
 */
import type { PaymentHandler } from './types.js';

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

/**
 * The id of the removed morsel payment handler. A 3.x client may still name it on completion; the
 * checkout answers it with the money handlers to choose from instead of "unknown handler".
 */
export const LEGACY_MORSEL_HANDLER_ID = 'io.aimeat.morsels';
