/**
 * @file src/commerce/x402-handler.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The x402 stablecoin PaymentHandler (TARGET-042): settles a MONEY checkout session
 *   with the stablecoin that matches its currency — USD with USDC, EUR with EURC — via the x402
 *   `exact` scheme, NON-CUSTODIAL. It registers in the same registry as io.aimeat.morsels and
 *   com.stripe.spt and implements the same collect/payout/refund contract, so the commerce core
 *   orchestrates it unchanged. The stablecoin is a payment METHOD for a fiat price (model 2): the
 *   session currency stays USD or EUR and never becomes USDC/EURC.
 *
 *   The advertised currency list is DERIVED from the configured network's assets, so this node only
 *   ever offers a currency it can actually settle — see x402-facilitator.ts for the registry and
 *   the verification behind each asset.
 *
 *   collect: the buyer's decoded X-PAYMENT proof arrives as the adapter `instrument`. With no proof
 *   yet, collect throws 402 PAYMENT_REQUIRED so the adapter answers with the exact-scheme accepts[].
 *   With a proof, collect asks the facilitator to verify it and then settle it onchain (buyer → the
 *   seller's own USDC address, loaded from the seller's commerce.psp) and returns the settlement tx
 *   hash as the tracking code. AIMEAT never holds funds — replay is rejected by the facilitator's
 *   single-use EIP-3009 nonce (and, on the same session, by the completed-session gate). payout and
 *   refund are no-ops: the facilitator already moved money directly to the seller, and an onchain
 *   onchain transfer cannot be reversed (a post-settlement fulfillment failure is recorded, not clawed
 *   back).
 * @structure X402_HANDLER_ID · x402PaymentHandler
 * @usage registerPaymentHandler(x402PaymentHandler(config, facilitator));
 * @version-history
 *   v1.1.0 — 2026-07-25 — EUR settles in EURC alongside USD/USDC: currencies derived from the
 *     network registry, asset selected by session currency, asset named in the tracking code (TARGET-042)
 *   v1.0.0 — 2026-07-18 — Initial non-custodial USDC handler (TARGET-042)
 */
import type { AimeatConfig } from '../config.js';
import type { PaymentHandler, PaymentContext } from './types.js';
import { PaymentError } from './payment-handlers.js';
import {
  getX402Network, getX402Asset, x402SettlementCurrencies, buildExactRequirements, extractPayTo,
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
  const configured = getX402Network(config.x402Network);
  return {
    id: X402_HANDLER_ID,
    title: 'Stablecoin settlement via x402',
    // ADVERTISE ONLY WHAT CAN SETTLE: the currency list is DERIVED from the assets the configured
    // network actually has (USD → USDC, EUR → EURC), never hardcoded. A currency with no asset — or
    // an unknown network, which yields [] — is never offered, so no buyer can trust a rail that
    // would fail. Model 2 throughout: the session currency stays fiat, the token is the instrument.
    currencies: x402SettlementCurrencies(configured),

    async collect(_ctx: PaymentContext, { amount, currency, reference, instrument, seller }) {
      const network = getX402Network(config.x402Network);
      if (!network) {
        throw new PaymentError('X402_NETWORK_UNKNOWN', 500, `x402 network not in the registry: ${config.x402Network}`);
      }
      // The session's currency picks its settlement token. No asset for the pair → refuse rather
      // than settle in the wrong token (the same gate that kept the currency off the advertised list).
      const asset = getX402Asset(network, currency);
      if (!asset) {
        throw new PaymentError('X402_CURRENCY_UNSUPPORTED', 422,
          `x402 cannot settle ${currency} on ${network.id}: no settlement asset is configured for that pair`);
      }
      // Non-custodial: funds settle to the SELLER's own address (their commerce.psp), never the node's.
      // One EVM address receives every asset, so USDC and EURC share the same payout setting.
      const payTo = extractPayTo(seller?.psp);
      if (!payTo) {
        throw new PaymentError('SELLER_NO_X402_ADDRESS', 422, 'The seller has no x402 stablecoin payout address configured (commerce.psp)');
      }
      const requirements = buildExactRequirements({
        network, asset, payTo, amountMicros: amount,
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
      // The tracking code names the token that actually moved (USDC / EURC), so a receipt says which
      // asset settled a fiat price rather than leaving it to be inferred from the session currency.
      return { trackingCode: `x402_${asset.symbol}_${settled.network ?? network.id}_${settled.transaction ?? 'settled'}` };
    },

    // Non-custodial: the facilitator settled buyer → seller directly, so there is nothing to pay out.
    async payout() { /* funds already moved to the seller's address at collect time */ },

    // An onchain stablecoin transfer is irreversible; a post-settlement fulfillment failure is recorded by
    // the session service, not reversed. Best-effort no-op (refund must never throw).
    async refund() { /* onchain transfers cannot be clawed back */ },
  };
}
