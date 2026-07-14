/**
 * @file src/routes/lib-commerce.ts
 * @description Server-side generator for the browser client library aimeat-commerce.js. Returns
 *   the JS source (as a string) exposing AIMEAT.commerce — checkout sessions over the TARGET-033
 *   commerce core (/v1/commerce/*), offer price reading, money formatting in 6-decimal micro-units
 *   (same convention as public/js/utils.js fmtMoney), the x402-style 402 `accepts` surface, and
 *   the TARGET-034 app-tool convention (manifest read + forward-compatible invoke).
 *
 * @structure
 *   - aimeatCommerceLib(config): returns the IIFE source string, stamped with node id
 *   - emitted commerce.fmtMoney/fmtAmount/microsFromInput: money micro-unit formatting
 *   - emitted commerce.openCheckout/getCheckout/listCheckouts/updateCheckout/cancelCheckout/
 *     completeCheckout/listOrders: the /v1/commerce checkout lifecycle (buyOffer = open+complete)
 *   - emitted commerce.feed/getOffer/priceOf: offer discovery + price reading
 *   - emitted commerce.getAppTools/invokeAppTool: TARGET-034 app-tool draft convention
 *   - commerce errors carry err.code, err.status, and (on 402) err.paymentRequired + err.accepts
 *
 * @usage router.get('/v1/libs/aimeat-commerce.js', (_req, res) => sendJavascriptLibrary(res, aimeatCommerceLib(config)));
 *
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial commerce client library (TARGET-033 checkout + TARGET-034 app-tool draft)
 */
import type { AimeatConfig } from '../config.js';

/**
 * aimeat-commerce.js — Commerce client library (checkout sessions, offer prices, money formatting)
 * Depends on AIMEAT.auth being loaded first (except fmtMoney/feed, which work standalone).
 * SECURITY: this library carries NO secrets. Seller PSP credentials (`commerce.psp`) are
 * server-side seller configuration read only by the node's payment handlers — a client app
 * must never ask for, store, or transmit secret keys.
 */
export function aimeatCommerceLib(config: AimeatConfig): string {
  return `// aimeat-commerce.js — AIMEAT Commerce Library (checkout, offer prices, money formatting)
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Requires: aimeat-auth.js loaded first (fmtMoney/fmtAmount/microsFromInput/feed also work logged out)
// Money convention: integer 6-decimal MICRO-UNITS (1 EUR = 1_000_000 micros). Morsels are plain integers.
// Usage:
//   const s = await AIMEAT.commerce.buyOffer('vendor#alice@node', 'translate-doc');   // open + complete
//   AIMEAT.commerce.fmtMoney(1500000, 'EUR')  // → "1.50 EUR"
// On 402 (payment required) thrown errors carry err.paymentRequired === true and the
// x402-style err.accepts array telling the caller HOW it could settle.
(function(global) {
'use strict';

const NODE_URL = '${config.baseUrl}';

/** Micros per whole currency unit — money amounts are 6-decimal micro-units (matches USDC/x402). */
const MONEY_UNIT = 1000000;

function getSession() {
  if (!global.AIMEAT || !global.AIMEAT.auth) {
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-commerce.js');
  }
  const s = global.AIMEAT.auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  return s;
}

async function authFetch(path, opts) {
  const session = getSession();
  return session.fetch(path, opts);
}

/** Build an Error from a failed envelope; 402 responses carry the x402-style accepts block. */
function commerceError(res, fallback) {
  const e = new Error((res.error && res.error.message) || fallback);
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
  return arr.map(function(i) {
    const out = { offer_id: i.offer_id || i.offerId };
    if (i.kind) out.kind = i.kind;
    if (i.agent) out.agent = i.agent;
    if (i.org) out.org = i.org;
    if (i.app) out.app = i.app;      // app-tool items (TARGET-034 draft)
    if (i.tool) out.tool = i.tool;
    if (i.quantity) out.quantity = i.quantity;
    return out;
  });
}

const commerce = {
  MONEY_UNIT: MONEY_UNIT,

  // ── Money formatting (same convention as the portal's utils.js fmtMoney) ──

  /** Format money micro-units as "1.50 EUR" / "0.002 USD" (≥2 decimals, up to 6 when sub-cent). */
  fmtMoney(micros, currency) {
    const s = ((Number(micros) || 0) / MONEY_UNIT).toFixed(6).replace(/(\\.\\d{2}\\d*?)0+$/, '$1');
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
    return offers.find(function(o) { return o.id === offerId; }) || null;
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
    const body = { items: normalizeItems(items) };
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

  // ── App tools (TARGET-034 DRAFT convention — priced tools on agent-faced apps) ──

  /**
   * Read an app's declared tool manifest: the public memory record apps.{appId}.tools under the
   * app owner's GHII — { tools: [{ name, description, inputSchema, price?, priceMoney? }] }.
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
   * Buy + invoke a priced app-tool through the checkout core (TARGET-034 phase A, DRAFT):
   * opens a session with a { kind:'app-tool', app, tool } line item and completes it.
   * Requires a node with the app-tool sellable resolver; on an older node this throws
   * with code 'APP_TOOL_NOT_AVAILABLE'.
   */
  async invokeAppTool(ref, opts) {
    try {
      const session = await commerce.openCheckout(
        [{ kind: 'app-tool', agent: ref.agent, app: ref.app, tool: ref.tool,
           offer_id: ref.tool, quantity: (ref.quantity || 1) }], opts);
      return commerce.completeCheckout(session.id, opts && opts.payment);
    } catch (e) {
      if (e.code === 'INVALID_CHECKOUT' || e.code === 'INVALID_ITEM') {
        const err = new Error('This node does not sell app-tools yet (TARGET-034 app-tool resolver not enabled)');
        err.code = 'APP_TOOL_NOT_AVAILABLE';
        err.cause = e;
        throw err;
      }
      throw e;
    }
  },
};

// ── Expose globally ──
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.commerce = commerce;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
