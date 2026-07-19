// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/portfolio-standalone/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-portfolio-standalone.js (with a per-node config prelude).
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

  // src/static/sdk-libs/portfolio-standalone/index.js
  var APEX = APEX_URL;
  var jwt = null;
  function post(msg) {
    try {
      window.postMessage(msg, window.location.origin);
    } catch {
    }
  }
  function announce(loggedIn) {
    post({ type: "aimeat-portfolio-auth", loggedIn: !!loggedIn });
  }
  window.addEventListener("message", function(e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || d.type !== "aimeat-portfolio-fetch") return;
    var reply = function(ok, value) {
      post({
        type: "aimeat-portfolio-fetch-result",
        id: d.id == null ? null : d.id,
        ok: !!ok,
        gaii: typeof d.gaii === "string" ? d.gaii : null,
        key: typeof d.key === "string" ? d.key : null,
        value: value == null ? null : value
      });
    };
    if (typeof d.gaii !== "string" || typeof d.key !== "string") {
      reply(false, null);
      return;
    }
    fetch(
      APEX + "/v1/memory/" + encodeURIComponent(d.gaii) + "/" + encodeURIComponent(d.key),
      jwt ? { headers: { Authorization: "Bearer " + jwt } } : void 0
    ).then(function(r) {
      return r.json().then(function(j) {
        return { r, j };
      });
    }).then(function(x) {
      var ok = !!(x.r.ok && x.j && x.j.ok !== false);
      reply(ok, ok && x.j.data ? x.j.data.value : null);
    }).catch(function() {
      reply(false, null);
    });
  });
  function boot() {
    var auth = window.AIMEAT && window.AIMEAT.auth;
    if (!auth || typeof auth.login !== "function") {
      announce(false);
      return;
    }
    Promise.resolve(auth.login()).then(function(session) {
      jwt = session && session.jwt ? session.jwt : null;
      announce(!!jwt);
    }).catch(function() {
      announce(false);
    });
    if (typeof auth.on === "function") {
      auth.on("login", function() {
        var s = typeof auth.getSession === "function" ? auth.getSession() : null;
        jwt = s && s.jwt || null;
        announce(!!jwt);
      });
      auth.on("logout", function() {
        jwt = null;
        announce(false);
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
