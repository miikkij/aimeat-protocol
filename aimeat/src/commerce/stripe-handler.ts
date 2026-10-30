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
 * @structure STRIPE_HANDLER_ID · stripeIdempotencyKey · stripePaymentHandler · stripeApi (module-local)
 * @usage registerPaymentHandler(stripePaymentHandler(config));
 * @version-history
 *   2026-10-30 — A credit card payment on a seller's own Stripe account, which only that seller
 *     attests, no longer records the buyer as an adult by itself: the buyer confirms it with one press
 *     (recordCreditCardAdult → commerce/card-adult-ask.ts). A payment on an operator's own account
 *     records it at once, as before (secaudit2026oct26 round 8c, commerce-07,
 *     commerce/stripe-checkout-complete:seller-paid-session-records-buyer-adult).
 *   2026-10-25 — collect puts `attempt` into the charge's Idempotency-Key, so a retry after a refunded
 *     attempt is a new charge (secaudit2026oct22).
 *   2026-10-25 — A test-mode payment (livemode false) records no adult check (isStripeTestMode;
 *     secaudit2026oct22).
 *   2026-10-18 — collect reads the paying card's funding type (expand latest_charge), and a credit card
 *     records the buyer as a verified adult (recordCreditCardAdult; Comicland v3 A-4). stripeApi and
 *     sellerKey are exported for the hosted Checkout handler (commerce/stripe-checkout.ts).
 *   2026-10-16 — refund answers `refunded` or `failed` instead of nothing, so a failed reversal is no
 *     longer reported to the buyer as a refund (QA audit F5-01).
 *   2026-10-16 — Every charge Stripe could make twice carries an Idempotency-Key (stripeIdempotencyKey):
 *     the checkout and its customer, the renewal of a period, the hold (QA audit S8-04).
 *   v1.5.0 — 2026-10-09 — Stripe's error text goes to the log, redacted, and the buyer gets a plain
 *     sentence; only a card_error, which Stripe writes for the cardholder, passes (secrets audit d5).
 *   v1.4.0 — 2026-10-08 — collect charges a shared payment token (spt_…) as payment_method_data
 *     under Stripe-Version 2026-09-30.preview, for the UCP guest checkout. Not run against Stripe
 *     itself here: a test-mode SPT needs a seller's Stripe account with agentic commerce on.
 *   v1.3.0 — 2026-10-02 — collect with saveForLater keeps the card at Stripe on the seller's account (a
 *     customer and setup_future_usage off_session) and returns its ids; chargeSaved charges it for an
 *     automatic renewal, off_session. Not yet run against Stripe itself: the E2E uses the test handler.
 *   v1.2.1 — 2026-10-01 — The missing-credentials message names only the Wallet tab: the MCP tool is screen-only now.
 *   v1.2.0 — 2026-09-16 — Takes the node config and opens the sealed Stripe key (commerce/psp-secrets.ts).
 *   v1.1.0 — 2026-08-06 — Hold rail (TINKI phase 1): authorize = manual-capture PaymentIntent
 *     (requires_capture), capture up to the held amount, release = cancel. The uncaptured intent
 *     is the escrow — funds guaranteed, settled onto the seller only at capture.
 *   v1.0.0 — 2026-07-28 — Promoted into core from the removed ee/ module, stripped of the Connect
 *     platform path: every seller charges on their own credentials (single edition, no fork).
 */
import { createHash } from 'node:crypto';
import type { PaymentHandler, PaymentContext } from './types.js';
import { sellerIsOperator, askBuyerCardAdult, type CardPaymentFacts } from './card-adult-ask.js';
import { openPspSecret } from './psp-secrets.js';
import { PaymentError } from './payment-handlers.js';
import { bookPayable } from './payable-book.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';
import { redactKeyShaped } from '../utils/redact-credentials.js';
import { MONEY_CURRENCIES, microsToStripeMinor } from './money.js';
import { recordAdult } from '../services/adult-assurance.js';
import { ownerGhiiOf } from '../utils/gaii.js';

type EncryptionConfig = { encryptionKey: string | null; totpSecretEncryptionKey: string | null };

/** Reverse-DNS id advertised in the /.well-known/ucp payment_handlers list. */
export const STRIPE_HANDLER_ID = 'com.stripe.spt';
/** The version a shared payment token is charged under (docs.stripe.com shared-payment-tokens, read 2026-10-08). */
export const SPT_STRIPE_VERSION = '2026-09-30.preview';

/** The seller's own Stripe secret, or a 403 naming the fix. Never logged, never returned. The stored
 *  value is sealed (commerce/psp-secrets.ts) and opened here, at the one call that sends it. */
export function sellerKey(config: EncryptionConfig, seller: { psp?: unknown } | undefined): string {
  const psp = seller?.psp as { secretKey?: unknown } | undefined;
  const key = openPspSecret(config, psp?.secretKey);
  if (!key) {
    throw new PaymentError(
      'PSP_NOT_CONFIGURED', 403,
      'The seller has no Stripe credentials — the seller sets them in the Wallet tab (Selling & payments), signed in themselves',
    );
  }
  return key;
}

/** What the buyer reads when Stripe refuses for a reason on the seller's side or Stripe's own. */
const STRIPE_SELLER_SIDE = 'The card payment could not be made, because the seller\'s payment setup did not accept it. Try again later, or ask the seller.';
/** What the buyer reads when Stripe refuses this request and the reason is not one written for the buyer. */
const STRIPE_REFUSED = 'The card payment provider refused this payment. Check the card details, or try another card.';
/** What the buyer reads when Stripe's answer could not be read. */
const STRIPE_UNREADABLE = 'The card payment provider gave an answer the node could not read. Try again shortly.';

/**
 * One raw Stripe REST call through safeFetch (Rule 10: all non-constant outbound HTTP). Params are
 * form-encoded, bracket notation included. Stripe's own 4xx becomes a 422 the buyer can act on; an
 * auth failure or 5xx becomes a 502, because it is the seller's or Stripe's problem, not the call's.
 */
export async function stripeApi(
  key: string, method: string, path: string, params?: Record<string, string>, version?: string, idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (version) headers['Stripe-Version'] = version;
  // Stripe answers a repeated key with the first request's result instead of acting twice, so a
  // retry after a timeout, or a second completion of the same checkout, charges once (QA audit S8-04).
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await safeFetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers,
    body: params ? new URLSearchParams(params).toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  // Read the body as TEXT first: Stripe answers JSON, but a proxy or an outage answers HTML, and
  // swallowing that into an empty object would report "Stripe failed" with no reason at all.
  const raw = await res.text();
  let body: { error?: { message?: string; type?: string; code?: string } } | null = null;
  try {
    body = JSON.parse(raw) as { error?: { message?: string; type?: string; code?: string } };
  } catch (parseErr) {
    logger.error(`[stripe] non-JSON body from ${path} (${res.status}): ${redactKeyShaped(raw.slice(0, 200))} — ${String(parseErr)}`);
    if (res.ok) throw new PaymentError('PSP_ERROR', 502, STRIPE_UNREADABLE);
  }
  if (!res.ok) {
    const status = res.status === 401 ? 502 : (res.status >= 400 && res.status < 500 ? 422 : 502);
    const err = body?.error;
    // Stripe's text for anything but a card refusal describes the SELLER's account and key
    // ("Invalid API Key provided: sk_live_****abcd"), and the buyer is the one reading this
    // answer. It goes to the log; the buyer gets a sentence. A card_error is the one kind Stripe
    // writes for the cardholder ("Your card was declined."), so it passes, redacted.
    logger.warn(`[stripe] ${path} answered ${res.status}`, { type: err?.type, code: err?.code, reason: redactKeyShaped(err?.message ?? '') });
    if (err?.type === 'card_error' && err.message) {
      throw new PaymentError('PSP_ERROR', status, redactKeyShaped(err.message));
    }
    throw new PaymentError('PSP_ERROR', status, status === 502 ? STRIPE_SELLER_SIDE : STRIPE_REFUSED);
  }
  return body as unknown as Record<string, unknown>;
}

/**
 * The Idempotency-Key of one charge: what it is for (`checkout`, `renewal`, `hold`), the node's own
 * reference for it, and, where the buyer supplies the card, a digest of that card token. The same
 * checkout paid with the same card gets the same key, so it is charged once however often the
 * request arrives; another card is a new attempt, so a declined card does not block a second one.
 */
/**
 * The funding type of the card that paid a PaymentIntent (`credit`, `debit`, `prepaid`, `unknown`),
 * from its expanded `latest_charge`; null when the intent was not expanded or no card paid.
 */
export function cardFundingOf(intent: Record<string, unknown> | null | undefined): string | null {
  const charge = intent?.latest_charge as { payment_method_details?: { card?: { funding?: unknown } } } | string | null | undefined;
  const funding = typeof charge === 'object' && charge ? charge.payment_method_details?.card?.funding : undefined;
  return typeof funding === 'string' ? funding : null;
}

/**
 * Whether Stripe says a payment was made in test mode: the intent, its expanded latest_charge or the
 * Checkout Session carries `livemode: false`. Only an explicit false counts, so an answer that leaves
 * the field out is read as live (secaudit2026oct22).
 */
export function isStripeTestMode(...objects: Array<Record<string, unknown> | null | undefined>): boolean {
  for (const o of objects) {
    if (!o || typeof o !== 'object') continue;
    if (o.livemode === false) return true;
    const charge = o.latest_charge;
    if (charge && typeof charge === 'object' && (charge as Record<string, unknown>).livemode === false) return true;
  }
  return false;
}

/**
 * A CREDIT card payment shows the buyer is an adult (Jouni's ruling, Comicland v3 A-4); a debit or a
 * prepaid card does not, because a minor can hold one. A test-mode payment does not either: no real
 * card and no card holder took part (secaudit2026oct22). On an operator's own Stripe account it is
 * recorded at once; on another seller's account, which only that seller attests, the buyer confirms it
 * with one press first (commerce/card-adult-ask.ts; secaudit2026oct26 round 8c, commerce-07). Never
 * fails the payment it follows: the money has moved, and a bookkeeping failure is logged.
 */
export async function recordCreditCardAdult(
  ctx: PaymentContext, buyerGhii: string, funding: string | null, testMode: boolean, paid: CardPaymentFacts,
): Promise<void> {
  if (funding !== 'credit' || testMode) return;
  try {
    if (await sellerIsOperator(ctx.storage, paid.seller)) await recordAdult(ctx.storage, ownerGhiiOf(buyerGhii), 'credit-card');
    else await askBuyerCardAdult(ctx, buyerGhii, paid);
  } catch (err) {
    logger.error('[stripe] the credit card payment was not recorded as an adult check', { buyer: buyerGhii, error: String(err) });
  }
}

export function stripeIdempotencyKey(kind: string, reference: string, instrument?: string): string {
  const card = instrument ? `-${createHash('sha256').update(instrument).digest('hex').slice(0, 16)}` : '';
  return `aimeat-${kind}-${reference}${card}`.slice(0, 255);
}

/**
 * The Stripe handler. Always registered — it carries no node-level credential, so a node without
 * any selling owner simply never reaches a charge. A seller who has not set a key gets
 * PSP_NOT_CONFIGURED at collect, which names exactly what to do.
 */
export function stripePaymentHandler(config: EncryptionConfig): PaymentHandler {
  return {
    id: STRIPE_HANDLER_ID,
    title: 'Card payment on the seller\'s own Stripe account',
    currencies: [...MONEY_CURRENCIES],

    async collect(ctx, { buyerGhii, amount, currency, reference, instrument, seller, saveForLater, attempt }) {
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
      const key = sellerKey(config, seller);
      // Automatic renewal: the card is kept at Stripe for charges without the buyer present, on the
      // seller's own account. Stripe needs a customer to attach it to, and setup_future_usage tells the
      // bank at this first charge, with the buyer present, that later ones will come.
      // A retry after a refunded attempt is a new charge: Stripe answers a repeated key with the first
      // (refunded) intent. A retry after a timeout keeps the key and gets the first charge's result.
      const chargeKey = stripeIdempotencyKey('checkout', attempt ? `${reference}-r${attempt}` : reference, instrument);
      const customer = saveForLater
        ? String((await stripeApi(key, 'POST', 'customers', { description: `AIMEAT buyer, checkout ${reference}` }, undefined, `${chargeKey}-customer`)).id)
        : null;
      // A shared payment token (spt_…) is an AI platform's grant for this one charge (the UCP guest
      // checkout, commerce/ucp-guest-checkout.ts): Stripe takes it as payment_method_data, under the
      // preview version its agentic commerce guide names, and clones the buyer's card from it.
      const isSpt = instrument.startsWith('spt_');
      const intent = await stripeApi(key, 'POST', 'payment_intents', {
        amount: String(stripeAmount),
        currency: currency.toLowerCase(),
        ...(isSpt ? { 'payment_method_data[shared_payment_granted_token]': instrument } : { payment_method: instrument }),
        confirm: 'true',
        // The buyer is present at checkout, so disallow redirect-based methods: a card token
        // confirms synchronously to `succeeded` without needing a return_url. A shared payment
        // token is sent the way Stripe's own example sends it, with nothing beside it.
        ...(isSpt ? {} : {
          'automatic_payment_methods[enabled]': 'true',
          'automatic_payment_methods[allow_redirects]': 'never',
        }),
        description: `AIMEAT checkout ${reference}`,
        ...(customer ? { customer, setup_future_usage: 'off_session' } : {}),
        // The charge comes back with the card's funding type, which a credit card's adult check reads.
        'expand[]': 'latest_charge',
      }, isSpt ? SPT_STRIPE_VERSION : undefined, chargeKey);
      if (intent.status !== 'succeeded') {
        throw new PaymentError('PAYMENT_NOT_CAPTURED', 402, `Stripe payment intent status: ${String(intent.status)}`);
      }
      await recordCreditCardAdult(ctx, buyerGhii, cardFundingOf(intent), isStripeTestMode(intent), { seller, checkout: reference, payment: String(intent.id) });
      return { trackingCode: String(intent.id), ...(customer ? { saved: { customer, payment_method: instrument } } : {}) };
    },

    // An automatic renewal: the card saved at the first payment, charged with the buyer not present.
    // A card that needs the buyer to confirm (requires_action) is a failure here: the owner is told and
    // renews by hand, which is the rule for any failed renewal.
    async chargeSaved(_ctx, { amount, currency, reference, saved, seller }) {
      if (!saved.customer || !saved.payment_method) {
        throw new PaymentError('NO_SAVED_PAYMENT', 402, 'No card was kept for this renewal.');
      }
      const stripeAmount = microsToStripeMinor(amount);
      if (stripeAmount < 1) throw new PaymentError('AMOUNT_TOO_SMALL', 422, 'Card charge below one minor unit');
      const intent = await stripeApi(sellerKey(config, seller), 'POST', 'payment_intents', {
        amount: String(stripeAmount),
        currency: currency.toLowerCase(),
        customer: saved.customer,
        payment_method: saved.payment_method,
        off_session: 'true',
        confirm: 'true',
        description: `AIMEAT renewal ${reference}`,
        // The renewal's reference names the period, so the daily job that retries a charge Stripe
        // accepted but the node timed out on gets the first charge back instead of a second one.
      }, undefined, stripeIdempotencyKey('renewal', reference));
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
        await stripeApi(sellerKey(config, seller), 'POST', 'refunds', {
          payment_intent: trackingCode,
          amount: String(microsToStripeMinor(amount)),
        });
        return { outcome: 'refunded' };
      } catch (err) {
        // Contract: refund must not throw. It answers `failed`, and the session service stores the
        // undelivered payment, tells the operator and tells the buyer the money was not returned.
        const reason = err instanceof Error ? err.message : String(err);
        logger.error(`[stripe] refund failed for ${trackingCode}: ${reason}`);
        return { outcome: 'failed', detail: `Stripe refused or did not answer the refund: ${reason}`.slice(0, 300) };
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
      const intent = await stripeApi(sellerKey(config, seller), 'POST', 'payment_intents', {
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
      }, undefined, stripeIdempotencyKey('hold', reference, instrument));
      if (intent.status !== 'requires_capture') {
        throw new PaymentError('HOLD_NOT_PLACED', 402, `Stripe payment intent status: ${String(intent.status)}`);
      }
      return { trackingCode: String(intent.id) };
    },

    async capture(_ctx, { amount, trackingCode, seller }) {
      const captured = await stripeApi(sellerKey(config, seller), 'POST', `payment_intents/${trackingCode}/capture`, {
        amount_to_capture: String(microsToStripeMinor(amount)),
      });
      if (captured.status !== 'succeeded') {
        throw new PaymentError('CAPTURE_FAILED', 402, `Stripe capture status: ${String(captured.status)}`);
      }
    },

    async release(_ctx, { trackingCode, seller }) {
      await stripeApi(sellerKey(config, seller), 'POST', `payment_intents/${trackingCode}/cancel`, {
        cancellation_reason: 'requested_by_customer',
      });
    },
  };
}
