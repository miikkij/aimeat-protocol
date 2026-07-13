/**
 * @file src/commerce/x402.ts
 * @description x402-style payment challenge body (TARGET-033 phase 5): every 402 response from a
 *   commerce adapter carries an `accepts` array telling the paying agent HOW it could settle —
 *   the payment handlers available on this node plus the morsel top-up path. The Coinbase x402
 *   stablecoin scheme slots in as one more entry once the EE stablecoin handler exists (phase 6);
 *   until then the envelope shape is already machine-actionable.
 * @usage res.status(402).json({ ...error(...), ...paymentChallenge(config) });
 * @version-history
 *   v1.0.0 — 2026-07-13 — Initial 402 accepts envelope (TARGET-033 phase 5)
 */
import type { AimeatConfig } from '../config.js';
import { listPaymentHandlers } from './payment-handlers.js';

/** The x402-inspired `accepts` block appended to 402 payment-required responses. */
export function paymentChallenge(config: AimeatConfig): { x402Version: number; accepts: Array<Record<string, unknown>> } {
  const b = config.baseUrl;
  const accepts: Array<Record<string, unknown>> = listPaymentHandlers().map((h) => ({
    scheme: 'aimeat-checkout',
    handler: h.id,
    currencies: h.currencies,
    description: `Complete the checkout session with POST /v1/commerce/checkout-sessions/{id}/complete using payment.handler="${h.id}"`,
    resource: `${b}/v1/commerce/checkout-sessions`,
  }));
  accepts.push({
    scheme: 'aimeat-morsel-topup',
    description: 'Insufficient morsels: ask the node operator to mint, receive the daily allowance, or earn by selling offers',
    resource: `${b}/v1/wallet`,
  });
  return { x402Version: 1, accepts };
}
