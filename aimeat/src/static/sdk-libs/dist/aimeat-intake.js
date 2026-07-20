// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/intake/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-intake.js (with a per-node config prelude).
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
    return cfg().baseUrl;
  }
  var NODE_URL = resolveNodeUrl();
  var APEX_URL = cfg().baseUrl;
  var NODE_ID = cfg().nodeId;
  var HEARTBEAT_MS = cfg().heartbeatMs || 3e4;

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

  // src/static/sdk-libs/intake/index.js
  function base() {
    if (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.nodeUrl) return String(window.AIMEAT.auth.nodeUrl).replace(/\/+$/, "");
    return APEX_URL;
  }
  function enc(s) {
    return encodeURIComponent(String(s == null ? "" : s));
  }
  function submitPath(org, ws, formId) {
    return "/v1/intake/" + enc(org) + "/" + enc(ws) + "/" + enc(formId);
  }
  async function getForm(org, ws, formId) {
    var res = await fetch(base() + submitPath(org, ws, formId), { headers: { "Accept": "application/json" } });
    var body = await res.json().catch(function() {
      return null;
    });
    if (!body || body.ok === false) throw new Error(body && body.error && body.error.message || "Form not found");
    return body.data;
  }
  async function submit(org, ws, formId, values) {
    var res = await fetch(base() + submitPath(org, ws, formId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values || {})
    });
    var body = await res.json().catch(function() {
      return null;
    });
    if (!body || body.ok === false) {
      var e = (
        /** @type {Error & { code?: string, details?: unknown }} */
        new Error(body && body.error && body.error.message || "Submit failed")
      );
      e.code = body && body.error && body.error.code;
      e.details = body && body.error && body.error.details;
      throw e;
    }
    return body.data;
  }
  async function authFetch(path, opts) {
    if (!window.AIMEAT || !window.AIMEAT.auth) throw new Error("AIMEAT.auth is required for owner methods (load aimeat-auth.js first)");
    var s = window.AIMEAT.auth.getSession();
    if (!s) throw new Error("Not logged in. Call AIMEAT.auth.login() first.");
    var res = await s.fetch(path, opts);
    if (res && typeof res.json === "function") res = await res.json();
    return res;
  }
  async function defineForm(cfg2) {
    var body = await authFetch("/v1/intake/forms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg2 || {}) });
    if (!body || body.ok === false) throw new Error(body && body.error && body.error.message || "defineForm failed");
    return body.data;
  }
  async function listForms(org, ws) {
    var body = await authFetch("/v1/intake/forms?organism_id=" + enc(org) + "&ws=" + enc(ws));
    if (!body || body.ok === false) throw new Error(body && body.error && body.error.message || "listForms failed");
    return body.data && body.data.forms || [];
  }
  async function deleteForm(org, ws, formId) {
    var body = await authFetch("/v1/intake/forms?organism_id=" + enc(org) + "&ws=" + enc(ws) + "&form_id=" + enc(formId), { method: "DELETE" });
    if (!body || body.ok === false) throw new Error(body && body.error && body.error.message || "deleteForm failed");
    return body.data;
  }
  attach("intake", { getForm, submit, defineForm, listForms, deleteForm, submitPath, nodeUrl: base() });
})();
