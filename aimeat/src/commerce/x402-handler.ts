/**
 * @file src/commerce/x402-handler.ts
 * @description The x402 stablecoin PaymentHandler (TARGET-042): settles a MONEY (USD) checkout
 *   session with USDC via the x402 `exact` scheme, NON-CUSTODIAL. It registers in the same registry
 *   as io.aimeat.morsels and com.stripe.spt and implements the same collect/payout/refund contract,
 *   so the commerce core orchestrates it unchanged. USDC is a payment METHOD for a USD price
 *   (model 2): the handler settles `currency: 'USD'` sessions, the session currency never becomes
 *   USDC, and the currency list stays morsel/EUR/USD.
 *
 *   collect: the buyer's decoded X-PAYMENT proof arrives as the adapter `instrument`. With no proof
 *   yet, collect throws 402 PAYMENT_REQUIRED so the adapter answers with the exact-scheme accepts[].
 *   With a proof, collect asks the facilitator to verify it and then settle it onchain (buyer → the
 *   seller's own USDC address, loaded from the seller's commerce.psp) and returns the settlement tx
 *   hash as the tracking code. AIMEAT never holds funds — replay is rejected by the facilitator's
 *   single-use EIP-3009 nonce (and, on the same session, by the completed-session gate). payout and
 *   refund are no-ops: the facilitator already moved money directly to the seller, and an onchain
 *   USDC transfer cannot be reversed (a post-settlement fulfillment failure is recorded, not clawed
 *   back).
 * @structure X402_HANDLER_ID · x402PaymentHandler
 * @usage registerPaymentHandler(x402PaymentHandler(config, facilitator));
 * @version-history
 *   v1.0.0 — 2026-07-18 — Initial non-custodial USDC handler (TARGET-042)
 */
import type { AimeatConfig } from '../config.js';
import type { PaymentHandler, PaymentContext } from './types.js';
import { PaymentError } from './payment-handlers.js';
import {
  getX402Network, buildExactRequirements, extractPayTo,
  type X402Facilitator, type X402PaymentPayload,
} from './x402-facilitator.js';

/** Reverse-DNS id advertised in the /.well-known/ucp payment_handlers list. */
export const X402_HANDLER_ID = 'com.coinbase.x402';

/**
 * The x402 USDC handler. `facilitator` is injected (the real safeFetch client in prod, the off-chain
 * double in E2E), so the network + facilitator are both parameters — a different chain or facilitator
 * needs no change here or in the commerce core.
 */
export function x402PaymentHandler(config: AimeatConfig, facilitator: X402Facilitator): PaymentHandler {
  return {
    id: X402_HANDLER_ID,
    title: 'USDC via x402',
    // Model 2: settles USD-priced sessions with USDC. EUR (EURC) can join the same handler later.
    currencies: ['USD'],

    async collect(_ctx: PaymentContext, { amount, reference, instrument, seller }) {
      const network = getX402Network(config.x402Network);
      if (!network) {
        throw new PaymentError('X402_NETWORK_UNKNOWN', 500, `x402 network not in the registry: ${config.x402Network}`);
      }
      // Non-custodial: funds settle to the SELLER's own USDC address (their commerce.psp), never the node's.
      const payTo = extractPayTo(seller?.psp);
      if (!payTo) {
        throw new PaymentError('SELLER_NO_X402_ADDRESS', 422, 'The seller has no x402 USDC payout address configured (commerce.psp)');
      }
      const requirements = buildExactRequirements({
        network, payTo, amountMicros: amount,
        resource: `${config.baseUrl}/v1/commerce/checkout-sessions/${reference}`,
        description: `AIMEAT checkout ${reference}`,
      });

      // No proof yet → 402 so the adapter answers with the exact-scheme accepts[] the buyer signs.
      const payload = instrument as X402PaymentPayload | undefined;
      if (!payload?.payload?.authorization?.nonce) {
        throw new PaymentError('PAYMENT_REQUIRED', 402, 'x402 payment required: sign the exact-scheme requirements and retry with the X-PAYMENT header');
      }

      const verified = await facilitator.verify(payload, requirements);
      if (!verified.isValid) {
        throw new PaymentError('X402_VERIFY_FAILED', 402, `x402 payment did not verify: ${verified.invalidReason ?? 'unknown reason'}`);
      }
      const settled = await facilitator.settle(payload, requirements);
      if (!settled.success) {
        // A reused nonce (replay) or an onchain error both land here — the buyer must sign a fresh proof.
        throw new PaymentError('X402_SETTLE_FAILED', 402, `x402 settlement failed (replay or onchain error): ${settled.errorReason ?? 'unknown reason'}`);
      }
      return { trackingCode: `x402_${settled.network ?? network.id}_${settled.transaction ?? 'settled'}` };
    },

    // Non-custodial: the facilitator settled buyer → seller directly, so there is nothing to pay out.
    async payout() { /* funds already moved to the seller's address at collect time */ },

    // An onchain USDC transfer is irreversible; a post-settlement fulfillment failure is recorded by
    // the session service, not reversed. Best-effort no-op (refund must never throw).
    async refund() { /* onchain transfers cannot be clawed back */ },
  };
}
