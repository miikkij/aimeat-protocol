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
    /** Format any session/offer amount currency-aware: morsels are integers, money is micro-units. */
    fmtAmount(amount, currency) {
      if (!currency || currency === "morsel" || currency === "MORSEL") {
        return (Number(amount) || 0) + " morsels";
      }
      return commerce.fmtMoney(amount, currency);
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
    /** Public product feed: every PUBLIC, priced agent offer on the node (no login needed). */
    async feed() {
      const r = await fetch(NODE_URL2 + "/v1/commerce/feed");
      const res = await r.json();
      if (res.error) throw commerceError(res, "Failed to read the commerce feed");
      return res;
    },
    /** Read one offer (with price/priceMoney) from an agent's published offers. */
    async getOffer(agent, offerId) {
      const res = await authFetch2("/v1/agents/" + encodeURIComponent(agent) + "/offers");
      if (!res.ok) throw commerceError(res, "Failed to read offers");
      const offers = res.data && res.data.offers || [];
      return offers.find(function(o) {
        return o.id === offerId;
      }) || null;
    },
    /**
     * The price of an offer or app-tool entry in one currency.
     * → { amount, currency, formatted } or null when it has no price in that currency.
     * currency omitted/'morsel' → price.morsels; 'EUR'/'USD' → priceMoney micro-units.
     */
    priceOf(offer, currency) {
      if (!offer) return null;
      if (!currency || currency === "morsel") {
        const m = offer.price && Number(offer.price.morsels);
        if (!m || m <= 0) return null;
        return { amount: m, currency: "morsel", formatted: commerce.fmtAmount(m, "morsel") };
      }
      const pm = offer.priceMoney;
      if (!pm || pm.currency !== currency) return null;
      return { amount: pm.amount, currency, formatted: commerce.fmtMoney(pm.amount, currency) };
    },
    // ── Checkout sessions (/v1/commerce/checkout-sessions) ──
    /**
     * Open a checkout session. items: [{ agent, offer_id, quantity? }] (kind defaults to 'offer').
     * opts: { note?, currency? } — currency 'EUR'/'USD' needs a money price + a settling handler.
     */
    async openCheckout(items, opts) {
      const body = (
        /** @type {Record<string, any>} */
        { items: normalizeItems(items) }
      );
      if (opts && opts.note) body.note = opts.note;
      if (opts && opts.currency) body.currency = opts.currency;
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
     * Complete (pay + fulfill) a session. payment: { handler?, instrument? } — omit for the
     * node default (morsels). On 402 the thrown error has err.paymentRequired + err.accepts.
     * Returns the completed session: session.receipt { handler, charged, fee }, session.fulfillment.
     */
    async completeCheckout(id, payment) {
      const res = await authFetch2("/v1/commerce/checkout-sessions/" + encodeURIComponent(id) + "/complete", {
        method: "POST",
        body: JSON.stringify(payment ? { payment } : {})
      });
      if (!res.ok) throw commerceError(res, "Failed to complete checkout");
      return res.data.session;
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
     * app owner's GHII — { tools: [{ name, description, inputSchema, action_id?, agent?, price?, priceMoney? }] }.
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
