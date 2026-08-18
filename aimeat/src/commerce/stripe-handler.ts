/**
 * @file src/commerce/stripe-handler.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Stripe card PaymentHandler: settles a MONEY checkout session on the SELLER's own
 *   Stripe account, using the secret key they brought themselves (`commerce.psp.secretKey` under
 *   their GHII, set from the Wallet tab or `aimeat_commerce_psp_set`). There is NO node-level Stripe
 *   key and no platform/Connect construct: the seller is the merchant of record, Stripe did their
 *   KYC, the charge lands on their account and the node never holds funds.
 *
 *   The operator's platform fee is NOT deducted from the card charge (that would require a Connect
 *   platform between buyer and seller). It is booked as a receivable by the commerce core
 *   (`recordMoneyPlatformFee` → `commerce.platform-fee.{trackingCode}`, mode `receivable`) and
 *   settled out of band.
 *
 *   collect confirms a PaymentIntent with the buyer's payment-method token; payout writes the
 *   seller's payable book entry for the receipt (the money already sits on their Stripe balance);
 *   refund reverses the intent. Amounts are 6-decimal micro-units everywhere and convert to Stripe
 *   minor units ONLY here, at the settlement rail, through the money chokepoint.
 * @structure STRIPE_HANDLER_ID · stripePaymentHandler · stripeApi (module-local)
 * @usage registerPaymentHandler(stripePaymentHandler());
 * @version-history
 *   v1.1.0 — 2026-08-06 — Hold rail (TINKI phase 1): authorize = manual-capture PaymentIntent
 *     (requires_capture), capture up to the held amount, release = cancel. The uncaptured intent
 *     is the escrow — funds guaranteed, settled onto the seller only at capture.
 *   v1.0.0 — 2026-07-28 — Promoted into core from the removed ee/ module, stripped of the Connect
 *     platform path: every seller charges on their own credentials (single edition, no fork).
 */
import type { PaymentHandler } from './types.js';
import { PaymentError } from './payment-handlers.js';
import { bookPayable } from './payable-book.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';
import { MONEY_CURRENCIES, microsToStripeMinor } from './money.js';

/** Reverse-DNS id advertised in the /.well-known/ucp payment_handlers list. */
export const STRIPE_HANDLER_ID = 'com.stripe.spt';

/** The seller's own Stripe secret, or a 403 naming the fix. Never logged, never returned. */
function sellerKey(seller: { psp?: unknown } | undefined): string {
  const psp = seller?.psp as { secretKey?: unknown } | undefined;
  const key = psp?.secretKey;
  if (typeof key !== 'string' || !key) {
    throw new PaymentError(
      'PSP_NOT_CONFIGURED', 403,
      'The seller has no Stripe credentials — set them in the Wallet tab (Selling & payments) or with aimeat_commerce_psp_set',
    );
  }
  return key;
}

/**
 * One raw Stripe REST call through safeFetch (Rule 10: all non-constant outbound HTTP). Params are
 * form-encoded, bracket notation included. Stripe's own 4xx becomes a 422 the buyer can act on; an
 * auth failure or 5xx becomes a 502, because it is the seller's or Stripe's problem, not the call's.
 */
async function stripeApi(
  key: string, method: string, path: string, params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  const res = await safeFetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers,
    body: params ? new URLSearchParams(params).toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  // Read the body as TEXT first: Stripe answers JSON, but a proxy or an outage answers HTML, and
  // swallowing that into an empty object would report "Stripe failed" with no reason at all.
  const raw = await res.text();
  let body: { error?: { message?: string } } | null = null;
  try {
    body = JSON.parse(raw) as { error?: { message?: string } };
  } catch (parseErr) {
    if (res.ok) {
      throw new PaymentError('PSP_ERROR', 502,
        `Stripe ${path} returned a non-JSON body (${res.status}): ${raw.slice(0, 200)}`);
    }
    logger.error(`[stripe] non-JSON error body from ${path} (${res.status}): ${raw.slice(0, 200)} — ${String(parseErr)}`);
  }
  if (!res.ok) {
    const status = res.status === 401 ? 502 : (res.status >= 400 && res.status < 500 ? 422 : 502);
    throw new PaymentError('PSP_ERROR', status, body?.error?.message ?? `Stripe ${path} failed (${res.status})`);
  }
  return body as unknown as Record<string, unknown>;
}

/**
 * The Stripe handler. Always registered — it carries no node-level credential, so a node without
 * any selling owner simply never reaches a charge. A seller who has not set a key gets
 * PSP_NOT_CONFIGURED at collect, which names exactly what to do.
 */
export function stripePaymentHandler(): PaymentHandler {
  return {
    id: STRIPE_HANDLER_ID,
    title: 'Card payment on the seller\'s own Stripe account',
    currencies: [...MONEY_CURRENCIES],

    async collect(_ctx, { amount, currency, reference, instrument, seller }) {
      if (typeof instrument !== 'string' || !instrument) {
        throw new PaymentError(
          'PAYMENT_INSTRUMENT_REQUIRED', 402,
          'Provide payment.instrument: a Stripe PaymentMethod id (e.g. a test-mode pm_… token)',
        );
      }
      // Micro-units → Stripe minor units happens ONLY here, at the rail.
      const stripeAmount = microsToStripeMinor(amount);
      if (stripeAmount < 1) {
        throw new PaymentError('AMOUNT_TOO_SMALL', 422, 'Card charge below one minor unit — aggregate sub-cent calls before settling');
      }
      const intent = await stripeApi(sellerKey(seller), 'POST', 'payment_intents', {
        amount: String(stripeAmount),
        currency: currency.toLowerCase(),
        payment_method: instrument,
        confirm: 'true',
        // The buyer is present at checkout, so disallow redirect-based methods: a card token
        // confirms synchronously to `succeeded` without needing a return_url.
        'automatic_payment_methods[enabled]': 'true',
        'automatic_payment_methods[allow_redirects]': 'never',
        description: `AIMEAT checkout ${reference}`,
      });
      if (intent.status !== 'succeeded') {
        throw new PaymentError('PAYMENT_NOT_CAPTURED', 402, `Stripe payment intent status: ${String(intent.status)}`);
      }
      return { trackingCode: String(intent.id) };
    },

    async payout(ctx, { toGhii, amount, currency, trackingCode, reference }) {
      // No custody: the charge already landed on the seller's own Stripe balance. This is the book
      // entry the receipt reads, not a movement of money.
      await bookPayable(ctx, toGhii, trackingCode, {
        amount, currency, reference, method: 'stripe', status: 'settled',
      });
    },

    async refund(_ctx, { amount, trackingCode, seller }) {
      try {
        await stripeApi(sellerKey(seller), 'POST', 'refunds', {
          payment_intent: trackingCode,
          amount: String(microsToStripeMinor(amount)),
        });
      } catch (err) {
        // Contract: refund must not throw. A failed reversal is an operator problem, not a second
        // failure on top of the fulfillment one that triggered it.
        logger.error(`[stripe] refund failed for ${trackingCode}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    // ── Hold rail: authorize (manual capture) → capture | release ──
    // The uncaptured PaymentIntent IS the escrow: money is guaranteed on the buyer's card but
    // lands on the seller's account only at capture. Stripe expires uncaptured card intents
    // after ~7 days — the hold book keeps its own expiry safely inside that.

    async authorize(_ctx, { amount, currency, reference, instrument, seller }) {
      if (typeof instrument !== 'string' || !instrument) {
        throw new PaymentError(
          'PAYMENT_INSTRUMENT_REQUIRED', 402,
          'Provide payment.instrument: a Stripe PaymentMethod id (e.g. a test-mode pm_… token) or a shared payment token (spt_…)',
        );
      }
      const stripeAmount = microsToStripeMinor(amount);
      if (stripeAmount < 1) {
        throw new PaymentError('AMOUNT_TOO_SMALL', 422, 'Hold below one minor unit');
      }
      // Two instrument shapes, one rail. A PaymentMethod id (pm_…) is the ordinary card token,
      // tokenized against THIS seller's account. A shared payment token (spt_…) is Stripe's
      // agentic-commerce grant: the buyer's agent grants the seller a scoped, expiring, amount-
      // capped credential, and the seller confirms it as payment_method_data instead. SPTs are
      // a preview feature limited to US/CA sellers, so this branch is untested from the EU —
      // it is here so an agent that HAS one is not turned away by a parameter name.
      const isSpt = instrument.startsWith('spt_');
      const intent = await stripeApi(sellerKey(seller), 'POST', 'payment_intents', {
        amount: String(stripeAmount),
        currency: currency.toLowerCase(),
        ...(isSpt
          ? { 'payment_method_data[shared_payment_granted_token]': instrument }
          : { payment_method: instrument }),
        confirm: 'true',
        'capture_method': 'manual',
        'automatic_payment_methods[enabled]': 'true',
        'automatic_payment_methods[allow_redirects]': 'never',
        description: `AIMEAT hold ${reference}`,
      });
      if (intent.status !== 'requires_capture') {
        throw new PaymentError('HOLD_NOT_PLACED', 402, `Stripe payment intent status: ${String(intent.status)}`);
      }
      return { trackingCode: String(intent.id) };
    },

    async capture(_ctx, { amount, trackingCode, seller }) {
      const captured = await stripeApi(sellerKey(seller), 'POST', `payment_intents/${trackingCode}/capture`, {
        amount_to_capture: String(microsToStripeMinor(amount)),
      });
      if (captured.status !== 'succeeded') {
        throw new PaymentError('CAPTURE_FAILED', 402, `Stripe capture status: ${String(captured.status)}`);
      }
    },

    async release(_ctx, { trackingCode, seller }) {
      await stripeApi(sellerKey(seller), 'POST', `payment_intents/${trackingCode}/cancel`, {
        cancellation_reason: 'requested_by_customer',
      });
    },
  };
}
