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
    if (typeof self !== "undefined" && typeof self.origin === "string" && self.origin.indexOf("http") === 0) {
      return self.origin;
    }
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

  // src/static/sdk-libs/intake/fields.js
  var NODE_MAX_VALUE = 8e3;
  var KNOWN_TYPES = ["text", "textarea", "email", "tel", "url", "number", "date", "select", "radio", "checkbox"];
  var TEXT_TYPES = ["text", "textarea", "email", "tel", "url"];
  var CHOICE_TYPES = ["select", "radio"];
  function labelText(label) {
    if (label == null) return "";
    if (typeof label !== "object") return String(label);
    const byLang = (
      /** @type {Record<string, unknown>} */
      label
    );
    if (typeof byLang.en === "string" && byLang.en) return byLang.en;
    for (const k of Object.keys(byLang)) if (typeof byLang[k] === "string" && byLang[k]) return (
      /** @type {string} */
      byLang[k]
    );
    return "";
  }
  function options(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const o of raw) {
      if (typeof o === "string" || typeof o === "number") out.push({ value: String(o), label: String(o) });
      else if (o && typeof o === "object" && o.value != null) {
        out.push({ value: String(o.value), label: o.label != null ? String(o.label) : String(o.value) });
      }
    }
    return out;
  }
  function positiveInt(v) {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : void 0;
  }
  function fields(form) {
    if (!form) return [];
    const list = Array.isArray(form) ? form : form.fields;
    const allowed = Array.isArray(form.allowed_fields) ? form.allowed_fields : Array.isArray(form.allowedFields) ? form.allowedFields : [];
    const requiredRaw = Array.isArray(form.required_fields) ? form.required_fields : Array.isArray(form.requiredFields) ? form.requiredFields : [];
    const required = new Set(requiredRaw.map(String));
    const honeypot = form.honeypot_field || form.honeypotField || null;
    const source = Array.isArray(list) && list.length ? list : allowed.map((k) => ({ key: k }));
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const f of source) {
      const raw = typeof f === "string" ? { key: f } : f || {};
      const name = raw.key != null ? String(raw.key) : raw.name != null ? String(raw.name) : "";
      if (!name || name === honeypot || seen.has(name)) continue;
      seen.add(name);
      let type = typeof raw.type === "string" ? raw.type.toLowerCase() : "text";
      if (KNOWN_TYPES.indexOf(type) === -1) type = "text";
      const opts = options(raw.options);
      if (CHOICE_TYPES.indexOf(type) !== -1 && !opts.length) type = "text";
      const field = {
        name,
        label: labelText(raw.label) || name,
        type,
        required: raw.required === true || required.has(name)
      };
      if (CHOICE_TYPES.indexOf(type) !== -1) field.options = opts;
      if (TEXT_TYPES.indexOf(type) !== -1) {
        const own = positiveInt(raw.maxLength != null ? raw.maxLength : raw.max_length);
        field.maxLength = own ? Math.min(own, NODE_MAX_VALUE) : NODE_MAX_VALUE;
      }
      out.push(field);
    }
    return out;
  }
  function firstSegment(path) {
    if (typeof path !== "string") return void 0;
    const seg = path.split("/")[1];
    return seg ? seg.replace(/~1/g, "/").replace(/~0/g, "~") : void 0;
  }
  function refusalField(error) {
    if (!error) return void 0;
    const d = error.details;
    if (d && typeof d === "object" && !Array.isArray(d) && typeof d.field === "string") return d.field;
    const msg = String(error.message || "");
    const m = /^Missing required field: (.+)$/.exec(msg) || /^Field '([^']+)' is too long$/.exec(msg);
    if (m) return m[1];
    if (Array.isArray(d)) {
      for (const v of d) {
        if (!v || typeof v !== "object") continue;
        const fromPath = firstSegment(v.path);
        if (fromPath) return fromPath;
        const p = v.params || {};
        if (typeof p.missingProperty === "string") return p.missingProperty;
        if (typeof p.additionalProperty === "string") return p.additionalProperty;
      }
    }
    return void 0;
  }

  // src/static/sdk-libs/intake/index.js
  function refused(body, status, fallback) {
    const err = body && body.error;
    const e = (
      /** @type {IntakeRefusal} */
      new Error(err && err.message || fallback)
    );
    e.code = err && err.code;
    e.details = err && err.details;
    e.status = status;
    return e;
  }
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
    if (!body || body.ok === false) throw refused(body, res.status, "Form not found");
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
      var e = refused(body, res.status, "Submit failed");
      var field = refusalField(body && body.error);
      if (field) e.field = field;
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
  attach("intake", { getForm, submit, fields, defineForm, listForms, deleteForm, submitPath, nodeUrl: base() });
})();
