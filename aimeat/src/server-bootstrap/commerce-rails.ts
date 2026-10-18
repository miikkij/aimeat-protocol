/**
 * @file src/server-bootstrap/commerce-rails.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The money rails and the sellable kinds the checkout knows, registered once per boot.
 *   Moved out of server-bootstrap/routes-loader.ts, unchanged, when that file passed 800 lines.
 * @structure registerCommerceRails(config, peers)
 * @usage await registerCommerceRails(config, peers);   // before the commerce routers mount
 * @version-history
 *   v1.0.0 — 2026-10-18 — Moved from routes-loader.ts (pure extraction), with the two registrations of
 *     the same change: the hosted card page handler and the subscription kind (Comicland v3 A-4, A-5).
 */
import type { AimeatConfig } from '../config.js';
import type { PeerInfo } from '../services/federation.js';
import { registerPaymentHandler, resetPaymentHandlers } from '../commerce/payment-handlers.js';
import { stripePaymentHandler } from '../commerce/stripe-handler.js';
import { stripeCheckoutHandler } from '../commerce/stripe-checkout.js';
import { subscriptionSellableResolver } from '../commerce/subscriptions.js';
import { invoicePaymentHandler } from '../commerce/invoice-handler.js';
import { testMoneyHandlerActive } from '../utils/test-money-guard.js';
import { registerSellableResolver, resetSellableResolvers, offerSellableResolver, appToolSellableResolver, extCallSellableResolver, pacingPackSellableResolver } from '../commerce/sellable-resolvers.js';
import { packageSellableResolver } from '../services/packages/sale/package-sale-checkout.js';

export async function registerCommerceRails(config: AimeatConfig, peers: Map<string, PeerInfo>): Promise<void> {
  resetPaymentHandlers();
  // Money rails. Neither carries a node-level credential: the Stripe handler charges on the
  // seller's own key (commerce.psp) and the invoice handler books an obligation instead of
  // capturing anything, so both are safe to register on every node.
  registerPaymentHandler(stripePaymentHandler(config));
  // The same seller's Stripe account, paid by a person on Stripe's own card page (commerce/stripe-checkout.ts).
  registerPaymentHandler(stripeCheckoutHandler(config));
  registerPaymentHandler(invoicePaymentHandler());
  resetSellableResolvers();
  registerSellableResolver(offerSellableResolver());
  registerSellableResolver(appToolSellableResolver());
  registerSellableResolver(extCallSellableResolver());   // priced raw-call money channel (rm-commercial-raw-calls)
  registerSellableResolver(packageSellableResolver(peers));   // a package this node sells, priced from its catalogue
  registerSellableResolver(pacingPackSellableResolver());   // pacing capacity the operator sells for money
  registerSellableResolver(subscriptionSellableResolver());   // one period of an extension's plan (commerce/subscriptions.ts)
  // A fake EUR/USD rail with no real PSP, on any node while the flag is on; a public node warns (utils/test-money-guard.ts).
  if (testMoneyHandlerActive(config)) registerPaymentHandler((await import('../commerce/test-money-handler.js')).testMoneyPaymentHandler());
  // x402 stablecoin settlement (TARGET-042): the NON-CUSTODIAL USDC handler for money (USD) sessions.
  // The facilitator is a parameter — an off-chain double in E2E (AIMEAT_X402_TEST_FACILITATOR), the
  // real safeFetch client against config.x402FacilitatorUrl in prod. OFF unless AIMEAT_X402_ENABLED.
  if (config.x402Enabled) {
    const { x402PaymentHandler } = await import('../commerce/x402-handler.js');
    const { httpFacilitator, testFacilitator } = await import('../commerce/x402-facilitator.js');
    registerPaymentHandler(x402PaymentHandler(
      config, config.x402TestFacilitator ? testFacilitator() : httpFacilitator(config.x402FacilitatorUrl),
    ));
  }
}
