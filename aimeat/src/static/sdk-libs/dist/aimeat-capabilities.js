// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/capabilities/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-capabilities.js (with a per-node config prelude).
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

  // src/static/sdk-libs/capabilities/index.js
  var { getSession: getSession2, authFetch: authFetch2 } = makeSession("aimeat-capabilities.js");
  var _loadedCortex = {};
  async function loadCortexLib(url) {
    if (_loadedCortex[url]) return;
    return new Promise(function(resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.onload = function() {
        _loadedCortex[url] = true;
        resolve(void 0);
      };
      s.onerror = function() {
        reject(new Error("Failed to load: " + url));
      };
      document.head.appendChild(s);
    });
  }
  function nodeCortexLibUrl(raw, ref) {
    var name = String(ref || "").replace(/^cortex:/, "");
    if (!name || /[/\\?#]/.test(name)) return null;
    var base = NODE_URL || location.href;
    if (!URL.canParse(base) || !URL.canParse(String(raw), base)) return null;
    var u = new URL(String(raw), base);
    var nodeOrigin = new URL(base).origin;
    if (u.origin !== nodeOrigin && u.origin !== location.origin) return null;
    var prefix = "/v1/cortex/" + encodeURIComponent(name) + "/libs/";
    if (u.pathname.indexOf(prefix) !== 0) return null;
    var file = u.pathname.slice(prefix.length);
    if (!/^[A-Za-z0-9._-]+\.m?js$/.test(file) || file.indexOf("..") !== -1) return null;
    return u.origin + u.pathname;
  }
  var capabilities = {
    // ── Discovery ──
    async list(filters) {
      var params = new URLSearchParams();
      if (filters) {
        if (filters.search) params.set("search", filters.search);
        if (filters.tags) params.set("tags", filters.tags.join(","));
        if (filters.callable !== void 0) params.set("callable", String(filters.callable));
        if (filters.authRequired) params.set("authRequired", filters.authRequired);
        if (filters.source_type) params.set("source_type", filters.source_type);
        if (filters.status) params.set("status", filters.status);
        if (filters.page) params.set("page", String(filters.page));
        if (filters.per_page) params.set("per_page", String(filters.per_page));
      }
      var qs = params.toString();
      var res = await authFetch2("/v1/capabilities" + (qs ? "?" + qs : ""));
      if (!res.ok) throw new Error(res.error?.message || "Failed to list capabilities");
      return res.data;
    },
    async search(query) {
      return capabilities.list({ search: query });
    },
    async get(id) {
      var res = await authFetch2("/v1/capabilities/" + encodeURIComponent(id));
      if (!res.ok) throw new Error(res.error?.message || "Capability not found");
      return res.data;
    },
    // ── Invocation ──
    async invoke(id, input, opts) {
      var cap = await capabilities.get(id);
      var mode = opts && opts.mode || "normal";
      if (cap.source && cap.source.type === "cortex") {
        var usage = cap.usage || "";
        var libMatch = usage.match(/loadScript\(['"]([^'"]+)['"]/);
        if (libMatch) {
          var libUrl = nodeCortexLibUrl(libMatch[1], cap.source.ref);
          if (!libUrl) {
            throw new Error(`This cortex capability names a library outside this node's cortex route for "` + String(cap.source.ref || "") + '", so it was not loaded. Load the library yourself with loadScript() if you trust it.');
          }
          await loadCortexLib(libUrl);
        }
        if (cap.exports && cap.exports.length > 0) {
          var parts = id.split(":");
          var funcName = parts.length >= 3 ? parts[2] : null;
          if (funcName) {
            var fn = window[funcName] || window.AIMEAT && window.AIMEAT[funcName];
            if (typeof fn === "function") {
              var start = performance.now();
              var result = await fn(input);
              var duration = Math.round(performance.now() - start);
              try {
                authFetch2("/v1/capabilities/" + encodeURIComponent(id) + "/telemetry", {
                  method: "POST",
                  body: JSON.stringify({ duration_ms: duration, status: "success" })
                }).catch(function() {
                });
              } catch {
              }
              return result;
            }
          }
        }
        throw new Error("Cortex capability loaded but export function not found. Use direct loadScript() instead.");
      }
      var res = await authFetch2("/v1/capabilities/" + encodeURIComponent(id) + "/invoke" + (mode === "raw" ? "?mode=raw" : ""), {
        method: "POST",
        body: JSON.stringify({ input: input || {} })
      });
      if (!res.ok) throw new Error(res.error?.message || "Invoke failed");
      return res.data.result !== void 0 ? res.data.result : res.data;
    },
    // ── Management ──
    async create(record) {
      var res = await authFetch2("/v1/capabilities", {
        method: "POST",
        body: JSON.stringify(record)
      });
      if (!res.ok) throw new Error(res.error?.message || "Failed to create capability");
      return res.data;
    },
    async update(id, updates) {
      var res = await authFetch2("/v1/capabilities/" + encodeURIComponent(id), {
        method: "PUT",
        body: JSON.stringify(updates)
      });
      if (!res.ok) throw new Error(res.error?.message || "Failed to update capability");
      return res.data;
    },
    async delete(id) {
      var res = await authFetch2("/v1/capabilities/" + encodeURIComponent(id), {
        method: "DELETE"
      });
      if (!res.ok) throw new Error(res.error?.message || "Failed to delete capability");
      return res.data;
    },
    async mine() {
      var session = getSession2();
      return capabilities.list({ owner: session.ghii || session.owner });
    },
    // ── Testing ──
    async test(id, input) {
      var res = await authFetch2("/v1/capabilities/" + encodeURIComponent(id) + "/test", {
        method: "POST",
        body: JSON.stringify({ input: input || {} })
      });
      if (!res.ok) throw new Error(res.error?.message || "Test failed");
      return res.data;
    },
    // ── Vouching ──
    async vouch(id, comment) {
      var body = comment ? { comment } : {};
      var res = await authFetch2("/v1/capabilities/" + encodeURIComponent(id) + "/vouch", {
        method: "POST",
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(res.error?.message || "Vouch failed");
      return res.data;
    },
    async unvouch(id) {
      var res = await authFetch2("/v1/capabilities/" + encodeURIComponent(id) + "/vouch", {
        method: "DELETE"
      });
      if (!res.ok) throw new Error(res.error?.message || "Unvouch failed");
      return res.data;
    }
  };
  attach("capabilities", capabilities);
})();
