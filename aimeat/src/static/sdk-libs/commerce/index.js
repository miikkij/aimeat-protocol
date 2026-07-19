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
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-commerce.ts (SDK-libs migration Phase 2).
 */
import { APEX_URL } from '../_core/config.js';
import { authFetch } from '../_core/session.js';
import { attach } from '../_core/namespace.js';

const NODE_URL = APEX_URL;

/** Micros per whole currency unit — money amounts are 6-decimal micro-units (matches USDC/x402). */
const MONEY_UNIT = 1000000;

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

  /** Format any session/offer amount currency-aware: morsels are integers, money is micro-units. */
  fmtAmount(amount, currency) {
    if (!currency || currency === 'morsel' || currency === 'MORSEL') {
      return (Number(amount) || 0) + ' morsels';
    }
    return commerce.fmtMoney(amount, currency);
  },

  /** Parse a major-unit input ("1.50", "0,002") into integer money micro-units; null if not positive. */
  microsFromInput(str) {
    const n = parseFloat(String(str).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * MONEY_UNIT);
  },

  // ── Offer discovery + price reading ──

  /** Public product feed: every PUBLIC, priced agent offer on the node (no login needed). */
  async feed() {
    const r = await fetch(NODE_URL + '/v1/commerce/feed');
    const res = await r.json();
    if (res.error) throw commerceError(res, 'Failed to read the commerce feed');
    return res; // { products: [{ id: "offer:<agentGaii>:<offerId>", title, price, seller }], total }
  },

  /** Read one offer (with price/priceMoney) from an agent's published offers. */
  async getOffer(agent, offerId) {
    const res = await authFetch('/v1/agents/' + encodeURIComponent(agent) + '/offers');
    if (!res.ok) throw commerceError(res, 'Failed to read offers');
    const offers = (res.data && res.data.offers) || [];
    return offers.find(function (o) { return o.id === offerId; }) || null;
  },

  /**
   * The price of an offer or app-tool entry in one currency.
   * → { amount, currency, formatted } or null when it has no price in that currency.
   * currency omitted/'morsel' → price.morsels; 'EUR'/'USD' → priceMoney micro-units.
   */
  priceOf(offer, currency) {
    if (!offer) return null;
    if (!currency || currency === 'morsel') {
      const m = offer.price && Number(offer.price.morsels);
      if (!m || m <= 0) return null;
      return { amount: m, currency: 'morsel', formatted: commerce.fmtAmount(m, 'morsel') };
    }
    const pm = offer.priceMoney;
    if (!pm || pm.currency !== currency) return null;
    return { amount: pm.amount, currency: currency, formatted: commerce.fmtMoney(pm.amount, currency) };
  },

  // ── Checkout sessions (/v1/commerce/checkout-sessions) ──

  /**
   * Open a checkout session. items: [{ agent, offer_id, quantity? }] (kind defaults to 'offer').
   * opts: { note?, currency? } — currency 'EUR'/'USD' needs a money price + a settling handler.
   */
  async openCheckout(items, opts) {
    const body = /** @type {Record<string, any>} */ ({ items: normalizeItems(items) });
    if (opts && opts.note) body.note = opts.note;
    if (opts && opts.currency) body.currency = opts.currency;
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
   * Complete (pay + fulfill) a session. payment: { handler?, instrument? } — omit for the
   * node default (morsels). On 402 the thrown error has err.paymentRequired + err.accepts.
   * Returns the completed session: session.receipt { handler, charged, fee }, session.fulfillment.
   */
  async completeCheckout(id, payment) {
    const res = await authFetch('/v1/commerce/checkout-sessions/' + encodeURIComponent(id) + '/complete', {
      method: 'POST', body: JSON.stringify(payment ? { payment: payment } : {}),
    });
    if (!res.ok) throw commerceError(res, 'Failed to complete checkout');
    return res.data.session;
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
   * app owner's GHII — { tools: [{ name, description, inputSchema, action_id?, agent?, price?, priceMoney? }] }.
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
