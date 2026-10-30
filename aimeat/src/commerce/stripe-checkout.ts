/**
 * @file src/commerce/stripe-checkout.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A card payment a PERSON makes: Stripe's own hosted Checkout page, on the SELLER's
 *   Stripe account, for one AIMEAT checkout session.
 *
 *   The node's other card handler (commerce/stripe-handler.ts, `com.stripe.spt`) charges a payment
 *   method id or a shared payment token the caller already holds. That suits an agent and a
 *   platform; a person in a browser holds neither, and nothing on the node let them type a card in,
 *   so a reader could not buy an episode by card (Comicland v3, KAU-07). Two steps, and the card
 *   never touches the node:
 *     1. openStripeCheckout(): a Stripe Checkout Session for exactly the session's total, with the
 *        AIMEAT session id in its metadata, and the address to send the person to.
 *     2. Completion with handler `com.stripe.checkout` and the Stripe session id as the instrument:
 *        collect() reads that session back from Stripe and takes it as payment only when it is paid,
 *        for this AIMEAT session, in this amount and currency. The app completes when the person
 *        returns; the Stripe webhook completes it when they never do (routes/commerce-webhooks.ts).
 *   A credit card records the buyer as a verified adult, as on the direct card path (A-4): at once on
 *   an operator's own Stripe account, and after the buyer's one-press confirmation on another seller's
 *   (commerce/card-adult-ask.ts). A line that renews (auto_renew) keeps the card for the renewals
 *   (setup_future_usage off_session).
 * @structure STRIPE_CHECKOUT_HANDLER_ID · openStripeCheckout · stripeCheckoutHandler
 * @usage
 *   const { url } = await openStripeCheckout(config, session, psp, returnUrl);
 *   registerPaymentHandler(stripeCheckoutHandler(config));
 * @version-history
 *   v1.0.2 — 2026-10-30 — A credit card on a seller's own Stripe account waits for the buyer's
 *     confirmation before the adult check is recorded (secaudit2026oct26 round 8c, commerce-07,
 *     commerce/stripe-checkout-complete:seller-paid-session-records-buyer-adult).
 *   v1.0.1 — 2026-10-25 — A test-mode payment records no adult check (secaudit2026oct22).
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-4, A-5, KAU-07).
 */
import type { PaymentHandler, CheckoutSessionRecord } from './types.js';
import { PaymentError } from './payment-handlers.js';
import { stripePaymentHandler, stripeApi, sellerKey, stripeIdempotencyKey, cardFundingOf, recordCreditCardAdult, isStripeTestMode } from './stripe-handler.js';
import { microsToStripeMinor } from './money.js';

type EncryptionConfig = { encryptionKey: string | null; totpSecretEncryptionKey: string | null };

/** Reverse-DNS id of the hosted card page handler. */
export const STRIPE_CHECKOUT_HANDLER_ID = 'com.stripe.checkout';

/** Whether a line asks for automatic renewal, which keeps the card for later charges. */
function renews(session: CheckoutSessionRecord): boolean {
  return session.items.some(i => (i.input as { auto_renew?: unknown } | undefined)?.auto_renew === true);
}

/** `url` with the query parameters added, keeping what it already had. */
function withParams(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  // Stripe fills {CHECKOUT_SESSION_ID} itself, so its braces must reach Stripe unencoded.
  return u.toString().replace(encodeURIComponent('{CHECKOUT_SESSION_ID}'), '{CHECKOUT_SESSION_ID}');
}

/**
 * Open Stripe's hosted card page for an open money session. `returnUrl` is where the person comes
 * back: with `aimeat_checkout=<id>&stripe_session=<cs id>` after paying, with `cancelled=1` when they
 * gave up. The amount is the session's own total, never a number the caller sends.
 */
export async function openStripeCheckout(
  config: EncryptionConfig & { baseUrl: string },
  session: CheckoutSessionRecord,
  psp: unknown,
  returnUrl: string,
): Promise<{ url: string; stripeSession: string }> {
  if (session.status !== 'open') throw new PaymentError('SESSION_NOT_OPEN', 409, `This checkout is ${session.status}.`);
  if (session.total <= 0) throw new PaymentError('NOTHING_TO_PAY', 409, 'This checkout has nothing to pay by card.');
  const amount = microsToStripeMinor(session.total);
  if (amount < 1) throw new PaymentError('AMOUNT_TOO_SMALL', 422, 'Card charge below one minor unit');
  const key = sellerKey(config, { psp });
  const title = session.items.map(i => i.title).filter(Boolean).join(', ').slice(0, 250) || `AIMEAT checkout ${session.id}`;
  const meta = { aimeat_session: session.id, aimeat_buyer: session.buyerGhii };
  const params: Record<string, string> = {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': session.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': title,
    success_url: withParams(returnUrl, { aimeat_checkout: session.id, stripe_session: '{CHECKOUT_SESSION_ID}' }),
    cancel_url: withParams(returnUrl, { aimeat_checkout: session.id, cancelled: '1' }),
    client_reference_id: session.id,
    'metadata[aimeat_session]': meta.aimeat_session,
    'metadata[aimeat_buyer]': meta.aimeat_buyer,
    'payment_intent_data[metadata][aimeat_session]': meta.aimeat_session,
    'payment_intent_data[description]': `AIMEAT checkout ${session.id}`,
    // Stripe's own session expiry is at least 30 minutes; the AIMEAT session's is what counts.
    expires_at: String(Math.max(Math.floor(Date.now() / 1000) + 1800, Math.floor(new Date(session.expiresAt).getTime() / 1000))),
    ...(renews(session) ? { customer_creation: 'always', 'payment_intent_data[setup_future_usage]': 'off_session' } : {}),
  };
  const cs = await stripeApi(key, 'POST', 'checkout/sessions', params, undefined, stripeIdempotencyKey('hosted', `${session.id}-${session.updatedAt}`));
  if (typeof cs.url !== 'string' || typeof cs.id !== 'string') {
    throw new PaymentError('PSP_ERROR', 502, 'The card payment provider did not give a payment page. Try again shortly.');
  }
  return { url: cs.url, stripeSession: cs.id };
}

/**
 * The handler that completes a session paid on the hosted page. Refunds, payouts and renewals are the
 * direct card handler's, because the money sits on the same Stripe account in the same shape.
 */
export function stripeCheckoutHandler(config: EncryptionConfig): PaymentHandler {
  const card = stripePaymentHandler(config);
  return {
    ...card,
    id: STRIPE_CHECKOUT_HANDLER_ID,
    title: 'Card payment on Stripe\'s own page, on the seller\'s Stripe account',

    async collect(ctx, { buyerGhii, amount, currency, reference, instrument, seller }) {
      if (typeof instrument !== 'string' || !instrument.startsWith('cs_')) {
        throw new PaymentError('PAYMENT_INSTRUMENT_REQUIRED', 402,
          'Pay on the card page first: POST /v1/commerce/checkout-sessions/{id}/card gives its address, and the person comes back with stripe_session, which completes this checkout.');
      }
      const cs = await stripeApi(sellerKey(config, seller), 'GET',
        `checkout/sessions/${encodeURIComponent(instrument)}?expand[]=payment_intent.latest_charge`);
      const meta = (cs.metadata ?? {}) as Record<string, unknown>;
      // Every fact is read back from Stripe; nothing the caller sent says the session was paid.
      if (meta.aimeat_session !== reference) {
        throw new PaymentError('PAYMENT_MISMATCH', 409, 'That card payment was made for another checkout.');
      }
      if (cs.payment_status !== 'paid') {
        throw new PaymentError('PAYMENT_NOT_CAPTURED', 402, 'The card payment is not finished yet. Finish it on the card page, then try again.');
      }
      if (cs.amount_total !== microsToStripeMinor(amount) || String(cs.currency).toUpperCase() !== currency.toUpperCase()) {
        throw new PaymentError('PAYMENT_MISMATCH', 409, 'The card payment was for a different amount than this checkout. Open the card page again.');
      }
      const intent = (typeof cs.payment_intent === 'object' && cs.payment_intent ? cs.payment_intent : null) as Record<string, unknown> | null;
      const intentId = intent ? String(intent.id) : String(cs.payment_intent ?? '');
      if (!intentId) throw new PaymentError('PSP_ERROR', 502, 'The card payment provider did not say which payment this was.');
      await recordCreditCardAdult(ctx, buyerGhii, cardFundingOf(intent), isStripeTestMode(cs, intent), { seller, checkout: reference, payment: intentId });
      const customer = typeof cs.customer === 'string' ? cs.customer : null;
      const method = intent && typeof intent.payment_method === 'string' ? intent.payment_method : null;
      return { trackingCode: intentId, ...(customer && method ? { saved: { customer, payment_method: method } } : {}) };
    },
  };
}
