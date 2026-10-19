/**
 * @file commerce/index.js
 * @description The aimeat-commerce library (SDK-libs migration Phase 2, TARGET-033/034). Exposes
 *   AIMEAT.commerce — checkout sessions over /v1/commerce/*, offer price reading, money formatting in
 *   6-decimal micro-units, the x402-style 402 `accepts` surface, and the app-tool convention (manifest
 *   read + one-call buy). Authenticated calls go through the AIMEAT.auth session; feed/getAppTools are
 *   public. Componentized ESM source esbuild bundles to the IIFE served, unchanged, at
 *   /v1/libs/aimeat-commerce.js. Ported verbatim from lib-commerce.ts. SECURITY: carries NO secrets —
 *   seller PSP credentials are server-side only; NODE_URL is the apex base (APEX_URL from _core/config).
 * @structure imports APEX_URL (config) + authFetch (session) + attach (namespace); commerceError/
 *   normalizeItems; money helpers; checkout lifecycle; offer discovery; app-tools; attach('commerce', …).
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-commerce.js"></script>
 *   const s = await AIMEAT.commerce.buyOffer('vendor#alice@node', 'translate-doc');
 * @version-history
 *   v1.4.1 — 2026-10-19 — feed() goes through _core/public-fetch.js (signed-in-only node).
 *   v1.4.0 — 2026-10-18 — payByCard(id) and finishCardPayment(): a person pays by card on Stripe's own
 *     page, on the seller's Stripe account, and the return page completes the checkout (Comicland v3 A-4).
 *     subscribe(ext, plan), subscriptions(), cancelSubscription(ext, plan) (A-5).
 *   v1.3.0 — 2026-10-11 — A morsel is pacing, never a price (decision-morseli-on-tahdistus-ei-hinta-
 *     tarjouksen-kaksi-arvoa): priceOf reads money only (priceMoney, pricesMoney) and returns null for
 *     'morsel'; pacingOf reads tollMorsels first and the old morsel price fields after; fmtPacing,
 *     fmtSession, pacingPack and buyPacingPack are new; fmtAmount shows a 'morsel' amount as pacing.
 *   v1.2.0 — 2026-10-08 — openCheckout sends `attribution` (the page's referrer and utm_source)
 *     unless the browser asks not to be followed, so the seller sees which channel a purchase came
 *     from (AI visibility). The node keeps only the channel.
 *   v1.1.0 — 2026-09-13 — parseAmount(), the one amount parser, and microsFromInput built on it. The
 *     old one-liner replaced only the first comma, so '1,500.00' became 1.5 EUR; an ambiguous amount
 *     ('1,000') now returns null so the app asks again (appdev pitfall
 *     amount-parser-reads-thousands-separator-as-decimal).
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-commerce.ts (SDK-libs migration Phase 2).
 */
import { APEX_URL } from '../_core/config.js';
import { publicFetch } from '../_core/public-fetch.js';
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-commerce.js');
import { attach } from '../_core/namespace.js';
import { parseAmount } from './amount.js';

const NODE_URL = APEX_URL;

/** Micros per whole currency unit — money amounts are 6-decimal micro-units (matches USDC/x402). */
const MONEY_UNIT = 1000000;

/**
 * Where this page was opened from, for the seller's AI visibility report: the Referer and
 * `utm_source` of the page load. The node turns them into a channel (ai, search, social, ...) and
 * keeps nothing else. Null when the browser asks not to be followed (Global Privacy Control or Do
 * Not Track), and then the purchase counts under no channel.
 */
function pageAttribution() {
  try {
    const nav = /** @type {Navigator & { globalPrivacyControl?: boolean }} */ (navigator);
    if (nav.globalPrivacyControl === true || nav.doNotTrack === '1') return null;
    const referrer = document.referrer || null;
    const utm = new URLSearchParams(location.search).get('utm_source');
    if (!referrer && !utm) return null;
    return { referrer: referrer ? referrer.slice(0, 2048) : null, utm_source: utm ? utm.slice(0, 100) : null };
  } catch {
    // A page without a DOM (a worker, a test harness) has nothing to attribute.
    return null;
  }
}

/** Build an Error from a failed envelope; 402 responses carry the x402-style accepts block. */
function commerceError(res, fallback) {
  const e = /** @type {Error & { code?: string, paymentRequired?: boolean, accepts?: unknown, x402Version?: unknown }} */ (new Error((res.error && res.error.message) || fallback));
  e.code = res.error && res.error.code;
  if (res.accepts) {
    e.paymentRequired = true;
    e.accepts = res.accepts;         // [{ scheme, handler, currencies, description, resource }]
    e.x402Version = res.x402Version;
  }
  return e;
}

/** Normalize line items: accept offerId or offer_id, default kind 'offer', quantity 1. */
function normalizeItems(items) {
  const arr = Array.isArray(items) ? items : [items];
  return arr.map(function (i) {
    const out = /** @type {Record<string, any>} */ ({ offer_id: i.offer_id || i.offerId });
    if (i.kind) out.kind = i.kind;
    if (i.agent) out.agent = i.agent;
    if (i.org) out.org = i.org;
    if (i.app) out.app = i.app;      // app-tool items (TARGET-034)
    if (i.tool) out.tool = i.tool;
    if (i.input) out.input = i.input; // app-tool: buyer input for the capability invoke
    if (i.quantity) out.quantity = i.quantity;
    return out;
  });
}

const commerce = {
  MONEY_UNIT: MONEY_UNIT,

  // ── Money formatting (same convention as the portal's utils.js fmtMoney) ──

  /** Format money micro-units as "1.50 EUR" / "0.002 USD" (≥2 decimals, up to 6 when sub-cent). */
  fmtMoney(micros, currency) {
    const s = ((Number(micros) || 0) / MONEY_UNIT).toFixed(6).replace(/(\.\d{2}\d*?)0+$/, '$1');
    return currency ? s + ' ' + currency : s;
  },

  /**
   * Format a pacing amount: "pacing 5 morsels" / "pacing 1 morsel". A morsel paces use and is never
   * a price, so this is never shown as a cost.
   * @param {unknown} n
   * @returns {string}
   */
  fmtPacing(n) {
    const v = Math.max(0, Math.trunc(Number(n) || 0));
    return 'pacing ' + v + (v === 1 ? ' morsel' : ' morsels');
  },

  /**
   * Format a session or offer amount. Money is micro-units in a currency. A currency of 'morsel'
   * (or none) comes only from a session stored before 4.x and is shown as pacing, never as a price.
   */
  fmtAmount(amount, currency) {
    if (!currency || currency === 'morsel' || currency === 'MORSEL') {
      return commerce.fmtPacing(amount);
    }
    return commerce.fmtMoney(amount, currency);
  },

  /**
   * A checkout session's two values in one line: "1.50 EUR · pacing 5 morsels", "free · pacing 5
   * morsels", or "free". Reads `total` + `currency` (money) and `pacingMorsels`.
   * @param {{ total?: number, currency?: string, pacingMorsels?: number } | null | undefined} session
   * @returns {string}
   */
  fmtSession(session) {
    if (!session) return '';
    const s = /** @type {{ total?: number, currency?: string, pacingMorsels?: number }} */ (session);
    // A session stored before 4.x in currency 'morsel' carried its pacing in `total`.
    const legacy = s.currency === 'morsel' || s.currency === 'MORSEL';
    const pacing = legacy ? Number(s.total) || 0 : Number(s.pacingMorsels) || 0;
    const money = !legacy && Number(s.total) > 0 ? commerce.fmtMoney(s.total, s.currency) : 'free';
    return pacing > 0 ? money + ' · ' + commerce.fmtPacing(pacing) : money;
  },

  /**
   * Parse an amount in any common notation into a number, or null. '12,000.00' → 12000,
   * '1.234,56' → 1234.56, '0,002' → 0.002. An AMBIGUOUS amount returns null: '1,000' and '1.000'
   * are a thousand apart under the two conventions, so the app asks the person again instead of
   * guessing. Full rules in ./amount.js.
   * @param {unknown} input
   * @returns {number|null}
   */
  parseAmount: parseAmount,

  /**
   * Parse a major-unit input ("1.50", "0,002", "1,500.00") into integer money micro-units.
   * Null when the amount is not positive, cannot be read, or is ambiguous ("1,000"): see parseAmount.
   * @param {unknown} str
   * @returns {number|null}
   */
  microsFromInput(str) {
    const n = parseAmount(str);
    if (n === null || !(n > 0)) return null;
    return Math.round(n * MONEY_UNIT);
  },

  // ── Offer discovery + price reading ──

  /** Public product feed: every PUBLIC agent offer on the node with a money price (no login needed). */
  async feed() {
    const r = await publicFetch(NODE_URL + '/v1/commerce/feed');
    const res = await r.json();
    if (res.error) throw commerceError(res, 'Failed to read the commerce feed');
    return res; // { products: [{ id: "offer:<agentGaii>:<offerId>", title, price, seller }], total }
  },

  /** Read one offer (with priceMoney and tollMorsels) from an agent's published offers. */
  async getOffer(agent, offerId) {
    const res = await authFetch('/v1/agents/' + encodeURIComponent(agent) + '/offers');
    if (!res.ok) throw commerceError(res, 'Failed to read offers');
    const offers = (res.data && res.data.offers) || [];
    return offers.find(function (o) { return o.id === offerId; }) || null;
  },

  /**
   * The MONEY price of an offer or app-tool entry. → { amount, currency, formatted } or null when it
   * has none (the item is free). Reads priceMoney, then pricesMoney. currency 'EUR'/'USD' asks for
   * that currency; omitted, the first money price. A morsel is never a price: 'morsel' returns null,
   * and the pacing amount is pacingOf(offer).
   * @param {any} offer
   * @param {string} [currency]
   * @returns {{ amount: number, currency: string, formatted: string } | null}
   */
  priceOf(offer, currency) {
    if (!offer || currency === 'morsel' || currency === 'MORSEL') return null;
    /** @type {Array<{ amount: number, currency: string }>} */
    const prices = [];
    if (offer.priceMoney && Number(offer.priceMoney.amount) > 0) prices.push(offer.priceMoney);
    if (Array.isArray(offer.pricesMoney)) {
      for (const p of offer.pricesMoney) if (p && Number(p.amount) > 0) prices.push(p);
    }
    const pm = currency ? prices.find(function (p) { return p.currency === currency; }) : prices[0];
    if (!pm) return null;
    return { amount: pm.amount, currency: pm.currency, formatted: commerce.fmtMoney(pm.amount, pm.currency) };
  },

  /**
   * The pacing amount of an offer, app-tool entry or action: whole morsels per use, 0 when none.
   * Reads tollMorsels / toll_morsels first, then the deprecated 3.x morsel price fields (price.morsels,
   * priceMorsels, price_morsels, base_morsels), which the node reads as pacing until 4.0.0.
   * @param {any} item
   * @returns {number}
   */
  pacingOf(item) {
    if (!item) return 0;
    const first = [item.tollMorsels, item.toll_morsels];
    for (const v of first) if (typeof v === 'number' && v >= 0) return Math.trunc(v);
    const legacy = (item.price && item.price.morsels) || item.priceMorsels || item.price_morsels
      || (item.pricing && (item.pricing.toll_morsels || item.pricing.base_morsels)) || 0;
    return Math.max(0, Math.trunc(Number(legacy) || 0));
  },

  /**
   * The pacing pack this node's operator sells: { morsels, price: { amount, currency }, checkout_item }
   * (GET /v1/wallet, data.pacing_pack), or null when the node sells none. Signed in.
   * @returns {Promise<{ morsels: number, price: { amount: number, currency: string }, checkout_item: { kind: string, quantity: number } } | null>}
   */
  async pacingPack() {
    const res = await authFetch('/v1/wallet');
    if (!res.ok) throw commerceError(res, 'Failed to read the wallet');
    return (res.data && res.data.pacing_pack) || null;
  },

  /**
   * Buy pacing capacity from the operator: opens a checkout for { kind: 'pacing-pack', quantity } in
   * the pack's currency and completes it with opts.payment ({ handler, instrument? }), which a money
   * total needs. Ask the person first: it spends money. Throws code PACING_PACK_UNAVAILABLE when the
   * node sells none.
   * @param {number} [quantity]
   * @param {{ payment?: { handler?: string, instrument?: unknown }, note?: string }} [opts]
   */
  async buyPacingPack(quantity, opts) {
    const pack = await commerce.pacingPack();
    if (!pack) {
      const err = /** @type {Error & { code?: string }} */ (new Error('This node does not sell pacing capacity; the daily allowance is POST /v1/wallet/request'));
      err.code = 'PACING_PACK_UNAVAILABLE';
      throw err;
    }
    const session = await commerce.openCheckout(
      [{ kind: 'pacing-pack', quantity: Math.max(1, Math.trunc(Number(quantity) || 1)) }],
      { currency: pack.price.currency, note: opts && opts.note });
    return commerce.completeCheckout(session.id, opts && opts.payment);
  },

  // ── Checkout sessions (/v1/commerce/checkout-sessions) ──

  /**
   * Open a checkout session. items: [{ agent, offer_id, quantity? }] (kind defaults to 'offer'; also
   * 'app-tool' and 'pacing-pack'). opts: { note?, currency? } — currency 'EUR'/'USD'; omitted, the
   * node uses the first money currency every item is priced in. The session carries `total` (money
   * micro-units, 0 = free), `currency` and `pacingMorsels` (fmtSession shows both).
   */
  async openCheckout(items, opts) {
    const body = /** @type {Record<string, any>} */ ({ items: normalizeItems(items) });
    if (opts && opts.note) body.note = opts.note;
    if (opts && opts.currency) body.currency = opts.currency;
    const attribution = pageAttribution();
    if (attribution) body.attribution = attribution;
    const res = await authFetch('/v1/commerce/checkout-sessions', {
      method: 'POST', body: JSON.stringify(body),
    });
    if (!res.ok) throw commerceError(res, 'Failed to open checkout');
    return res.data.session;
  },

  /** Read one of the buyer's checkout sessions. */
  async getCheckout(id) {
    const res = await authFetch('/v1/commerce/checkout-sessions/' + encodeURIComponent(id));
    if (!res.ok) throw commerceError(res, 'Failed to read checkout');
    return res.data.session;
  },

  /** The buyer's checkout sessions (purchases), newest first. */
  async listCheckouts(opts) {
    const qs = opts && opts.limit ? '?limit=' + opts.limit : '';
    const res = await authFetch('/v1/commerce/checkout-sessions' + qs);
    if (!res.ok) throw commerceError(res, 'Failed to list checkouts');
    return res.data.sessions;
  },

  /** Replace the cart of an open session. */
  async updateCheckout(id, items) {
    const res = await authFetch('/v1/commerce/checkout-sessions/' + encodeURIComponent(id), {
      method: 'PATCH', body: JSON.stringify({ items: normalizeItems(items) }),
    });
    if (!res.ok) throw commerceError(res, 'Failed to update checkout');
    return res.data.session;
  },

  /** Cancel an open session. */
  async cancelCheckout(id) {
    const res = await authFetch('/v1/commerce/checkout-sessions/' + encodeURIComponent(id), {
      method: 'PATCH', body: JSON.stringify({ cancel: true }),
    });
    if (!res.ok) throw commerceError(res, 'Failed to cancel checkout');
    return res.data.session;
  },

  /**
   * Complete (pay + fulfill) a session. payment: { handler, instrument? } — a session with a money
   * total names its handler (code PAYMENT_HANDLER_REQUIRED lists them); a free session needs none.
   * The session's pacing is debited from the owner's morsel balance. On 402 the thrown error has
   * err.paymentRequired + err.accepts; for code INSUFFICIENT_MORSELS the entry with scheme
   * 'aimeat-morsel-topup' names the daily allowance and the pacing pack (buyPacingPack).
   * Returns the completed session: session.receipt { handler, charged, fee, pacing?: { morsels,
   * burned, fee, providerEarned, trackingCode } }, session.fulfillment.
   */
  async completeCheckout(id, payment) {
    const res = await authFetch('/v1/commerce/checkout-sessions/' + encodeURIComponent(id) + '/complete', {
      method: 'POST', body: JSON.stringify(payment ? { payment: payment } : {}),
    });
    if (!res.ok) throw commerceError(res, 'Failed to complete checkout');
    return res.data.session;
  },

  /**
   * Pay a money session by card on Stripe's own page, on the seller's Stripe account, then come back.
   * Sends the person to the card page; `returnUrl` (default: this page) is where they come back to.
   * On that page call finishCardPayment(): it completes the checkout and resolves with the session.
   * @param {string} id The open checkout session.
   * @param {{ returnUrl?: string, redirect?: boolean }} [opts] redirect: false resolves with { url } instead.
   */
  async payByCard(id, opts) {
    const returnUrl = (opts && opts.returnUrl) || window.location.href.split('#')[0];
    const res = await authFetch('/v1/commerce/checkout-sessions/' + encodeURIComponent(id) + '/card', {
      method: 'POST', body: JSON.stringify({ return_url: returnUrl }),
    });
    if (!res.ok) throw commerceError(res, 'The card page could not be opened');
    if (opts && opts.redirect === false) return res.data;
    window.location.assign(res.data.url);
    return res.data;
  },

  /**
   * On the page the card page returned to: complete the checkout the person just paid. Resolves with
   * the completed session, with { cancelled: true } when they gave up on the card page, or null when
   * this page was not opened by a card page. A purchase the node already finished from Stripe's own
   * notice resolves with that session too.
   */
  async finishCardPayment() {
    const q = new URLSearchParams(window.location.search);
    const id = q.get('aimeat_checkout');
    if (!id) return null;
    if (q.get('cancelled') === '1') return { cancelled: true, id: id };
    const res = await authFetch('/v1/commerce/checkout-sessions/' + encodeURIComponent(id) + '/complete', {
      method: 'POST', body: JSON.stringify({ payment: { handler: 'com.stripe.checkout', instrument: q.get('stripe_session') } }),
    });
    if (res.ok) return res.data.session;
    if (res.error && res.error.code === 'SESSION_NOT_OPEN') return commerce.getCheckout(id);
    throw commerceError(res, 'The card payment could not be completed');
  },

  /**
   * Subscribe to a plan an extension offers (its `subscription.plans` record): opens a checkout for one
   * period and sends the person to the card page, which keeps the card for the renewals. Back on the
   * return page, finishCardPayment() completes it. `autoRenew: false` buys one period only.
   * @param {string} ext The extension that offers the plan.
   * @param {string} plan The plan id.
   * @param {{ autoRenew?: boolean, currency?: string, returnUrl?: string, redirect?: boolean }} [opts]
   */
  async subscribe(ext, plan, opts) {
    const session = await commerce.openCheckout([{ kind: 'subscription', app: ext, tool: plan, input: { auto_renew: !(opts && opts.autoRenew === false) } }], opts);
    return commerce.payByCard(session.id, opts);
  },

  /** The person's subscriptions, running and ended: { ext, plan, title, active_until, active, auto_renew, ... }. */
  async subscriptions() {
    const res = await authFetch('/v1/commerce/subscriptions');
    if (!res.ok) throw commerceError(res, 'Failed to list subscriptions');
    return res.data.subscriptions;
  },

  /** Stop a subscription's renewal; the period already paid runs to its end. */
  async cancelSubscription(ext, plan) {
    const res = await authFetch('/v1/commerce/subscriptions/' + encodeURIComponent(ext) + '/' + encodeURIComponent(plan) + '/cancel', { method: 'POST', body: '{}' });
    if (!res.ok) throw commerceError(res, 'Failed to cancel the subscription');
    return res.data.subscription;
  },

  /** One-call purchase: open a session for one offer and complete it immediately. */
  async buyOffer(agent, offerId, opts) {
    const session = await commerce.openCheckout(
      [{ agent: agent, offer_id: offerId, quantity: (opts && opts.quantity) || 1 }], opts);
    return commerce.completeCheckout(session.id, opts && opts.payment);
  },

  /** The seller's received orders (completed sessions where you are the seller). */
  async listOrders(opts) {
    const qs = opts && opts.limit ? '?limit=' + opts.limit : '';
    const res = await authFetch('/v1/commerce/orders' + qs);
    if (!res.ok) throw commerceError(res, 'Failed to list orders');
    return res.data.orders;
  },

  // ── App tools (TARGET-034 — priced tool calls on agent-faced apps) ──

  /**
   * Read an app's declared tool manifest: the public memory record apps.{appId}.tools under the
   * app owner's GHII — { tools: [{ name, description, inputSchema, action_id?, agent?, priceMoney?, pricesMoney?, tollMorsels? }] }
   * (priceOf reads the money price, pacingOf the pacing amount).
   * Returns null when the app declares no tools. Works logged out (public read).
   */
  async getAppTools(ownerGhii, appId) {
    const url = NODE_URL + '/v1/memory/' + encodeURIComponent(ownerGhii) + '/'
      + encodeURIComponent('apps.' + appId + '.tools');
    const r = await fetch(url);
    const res = await r.json();
    if (!res.ok) {
      if (res.error && res.error.code === 'NOT_FOUND') return null;
      throw commerceError(res, 'Failed to read app tools');
    }
    return res.data.value;
  },

  /**
   * Buy + invoke a priced app-tool through the checkout core (TARGET-034):
   * one { kind:'app-tool', app:'ownerName/appId', tool, input } line item, opened and
   * completed in one call. A tool bound to a capability (action_id) runs with your input and
   * the result comes back on session.fulfillment.results[0].result; an unbound tool queues an
   * agent TASK for the app owner instead — session.fulfillment.taskIds[0] (the deliverable
   * arrives via the seller's task flow). The receipt shows the charge either way.
   * One call per invocation. On a node without the resolver this throws
   * with code 'APP_TOOL_NOT_AVAILABLE'.
   */
  async invokeAppTool(ref, opts) {
    try {
      const session = await commerce.openCheckout(
        [{ kind: 'app-tool', app: ref.app, tool: ref.tool, input: ref.input }], opts);
      return commerce.completeCheckout(session.id, opts && opts.payment);
    } catch (e) {
      // Older nodes reject the kind at validation (zod enum error naming "kind"); a node with the
      // widened schema but no resolver answers UNKNOWN_ITEM_KIND. Both mean: not sellable here.
      if (e.code === 'UNKNOWN_ITEM_KIND' || (e.code === 'INVALID_CHECKOUT' && /invalid enum|"kind"/i.test(String(e.message)))) {
        const err = /** @type {Error & { code?: string, cause?: unknown }} */ (new Error('This node does not sell app-tools (app-tool resolver not enabled)'));
        err.code = 'APP_TOOL_NOT_AVAILABLE';
        err.cause = e;
        throw err;
      }
      throw e;
    }
  },
};

// ── Expose globally ──
attach('commerce', commerce);
