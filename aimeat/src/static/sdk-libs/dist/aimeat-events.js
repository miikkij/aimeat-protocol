// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/events/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-events.js (with a per-node config prelude).
"use strict";
(() => {
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

  // src/static/sdk-libs/events/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-events.js");
  async function record(kind, data, opts = {}) {
    const res = await authFetch2("/v1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        data: data || {},
        ...opts.link ? { link: opts.link } : {},
        ...opts.subject ? { subject: opts.subject } : {}
      })
    });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error?.message || "Could not record the event");
    return body.data;
  }
  async function list(opts = {}) {
    const qs = opts.limit ? `?limit=${encodeURIComponent(String(opts.limit))}` : "";
    const res = await authFetch2(`/v1/events${qs}`);
    const body = await res.json();
    if (!body.ok) throw new Error(body.error?.message || "Could not read the events");
    return body.data;
  }
  async function archive(opts = {}) {
    const params = new URLSearchParams();
    for (const key of ["limit", "offset", "from", "to"]) {
      if (opts[key] !== void 0 && opts[key] !== null) params.set(key, String(opts[key]));
    }
    const qs = params.toString();
    const res = await authFetch2(`/v1/events/archive${qs ? `?${qs}` : ""}`);
    const body = await res.json();
    if (!body.ok) throw new Error(body.error?.message || "Could not read the archive");
    return body.data;
  }
  attach("events", { record, list, archive });
})();
