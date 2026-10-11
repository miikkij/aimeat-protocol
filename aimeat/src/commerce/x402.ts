/**
 * @file src/commerce/x402.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description x402 payment challenge body (TARGET-033 phase 5, TARGET-042): every 402 response from a
 *   commerce adapter carries an `accepts` array telling the paying agent HOW it could settle. Two
 *   layers live here:
 *   - The AIMEAT-native schemes (`aimeat-checkout`, `aimeat-morsel-topup`) — the registered money
 *     handlers, plus how to get more morsels of pacing (the daily allowance, and the pacing pack the
 *     operator may sell for money) — which an AIMEAT client understands.
 *   - The REAL x402 `exact` scheme (TARGET-042), added for a MONEY session when the x402 handler is
 *     enabled, the session's currency has a settlement asset on the configured network (USD → USDC,
 *     EUR → EURC), and the seller has a payout address: full x402 vocabulary (network, payTo, asset,
 *     maxAmountRequired, extra) so an external x402-compatible agent can sign and pay. It is prepended
 *     (x402 clients pick the first scheme they support) and the native schemes always remain, so the
 *     envelope stays backward compatible.
 * @structure paymentChallenge · x402ExactAccepts
 * @usage
 *   const extra = await x402ExactAccepts(config, storage, session); // [] unless x402 applies
 *   res.status(402).json({ ...error(...), ...paymentChallenge(config, extra) });
 * @version-history
 *   v1.4.0 — 2026-10-11 — The top-up entry names the daily allowance route and, when the operator sells
 *     one, the pacing pack (morsels, money price, checkout_item). No handler settles morsels any more.
 *   v1.3.0 — 2026-10-11 — paymentChallenge takes `moneyOnly` for the ACP and UCP surfaces, which no
 *     longer offer the morsel ledger as a way to pay (ruling D4).
 *   v1.2.0 — 2026-07-25 — The exact scheme is built from the SESSION CURRENCY's settlement asset, so
 *     a EUR session is offered in EURC and a currency with no asset yields no scheme (TARGET-042)
 *   v1.1.0 — 2026-07-18 — Real x402 `exact` scheme via x402ExactAccepts + optional extraAccepts on
 *     paymentChallenge; native schemes preserved (TARGET-042)
 *   v1.0.0 — 2026-07-13 — Initial 402 accepts envelope (TARGET-033 phase 5)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CheckoutSessionRecord } from './types.js';
import { listPaymentHandlers } from './payment-handlers.js';
import { isMoneyCurrency, formatMoneyMajor } from './money.js';
import { pacingPackOffer } from './pacing-pack.js';
import { getX402Network, getX402Asset, buildExactRequirements, extractPayTo } from './x402-facilitator.js';

/**
 * The x402-inspired `accepts` block appended to 402 payment-required responses. `extraAccepts` (the
 * real x402 `exact` scheme from {@link x402ExactAccepts}, when it applies) is prepended so an x402
 * client finds a scheme it can settle first; the AIMEAT-native schemes always follow.
 *
 * `moneyOnly` is for the ACP and UCP surfaces, where a price is money (commerce/protocol-money.ts):
 * only money currencies are listed, and the morsel top-up scheme is not offered.
 */
export function paymentChallenge(
  config: AimeatConfig,
  extraAccepts: Array<Record<string, unknown>> = [],
  opts: { moneyOnly?: boolean } = {},
): { x402Version: number; accepts: Array<Record<string, unknown>> } {
  const b = config.baseUrl;
  const accepts: Array<Record<string, unknown>> = [...extraAccepts];
  for (const h of listPaymentHandlers()) {
    const currencies = opts.moneyOnly ? h.currencies.filter(isMoneyCurrency) : h.currencies;
    if (currencies.length === 0) continue;
    accepts.push({
      scheme: 'aimeat-checkout',
      handler: h.id,
      currencies,
      description: `Complete the checkout session with POST /v1/commerce/checkout-sessions/{id}/complete using payment.handler="${h.id}"`,
      resource: `${b}/v1/commerce/checkout-sessions`,
    });
  }
  if (!opts.moneyOnly) {
    // Morsels pace use; they are not a payment. When a use is refused for want of them, this entry
    // says how to get more: the daily allowance, and the pacing pack when the operator sells one.
    const pack = pacingPackOffer(config);
    accepts.push({
      scheme: 'aimeat-morsel-topup',
      description: pack
        ? `Not enough morsels for the pacing: request the daily allowance (POST /v1/wallet/request), or buy ${pack.morsels} morsels of pacing capacity for ${formatMoneyMajor(pack.price.amount)} ${pack.price.currency} by opening a checkout with checkout_item`
        : 'Not enough morsels for the pacing: request the daily allowance (POST /v1/wallet/request), or ask the operator of this node',
      resource: `${b}/v1/wallet`,
      daily_allowance: { method: 'POST', url: `${b}/v1/wallet/request` },
      ...(pack ? { morsels: pack.morsels, price: pack.price, checkout_item: pack.checkout_item, checkout: `${b}/v1/commerce/checkout-sessions` } : {}),
    });
  }
  return { x402Version: 1, accepts };
}

/**
 * The real x402 `exact` accepts entry (or entries) for a session, or [] when x402 does not apply.
 * Applies only when: the x402 handler is enabled, the session is a MONEY session (not morsels), the
 * configured network is in the registry, THAT NETWORK HAS A SETTLEMENT ASSET FOR THE SESSION'S
 * CURRENCY, and the SELLER has a payout address in their commerce.psp. The stablecoin is a payment
 * method for the session's fiat price (model 2) — a USD session is offered in USDC and a EUR session
 * in EURC, and the session currency is unchanged either way. A currency with no asset yields no
 * exact scheme at all, so a buyer is never handed requirements this node could not settle.
 */
export async function x402ExactAccepts(
  config: AimeatConfig,
  storage: Storage,
  session: CheckoutSessionRecord,
): Promise<Array<Record<string, unknown>>> {
  if (!config.x402Enabled || !isMoneyCurrency(session.currency)) return [];
  const network = getX402Network(config.x402Network);
  const asset = getX402Asset(network, session.currency);
  if (!network || !asset) return [];
  const pspRec = await storage.getMemory(session.sellerGhii, 'commerce.psp');
  const payTo = extractPayTo(pspRec?.value);
  if (!payTo) return [];
  return [buildExactRequirements({
    network, asset, payTo, amountMicros: session.total,
    resource: `${config.baseUrl}/v1/commerce/checkout-sessions/${session.id}`,
    description: `AIMEAT checkout ${session.id}`,
  }) as unknown as Record<string, unknown>];
}
