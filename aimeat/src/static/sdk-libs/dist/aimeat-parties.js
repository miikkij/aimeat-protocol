// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/parties/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-parties.js (with a per-node config prelude).
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

  // src/static/sdk-libs/_core/app-ref.js
  function appRef() {
    try {
      const node = document.getElementById("aimeat-app-ref");
      if (!node) return null;
      const raw = node.textContent || "";
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
      }
      return parsed && parsed.owner && parsed.app_id ? { owner: String(parsed.owner), filename: String(parsed.app_id) } : null;
    } catch {
      return null;
    }
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

  // src/static/sdk-libs/parties/index.js
  var BASE = (APEX_URL || NODE_URL || "").replace(/\/+$/, "");
  var STORE_KEY = "aimeat-party-session";
  function app() {
    const ref = appRef();
    if (!ref) throw Object.assign(new Error("This page is not an app served by an AIMEAT node."), { code: "NOT_AN_APP" });
    return ref;
  }
  function path(suffix) {
    const ref = app();
    return `${BASE}/v1/apps/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.filename)}${suffix}`;
  }
  function token() {
    try {
      return sessionStorage.getItem(STORE_KEY);
    } catch (e) {
      console.debug("[aimeat-parties] no session storage:", e instanceof Error ? e.message : e);
      return null;
    }
  }
  function keep(t) {
    try {
      if (t) sessionStorage.setItem(STORE_KEY, t);
      else sessionStorage.removeItem(STORE_KEY);
    } catch (e) {
      console.debug("[aimeat-parties] no session storage:", e instanceof Error ? e.message : e);
    }
    memory = t;
  }
  var memory = null;
  async function call(suffix, opts = {}) {
    const headers = { "Content-Type": "application/json" };
    const t = token() || memory;
    if (opts.auth && t) headers.Authorization = `Bearer ${t}`;
    const r = await fetch(path(suffix), {
      method: opts.method || (opts.body === void 0 ? "GET" : "POST"),
      headers,
      ...opts.body === void 0 ? {} : { body: JSON.stringify(opts.body) }
    });
    let body;
    try {
      body = await r.json();
    } catch (e) {
      console.warn("[aimeat-parties] the node answer was not JSON:", r.status, e instanceof Error ? e.message : e);
      body = null;
    }
    if (!r.ok || !body || body.ok === false || body.error) {
      const err = body && body.error || { code: "REQUEST_FAILED", message: `The node answered ${r.status}.` };
      if (r.status === 401 && opts.auth) keep(null);
      throw Object.assign(new Error(err.message || "Request failed"), { code: err.code, status: r.status });
    }
    return body.data !== void 0 ? body.data : body;
  }
  var linkOpened = (async () => {
    try {
      const url = new URL(location.href);
      const link = url.searchParams.get("aimeat_party_link");
      if (!link) return;
      url.searchParams.delete("aimeat_party_link");
      history.replaceState(history.state, "", url.toString());
      const out = await call("/parties/verify", { body: { token: link } });
      keep(out.token);
    } catch (e) {
      console.warn("[aimeat-parties] the sign-in link did not open:", e instanceof Error ? e.message : e);
    }
  })();
  var lang = () => (document.documentElement.lang || navigator.language || "en").slice(0, 2);
  var parties = {
    /** Resolves when a link the page was loaded with has been opened. */
    ready: () => linkOpened,
    /** Whether this tab holds a session. */
    signedIn: () => !!(token() || memory),
    /** Whether people may register to this app now: { open, effective }. */
    registration: () => call("/parties/registration"),
    /** Register with an e-mail address; a link is mailed to it. @param {string} email @param {string} [displayName] */
    signUp: (email, displayName) => call("/parties/signup", { body: { email, ...displayName ? { display_name: displayName } : {}, lang: lang() } }),
    /** Ask for a new sign-in link. @param {string} email */
    signIn: (email) => call("/parties/signin", { body: { email, lang: lang() } }),
    /** Who is signed in, and its role in the app. */
    me: () => call("/parties/me", { auth: true }),
    /** End every session of this person in this app. */
    signOut: async () => {
      try {
        await call("/parties/signout", { body: {}, auth: true });
      } finally {
        keep(null);
      }
      return { signed_out: true };
    },
    data: {
      /** One collection of the person's own, or with { shared: true } one the app shares. @param {string} key @param {{ shared?: boolean }} [opts] */
      get: async (key, opts = {}) => (await call(`/party-data/${encodeURIComponent(key)}${opts.shared ? "?shared=true" : ""}`, { auth: true })).value,
      /** Replace one collection of the person's own (at most 64 kB). @param {string} key @param {unknown} value */
      set: (key, value) => call(`/party-data/${encodeURIComponent(key)}`, { method: "PUT", body: { value }, auth: true }),
      /** Delete one collection of the person's own. @param {string} key */
      remove: (key) => call(`/party-data/${encodeURIComponent(key)}`, { method: "DELETE", auth: true })
    }
  };
  attach("parties", parties);
})();
