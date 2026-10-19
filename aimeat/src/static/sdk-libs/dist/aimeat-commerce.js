// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/commerce/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-commerce.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/config.js
  function cfg() {
    return window.__AIMEAT_SDK_CFG__ || { nodeId: "", baseUrl: "" };
  }
  function resolveNodeUrl() {
    const meta = document.querySelector('meta[name="aimeat-node"]');
    if (meta) return (meta.getAttribute("content") || "").replace(/\/$/, "");
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin;
    if (typeof self !== "undefined" && typeof self.origin === "string" && self.origin.indexOf("http") === 0) {
      return self.origin;
    }
    return cfg().baseUrl;
  }
  var NODE_URL = resolveNodeUrl();
  var APEX_URL = cfg().baseUrl;
  var NODE_ID = cfg().nodeId;
  var HEARTBEAT_MS = cfg().heartbeatMs || 3e4;

  // src/static/sdk-libs/_core/public-fetch.js
  var signedInOnly = false;
  function sessionJwt() {
    const auth = typeof window !== "undefined" && window.AIMEAT && window.AIMEAT.auth;
    const s = auth && typeof auth.getSession === "function" ? auth.getSession() : null;
    return s && s.jwt || null;
  }
  function withSession(init, jwt) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", "Bearer " + jwt);
    return { ...init, headers };
  }
  async function publicFetch(url, init = {}) {
    const early = signedInOnly ? sessionJwt() : null;
    const r = await fetch(url, early ? withSession(init, early) : init);
    if (r.status !== 401 || early) return r;
    if (!(r.headers.get("content-type") || "").includes("json")) return r;
    const body = await r.clone().json();
    if (!body || !body.error || body.error.code !== "SIGN_IN_REQUIRED") return r;
    signedInOnly = true;
    const jwt = sessionJwt();
    return jwt ? fetch(url, withSession(init, jwt)) : r;
  }

  // src/static/sdk-libs/_core/session.js
  function getSession(libLabel) {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    if (!auth) {
      throw new Error("AIMEAT.auth is required. Include aimeat-auth.js before " + (libLabel || "this library"));
    }
    const s = auth.getSession();
    if (!s) throw new Error("Not logged in. Call AIMEAT.auth.login() first.");
    return s;
  }
  function authFetch(path, opts, libLabel) {
    return getSession(libLabel).fetch(path, opts);
  }
  function makeSession(libLabel) {
    return {
      getSession: () => getSession(libLabel),
      authFetch: (path, opts) => authFetch(path, opts, libLabel)
    };
  }

  // src/static/sdk-libs/_core/namespace.js
  function namespace() {
    if (!window.AIMEAT) window.AIMEAT = {};
    return window.AIMEAT;
  }
  function attach(key, value) {
    const ns = namespace();
    ns[key] = value;
    return ns;
  }

  // src/static/sdk-libs/commerce/amount.js
  var SPACE_GROUP = /[\s'’]/;
  var SPACE_GROUPS = /[\s'’]+/;
  function groupedDigits(str, mark) {
    var g = str.split(mark);
    if (!/^\d{1,3}$/.test(g[0]) || !/^\d{3}$/.test(g[g.length - 1])) return null;
    var middle = g.slice(1, -1);
    var western = middle.every(function(x) {
      return /^\d{3}$/.test(x);
    });
    var indian = middle.length > 0 && middle.every(function(x) {
      return /^\d{2}$/.test(x);
    });
    return western || indian ? g.join("") : null;
  }
  function parseAmount(input) {
    if (typeof input === "number") return Number.isFinite(input) ? input : null;
    if (input == null) return null;
    var s = String(input).replace(/−/g, "-").trim();
    var first = s.search(/\d/);
    if (first < 0) return null;
    var last = s.length - 1;
    while (!/\d/.test(s.charAt(last))) last--;
    var prefix = s.slice(0, first);
    var body = s.slice(first, last + 1);
    var suffix = s.slice(last + 1);
    if (/(^|[\s+\-(])[.,]$/.test(prefix)) {
      body = prefix.slice(-1) + body;
      prefix = prefix.slice(0, -1);
    }
    if (/^[.,]/.test(suffix)) suffix = suffix.slice(1);
    var negative = prefix.indexOf("-") >= 0 || prefix.indexOf("(") >= 0 && suffix.indexOf(")") >= 0;
    if (/[^\d.,\s'’]/.test(body)) return null;
    var t = body;
    var spaced = SPACE_GROUP.test(body);
    if (spaced) {
      var parts = body.split(SPACE_GROUPS);
      for (var i = 0; i < parts.length; i++) {
        var ok = i === 0 ? /^\d{1,3}$/.test(parts[i]) : i < parts.length - 1 ? /^\d{3}$/.test(parts[i]) : /^\d{3}([.,]\d*)?$/.test(parts[i]);
        if (!ok) return null;
      }
      t = parts.join("");
    }
    var commas = t.split(",").length - 1;
    var dots = t.split(".").length - 1;
    var whole;
    var fraction = "";
    if (commas + dots === 0) {
      whole = t;
    } else if (spaced) {
      var k = t.search(/[.,]/);
      whole = t.slice(0, k);
      fraction = t.slice(k + 1);
    } else if (commas > 0 && dots > 0) {
      var at = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
      var decimal = t.charAt(at);
      if (t.split(decimal).length - 1 !== 1) return null;
      whole = groupedDigits(t.slice(0, at), decimal === "," ? "." : ",");
      if (whole === null) return null;
      fraction = t.slice(at + 1);
    } else if (commas + dots > 1) {
      whole = groupedDigits(t, commas ? "," : ".");
      if (whole === null) return null;
    } else {
      var m = t.search(/[.,]/);
      var before = t.slice(0, m);
      var after = t.slice(m + 1);
      if (after.length === 3 && /^[1-9]\d{0,2}$/.test(before)) return null;
      whole = before;
      fraction = after;
    }
    if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction) || whole === "" && fraction === "") return null;
    var value = parseFloat((whole || "0") + "." + (fraction || "0"));
    if (!Number.isFinite(value)) return null;
    return negative && value !== 0 ? -value : value;
  }

  // src/static/sdk-libs/commerce/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-commerce.js");
  var NODE_URL2 = APEX_URL;
  var MONEY_UNIT = 1e6;
  function pageAttribution() {
    try {
      const nav = (
        /** @type {Navigator & { globalPrivacyControl?: boolean }} */
        navigator
      );
      if (nav.globalPrivacyControl === true || nav.doNotTrack === "1") return null;
      const referrer = document.referrer || null;
      const utm = new URLSearchParams(location.search).get("utm_source");
      if (!referrer && !utm) return null;
      return { referrer: referrer ? referrer.slice(0, 2048) : null, utm_source: utm ? utm.slice(0, 100) : null };
    } catch {
      return null;
    }
  }
  function commerceError(res, fallback) {
    const e = (
      /** @type {Error & { code?: string, paymentRequired?: boolean, accepts?: unknown, x402Version?: unknown }} */
      new Error(res.error && res.error.message || fallback)
    );
    e.code = res.error && res.error.code;
    if (res.accepts) {
      e.paymentRequired = true;
      e.accepts = res.accepts;
      e.x402Version = res.x402Version;
    }
    return e;
  }
  function normalizeItems(items) {
    const arr = Array.isArray(items) ? items : [items];
    return arr.map(function(i) {
      const out = (
        /** @type {Record<string, any>} */
        { offer_id: i.offer_id || i.offerId }
      );
      if (i.kind) out.kind = i.kind;
      if (i.agent) out.agent = i.agent;
      if (i.org) out.org = i.org;
      if (i.app) out.app = i.app;
      if (i.tool) out.tool = i.tool;
      if (i.input) out.input = i.input;
      if (i.quantity) out.quantity = i.quantity;
      return out;
    });
  }
  var commerce = {
    MONEY_UNIT,
    // ── Money formatting (same convention as the portal's utils.js fmtMoney) ──
    /** Format money micro-units as "1.50 EUR" / "0.002 USD" (≥2 decimals, up to 6 when sub-cent). */
    fmtMoney(micros, currency) {
      const s = ((Number(micros) || 0) / MONEY_UNIT).toFixed(6).replace(/(\.\d{2}\d*?)0+$/, "$1");
      return currency ? s + " " + currency : s;
    },
    /**
     * Format a pacing amount: "pacing 5 morsels" / "pacing 1 morsel". A morsel paces use and is never
     * a price, so this is never shown as a cost.
     * @param {unknown} n
     * @returns {string}
     */
    fmtPacing(n) {
      const v = Math.max(0, Math.trunc(Number(n) || 0));
      return "pacing " + v + (v === 1 ? " morsel" : " morsels");
    },
    /**
     * Format a session or offer amount. Money is micro-units in a currency. A currency of 'morsel'
     * (or none) comes only from a session stored before 4.x and is shown as pacing, never as a price.
     */
    fmtAmount(amount, currency) {
      if (!currency || currency === "morsel" || currency === "MORSEL") {
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
      if (!session) return "";
      const s = (
        /** @type {{ total?: number, currency?: string, pacingMorsels?: number }} */
        session
      );
      const legacy = s.currency === "morsel" || s.currency === "MORSEL";
      const pacing = legacy ? Number(s.total) || 0 : Number(s.pacingMorsels) || 0;
      const money = !legacy && Number(s.total) > 0 ? commerce.fmtMoney(s.total, s.currency) : "free";
      return pacing > 0 ? money + " · " + commerce.fmtPacing(pacing) : money;
    },
    /**
     * Parse an amount in any common notation into a number, or null. '12,000.00' → 12000,
     * '1.234,56' → 1234.56, '0,002' → 0.002. An AMBIGUOUS amount returns null: '1,000' and '1.000'
     * are a thousand apart under the two conventions, so the app asks the person again instead of
     * guessing. Full rules in ./amount.js.
     * @param {unknown} input
     * @returns {number|null}
     */
    parseAmount,
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
      const r = await publicFetch(NODE_URL2 + "/v1/commerce/feed");
      const res = await r.json();
      if (res.error) throw commerceError(res, "Failed to read the commerce feed");
      return res;
    },
    /** Read one offer (with priceMoney and tollMorsels) from an agent's published offers. */
    async getOffer(agent, offerId) {
      const res = await authFetch2("/v1/agents/" + encodeURIComponent(agent) + "/offers");
      if (!res.ok) throw commerceError(res, "Failed to read offers");
      const offers = res.data && res.data.offers || [];
      return offers.find(function(o) {
        return o.id === offerId;
      }) || null;
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
      if (!offer || currency === "morsel" || currency === "MORSEL") return null;
      const prices = [];
      if (offer.priceMoney && Number(offer.priceMoney.amount) > 0) prices.push(offer.priceMoney);
      if (Array.isArray(offer.pricesMoney)) {
        for (const p of offer.pricesMoney) if (p && Number(p.amount) > 0) prices.push(p);
      }
      const pm = currency ? prices.find(function(p) {
        return p.currency === currency;
      }) : prices[0];
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
      for (const v of first) if (typeof v === "number" && v >= 0) return Math.trunc(v);
      const legacy = item.price && item.price.morsels || item.priceMorsels || item.price_morsels || item.pricing && (item.pricing.toll_morsels || item.pricing.base_morsels) || 0;
      return Math.max(0, Math.trunc(Number(legacy) || 0));
    },
    /**
     * The pacing pack this node's operator sells: { morsels, price: { amount, currency }, checkout_item }
     * (GET /v1/wallet, data.pacing_pack), or null when the node sells none. Signed in.
     * @returns {Promise<{ morsels: number, price: { amount: number, currency: string }, checkout_item: { kind: string, quantity: number } } | null>}
     */
    async pacingPack() {
      const res = await authFetch2("/v1/wallet");
      if (!res.ok) throw commerceError(res, "Failed to read the wallet");
      return res.data && res.data.pacing_pack || null;
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
        const err = (
          /** @type {Error & { code?: string }} */
          new Error("This node does not sell pacing capacity; the daily allowance is POST /v1/wallet/request")
        );
        err.code = "PACING_PACK_UNAVAILABLE";
        throw err;
      }
      const session = await commerce.openCheckout(
        [{ kind: "pacing-pack", quantity: Math.max(1, Math.trunc(Number(quantity) || 1)) }],
        { currency: pack.price.currency, note: opts && opts.note }
      );
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
      const body = (
        /** @type {Record<string, any>} */
        { items: normalizeItems(items) }
      );
      if (opts && opts.note) body.note = opts.note;
      if (opts && opts.currency) body.currency = opts.currency;
      const attribution = pageAttribution();
      if (attribution) body.attribution = attribution;
      const res = await authFetch2("/v1/commerce/checkout-sessions", {
        method: "POST",
        body: JSON.stringify(body)
      });
      if (!res.ok) throw commerceError(res, "Failed to open checkout");
      return res.data.session;
    },
    /** Read one of the buyer's checkout sessions. */
    async getCheckout(id) {
      const res = await authFetch2("/v1/commerce/checkout-sessions/" + encodeURIComponent(id));
      if (!res.ok) throw commerceError(res, "Failed to read checkout");
      return res.data.session;
    },
    /** The buyer's checkout sessions (purchases), newest first. */
    async listCheckouts(opts) {
      const qs = opts && opts.limit ? "?limit=" + opts.limit : "";
      const res = await authFetch2("/v1/commerce/checkout-sessions" + qs);
      if (!res.ok) throw commerceError(res, "Failed to list checkouts");
      return res.data.sessions;
    },
    /** Replace the cart of an open session. */
    async updateCheckout(id, items) {
      const res = await authFetch2("/v1/commerce/checkout-sessions/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify({ items: normalizeItems(items) })
      });
      if (!res.ok) throw commerceError(res, "Failed to update checkout");
      return res.data.session;
    },
    /** Cancel an open session. */
    async cancelCheckout(id) {
      const res = await authFetch2("/v1/commerce/checkout-sessions/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify({ cancel: true })
      });
      if (!res.ok) throw commerceError(res, "Failed to cancel checkout");
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
      const res = await authFetch2("/v1/commerce/checkout-sessions/" + encodeURIComponent(id) + "/complete", {
        method: "POST",
        body: JSON.stringify(payment ? { payment } : {})
      });
      if (!res.ok) throw commerceError(res, "Failed to complete checkout");
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
      const returnUrl = opts && opts.returnUrl || window.location.href.split("#")[0];
      const res = await authFetch2("/v1/commerce/checkout-sessions/" + encodeURIComponent(id) + "/card", {
        method: "POST",
        body: JSON.stringify({ return_url: returnUrl })
      });
      if (!res.ok) throw commerceError(res, "The card page could not be opened");
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
      const id = q.get("aimeat_checkout");
      if (!id) return null;
      if (q.get("cancelled") === "1") return { cancelled: true, id };
      const res = await authFetch2("/v1/commerce/checkout-sessions/" + encodeURIComponent(id) + "/complete", {
        method: "POST",
        body: JSON.stringify({ payment: { handler: "com.stripe.checkout", instrument: q.get("stripe_session") } })
      });
      if (res.ok) return res.data.session;
      if (res.error && res.error.code === "SESSION_NOT_OPEN") return commerce.getCheckout(id);
      throw commerceError(res, "The card payment could not be completed");
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
      const session = await commerce.openCheckout([{ kind: "subscription", app: ext, tool: plan, input: { auto_renew: !(opts && opts.autoRenew === false) } }], opts);
      return commerce.payByCard(session.id, opts);
    },
    /** The person's subscriptions, running and ended: { ext, plan, title, active_until, active, auto_renew, ... }. */
    async subscriptions() {
      const res = await authFetch2("/v1/commerce/subscriptions");
      if (!res.ok) throw commerceError(res, "Failed to list subscriptions");
      return res.data.subscriptions;
    },
    /** Stop a subscription's renewal; the period already paid runs to its end. */
    async cancelSubscription(ext, plan) {
      const res = await authFetch2("/v1/commerce/subscriptions/" + encodeURIComponent(ext) + "/" + encodeURIComponent(plan) + "/cancel", { method: "POST", body: "{}" });
      if (!res.ok) throw commerceError(res, "Failed to cancel the subscription");
      return res.data.subscription;
    },
    /** One-call purchase: open a session for one offer and complete it immediately. */
    async buyOffer(agent, offerId, opts) {
      const session = await commerce.openCheckout(
        [{ agent, offer_id: offerId, quantity: opts && opts.quantity || 1 }],
        opts
      );
      return commerce.completeCheckout(session.id, opts && opts.payment);
    },
    /** The seller's received orders (completed sessions where you are the seller). */
    async listOrders(opts) {
      const qs = opts && opts.limit ? "?limit=" + opts.limit : "";
      const res = await authFetch2("/v1/commerce/orders" + qs);
      if (!res.ok) throw commerceError(res, "Failed to list orders");
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
      const url = NODE_URL2 + "/v1/memory/" + encodeURIComponent(ownerGhii) + "/" + encodeURIComponent("apps." + appId + ".tools");
      const r = await fetch(url);
      const res = await r.json();
      if (!res.ok) {
        if (res.error && res.error.code === "NOT_FOUND") return null;
        throw commerceError(res, "Failed to read app tools");
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
          [{ kind: "app-tool", app: ref.app, tool: ref.tool, input: ref.input }],
          opts
        );
        return commerce.completeCheckout(session.id, opts && opts.payment);
      } catch (e) {
        if (e.code === "UNKNOWN_ITEM_KIND" || e.code === "INVALID_CHECKOUT" && /invalid enum|"kind"/i.test(String(e.message))) {
          const err = (
            /** @type {Error & { code?: string, cause?: unknown }} */
            new Error("This node does not sell app-tools (app-tool resolver not enabled)")
          );
          err.code = "APP_TOOL_NOT_AVAILABLE";
          err.cause = e;
          throw err;
        }
        throw e;
      }
    }
  };
  attach("commerce", commerce);
})();
