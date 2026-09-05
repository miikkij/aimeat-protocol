// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/auth/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-auth.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/auth/crypto.js
  async function importEd25519Key(privateKeyBase64) {
    const privBytes = Uint8Array.from(atob(privateKeyBase64), (c) => c.charCodeAt(0));
    const pkcs8Prefix = new Uint8Array([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]);
    const pkcs8 = new Uint8Array(pkcs8Prefix.length + privBytes.length);
    pkcs8.set(pkcs8Prefix);
    pkcs8.set(privBytes, pkcs8Prefix.length);
    const cryptoKey = await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", false, ["sign"]);
    privBytes.fill(0);
    pkcs8.fill(0);
    return cryptoKey;
  }
  function isCryptoKey(value) {
    if (!value || typeof value !== "object") return false;
    if (typeof CryptoKey !== "undefined" && value instanceof CryptoKey) return true;
    return Object.prototype.toString.call(value) === "[object CryptoKey]";
  }
  async function sign(keyOrB64, message) {
    let key = keyOrB64;
    if (typeof keyOrB64 === "string") {
      key = await importEd25519Key(keyOrB64);
    }
    if (!isCryptoKey(key)) {
      throw new Error("AIMEAT signing key is missing or invalid. Please sign in again.");
    }
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = await crypto.subtle.sign("Ed25519", key, msgBytes);
    return btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  }
  var KEY_DB_NAME = "aimeat_keys";
  var KEY_STORE_NAME = "cryptokeys";
  function openKeyDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(KEY_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(KEY_STORE_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function storeKey(name, cryptoKey) {
    const db = (
      /** @type {IDBDatabase} */
      await openKeyDB()
    );
    return new Promise((resolve, reject) => {
      const tx = db.transaction(KEY_STORE_NAME, "readwrite");
      tx.objectStore(KEY_STORE_NAME).put(cryptoKey, name);
      tx.oncomplete = () => {
        db.close();
        resolve(void 0);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  }
  async function loadKey(name) {
    const db = (
      /** @type {IDBDatabase} */
      await openKeyDB()
    );
    return new Promise((resolve) => {
      const tx = db.transaction(KEY_STORE_NAME, "readonly");
      const req = tx.objectStore(KEY_STORE_NAME).get(name);
      req.onsuccess = () => {
        db.close();
        resolve(req.result || null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  }
  async function deleteKey(name) {
    try {
      const db = (
        /** @type {IDBDatabase} */
        await openKeyDB()
      );
      return new Promise((resolve) => {
        const tx = db.transaction(KEY_STORE_NAME, "readwrite");
        tx.objectStore(KEY_STORE_NAME).delete(name);
        tx.oncomplete = () => {
          db.close();
          resolve(void 0);
        };
        tx.onerror = () => {
          db.close();
          resolve(void 0);
        };
      });
    } catch {
    }
  }
  async function migrateKeysToIndexedDB() {
    try {
      const session = load("session");
      if (session && session.privateKey) {
        const cryptoKey = await importEd25519Key(session.privateKey);
        await storeKey("agent_key", cryptoKey);
        delete session.privateKey;
        save("session", session);
      }
      const ownerKey = load("owner_key");
      if (typeof ownerKey === "string" && ownerKey.length > 0) {
        const cryptoKey = await importEd25519Key(ownerKey);
        await storeKey("owner_key", cryptoKey);
        remove("owner_key");
      }
    } catch (e) {
      console.warn("AIMEAT: Key migration to IndexedDB failed, falling back to localStorage", e);
    }
  }
  var STORAGE_PREFIX = "aimeat_";
  function save(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch {
    }
  }
  function load(key) {
    try {
      const v = localStorage.getItem(STORAGE_PREFIX + key);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  }
  function remove(key) {
    try {
      localStorage.removeItem(STORAGE_PREFIX + key);
    } catch {
    }
  }
  function parseJwt(token) {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload;
    } catch {
      return null;
    }
  }
  function isExpired(jwt) {
    const payload = parseJwt(jwt);
    if (!payload || !payload.exp) return true;
    return Date.now() / 1e3 > payload.exp - 60;
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

  // src/static/sdk-libs/auth/config.js
  var APP_DEFAULT_SCOPES = "memory:read memory:write storage:read storage:write";
  function appDeclaredScopes() {
    try {
      var m = document.querySelector('meta[name="aimeat-scopes"]');
      var c = m && m.getAttribute("content");
      if (c && c.trim()) return c.trim().replace(/\s+/g, " ");
    } catch {
    }
    return APP_DEFAULT_SCOPES;
  }
  var AUTH_PROVIDERS = window.__AIMEAT_AUTH_CFG__ && window.__AIMEAT_AUTH_CFG__.providers || [];
  var EMAIL_REQUIRED = !!(window.__AIMEAT_AUTH_CFG__ && window.__AIMEAT_AUTH_CFG__.emailRequired);
  var PROVIDER_ICONS = {
    google: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>',
    entra: '<svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg>',
    casdoor: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" fill="#4757F6"/><circle cx="14" cy="11" r="1.6" fill="#fff"/><rect x="13.2" y="11.5" width="1.6" height="4" fill="#fff"/></svg>'
  };

  // src/static/sdk-libs/auth/events.js
  var listeners = {};
  function emit(event, data) {
    (listeners[event] || []).forEach((fn) => fn(data));
  }
  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
  }
  function off(event, fn) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter((f) => f !== fn);
  }

  // src/static/sdk-libs/auth/ink.js
  var LIGHT = "--aimeat-ink:var(--aimeat-pill-fg,var(--text,#1A1A2E));--aimeat-paper:var(--aimeat-pill-bg,var(--bg,#FAFAF8))";
  var DARK = "--aimeat-ink:var(--aimeat-pill-fg,var(--text,#EDEEF2));--aimeat-paper:var(--aimeat-pill-bg,var(--bg,#14151A))";
  function inkVarsCss(roots) {
    var light = roots.join(",");
    var dark = roots.map(function(r) {
      return 'html[data-theme="dark"] ' + r;
    }).join(",");
    var system = roots.map(function(r) {
      return 'html:not([data-theme="light"]) ' + r;
    }).join(",");
    return light + "{" + LIGHT + "}" + dark + "{" + DARK + "}@media (prefers-color-scheme:dark){" + system + "{" + DARK + "}}";
  }

  // src/static/sdk-libs/auth/theme.js
  function escHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
  var AIMEAT_THEME_KEY = "aimeat-theme";
  function aimeatReadTheme() {
    try {
      var u = new URLSearchParams(location.search).get("mode");
      if (u === "light" || u === "dark") return u;
    } catch {
    }
    try {
      var s = localStorage.getItem(AIMEAT_THEME_KEY);
      if (s === "light" || s === "dark") return s;
    } catch {
    }
    var attr = document.documentElement.dataset.theme;
    if (attr === "light" || attr === "dark") return attr;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function aimeatApplyTheme(t) {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(AIMEAT_THEME_KEY, t);
    } catch {
    }
    try {
      window.dispatchEvent(new CustomEvent("aimeat-theme-change", { detail: { theme: t } }));
    } catch {
    }
  }
  function aimeatRestoreMode() {
    try {
      var u = new URLSearchParams(location.search).get("mode");
      if (u === "light" || u === "dark") document.documentElement.dataset.theme = u;
    } catch {
    }
  }
  var FIXED_REGISTER_PREFIX = "genre-";
  function aimeatFixedRegister() {
    try {
      var m = document.querySelector('meta[name="aimeat-register"]');
      var v = m && m.getAttribute("content");
      return v && v.indexOf(FIXED_REGISTER_PREFIX) === 0 ? v : null;
    } catch {
      return null;
    }
  }
  function modeSwitchHtml(i) {
    var cur = aimeatReadTheme();
    var light = i.lightMode || "Light mode";
    var dark = i.darkMode || "Dark mode";
    var fixed = aimeatFixedRegister();
    var why = i.fixedRegister || "This register keeps its own light";
    var seg = fixed ? ' class="aimeat-seg aimeat-seg--fixed" title="' + escHtml(why) + '" aria-label="' + escHtml(why) + '"' : ' class="aimeat-seg" aria-label="' + escHtml(i.themeLabel || "Theme") + '"';
    var off2 = fixed ? ' disabled aria-disabled="true" title="' + escHtml(why) + '"' : "";
    return '<span id="aimeat-mode-switch" role="group"' + seg + '><button type="button" data-mode="light" aria-pressed="' + (cur === "light") + '"' + (fixed ? off2 : ' title="' + escHtml(light) + '"') + ' aria-label="' + escHtml(fixed ? why : light) + '"><span class="seg-ico" aria-hidden="true">☀</span></button><button type="button" data-mode="dark" aria-pressed="' + (cur === "dark") + '"' + (fixed ? off2 : ' title="' + escHtml(dark) + '"') + ' aria-label="' + escHtml(fixed ? why : dark) + '"><span class="seg-ico" aria-hidden="true">☾</span></button></span>';
  }
  function wireModeSwitch(container) {
    var root = container.querySelector("#aimeat-mode-switch");
    if (!root) return;
    if (aimeatFixedRegister()) return;
    function sync(cur) {
      root.querySelectorAll("button[data-mode]").forEach(function(b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-mode") === cur));
      });
    }
    root.querySelectorAll("button[data-mode]").forEach(function(b) {
      b.addEventListener("click", function() {
        var m = b.getAttribute("data-mode");
        aimeatApplyTheme(m);
        sync(m);
      });
    });
    window.addEventListener("aimeat-theme-change", function(ev) {
      var e = (
        /** @type {CustomEvent} */
        ev
      );
      if (e && e.detail && e.detail.theme) sync(e.detail.theme);
    });
  }
  function ensureAuthPillStyles() {
    if (document.getElementById("aimeat-auth-pill-css")) return;
    var st = document.createElement("style");
    st.id = "aimeat-auth-pill-css";
    var ink2 = "var(--aimeat-ink)";
    var paper2 = "var(--aimeat-paper)";
    var font2 = "var(--aimeat-pill-font,var(--font-showroom-body,var(--font,system-ui,sans-serif)))";
    st.textContent = [
      inkVarsCss([".aimeat-auth-wrap", ".aimeat-auth-out", ".aimeat-auth-pill"]),
      ".aimeat-auth-pill{display:inline-flex;align-items:center;gap:10px;padding:4px 11px;",
      "border:2px solid " + ink2 + ";background:" + paper2 + ";color:" + ink2 + ";",
      "border-radius:var(--aimeat-pill-radius,0);font-family:" + font2 + ";font-size:13px;line-height:1.4}",
      ".aimeat-auth-dot{display:inline-block;flex:0 0 auto;width:9px;height:9px;",
      "background:var(--aimeat-pill-live,var(--success,#10B981))}",
      ".aimeat-auth-label{display:inline-flex;align-items:center;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}",
      ".aimeat-auth-ghii{font-weight:800;font-size:13px;color:var(--aimeat-pill-name,var(--accent,#E8564A))}",
      ".aimeat-auth-fed{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;letter-spacing:.04em;",
      "padding:1px 6px;border:2px solid currentColor}",
      ".aimeat-auth-gear{appearance:none;background:none;border:2px solid currentColor;color:inherit;border-radius:0;",
      "padding:2px 7px;cursor:pointer;font-size:13px;line-height:1}",
      ".aimeat-auth-logout{appearance:none;background:none;border:0;border-bottom:2px solid currentColor;border-radius:0;",
      "padding:0 0 1px;margin:0;cursor:pointer;color:inherit;font-family:inherit;font-size:11px;font-weight:800;",
      "letter-spacing:.04em;text-transform:uppercase;line-height:1.4}",
      ".aimeat-auth-logout:hover,.aimeat-auth-gear:hover{color:var(--aimeat-pill-name,var(--accent,#E8564A))}",
      /* Signed out: the cluster beside one ink slab with the sun's offset shadow. */
      ".aimeat-auth-out{display:inline-flex;align-items:center;gap:10px;color:" + ink2 + "}",
      ".aimeat-sign-btn{appearance:none;padding:8px 16px;background:var(--aimeat-pill-cta-bg," + ink2 + ");",
      "color:var(--aimeat-pill-cta-fg," + paper2 + ");border:0;border-radius:var(--aimeat-pill-radius,0);cursor:pointer;",
      "font-family:" + font2 + ";font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;line-height:1.4;",
      "box-shadow:4px 4px 0 var(--aimeat-pill-cta-shadow,var(--sun,#FFB52E));transition:transform .12s,box-shadow .12s}",
      ".aimeat-sign-btn:hover{transform:translate(2px,2px);box-shadow:2px 2px 0 var(--aimeat-pill-cta-shadow,var(--sun,#FFB52E))}",
      /* Compact: the account button, and the pill as its popover. */
      ".aimeat-auth-wrap{position:relative;display:inline-flex;align-items:center}",
      ".aimeat-auth-compact{display:none;align-items:center;gap:7px;padding:5px 11px 5px 9px;cursor:pointer;",
      "background:" + paper2 + ";color:" + ink2 + ";border:2px solid " + ink2 + ";border-radius:var(--aimeat-pill-radius,0);",
      "font-family:" + font2 + ";font-size:13px}",
      ".aimeat-auth-compact .cdot{width:8px;height:8px;flex:0 0 auto;background:var(--aimeat-pill-live,var(--success,#10B981))}",
      ".aimeat-auth-compact .cini{font-weight:800;letter-spacing:.3px;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".aimeat-auth-compact .ccar{font-size:9px;opacity:.75;transition:transform .18s}",
      ".aimeat-auth-wrap.aimeat-open .aimeat-auth-compact .ccar{transform:rotate(180deg)}",
      "@media (max-width:600px){",
      ".aimeat-auth-compact{display:inline-flex}",
      ".aimeat-auth-wrap>.aimeat-auth-pill{position:absolute;top:calc(100% + 8px);right:0;z-index:1000;",
      "display:none!important;flex-wrap:wrap!important;justify-content:flex-start;row-gap:9px;padding:10px 12px;",
      "min-width:210px;max-width:calc(100vw - 24px);box-shadow:6px 6px 0 var(--aimeat-pill-cta-shadow,var(--sun,#FFB52E))}",
      ".aimeat-auth-wrap.aimeat-open>.aimeat-auth-pill{display:flex!important}",
      "}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }
  function pillInitials(s) {
    s = (s || "").trim();
    if (!s) return "•";
    s = s.split("@")[0].split("#")[0].trim();
    var parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    return s.slice(0, 2).toUpperCase();
  }

  // src/static/sdk-libs/auth/i18n.js
  var MODAL_LANG_KEY = "aimeat-lang";
  var MODAL_LANGS = ["en", "fi", "es"];
  function currentModalLang() {
    try {
      var u = new URLSearchParams(location.search).get("lang");
      if (MODAL_LANGS.indexOf(u) !== -1) return u;
      var s = localStorage.getItem(MODAL_LANG_KEY);
      if (MODAL_LANGS.indexOf(s) !== -1) return s;
    } catch {
    }
    var nav = (navigator.language || "en").slice(0, 2).toLowerCase();
    return MODAL_LANGS.indexOf(nav) !== -1 ? nav : "en";
  }
  function flattenModalI18n(obj, prefix, out) {
    out = out || {};
    prefix = prefix || "";
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var key = prefix ? prefix + "." + k : k;
      var v = obj[k];
      if (v && typeof v === "object" && !Array.isArray(v)) flattenModalI18n(v, key, out);
      else out[key] = v;
    }
    return out;
  }
  async function loadModalI18n(lang) {
    var v = Date.now();
    var t = {};
    try {
      var enRes = await fetch(NODE_URL + "/locales/en.json?v=" + v);
      if (enRes.ok) t = flattenModalI18n(await enRes.json());
    } catch {
    }
    if (lang !== "en") {
      try {
        var locRes = await fetch(NODE_URL + "/locales/" + lang + ".json?v=" + v);
        if (locRes.ok) {
          var loc = flattenModalI18n(await locRes.json());
          for (var lk in loc) if (Object.prototype.hasOwnProperty.call(loc, lk)) t[lk] = loc[lk];
        }
      } catch {
      }
    }
    var out = {};
    for (var k in t) {
      if (Object.prototype.hasOwnProperty.call(t, k) && k.indexOf("modal.") === 0) out[k.slice(6)] = t[k];
    }
    return out;
  }

  // src/static/sdk-libs/auth/modal-styles.js
  var ink = "var(--aimeat-ink)";
  var paper = "var(--aimeat-paper)";
  var dim = "var(--text-dim,#6B7280)";
  var line = "var(--border,#E5E7EB)";
  var accent = "var(--accent,#E8564A)";
  var sun = "var(--sun,#FFB52E)";
  var onSun = "var(--on-sun,#1A1A2E)";
  var okc = "var(--success-fg,#047857)";
  var font = "var(--font-showroom-body,'Archivo','DM Sans',system-ui,sans-serif)";
  var poster = "var(--font-poster,'Archivo Black','Archivo',system-ui,sans-serif)";
  var wordmark = "var(--font-wordmark,'Archivo Black','Archivo',system-ui,sans-serif)";
  var section = "var(--font-poster-section,'Archivo','DM Sans',system-ui,sans-serif)";
  var mono = "var(--font-mono,'JetBrains Mono','SF Mono',monospace)";
  var MODAL_CSS = [
    inkVarsCss([".aimeat-scrim"]),
    ".aimeat-scrim{position:fixed;inset:0;background:rgba(26,26,46,.4);backdrop-filter:blur(8px);display:flex;",
    "align-items:flex-start;justify-content:center;overflow-y:auto;z-index:99999;padding:24px;font-family:" + font + "}",
    ".aimeat-dlg{background:" + paper + ";color:" + ink + ";border:3px solid " + ink + ";box-shadow:12px 12px 0 " + sun + ";",
    "max-width:420px;width:100%;margin:auto;box-sizing:border-box}",
    ".aimeat-dlg.aimeat-in{animation:aimeatModalIn .3s ease}",
    "@keyframes aimeatModalIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",
    /* The head: the crumb, the masthead, the tabs. */
    ".aimeat-head{padding:22px 28px 0}",
    ".aimeat-crumb{display:flex;align-items:center;justify-content:space-between;gap:12px}",
    ".aimeat-brand{display:flex;align-items:baseline;gap:10px;min-width:0}",
    ".aimeat-mark{display:inline-flex;align-items:center;gap:1px;font-family:" + wordmark + ";font-weight:400;",
    "font-size:15px;letter-spacing:-.01em;line-height:1;color:" + ink + "}",
    ".aimeat-mark svg{width:13px;height:13px;fill:" + accent + "}",
    ".aimeat-mark b{font-weight:inherit;color:" + accent + "}",
    ".aimeat-host{font:400 12px/1 " + mono + ";color:" + dim + ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".aimeat-crumb-right{display:flex;align-items:center;gap:8px;flex:0 0 auto}",
    ".aimeat-close{appearance:none;width:26px;height:26px;padding:0;margin:0;display:inline-flex;align-items:center;justify-content:center;",
    "border:2px solid " + ink + ";background:transparent;color:" + ink + ";cursor:pointer;transition:color .12s,border-color .12s}",
    ".aimeat-close svg{width:12px;height:12px;stroke:currentColor;stroke-width:2.5;fill:none;stroke-linecap:square}",
    ".aimeat-close:hover{color:" + accent + ";border-color:" + accent + "}",
    ".aimeat-langsw{display:inline-flex;align-items:stretch;height:26px;flex:0 0 auto;border:2px solid " + ink + "}",
    ".aimeat-lang{appearance:none;border:0;background:transparent;color:" + ink + ";opacity:.6;font:700 11px/1 " + font + ";",
    "letter-spacing:.4px;padding:0 10px;margin:0;cursor:pointer;display:inline-flex;align-items:center;transition:opacity .12s}",
    ".aimeat-lang:hover{opacity:.9}",
    ".aimeat-lang.active{opacity:1;background:" + ink + ";color:" + paper + ";cursor:default}",
    ".aimeat-headline{margin:18px 0 0;font-family:" + poster + ";font-weight:var(--font-poster-weight,400);font-size:34px;",
    "line-height:var(--font-poster-leading,1);letter-spacing:var(--font-poster-tracking,.01em);color:" + ink + ";text-wrap:pretty}",
    ".aimeat-line{margin:10px 0 0;font-size:14px;line-height:1.5;font-weight:400;color:" + dim + "}",
    ".aimeat-tabs{display:flex;margin-top:18px;border-top:3px solid " + ink + "}",
    ".aimeat-tab{appearance:none;flex:1;background:none;border:0;border-bottom:2px solid transparent;border-radius:0;padding:10px 12px;",
    "cursor:pointer;font:600 13px/1.4 " + font + ";text-transform:uppercase;letter-spacing:.04em;color:" + dim + ";transition:color .15s}",
    ".aimeat-tab:hover{color:" + ink + "}",
    ".aimeat-tab.active{background:" + sun + ";color:" + onSun + ";border-bottom-color:" + ink + ";cursor:default}",
    /* The body and the sub-views share one padding; fields are underlines. */
    ".aimeat-body{padding:22px 28px 26px}",
    ".aimeat-field{margin-bottom:18px}",
    ".aimeat-label{display:flex;align-items:baseline;gap:8px;margin:0 0 2px;font:700 11.5px/1.4 " + font + ";",
    "letter-spacing:.1em;text-transform:uppercase;color:" + accent + "}",
    ".aimeat-opt{font:400 11px/1.4 " + mono + ";letter-spacing:0;text-transform:none;color:" + dim + "}",
    ".aimeat-inp{display:block;width:100%;box-sizing:border-box;background:transparent;border:0;border-bottom:3px solid " + ink + ";",
    "border-radius:0;padding:9px 0;font:400 16px/1.4 " + font + ";color:" + ink + ";outline:none;transition:border-color .15s}",
    ".aimeat-inp:focus{border-bottom-color:" + accent + "}",
    ".aimeat-inp::placeholder{color:" + dim + ";font-weight:600}",
    /* A field's hint waits until the person is in that field or has written in it, so the form
       reads as four labels and four lines until one of them is being filled. */
    ".aimeat-hint{margin:7px 0 0;font:400 12.5px/1.45 " + font + ";color:" + dim + "}",
    ".aimeat-field .aimeat-hint{display:none}",
    ".aimeat-field:focus-within .aimeat-hint{display:block}",
    /* The username rules: shown only while the person is in the field and has typed something,
       each turning green as it is met; leaving the field folds them away again. */
    ".aimeat-rules{display:none;margin-top:8px;flex-direction:column;gap:3px}",
    ".aimeat-field:focus-within .aimeat-rules.on{display:flex}",
    ".aimeat-rule{display:flex;align-items:center;gap:7px;font:400 12.5px/1.45 " + font + ";color:" + dim + "}",
    ".aimeat-rule svg{width:12px;height:12px;flex:0 0 auto}",
    ".aimeat-rule .r-ok{display:none}",
    ".aimeat-rule.ok{color:" + okc + "}",
    ".aimeat-rule.ok .r-ok{display:block}",
    ".aimeat-rule.ok .r-no{display:none}",
    /* The loud action is an ink slab; the quiet ones are underlined words. */
    ".aimeat-actions{display:flex;align-items:center;gap:22px;margin-top:4px}",
    ".aimeat-go{appearance:none;background:" + ink + ";color:" + paper + ";border:0;border-radius:0;padding:13px 20px;cursor:pointer;",
    "font:600 13px/1.4 " + font + ";text-transform:uppercase;letter-spacing:.04em;box-shadow:4px 4px 0 " + sun + ";",
    "transition:transform .12s,box-shadow .12s}",
    ".aimeat-go:hover{transform:translate(2px,2px);box-shadow:2px 2px 0 " + sun + "}",
    ".aimeat-go:disabled{opacity:.45;transform:none;cursor:default}",
    ".aimeat-cancel{appearance:none;background:none;border:0;border-bottom:2px solid " + ink + ";border-radius:0;padding:0 0 1px;",
    "cursor:pointer;font:600 12.5px/1.5 " + font + ";text-transform:uppercase;letter-spacing:.04em;color:" + ink + "}",
    ".aimeat-cancel:hover{color:" + accent + ";border-bottom-color:" + accent + "}",
    ".aimeat-links{display:flex;align-items:center;gap:18px;margin-top:16px}",
    ".aimeat-link{font:600 11.5px/1.5 " + font + ";text-transform:uppercase;letter-spacing:.04em;color:" + dim + ";",
    "text-decoration:none;border-bottom:2px solid " + dim + ";padding-bottom:1px;cursor:pointer}",
    ".aimeat-link:hover{color:" + accent + ";border-bottom-color:" + accent + "}",
    ".aimeat-err{margin:10px 0 0;font:600 13px/1.45 " + font + ";color:" + accent + ";display:none}",
    ".aimeat-msg{margin:10px 0 0;font:600 13px/1.45 " + font + ";color:" + okc + ";display:none}",
    /* Social sign-in: a mono "or" between hairlines, then ink-framed boxes. */
    ".aimeat-or{display:flex;align-items:center;gap:12px;margin:22px 0 18px}",
    ".aimeat-or span{flex:1;height:1px;background:" + line + "}",
    ".aimeat-or b{flex:0 0 auto;font:500 11px/1 " + mono + ";letter-spacing:.1em;text-transform:uppercase;color:" + accent + "}",
    ".aimeat-oauth-btn{appearance:none;width:100%;box-sizing:border-box;min-height:44px;display:flex;align-items:center;justify-content:center;",
    "gap:10px;margin-bottom:8px;padding:8px 12px;background:transparent;border:2px solid " + ink + ";border-radius:0;color:" + ink + ";",
    "cursor:pointer;font:600 14px/1.2 " + font + ";transition:border-color .15s,color .15s}",
    ".aimeat-oauth-btn:hover{border-color:" + accent + ";color:" + accent + "}",
    /* The sub-views (reset, recover, email code) open with a section headline. */
    ".aimeat-sub-title{margin:0 0 8px;font-family:" + section + ";font-weight:var(--font-poster-section-weight,400);font-size:21px;",
    "line-height:.95;text-transform:uppercase;letter-spacing:-.02em;color:" + ink + "}",
    ".aimeat-sub-desc{margin:0 0 16px;font:400 13.5px/1.5 " + font + ";color:" + dim + "}",
    /* What you get: a numbered index under an ink rule, the last line in bold. */
    ".aimeat-why{padding:18px 28px 22px;border-top:3px solid " + ink + "}",
    ".aimeat-why-title{margin:0 0 6px;font-family:" + section + ";font-weight:var(--font-poster-section-weight,400);font-size:21px;",
    "line-height:.95;text-transform:uppercase;letter-spacing:-.02em;color:" + ink + "}",
    ".aimeat-why-row{display:grid;grid-template-columns:28px minmax(0,1fr);gap:0 8px;align-items:baseline;padding:9px 0;",
    "border-bottom:1px solid " + line + ";font:400 13.5px/1.45 " + font + ";color:" + ink + "}",
    ".aimeat-why-row:last-child{border-bottom:0}",
    ".aimeat-why-row.strong{font-weight:600}",
    ".aimeat-why-num{font:400 12px/1.45 " + mono + ";color:" + accent + "}"
  ].join("");

  // src/static/sdk-libs/auth/modal-totp.js
  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 6);
  }
  function totpViewHtml(i, field) {
    return '<div id="aimeat-totp-view" class="aimeat-body" style="display:none"><h3 class="aimeat-sub-title">' + escHtml(i.totpTitle || "One more step") + '</h3><p class="aimeat-sub-desc">' + escHtml(i.totpDesc || "Your account asks for a code. Open your authenticator app and enter the six digits it shows.") + "</p>" + field(
      i.totpCodeLabel || "Code",
      '<input id="aimeat-totp-code" class="aimeat-inp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">'
    ) + field(
      i.totpBackupLabel || "Backup code",
      '<input id="aimeat-totp-backup" class="aimeat-inp" autocomplete="off" maxlength="16" placeholder="' + escHtml(i.totpBackupPlaceholder || "One of your backup codes") + '">',
      '<p class="aimeat-hint">' + escHtml(i.totpBackupHint || "Use this if you cannot reach the app. Each code works once.") + "</p>"
    ) + '<div class="aimeat-actions"><button id="aimeat-totp-go" class="aimeat-go">' + escHtml(i.totpSubmit || "Sign in") + '</button><button id="aimeat-totp-back" class="aimeat-cancel">' + escHtml(i.backToLogin || "Back to Login") + '</button></div><p id="aimeat-totp-err" class="aimeat-err"></p></div>';
  }
  function wireTotpStep(ctx) {
    var i = ctx.i;
    var pending = null;
    var codeEl = (
      /** @type {any} */
      document.getElementById("aimeat-totp-code")
    );
    var backupEl = (
      /** @type {any} */
      document.getElementById("aimeat-totp-backup")
    );
    var errEl = document.getElementById("aimeat-totp-err");
    var goBtn = (
      /** @type {any} */
      document.getElementById("aimeat-totp-go")
    );
    var backBtn = document.getElementById("aimeat-totp-back");
    if (!codeEl || !backupEl || !errEl || !goBtn || !backBtn) return { openTotpStep: function() {
    } };
    function fail(message) {
      errEl.textContent = message;
      errEl.style.display = "block";
    }
    function forget() {
      pending = null;
      codeEl.value = "";
      backupEl.value = "";
    }
    codeEl.addEventListener("input", function() {
      codeEl.value = onlyDigits(codeEl.value);
      if (codeEl.value) backupEl.value = "";
    });
    backupEl.addEventListener("input", function() {
      if (backupEl.value) codeEl.value = "";
    });
    [codeEl, backupEl].forEach(function(el) {
      el.addEventListener("keydown", function(e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (!goBtn.disabled) goBtn.click();
      });
    });
    backBtn.addEventListener("click", function() {
      forget();
      errEl.style.display = "none";
      ctx.showView("login");
    });
    goBtn.addEventListener("click", async function() {
      if (!pending) {
        ctx.showView("login");
        return;
      }
      var code = onlyDigits(codeEl.value);
      var backup = backupEl.value.trim();
      errEl.style.display = "none";
      if (!code && !backup) {
        fail(i.errTotpRequired || "Enter the code from your app, or one backup code.");
        return;
      }
      if (code && code.length !== 6) {
        fail(i.errTotpSix || "The code is six digits.");
        return;
      }
      var label = i.totpSubmit || "Sign in";
      goBtn.textContent = i.working || "Working...";
      goBtn.disabled = true;
      try {
        var session = await ctx.submit(
          pending.username,
          pending.password,
          code ? { totpCode: code } : { backupCode: backup }
        );
        forget();
        ctx.onSuccess(session);
      } catch (e) {
        if (e.code === "TOTP_LOCKED") fail(e.message);
        else if (e.code === "TOTP_REPLAY") fail(i.errTotpReplay || "That code was already used. Wait for your app to show the next one.");
        else if (e.code === "INVALID_TOTP") fail(i.errTotpWrong || "That code does not match. Check the app and try again.");
        else fail(e.message);
        codeEl.value = "";
        goBtn.textContent = label;
        goBtn.disabled = false;
      }
    });
    return {
      /** The password was right and the server asked for the second factor. */
      openTotpStep: function(username, password) {
        pending = { username, password };
        codeEl.value = "";
        backupEl.value = "";
        errEl.style.display = "none";
        goBtn.textContent = i.totpSubmit || "Sign in";
        goBtn.disabled = false;
        ctx.showView("totp");
        setTimeout(function() {
          codeEl.focus();
        }, 50);
      }
    };
  }

  // src/static/sdk-libs/auth/modal-recovery-views.js
  function recoveryViewsHtml(i, field) {
    return '<div id="aimeat-forgot-pw-view" class="aimeat-body" style="display:none"><div id="aimeat-fpw-step1"><h3 class="aimeat-sub-title">' + escHtml(i.resetPasswordTitle || "Reset Password") + '</h3><p class="aimeat-sub-desc">' + escHtml(i.resetPasswordDesc || "Enter your username to receive a reset code by email.") + "</p>" + field(i.usernameLabel || "Username", '<input id="aimeat-fpw-username" class="aimeat-inp" placeholder="' + escHtml(i.usernamePlaceholder || "Username") + '">') + '<div class="aimeat-actions"><button id="aimeat-fpw-send" class="aimeat-go">' + escHtml(i.sendResetCode || "Send Reset Code") + '</button><button id="aimeat-fpw-back" class="aimeat-cancel">' + escHtml(i.backToLogin || "Back to Login") + '</button></div><p id="aimeat-fpw-msg" class="aimeat-msg"></p><p id="aimeat-fpw-err" class="aimeat-err"></p></div><div id="aimeat-fpw-step2" style="display:none"><h3 class="aimeat-sub-title">' + escHtml(i.enterNewPasswordTitle || "Enter New Password") + '</h3><p class="aimeat-sub-desc">' + escHtml(i.resetCodeSent || "A reset code was sent to your email. Enter it below with your new password.") + "</p>" + field(i.codeLabel || "Reset Code", '<input id="aimeat-fpw-code" class="aimeat-inp" placeholder="123456" maxlength="6">') + field(i.newPasswordLabel || "New Password", '<input id="aimeat-fpw-newpass" type="password" class="aimeat-inp" placeholder="' + escHtml(i.newPasswordPlaceholder || "New password (min 8 chars)") + '">') + '<div class="aimeat-actions"><button id="aimeat-fpw-reset" class="aimeat-go">' + escHtml(i.resetPassword || "Reset Password") + '</button><button id="aimeat-fpw-back2" class="aimeat-cancel">' + escHtml(i.backToLogin || "Back to Login") + '</button></div><p id="aimeat-fpw-msg2" class="aimeat-msg"></p><p id="aimeat-fpw-err2" class="aimeat-err"></p></div></div><div id="aimeat-forgot-user-view" class="aimeat-body" style="display:none"><h3 class="aimeat-sub-title">' + escHtml(i.recoverUsernameTitle || "Recover Username") + '</h3><p class="aimeat-sub-desc">' + escHtml(i.recoverUsernameDesc || "Enter the email address associated with your account.") + "</p>" + field(i.emailLabel || "Email", '<input id="aimeat-fu-email" class="aimeat-inp" type="email" placeholder="you@example.com">') + '<div class="aimeat-actions"><button id="aimeat-fu-send" class="aimeat-go">' + escHtml(i.sendUsername || "Send My Username") + '</button><button id="aimeat-fu-back" class="aimeat-cancel">' + escHtml(i.backToLogin || "Back to Login") + '</button></div><p id="aimeat-fu-msg" class="aimeat-msg"></p></div><div id="aimeat-email-view" class="aimeat-body" style="display:none"><div id="aimeat-em-step1"><h3 class="aimeat-sub-title">' + escHtml(i.completeAccountTitle || "One last step") + '</h3><p class="aimeat-sub-desc">' + escHtml(i.completeAccountDesc || "Add an email to finish setting up your account. We’ll send a verification code to confirm it.") + "</p>" + field(i.emailLabel || "Email", '<input id="aimeat-em-email" class="aimeat-inp" type="email" placeholder="you@example.com">') + '<div class="aimeat-actions"><button id="aimeat-em-send" class="aimeat-go">' + escHtml(i.sendVerificationCode || "Send Verification Code") + '</button><button id="aimeat-em-back" class="aimeat-cancel">' + escHtml(i.backToLogin || "Back to Login") + '</button></div><p id="aimeat-em-err" class="aimeat-err"></p></div><div id="aimeat-em-step2" style="display:none"><h3 class="aimeat-sub-title">' + escHtml(i.enterCodeTitle || "Enter Verification Code") + '</h3><p class="aimeat-sub-desc">' + escHtml(i.enterCodeDesc || "We sent a 6-digit code to your email. Enter it below to finish and sign in.") + "</p>" + field(i.codeLabel || "Verification Code", '<input id="aimeat-em-code" class="aimeat-inp" placeholder="123456" maxlength="6" inputmode="numeric">') + '<div class="aimeat-actions"><button id="aimeat-em-confirm" class="aimeat-go">' + escHtml(i.confirmAndSignIn || "Confirm & Sign In") + '</button><button id="aimeat-em-back2" class="aimeat-cancel">' + escHtml(i.backToLogin || "Back to Login") + '</button></div><p id="aimeat-em-msg2" class="aimeat-msg"></p><p id="aimeat-em-err2" class="aimeat-err"></p></div></div>';
  }

  // src/static/sdk-libs/auth/http.js
  async function api(path, opts = {}) {
    const url = NODE_URL + path;
    const headers = { "Content-Type": "application/json", ...opts.headers };
    const resp = await fetch(url, { ...opts, headers });
    const data = await resp.json();
    if (!data.ok) {
      const err = (
        /** @type {Error & { code?: string, details?: unknown }} */
        new Error(data.error?.message || "API error")
      );
      err.code = data.error?.code;
      err.details = data.error?.details;
      throw err;
    }
    return data;
  }
  async function authApi(path, jwt, opts = {}) {
    return api(path, { ...opts, headers: { ...opts.headers, "Authorization": "Bearer " + jwt } });
  }

  // src/static/sdk-libs/auth/passkey.js
  function passkeySupported() {
    try {
      return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && !!(navigator.credentials && navigator.credentials.create && navigator.credentials.get);
    } catch {
      return false;
    }
  }
  function toBuffer(value) {
    var s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var raw = atob(s);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
  }
  function toB64u(buffer) {
    var bytes = new Uint8Array(buffer);
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function creationOptions(options) {
    var out = Object.assign({}, options);
    out.challenge = toBuffer(options.challenge);
    out.user = Object.assign({}, options.user, { id: toBuffer(options.user.id) });
    if (Array.isArray(options.excludeCredentials)) {
      out.excludeCredentials = options.excludeCredentials.map(function(c) {
        return Object.assign({}, c, { id: toBuffer(c.id) });
      });
    }
    return out;
  }
  function requestOptions(options) {
    var out = Object.assign({}, options);
    out.challenge = toBuffer(options.challenge);
    if (Array.isArray(options.allowCredentials)) {
      out.allowCredentials = options.allowCredentials.map(function(c) {
        return Object.assign({}, c, { id: toBuffer(c.id) });
      });
    }
    return out;
  }
  function isCancellation(err) {
    var name = err && err.name;
    return name === "NotAllowedError" || name === "AbortError";
  }
  function cancelled() {
    var e = (
      /** @type {Error & { code?: string }} */
      new Error("cancelled")
    );
    e.code = "PASSKEY_CANCELLED";
    return e;
  }
  async function passkeySignIn(username) {
    var started = await api("/v1/ghii/login/passkey/options", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(username ? { username } : {})
    });
    var assertion;
    try {
      assertion = await navigator.credentials.get({ publicKey: requestOptions(started.data.options) });
    } catch (err) {
      if (isCancellation(err)) throw cancelled();
      throw err;
    }
    if (!assertion) throw cancelled();
    var response = {
      id: assertion.id,
      rawId: toB64u(assertion.rawId),
      type: assertion.type,
      clientExtensionResults: assertion.getClientExtensionResults ? assertion.getClientExtensionResults() : {},
      response: {
        clientDataJSON: toB64u(assertion.response.clientDataJSON),
        authenticatorData: toB64u(assertion.response.authenticatorData),
        signature: toB64u(assertion.response.signature),
        userHandle: assertion.response.userHandle ? toB64u(assertion.response.userHandle) : void 0
      }
    };
    return api("/v1/ghii/login/passkey/verify", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ ceremony_id: started.data.ceremony_id, response })
    });
  }
  async function passkeyAdd(jwt, label) {
    var started = await authApi("/v1/ghii/passkeys/register/options", jwt, { method: "POST", body: "{}" });
    var credential;
    try {
      credential = await navigator.credentials.create({ publicKey: creationOptions(started.data.options) });
    } catch (err) {
      if (isCancellation(err)) throw cancelled();
      throw err;
    }
    if (!credential) throw cancelled();
    var response = {
      id: credential.id,
      rawId: toB64u(credential.rawId),
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
      response: {
        clientDataJSON: toB64u(credential.response.clientDataJSON),
        attestationObject: toB64u(credential.response.attestationObject),
        transports: credential.response.getTransports ? credential.response.getTransports() : []
      }
    };
    return authApi("/v1/ghii/passkeys/register/verify", jwt, {
      method: "POST",
      body: JSON.stringify({ ceremony_id: started.data.ceremony_id, response, label: label || "" })
    });
  }

  // src/static/sdk-libs/auth/modal-passkey.js
  var KEY_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="12" r="4"></circle><path d="M12 12h9M18 12v3M15 12v2"></path></svg>';
  function passkeyButtonHtml(i) {
    if (!passkeySupported()) return "";
    return '<button type="button" id="aimeat-passkey-btn" class="aimeat-oauth-btn">' + KEY_SVG + escHtml(i.passkeySignIn || "Sign in with a passkey") + '</button><p id="aimeat-passkey-hint" class="aimeat-hint">' + escHtml(i.passkeyHint || "Your fingerprint, face or screen lock. No password to remember.") + "</p>";
  }
  function wirePasskeyButton(ctx) {
    var i = ctx.i;
    var btn = (
      /** @type {any} */
      document.getElementById("aimeat-passkey-btn")
    );
    if (!btn) return;
    var errEl = document.getElementById("aimeat-error");
    btn.addEventListener("click", async function() {
      var label = i.passkeySignIn || "Sign in with a passkey";
      var nameEl = (
        /** @type {any} */
        document.getElementById("aimeat-username")
      );
      var typed = nameEl && !/[@]/.test(nameEl.value) ? nameEl.value.trim().toLowerCase() : "";
      if (errEl) errEl.style.display = "none";
      btn.textContent = i.working || "Working...";
      btn.disabled = true;
      try {
        var session = await ctx.signIn(typed || void 0);
        ctx.onSuccess(session);
      } catch (e) {
        if (e && e.code !== "PASSKEY_CANCELLED" && errEl) {
          errEl.textContent = e.code === "PASSKEY_UNKNOWN" ? i.errPasskeyUnknown || "This device is not registered here yet. Sign in another way, then add it under Account security." : e.message;
          errEl.style.display = "block";
        }
        btn.innerHTML = KEY_SVG + escHtml(label);
        btn.disabled = false;
      }
    });
  }

  // src/static/sdk-libs/auth/modal.js
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var OWNER_NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
  var NODE_HOST = (function() {
    try {
      return new URL(NODE_URL).host;
    } catch {
      return typeof location !== "undefined" && location.host || "";
    }
  })();
  var HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.8 8.2 3 4.5 6.7 4.5c2 0 3.6 1.1 4.5 2.6.9-1.5 2.5-2.6 4.5-2.6 3.7 0 5.9 3.7 4.3 7.3C19.5 16.4 12 21 12 21z"></path></svg>';
  var RULE_MARKS = '<svg class="r-ok" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3"></path></svg><svg class="r-no" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="2" width="8" height="8"></rect></svg>';
  function showLoginModal(opts, renderBtn) {
    var i = opts.i18n || {};
    var lang = currentModalLang();
    var tab = opts.tab === "register" ? "register" : "signin";
    const old = document.getElementById("aimeat-modal");
    if (old) old.remove();
    const modal = document.createElement("div");
    modal.id = "aimeat-modal";
    function captureInputs() {
      var g = function(id) {
        var el = (
          /** @type {any} */
          document.getElementById(id)
        );
        return el ? el.value : "";
      };
      return {
        u: g("aimeat-username"),
        p: g("aimeat-password"),
        ru: g("aimeat-reg-username"),
        rp: g("aimeat-reg-password"),
        rd: g("aimeat-reg-displayname"),
        re: g("aimeat-reg-email")
      };
    }
    function restoreInputs(vals) {
      var s = function(id, val) {
        var el = (
          /** @type {any} */
          document.getElementById(id)
        );
        if (!el || !val) return;
        el.value = val;
        try {
          el.dispatchEvent(new Event("input"));
        } catch {
        }
      };
      s("aimeat-username", vals.u);
      s("aimeat-password", vals.p);
      s("aimeat-reg-username", vals.ru);
      s("aimeat-reg-password", vals.rp);
      s("aimeat-reg-displayname", vals.rd);
      s("aimeat-reg-email", vals.re);
    }
    function switchLang(next) {
      if (next === lang) return;
      try {
        localStorage.setItem(MODAL_LANG_KEY, next);
        document.cookie = "aimeat-lang=" + next + ";path=/;max-age=31536000;SameSite=Lax";
      } catch {
      }
      var vals = captureInputs();
      loadModalI18n(next).then(function(fresh) {
        lang = next;
        if (fresh && Object.keys(fresh).length) i = fresh;
        render(false);
        restoreInputs(vals);
      });
    }
    function render(anim) {
      modal.innerHTML = buildModalInner(i, lang, anim, tab);
      wireModal();
    }
    document.body.appendChild(modal);
    render(true);
    loadModalI18n(lang).then(function(fresh) {
      if (!fresh || !Object.keys(fresh).length) return;
      var differs = false;
      for (var k in fresh) {
        if (Object.prototype.hasOwnProperty.call(fresh, k) && fresh[k] !== i[k]) {
          differs = true;
          break;
        }
      }
      if (!differs) return;
      var vals = captureInputs();
      i = fresh;
      render(false);
      restoreInputs(vals);
    });
    function buildModalInner(i2, lang2, anim, tab2) {
      var isReg = tab2 === "register";
      function rule(key, text) {
        return '<div class="aimeat-rule" data-rule="' + key + '">' + RULE_MARKS + "<span>" + escHtml(text) + "</span></div>";
      }
      function field(label, input, hint, opt) {
        return '<div class="aimeat-field"><label class="aimeat-label"><span>' + escHtml(label) + "</span>" + (opt ? '<span class="aimeat-opt">' + escHtml(opt) + "</span>" : "") + "</label>" + input + (hint || "") + "</div>";
      }
      return "<style>" + MODAL_CSS + '</style><div class="aimeat-scrim"><div class="aimeat-dlg' + (anim ? " aimeat-in" : "") + '"><div class="aimeat-head"><div class="aimeat-crumb"><div class="aimeat-brand"><span class="aimeat-mark">AIME' + HEART_SVG + "<b>AT</b></span>" + (NODE_HOST ? '<span class="aimeat-host">' + escHtml(NODE_HOST) + " /</span>" : "") + '</div><div class="aimeat-crumb-right"><div class="aimeat-langsw" role="group" aria-label="' + escHtml(i2.switchLanguage || "Language") + '">' + MODAL_LANGS.map(function(l) {
        return '<button type="button" class="aimeat-lang' + (lang2 === l ? " active" : "") + '" data-lang="' + l + '">' + l.toUpperCase() + "</button>";
      }).join("") + '</div><button type="button" id="aimeat-close-btn" class="aimeat-close" aria-label="' + escHtml(i2.closeDialog || "Close") + '"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"></path></svg></button></div></div><h2 class="aimeat-headline">' + escHtml(isReg ? i2.headlineNew || "Welcome in." : i2.headlineReturning || "Welcome back.") + '</h2><p class="aimeat-line">' + escHtml(isReg ? i2.lineNew || "Pick a username and password." : i2.descReturning || "Enter the username or email you signed up with.") + '</p><div class="aimeat-tabs" role="tablist"><button type="button" role="tab" class="aimeat-tab' + (isReg ? "" : " active") + '" data-tab="signin" aria-selected="' + (isReg ? "false" : "true") + '">' + escHtml(i2.tabSignIn || "Sign in") + '</button><button type="button" role="tab" class="aimeat-tab' + (isReg ? " active" : "") + '" data-tab="register" aria-selected="' + (isReg ? "true" : "false") + '">' + escHtml(i2.tabRegister || "Create account") + '</button></div></div><div id="aimeat-modal-body" class="aimeat-body"><div id="aimeat-tab-signin"' + (isReg ? ' style="display:none"' : "") + ">" + passkeyButtonHtml(i2) + field(
        i2.identifierLabel || "Username or email",
        '<input id="aimeat-username" class="aimeat-inp" autocomplete="username" placeholder="' + escHtml(i2.identifierPlaceholder || "Username or email") + '">'
      ) + field(
        i2.passwordLabel || "Password",
        '<input id="aimeat-password" type="password" autocomplete="current-password" class="aimeat-inp" placeholder="' + escHtml(i2.passwordPlaceholder || "Password") + '">'
      ) + '<div class="aimeat-actions"><button id="aimeat-go-btn" class="aimeat-go">' + escHtml(i2.signInOnlyBtn || "Sign in") + '</button><button id="aimeat-cancel-btn" class="aimeat-cancel">' + escHtml(i2.cancelBtn || "Cancel") + '</button></div><p id="aimeat-error" class="aimeat-err"></p><div class="aimeat-links"><a href="#" id="aimeat-forgot-pw" class="aimeat-link">' + escHtml(i2.forgotPassword || "Forgot password?") + '</a><a href="#" id="aimeat-forgot-user" class="aimeat-link">' + escHtml(i2.forgotUsername || "Forgot username?") + '</a></div></div><div id="aimeat-tab-register"' + (isReg ? "" : ' style="display:none"') + ">" + field(
        i2.usernameLabel || "Username",
        '<input id="aimeat-reg-username" class="aimeat-inp" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="64" placeholder="' + escHtml(i2.usernamePlaceholder || "Username") + '"><div id="aimeat-reg-rules" class="aimeat-rules">' + rule("len", i2.usernameRuleLength || "3 to 64 characters") + rule("chars", i2.usernameRuleChars || "Letters a to z, digits and hyphens") + rule("edges", i2.usernameRuleEdges || "Starts and ends with a letter or digit") + "</div>",
        '<p class="aimeat-hint">' + escHtml(i2.usernameLowercase || "Capital letters become lowercase.") + " " + escHtml(i2.usernameHint || "This becomes your permanent name here.") + "</p>"
      ) + (EMAIL_REQUIRED ? field(
        i2.emailLabel || "Email",
        '<input id="aimeat-reg-email" type="email" autocomplete="email" class="aimeat-inp" placeholder="you@example.com">',
        '<p class="aimeat-hint">' + escHtml(i2.registerEmailHint || "We send a 6-digit code here to confirm the address. You can sign in with it later.") + "</p>"
      ) : "") + field(
        i2.passwordLabel || "Password",
        '<input id="aimeat-reg-password" type="password" autocomplete="new-password" class="aimeat-inp" placeholder="' + escHtml(i2.passwordPlaceholder || "Password (min 8 chars)") + '">'
      ) + field(
        i2.displayNameLabel || "Display Name",
        '<input id="aimeat-reg-displayname" class="aimeat-inp" placeholder="' + escHtml(i2.displayNamePlaceholder || "Display Name") + '">',
        '<p class="aimeat-hint">' + escHtml(i2.displayNameWhy || "Worth filling in: without it, your username is the name everyone sees.") + "</p>",
        i2.displayNameOptional || "optional"
      ) + '<div class="aimeat-actions"><button id="aimeat-reg-btn" class="aimeat-go">' + escHtml(i2.createAccountBtn || "Create account") + '</button><button id="aimeat-reg-cancel-btn" class="aimeat-cancel">' + escHtml(i2.cancelBtn || "Cancel") + '</button></div><p id="aimeat-reg-error" class="aimeat-err"></p></div>' + (AUTH_PROVIDERS.length ? '<div class="aimeat-or"><span></span><b>' + escHtml(i2.orLabel || "OR") + "</b><span></span></div>" + AUTH_PROVIDERS.map(function(p) {
        return '<button type="button" class="aimeat-oauth-btn" data-provider="' + escHtml(p.id) + '">' + (PROVIDER_ICONS[p.id] || "") + escHtml(i2[p.i18nKey] || p.label) + "</button>";
      }).join("") : "") + "</div>" + recoveryViewsHtml(i2, field) + totpViewHtml(i2, field) + '<div id="aimeat-why" class="aimeat-why"' + (isReg ? "" : ' style="display:none"') + '><h4 class="aimeat-why-title">' + escHtml(i2.whyTitle || "What do you get?") + '</h4><div class="aimeat-why-row"><span class="aimeat-why-num">01</span><span>' + escHtml(i2.whyGhii || "Your own digital identity. Only you control it") + '</span></div><div class="aimeat-why-row"><span class="aimeat-why-num">02</span><span>' + escHtml(i2.whyPrivacy || "Your own private memory space, protected by your password") + '</span></div><div class="aimeat-why-row"><span class="aimeat-why-num">03</span><span>' + escHtml(i2.whyAgents || "Connect AI agents that remember you and work on your behalf") + '</span></div><div class="aimeat-why-row strong"><span class="aimeat-why-num">04</span><span>' + escHtml(i2.whyMorsels || "Your own AI-built apps and agents work for you: your own AI operating system.") + "</span></div></div></div></div>";
    }
    function wireModal() {
      modal.querySelectorAll(".aimeat-lang").forEach(function(b) {
        b.addEventListener("click", function() {
          switchLang(b.getAttribute("data-lang"));
        });
      });
      ["aimeat-cancel-btn", "aimeat-reg-cancel-btn", "aimeat-close-btn"].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener("click", function() {
          modal.remove();
        });
      });
      function holdsTypedInput() {
        var inputs = modal.querySelectorAll(".aimeat-inp");
        for (var k = 0; k < inputs.length; k++) if (
          /** @type {any} */
          inputs[k].value
        ) return true;
        return false;
      }
      var scrim = modal.querySelector(".aimeat-scrim");
      if (scrim) scrim.addEventListener("mousedown", function(e) {
        if (e.target === scrim && !holdsTypedInput()) modal.remove();
      });
      function onKey(e) {
        if (!document.body.contains(modal)) {
          document.removeEventListener("keydown", onKey);
          return;
        }
        if (e.key === "Escape" && !holdsTypedInput()) modal.remove();
      }
      document.addEventListener("keydown", onKey);
      modal.querySelectorAll(".aimeat-tab").forEach(function(b) {
        b.addEventListener("click", function() {
          var next = b.getAttribute("data-tab");
          if (next === tab) return;
          var vals = captureInputs();
          tab = next;
          render(false);
          restoreInputs(vals);
          var focusId = tab === "register" ? "aimeat-reg-username" : "aimeat-username";
          setTimeout(function() {
            var el = document.getElementById(focusId);
            if (el) el.focus();
          }, 30);
        });
      });
      var regUser = (
        /** @type {any} */
        document.getElementById("aimeat-reg-username")
      );
      var rulesEl = document.getElementById("aimeat-reg-rules");
      function syncUsernameRules() {
        if (!regUser || !rulesEl) return;
        var raw = String(regUser.value || "");
        var clean = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (clean !== raw) {
          var pos = Math.max(0, (regUser.selectionStart == null ? raw.length : regUser.selectionStart) - (raw.length - clean.length));
          regUser.value = clean;
          try {
            regUser.setSelectionRange(pos, pos);
          } catch {
          }
        }
        rulesEl.classList.toggle("on", clean.length > 0);
        var met = {
          len: clean.length >= 3 && clean.length <= 64,
          chars: clean.length > 0,
          edges: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(clean)
        };
        rulesEl.querySelectorAll(".aimeat-rule").forEach(function(r) {
          r.classList.toggle("ok", !!met[r.getAttribute("data-rule") || ""]);
        });
      }
      if (regUser) regUser.addEventListener("input", syncUsernameRules);
      modal.querySelectorAll(".aimeat-oauth-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var id = btn.getAttribute("data-provider") || "";
          if (!/^[a-z0-9_-]+(?::[a-z0-9_-]+)?$/i.test(id)) return;
          var back = encodeURIComponent(location.pathname + location.search + location.hash);
          location.href = NODE_URL + "/v1/ghii/login/" + id.split(":").join("/") + "?redirect=" + back;
        });
      });
      function showView(view) {
        document.getElementById("aimeat-modal-body").style.display = view === "login" ? "" : "none";
        document.getElementById("aimeat-forgot-pw-view").style.display = view === "forgot-pw" ? "" : "none";
        document.getElementById("aimeat-forgot-user-view").style.display = view === "forgot-user" ? "" : "none";
        document.getElementById("aimeat-email-view").style.display = view === "email" ? "" : "none";
        document.getElementById("aimeat-totp-view").style.display = view === "totp" ? "" : "none";
      }
      function finishLogin(session) {
        modal.remove();
        renderBtn();
        if (opts.onLogin) opts.onLogin(session);
      }
      wirePasskeyButton({
        i,
        signIn: function(username) {
          return auth.signInWithPasskey(username);
        },
        onSuccess: finishLogin
      });
      var totpStep = wireTotpStep({
        i,
        showView,
        submit: function(user, pass, secondFactor) {
          return auth.loginWithPassword(user, pass, secondFactor);
        },
        onSuccess: finishLogin
      });
      var pendingEmailLogin = null;
      function openEmailCompletion(user, pass, hasEmail, mode, displayName, prefillEmail) {
        pendingEmailLogin = { username: user, password: pass, mode: mode || "attach", displayName: displayName || user };
        showView("email");
        document.getElementById("aimeat-em-step1").style.display = "";
        document.getElementById("aimeat-em-step2").style.display = "none";
        var emailInput = (
          /** @type {any} */
          document.getElementById("aimeat-em-email")
        );
        emailInput.value = prefillEmail || "";
        var titleEl = document.querySelector("#aimeat-em-step1 h3");
        var desc = document.querySelector("#aimeat-em-step1 p");
        if (pendingEmailLogin.mode === "register") {
          if (titleEl) titleEl.textContent = i.registerEmailTitle || "Add your email";
          if (desc) desc.textContent = i.registerEmailDesc || "Enter your email to create your account. We’ll send a verification code to confirm it.";
        } else {
          if (titleEl) titleEl.textContent = i.completeAccountTitle || "One last step";
          if (desc) {
            desc.textContent = hasEmail ? i.completeAccountDescResend || "Confirm your email to finish signing in. We’ll send a verification code — edit the address if it’s wrong." : i.completeAccountDesc || "Add an email to finish setting up your account. We’ll send a verification code to confirm it.";
          }
        }
        document.getElementById("aimeat-em-err").style.display = "none";
        if (prefillEmail) {
          sendEmailCode();
          return;
        }
        setTimeout(function() {
          emailInput.focus();
        }, 50);
      }
      document.getElementById("aimeat-forgot-pw").addEventListener("click", function(e) {
        e.preventDefault();
        showView("forgot-pw");
        document.getElementById("aimeat-fpw-step1").style.display = "";
        document.getElementById("aimeat-fpw-step2").style.display = "none";
      });
      document.getElementById("aimeat-forgot-user").addEventListener("click", function(e) {
        e.preventDefault();
        showView("forgot-user");
      });
      ["aimeat-fpw-back", "aimeat-fpw-back2", "aimeat-fu-back", "aimeat-em-back", "aimeat-em-back2"].forEach(function(id) {
        document.getElementById(id).addEventListener("click", function() {
          showView("login");
        });
      });
      async function sendEmailCode() {
        var email = (
          /** @type {any} */
          document.getElementById("aimeat-em-email").value.trim()
        );
        var errEl = document.getElementById("aimeat-em-err");
        errEl.style.display = "none";
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          errEl.textContent = i.errEmailInvalid || "Please enter a valid email address.";
          errEl.style.display = "block";
          return;
        }
        if (!pendingEmailLogin) {
          showView("login");
          return;
        }
        var btn = (
          /** @type {any} */
          document.getElementById("aimeat-em-send")
        );
        btn.textContent = i.working || "Working...";
        btn.disabled = true;
        try {
          var res;
          if (pendingEmailLogin.mode === "register") {
            res = await api("/v1/ghii", {
              method: "POST",
              credentials: "include",
              body: JSON.stringify({
                username: pendingEmailLogin.username,
                display_name: pendingEmailLogin.displayName,
                password: pendingEmailLogin.password,
                email,
                // The account's locale, so the verification code arrives in the language the
                // person is reading right now. Without it every account was created locale-less
                // and every system email fell back to English (UX-remake v3, measured).
                locale: currentModalLang()
              })
            });
          } else {
            res = await api("/v1/ghii/login/attach-email", {
              method: "POST",
              body: JSON.stringify({ username: pendingEmailLogin.username, password: pendingEmailLogin.password, email })
            });
          }
          pendingEmailLogin.verificationId = res.data && res.data.verification_id;
          document.getElementById("aimeat-em-step1").style.display = "none";
          document.getElementById("aimeat-em-step2").style.display = "";
          setTimeout(function() {
            document.getElementById("aimeat-em-code").focus();
          }, 50);
        } catch (e) {
          errEl.textContent = e.message;
          errEl.style.display = "block";
        } finally {
          btn.textContent = i.sendVerificationCode || "Send Verification Code";
          btn.disabled = false;
        }
      }
      document.getElementById("aimeat-em-send").addEventListener("click", sendEmailCode);
      document.getElementById("aimeat-em-confirm").addEventListener("click", async function() {
        var code = (
          /** @type {any} */
          document.getElementById("aimeat-em-code").value.trim()
        );
        var msgEl = document.getElementById("aimeat-em-msg2");
        var errEl = document.getElementById("aimeat-em-err2");
        msgEl.style.display = "none";
        errEl.style.display = "none";
        if (!code) {
          errEl.textContent = i.errCodeRequired || "Enter the verification code.";
          errEl.style.display = "block";
          return;
        }
        if (!pendingEmailLogin) {
          showView("login");
          return;
        }
        var btn = (
          /** @type {any} */
          document.getElementById("aimeat-em-confirm")
        );
        btn.textContent = i.working || "Working...";
        btn.disabled = true;
        try {
          await api("/v1/ghii/verify-email", {
            method: "POST",
            body: JSON.stringify({ verification_id: pendingEmailLogin.verificationId, code })
          });
          msgEl.textContent = i.emailVerifiedSigningIn || "Verified! Signing you in...";
          msgEl.style.display = "block";
          var session = await auth.loginWithPassword(pendingEmailLogin.username, pendingEmailLogin.password);
          pendingEmailLogin = null;
          modal.remove();
          renderBtn();
          if (opts.onLogin) opts.onLogin(session);
        } catch (e) {
          errEl.textContent = e.message;
          errEl.style.display = "block";
          btn.textContent = i.confirmAndSignIn || "Confirm & Sign In";
          btn.disabled = false;
        }
      });
      document.getElementById("aimeat-fpw-send").addEventListener("click", async function() {
        var username = (
          /** @type {any} */
          document.getElementById("aimeat-fpw-username").value.trim().toLowerCase()
        );
        var msgEl = document.getElementById("aimeat-fpw-msg");
        var errEl = document.getElementById("aimeat-fpw-err");
        msgEl.style.display = "none";
        errEl.style.display = "none";
        if (!username) {
          errEl.textContent = i.errUserShort || "Username is required";
          errEl.style.display = "block";
          return;
        }
        try {
          await api("/v1/ghii/password/reset-request", { method: "POST", body: JSON.stringify({ username }) });
          msgEl.textContent = i.resetCodeSent || "If your account has a verified email, a reset code was sent.";
          msgEl.style.display = "block";
          document.getElementById("aimeat-fpw-step1").style.display = "none";
          document.getElementById("aimeat-fpw-step2").style.display = "";
          window.__aimeatResetUser = username;
        } catch (e) {
          errEl.textContent = e.message;
          errEl.style.display = "block";
        }
      });
      document.getElementById("aimeat-fpw-reset").addEventListener("click", async function() {
        var code = (
          /** @type {any} */
          document.getElementById("aimeat-fpw-code").value.trim()
        );
        var newPass = (
          /** @type {any} */
          document.getElementById("aimeat-fpw-newpass").value
        );
        var msgEl = document.getElementById("aimeat-fpw-msg2");
        var errEl = document.getElementById("aimeat-fpw-err2");
        msgEl.style.display = "none";
        errEl.style.display = "none";
        if (!code) {
          errEl.textContent = "Code is required";
          errEl.style.display = "block";
          return;
        }
        if (!newPass || newPass.length < 8) {
          errEl.textContent = i.errPassWeak || "Password must be at least 8 characters";
          errEl.style.display = "block";
          return;
        }
        try {
          await api("/v1/ghii/password/reset", { method: "POST", body: JSON.stringify({
            username: window.__aimeatResetUser || "",
            code,
            newPassword: newPass
          }) });
          msgEl.textContent = i.resetSuccess || "Password reset successful! You can now sign in.";
          msgEl.style.display = "block";
          setTimeout(function() {
            showView("login");
          }, 2e3);
        } catch (e) {
          errEl.textContent = e.message;
          errEl.style.display = "block";
        }
      });
      document.getElementById("aimeat-fu-send").addEventListener("click", async function() {
        var email = (
          /** @type {any} */
          document.getElementById("aimeat-fu-email").value.trim()
        );
        var msgEl = document.getElementById("aimeat-fu-msg");
        msgEl.style.display = "none";
        if (!email) return;
        try {
          await api("/v1/ghii/account/recover", { method: "POST", body: JSON.stringify({ email }) });
        } catch {
        }
        msgEl.textContent = i.usernameSent || "If an account with that email exists, your username was sent.";
        msgEl.style.display = "block";
      });
      [
        ["aimeat-username", "aimeat-go-btn"],
        ["aimeat-password", "aimeat-go-btn"],
        ["aimeat-reg-username", "aimeat-reg-btn"],
        ["aimeat-reg-email", "aimeat-reg-btn"],
        ["aimeat-reg-password", "aimeat-reg-btn"],
        ["aimeat-reg-displayname", "aimeat-reg-btn"]
      ].forEach(function(pair) {
        var el = document.getElementById(pair[0]);
        if (!el) return;
        el.addEventListener("keydown", function(e) {
          if (e.key !== "Enter") return;
          e.preventDefault();
          var btn = (
            /** @type {any} */
            document.getElementById(pair[1])
          );
          if (btn && !btn.disabled) btn.click();
        });
      });
      function releaseBtn(id, label) {
        var b = (
          /** @type {any} */
          document.getElementById(id)
        );
        if (!b) return;
        b.textContent = label;
        b.disabled = false;
      }
      document.getElementById("aimeat-go-btn").addEventListener("click", async () => {
        const raw = (
          /** @type {any} */
          document.getElementById("aimeat-username").value.trim().toLowerCase()
        );
        const password = (
          /** @type {any} */
          document.getElementById("aimeat-password").value
        );
        const errEl = document.getElementById("aimeat-error");
        const signInLabel = i.signInOnlyBtn || "Sign in";
        errEl.style.display = "none";
        const isEmail = EMAIL_RE.test(raw);
        let isFederated = false;
        let localName = raw;
        if (!isEmail && raw.includes("@")) {
          const nodePart = raw.substring(raw.indexOf("@") + 1);
          if (nodePart && nodePart !== NODE_ID) isFederated = true;
          else localName = raw.substring(0, raw.indexOf("@"));
        }
        if (!raw || !isEmail && localName.length < 3) {
          errEl.textContent = i.errIdentifierRequired || i.errUserShort || "Enter your username or email.";
          errEl.style.display = "block";
          return;
        }
        if (!password) {
          errEl.textContent = i.errPassRequired || "Enter your password.";
          errEl.style.display = "block";
          return;
        }
        const btn = (
          /** @type {any} */
          document.getElementById("aimeat-go-btn")
        );
        btn.textContent = isFederated ? i.connectingHome || "Connecting to home node..." : i.working || "Working...";
        btn.disabled = true;
        try {
          const session = await auth.loginWithPassword(isEmail || isFederated ? raw : localName, password);
          finishLogin(session);
        } catch (e) {
          if (e.code === "EMAIL_NOT_VERIFIED" && !isFederated) {
            releaseBtn("aimeat-go-btn", signInLabel);
            openEmailCompletion(localName, password, !!(e.details && e.details.has_email));
            return;
          }
          if (e.code === "TOTP_REQUIRED") {
            releaseBtn("aimeat-go-btn", signInLabel);
            totpStep.openTotpStep(isEmail || isFederated ? raw : localName, password);
            return;
          }
          if (e.code === "TOTP_LOCKED") {
            errEl.textContent = e.message;
            errEl.style.display = "block";
            releaseBtn("aimeat-go-btn", signInLabel);
            return;
          }
          errEl.textContent = e.message.includes("Invalid username or password") ? i.errWrongCredentials || "That username or email and password do not match an account here." : e.message;
          errEl.style.display = "block";
          releaseBtn("aimeat-go-btn", signInLabel);
        }
      });
      document.getElementById("aimeat-reg-btn").addEventListener("click", async () => {
        const username = (
          /** @type {any} */
          document.getElementById("aimeat-reg-username").value.trim().toLowerCase()
        );
        const password = (
          /** @type {any} */
          document.getElementById("aimeat-reg-password").value
        );
        const emailEl = (
          /** @type {any} */
          document.getElementById("aimeat-reg-email")
        );
        const email = emailEl ? emailEl.value.trim() : "";
        const displayName = (
          /** @type {any} */
          document.getElementById("aimeat-reg-displayname").value.trim() || username
        );
        const errEl = document.getElementById("aimeat-reg-error");
        const createLabel = i.createAccountBtn || "Create account";
        errEl.style.display = "none";
        if (!username || username.length < 3) {
          errEl.textContent = i.errUserShort || "Username must be at least 3 characters";
          errEl.style.display = "block";
          return;
        }
        if (!OWNER_NAME_RE.test(username)) {
          errEl.textContent = i.errUserInvalid || "A username is 3 to 64 characters: letters a to z, digits and hyphens, starting and ending with a letter or digit.";
          errEl.style.display = "block";
          return;
        }
        if (emailEl && !EMAIL_RE.test(email)) {
          errEl.textContent = i.errEmailInvalid || "Please enter a valid email address.";
          errEl.style.display = "block";
          return;
        }
        if (!password || password.length < 8) {
          errEl.textContent = i.errPassShort || "Password must be at least 8 characters";
          errEl.style.display = "block";
          return;
        }
        const btn = (
          /** @type {any} */
          document.getElementById("aimeat-reg-btn")
        );
        btn.textContent = i.working || "Working...";
        btn.disabled = true;
        if (emailEl) {
          releaseBtn("aimeat-reg-btn", createLabel);
          openEmailCompletion(username, password, false, "register", displayName, email);
          return;
        }
        try {
          const session = await auth.register(username, displayName, { password, locale: currentModalLang() });
          modal.remove();
          renderBtn();
          if (opts.onLogin) opts.onLogin(session);
        } catch (e) {
          if (e.code === "EMAIL_REQUIRED") {
            releaseBtn("aimeat-reg-btn", createLabel);
            openEmailCompletion(username, password, false, "register", displayName);
            return;
          }
          errEl.textContent = e.message.includes("already registered") || e.message.includes("NAME_TAKEN") ? i.errNameTaken || "That username is taken. If it is yours, sign in instead." : e.message;
          errEl.style.display = "block";
          releaseBtn("aimeat-reg-btn", createLabel);
        }
      });
    }
  }

  // src/static/sdk-libs/auth/cluster.js
  function ensureClusterStyles() {
    if (document.getElementById("aimeat-cluster-css")) return;
    var st = document.createElement("style");
    st.id = "aimeat-cluster-css";
    st.textContent = [
      /* The cluster row. Inherits text colour from its host (gold pill or page header). */
      ".aimeat-ctl{display:inline-flex;align-items:center;gap:6px}",
      /* Segmented group: one bordered pill, every option a button. */
      ".aimeat-seg{display:inline-flex;align-items:stretch;height:26px;flex:0 0 auto;",
      "border:2px solid currentColor;border-radius:var(--aimeat-pill-radius,0);",
      "overflow:hidden;background:transparent}",
      ".aimeat-seg button{appearance:none;border:0;background:transparent;color:currentColor;",
      'opacity:.6;font:700 11px/1 "Inter","Segoe UI",system-ui,sans-serif;letter-spacing:.4px;',
      "padding:0 10px;margin:0;cursor:pointer;display:inline-flex;align-items:center;gap:4px;",
      "transition:opacity var(--motion-fast,120ms) ease,background var(--motion-fast,120ms) ease}",
      ".aimeat-seg button:hover{opacity:.9}",
      ".aimeat-seg button:focus-visible{outline:2px solid currentColor;outline-offset:-2px;opacity:1}",
      '.aimeat-seg button[aria-pressed="true"]{opacity:1;',
      "background:var(--aimeat-ink);color:var(--aimeat-paper)}",
      ".aimeat-seg button+button{border-left:0}",
      ".aimeat-seg .seg-ico{font-size:13px;line-height:1}",
      /* A control that has stood down. The group keeps its frame so it still reads as an
         instrument that exists, and the whole thing dims and takes the arrow cursor so nobody
         aims at it twice — the reason is on the group's title, because a native tooltip on a
         disabled button never appears. Used by a page that keeps its own palette (a genre body). */
      ".aimeat-seg--fixed{opacity:.55;cursor:default}",
      ".aimeat-seg button[disabled]{cursor:default;opacity:.6}",
      ".aimeat-seg button[disabled]:hover{opacity:.6}",
      /* Popover trigger (palette picker; language picker when 4+ languages). */
      ".aimeat-pop-wrap{position:relative;display:inline-flex;flex:0 0 auto}",
      ".aimeat-pop-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;",
      "gap:5px;height:26px;min-width:26px;padding:0 6px;background:transparent;",
      "border:2px solid currentColor;border-radius:var(--aimeat-pill-radius,0);",
      'cursor:pointer;color:currentColor;font:700 11px/1 "Inter","Segoe UI",system-ui,sans-serif;letter-spacing:.4px;',
      "transition:background var(--motion-fast,120ms) ease}",
      ".aimeat-pop-btn:hover{background:color-mix(in oklab,currentColor 12%,transparent)}",
      ".aimeat-pop-btn:focus-visible{outline:2px solid currentColor;outline-offset:-2px}",
      /* The popover panel: a real themed surface (not the host pill), so swatches read true. */
      ".aimeat-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:1200;display:none;",
      "background:var(--color-base-200,#ffffff);color:var(--color-base-content,#1a1a2e);",
      "border:1px solid var(--color-base-300,#d9dbe1);border-radius:var(--radius-box,14px);",
      "box-shadow:var(--elev-pop,0 4px 10px rgb(15 18 25 / .1),0 18px 44px rgb(15 18 25 / .16));",
      "padding:8px;width:max-content;max-width:calc(100vw - 24px)}",
      ".aimeat-pop-wrap.aimeat-open .aimeat-pop{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}",
      ".aimeat-pop.aimeat-pop-list{grid-template-columns:minmax(0,1fr)}",
      ".aimeat-pop button{appearance:none;display:flex;align-items:center;gap:8px;padding:7px 9px;margin:0;",
      "background:transparent;border:1px solid transparent;border-radius:calc(var(--radius-box,14px) - 6px);",
      'cursor:pointer;color:inherit;font:600 12px/1.1 "Inter","Segoe UI",system-ui,sans-serif;text-align:left;',
      "transition:background var(--motion-fast,120ms) ease}",
      ".aimeat-pop button:hover{background:color-mix(in oklab,currentColor 8%,transparent)}",
      ".aimeat-pop button:focus-visible{outline:2px solid var(--color-primary,#e8564a);outline-offset:-2px}",
      '.aimeat-pop button[aria-pressed="true"]{border-color:var(--color-primary,#e8564a)}',
      /* Palette swatch chips: page/card/accent of the palette IN THE CURRENT MODE. The three
         colours are data (they vary per palette), so they arrive as inline background values on
         these spans — layout and everything else stays here. */
      ".aimeat-pal-chip{position:relative;flex:0 0 auto;width:26px;height:20px;border-radius:5px;",
      "border:1px solid color-mix(in oklab,currentColor 25%,transparent);overflow:hidden}",
      ".aimeat-pal-chip .pc-card{position:absolute;inset:5px 5px 3px 5px;border-radius:3px}",
      ".aimeat-pal-chip .pc-acc{position:absolute;right:3px;bottom:3px;width:7px;height:7px;border-radius:50%}",
      /* The trigger's miniature: the active palette's accent as a dot. */
      ".aimeat-pal-dot{width:12px;height:12px;border-radius:50%;flex:0 0 auto;",
      "border:1px solid color-mix(in oklab,currentColor 30%,transparent)}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }
  function clampPopover(pop) {
    pop.style.transform = "";
    var r = pop.getBoundingClientRect();
    var pad = 12;
    var shift = 0;
    if (r.left < pad) shift = pad - r.left;
    else if (r.right > window.innerWidth - pad) shift = window.innerWidth - pad - r.right;
    if (shift) pop.style.transform = "translateX(" + Math.round(shift) + "px)";
  }

  // src/static/sdk-libs/auth/locale.js
  var AIMEAT_LANG_KEY = "aimeat-lang";
  function readLocales(opts) {
    var list = opts && Array.isArray(opts.locales) ? opts.locales : null;
    if (!list) {
      try {
        var m = (
          /** @type {HTMLMetaElement|null} */
          document.querySelector('meta[name="aimeat-locales"]')
        );
        if (m && m.content) list = m.content.split(/[\s,]+/);
      } catch {
      }
    }
    if (!list) return [];
    var seen = {}, out = [];
    for (var i = 0; i < list.length; i++) {
      var c = String(list[i] || "").trim().toLowerCase();
      if (/^[a-z]{2}$/.test(c) && !seen[c]) {
        seen[c] = 1;
        out.push(c);
      }
    }
    return out.length > 1 ? out : [];
  }
  function aimeatReadLang(locales) {
    var ok = function(v) {
      return v && locales.indexOf(v) >= 0 ? v : null;
    };
    try {
      var u = ok(new URLSearchParams(location.search).get("lang"));
      if (u) return u;
      var s = ok(localStorage.getItem(AIMEAT_LANG_KEY));
      if (s) return s;
      var c = document.cookie.match(/(?:^|;\s*)aimeat-lang=([a-z]{2})(?:;|$)/);
      if (c && ok(c[1])) return c[1];
    } catch {
    }
    var nav = ok((navigator.language || "").slice(0, 2).toLowerCase());
    return nav || locales[0];
  }
  function aimeatApplyLang(lang) {
    try {
      localStorage.setItem(AIMEAT_LANG_KEY, lang);
      document.cookie = "aimeat-lang=" + lang + ";path=/;max-age=31536000;SameSite=Lax";
    } catch {
    }
    try {
      document.documentElement.setAttribute("lang", lang);
    } catch {
    }
    try {
      window.dispatchEvent(new CustomEvent("aimeat-lang-change", { detail: { lang } }));
    } catch {
    }
  }
  function langName(code) {
    try {
      var dn = new Intl.DisplayNames([code], { type: "language" });
      var n = dn.of(code);
      if (n && n !== code) return n.charAt(0).toUpperCase() + n.slice(1);
    } catch {
    }
    return code.toUpperCase();
  }
  var SEGMENT_MAX = 3;
  function langSwitchHtml(i, locales) {
    if (!locales.length) return "";
    var cur = aimeatReadLang(locales);
    var group = i && i.switchLanguage ? i.switchLanguage : "Language";
    if (locales.length <= SEGMENT_MAX) {
      return '<span id="aimeat-lang-switch" class="aimeat-seg" role="group" aria-label="' + escHtml(group) + '">' + locales.map(function(c) {
        return '<button type="button" data-lang="' + escHtml(c) + '" aria-pressed="' + (c === cur) + '" title="' + escHtml(langName(c)) + '" aria-label="' + escHtml(langName(c)) + '">' + escHtml(c.toUpperCase()) + "</button>";
      }).join("") + "</span>";
    }
    return '<span id="aimeat-lang-switch" class="aimeat-pop-wrap"><button type="button" class="aimeat-pop-btn" aria-haspopup="listbox" aria-expanded="false" title="' + escHtml(group) + '" aria-label="' + escHtml(group) + '">' + escHtml(cur.toUpperCase()) + ' <span aria-hidden="true">▾</span></button><span class="aimeat-pop aimeat-pop-list" role="listbox">' + locales.map(function(c) {
      return '<button type="button" role="option" data-lang="' + escHtml(c) + '" aria-pressed="' + (c === cur) + '">' + escHtml(c.toUpperCase()) + " · " + escHtml(langName(c)) + "</button>";
    }).join("") + "</span></span>";
  }
  function wireLangSwitch(container, i, locales) {
    var root = container.querySelector("#aimeat-lang-switch");
    if (!root || !locales.length) return;
    var trigger = root.querySelector(".aimeat-pop-btn");
    function sync(cur) {
      root.querySelectorAll("button[data-lang]").forEach(function(b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === cur));
      });
      if (trigger) trigger.childNodes[0].textContent = cur.toUpperCase() + " ";
    }
    root.querySelectorAll("button[data-lang]").forEach(function(b) {
      b.addEventListener("click", function() {
        aimeatApplyLang(b.getAttribute("data-lang"));
        sync(b.getAttribute("data-lang"));
        root.classList.remove("aimeat-open");
        if (trigger) trigger.setAttribute("aria-expanded", "false");
      });
    });
    if (trigger) trigger.addEventListener("click", function(ev) {
      ev.stopPropagation();
      var open = root.classList.toggle("aimeat-open");
      trigger.setAttribute("aria-expanded", String(open));
      if (open) clampPopover(root.querySelector(".aimeat-pop"));
    });
    window.addEventListener("aimeat-lang-change", function(ev) {
      var e = (
        /** @type {CustomEvent} */
        ev
      );
      var lang = e && e.detail && e.detail.lang;
      if (lang && locales.indexOf(lang) >= 0) sync(lang);
    });
  }

  // src/static/sdk-libs/auth/pill-strings.js
  var PILL_STRINGS = {
    en: {
      loggedIn: "logged in",
      logoutBtn: "Logout",
      signInBtn: "❤️ Sign In",
      account: "Account",
      federated: "Federated",
      manageAccess: "Manage permissions",
      lightMode: "Light mode",
      darkMode: "Dark mode",
      themeLabel: "Theme",
      fixedRegister: "This register keeps its own light",
      chooseLook: "Choose look",
      switchLanguage: "Language"
    },
    fi: {
      loggedIn: "kirjautuneena",
      logoutBtn: "Kirjaudu ulos",
      signInBtn: "❤️ Kirjaudu",
      account: "Tili",
      federated: "Federoitu",
      manageAccess: "Hallitse oikeuksia",
      lightMode: "Vaalea tila",
      darkMode: "Tumma tila",
      themeLabel: "Teema",
      fixedRegister: "Tämä rekisteri pitää oman valonsa",
      chooseLook: "Valitse tyyli",
      switchLanguage: "Kieli"
    },
    es: {
      loggedIn: "sesión iniciada",
      logoutBtn: "Cerrar sesión",
      signInBtn: "❤️ Entrar",
      account: "Cuenta",
      federated: "Federado",
      manageAccess: "Gestionar permisos",
      lightMode: "Modo claro",
      darkMode: "Modo oscuro",
      themeLabel: "Tema",
      fixedRegister: "Este registro conserva su propia luz",
      chooseLook: "Elige el aspecto",
      switchLanguage: "Idioma"
    }
  };
  function pillStrings(lang) {
    var base = PILL_STRINGS.en;
    var over = PILL_STRINGS[lang] || {};
    var out = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = over[k] || base[k];
    return out;
  }

  // src/static/sdk-libs/auth/palette.js
  var AIMEAT_PALETTE_KEY = "aimeat-palette";
  var PALETTES = [
    { id: "aimeat", label: "AIMEAT", swatch: {
      light: { bg: "#eaeef7", card: "#ffffff", accent: "#e8564a" },
      dark: { bg: "#14151a", card: "#21232e", accent: "#ff6f62" }
    } },
    { id: "paper", label: "Paper", swatch: {
      light: { bg: "#eae2cf", card: "#fdfaf1", accent: "#a03040" },
      dark: { bg: "#151110", card: "#282017", accent: "#e08590" }
    } },
    { id: "circuit", label: "Circuit", swatch: {
      light: { bg: "#e9edf1", card: "#ffffff", accent: "#0e7290" },
      dark: { bg: "#0a0f14", card: "#18202b", accent: "#4fd2f2" }
    } },
    { id: "contrast", label: "Contrast", swatch: {
      light: { bg: "#e9e9e9", card: "#ffffff", accent: "#1d4ed8" },
      dark: { bg: "#000000", card: "#17171c", accent: "#99c2ff" }
    } },
    { id: "mist", label: "Mist", swatch: {
      light: { bg: "#e6eae4", card: "#fbfcfa", accent: "#47695a" },
      dark: { bg: "#141715", card: "#252b27", accent: "#9cc0ae" }
    } },
    { id: "voltage", label: "Voltage", swatch: {
      light: { bg: "#f1e4d2", card: "#ffffff", accent: "#c2187e" },
      dark: { bg: "#150d20", card: "#2c1d3f", accent: "#ff4fa8" }
    } }
  ];
  function aimeatReadPalette() {
    var ids = PALETTES.map(function(p) {
      return p.id;
    });
    try {
      var u = new URLSearchParams(location.search).get("palette");
      if (u && ids.indexOf(u) >= 0) return u;
    } catch {
    }
    try {
      var s = localStorage.getItem(AIMEAT_PALETTE_KEY);
      if (s && ids.indexOf(s) >= 0) return s;
    } catch {
    }
    var attr = document.documentElement.getAttribute("data-palette");
    return attr && ids.indexOf(attr) >= 0 ? attr : PALETTES[0].id;
  }
  function aimeatApplyPalette(id) {
    if (id === PALETTES[0].id) document.documentElement.removeAttribute("data-palette");
    else document.documentElement.setAttribute("data-palette", id);
    try {
      localStorage.setItem(AIMEAT_PALETTE_KEY, id);
    } catch {
    }
    try {
      window.dispatchEvent(new CustomEvent("aimeat-palette-change", { detail: { palette: id } }));
    } catch {
    }
  }
  function aimeatRestorePalette() {
    var cur = aimeatReadPalette();
    if (cur !== PALETTES[0].id) document.documentElement.setAttribute("data-palette", cur);
    else document.documentElement.removeAttribute("data-palette");
    try {
      window.addEventListener("storage", function(e) {
        if (e.key === AIMEAT_PALETTE_KEY && e.newValue) aimeatApplyPalette(e.newValue);
      });
    } catch {
    }
  }
  function paletteControlHtml(i) {
    var cur = aimeatReadPalette();
    var mode = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    var curAcc = (PALETTES.find(function(p) {
      return p.id === cur;
    }) || PALETTES[0]).swatch[mode].accent;
    var label = i && i.chooseLook || "Choose look";
    return '<span id="aimeat-palette-switch" class="aimeat-pop-wrap"><button type="button" class="aimeat-pop-btn" aria-haspopup="listbox" aria-expanded="false" title="' + esc(label) + '" aria-label="' + esc(label) + '"><span class="aimeat-pal-dot" style="background:' + esc(curAcc) + '"></span></button><span class="aimeat-pop" role="listbox">' + PALETTES.map(function(p) {
      var s = p.swatch[mode];
      return '<button type="button" role="option" data-palette="' + esc(p.id) + '" aria-pressed="' + (p.id === cur) + '"><span class="aimeat-pal-chip" style="background:' + esc(s.bg) + '"><span class="pc-card" style="background:' + esc(s.card) + '"></span><span class="pc-acc" style="background:' + esc(s.accent) + '"></span></span>' + esc(p.label) + "</button>";
    }).join("") + "</span></span>";
  }
  function wirePaletteControl(container, clampPopover2) {
    var root = container.querySelector("#aimeat-palette-switch");
    if (!root) return;
    var trigger = (
      /** @type {HTMLElement} */
      root.querySelector(".aimeat-pop-btn")
    );
    function syncDot() {
      var cur = aimeatReadPalette();
      var mode = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      var p = PALETTES.find(function(x) {
        return x.id === cur;
      }) || PALETTES[0];
      var dot = (
        /** @type {HTMLElement|null} */
        root.querySelector(".aimeat-pal-dot")
      );
      if (dot) dot.style.background = p.swatch[mode].accent;
      root.querySelectorAll("button[data-palette]").forEach(function(b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-palette") === cur));
        var pp = PALETTES.find(function(x) {
          return x.id === b.getAttribute("data-palette");
        });
        if (!pp) return;
        var s = pp.swatch[mode];
        var chip = (
          /** @type {HTMLElement|null} */
          b.querySelector(".aimeat-pal-chip")
        );
        var card = (
          /** @type {HTMLElement|null} */
          b.querySelector(".pc-card")
        );
        var acc = (
          /** @type {HTMLElement|null} */
          b.querySelector(".pc-acc")
        );
        if (chip) chip.style.background = s.bg;
        if (card) card.style.background = s.card;
        if (acc) acc.style.background = s.accent;
      });
    }
    root.querySelectorAll("button[data-palette]").forEach(function(b) {
      b.addEventListener("click", function() {
        aimeatApplyPalette(b.getAttribute("data-palette") || PALETTES[0].id);
        syncDot();
        root.classList.remove("aimeat-open");
        trigger.setAttribute("aria-expanded", "false");
      });
    });
    trigger.addEventListener("click", function(ev) {
      ev.stopPropagation();
      var open = root.classList.toggle("aimeat-open");
      trigger.setAttribute("aria-expanded", String(open));
      if (open) clampPopover2(
        /** @type {HTMLElement} */
        root.querySelector(".aimeat-pop")
      );
    });
    window.addEventListener("aimeat-palette-change", syncDot);
    window.addEventListener("aimeat-theme-change", syncDot);
  }
  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // src/static/sdk-libs/auth/pill.js
  function mountPill(auth2, selector, opts = {}) {
    let container;
    if (selector && typeof selector === "object" && selector.nodeType === 1) {
      container = selector;
    } else if (selector && typeof selector === "object") {
      opts = selector;
      container = document.getElementById("aimeat-auth-bar");
      if (!container) {
        container = document.createElement("div");
        container.id = "aimeat-auth-bar";
        document.body.appendChild(container);
      }
    } else {
      container = document.querySelector(selector);
      if (!container) {
        console.error("AIMEAT: mountLoginButton container not found for selector:", selector, "— pass a CSS selector string, a DOM element, or an options object.");
        return;
      }
    }
    const locales = readLocales(opts);
    let i = Object.assign({}, pillStrings(aimeatReadLang(locales.length ? locales : ["en"])), opts.i18n);
    const useCompact = opts.compact !== void 0 ? !!opts.compact : isAppOrigin();
    function render() {
      i = Object.assign({}, pillStrings(aimeatReadLang(locales.length ? locales : ["en"])), opts.i18n);
      const stored = auth2.getSession() || load("session");
      if (stored) {
        var pillHtml = '<div class="aimeat-auth-pill"><span class="aimeat-auth-dot" aria-hidden="true"></span><span class="aimeat-auth-label">' + escHtml(i.loggedIn || "logged in") + '</span><span class="aimeat-auth-ghii">' + escHtml(stored.displayName || stored.ghii || stored.owner) + "</span>" + (stored.federated ? '<span class="aimeat-auth-fed">🌐 ' + escHtml(i.federated || "Federated") + "</span>" : "") + (stored._appOrigin && stored._app && !stored._own ? '<button id="aimeat-grant-gear" class="aimeat-auth-gear" title="' + escHtml(i.manageAccess || "Manage permissions") + '" aria-label="' + escHtml(i.manageAccess || "Manage permissions") + '">⚙️</button>' : "") + '<span class="aimeat-ctl">' + langSwitchHtml(i, locales) + modeSwitchHtml(i) + paletteControlHtml(i) + '</span><button id="aimeat-logout-btn" class="aimeat-auth-logout">' + escHtml(i.logoutBtn || "Logout") + "</button></div>";
        ensureAuthPillStyles();
        if (useCompact) {
          var ini = pillInitials(stored.displayName || stored.ghii || stored.owner);
          container.innerHTML = '<div class="aimeat-auth-wrap"><button class="aimeat-auth-compact" id="aimeat-auth-compact" aria-haspopup="true" aria-expanded="false" aria-label="' + escHtml(i.account || "Account") + '"><span class="cdot" aria-hidden="true"></span><span class="cini">' + escHtml(ini) + '</span><span class="ccar" aria-hidden="true">▾</span></button>' + pillHtml + "</div>";
        } else {
          container.innerHTML = pillHtml;
        }
        document.getElementById("aimeat-logout-btn").addEventListener("click", () => {
          auth2.logout();
        });
        var gearBtn = document.getElementById("aimeat-grant-gear");
        if (gearBtn) gearBtn.addEventListener("click", () => {
          auth2.manageGrant().then(() => {
            render();
          }).catch(() => {
          });
        });
        var compactBtn = document.getElementById("aimeat-auth-compact");
        if (compactBtn) compactBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          var w = container.querySelector(".aimeat-auth-wrap");
          if (!w) return;
          var open = w.classList.toggle("aimeat-open");
          compactBtn.setAttribute("aria-expanded", open ? "true" : "false");
        });
      } else {
        ensureAuthPillStyles();
        container.innerHTML = '<span class="aimeat-auth-out"><span class="aimeat-ctl">' + langSwitchHtml(i, locales) + modeSwitchHtml(i) + paletteControlHtml(i) + '</span><button id="aimeat-login-btn" class="aimeat-sign-btn">' + (opts.buttonText || i.signInBtn || "❤️ Sign In") + "</button></span>";
        document.getElementById("aimeat-login-btn").addEventListener("click", () => {
          if (isAppOrigin()) {
            restoreSessionFromAppOrigin(true).then((s) => {
              if (s) render();
            }).catch(() => {
            });
          } else {
            showLoginModal(opts, render);
          }
        });
      }
      wireModeSwitch(container);
      wireLangSwitch(container, i, locales);
      wirePaletteControl(container, clampPopover);
    }
    ensureClusterStyles();
    render();
    window.addEventListener("aimeat-lang-change", render);
    document.addEventListener("click", (ev) => {
      container.querySelectorAll(".aimeat-pop-wrap.aimeat-open").forEach((w) => {
        if (!w.contains(
          /** @type {Node} */
          ev.target
        )) {
          w.classList.remove("aimeat-open");
          var b = w.querySelector(".aimeat-pop-btn");
          if (b) b.setAttribute("aria-expanded", "false");
        }
      });
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      container.querySelectorAll(".aimeat-pop-wrap.aimeat-open").forEach((w) => {
        w.classList.remove("aimeat-open");
        var b = w.querySelector(".aimeat-pop-btn");
        if (b) b.setAttribute("aria-expanded", "false");
      });
    });
    if (useCompact) {
      var closeCompact = () => {
        var w = container.querySelector(".aimeat-auth-wrap.aimeat-open");
        if (!w) return;
        w.classList.remove("aimeat-open");
        var cb = w.querySelector(".aimeat-auth-compact");
        if (cb) cb.setAttribute("aria-expanded", "false");
      };
      document.addEventListener("click", (ev) => {
        var w = container.querySelector(".aimeat-auth-wrap.aimeat-open");
        if (w && !w.contains(ev.target)) closeCompact();
      });
      document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") closeCompact();
      });
    }
    auth2.on("login", render);
    auth2.on("logout", () => {
      render();
      if (opts.onLogout) opts.onLogout();
    });
    auth2.on("session-updated", render);
    if (isAppOrigin() && !auth2.getSession()) {
      restoreSessionFromAppOrigin(false).then((s) => {
        if (!s && load("session")) {
          remove("session");
          emit("logout");
        }
      }).catch(() => {
      });
    }
  }

  // src/static/sdk-libs/auth/pkce.js
  function b64url(buf) {
    var bytes = new Uint8Array(buf), s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function pkce() {
    var verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
    if (crypto.subtle && crypto.subtle.digest) {
      var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      return { verifier, challenge: b64url(digest), method: "S256" };
    }
    return { verifier, challenge: verifier, method: "plain" };
  }

  // src/static/sdk-libs/auth/app-origin.js
  function isAppOrigin() {
    try {
      return location.origin !== new URL(APEX_URL).origin;
    } catch {
      return false;
    }
  }
  function appScopeDrift(session) {
    if (!session || !session._appOrigin || !session.jwt) return [];
    var have = (parseJwt(session.jwt) || {}).scopes || [];
    return appDeclaredScopes().split(" ").filter(function(s) {
      return s && have.indexOf(s) < 0;
    });
  }
  function silentAppToken() {
    return new Promise(function(resolve) {
      var apexOrigin;
      try {
        apexOrigin = new URL(APEX_URL).origin;
      } catch {
        resolve(null);
        return;
      }
      if (location.origin === apexOrigin) {
        resolve(null);
        return;
      }
      var settled = false, iframe = null, timer = null;
      function finish(v) {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onMsg);
        if (timer) clearTimeout(timer);
        if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
        resolve(v);
      }
      function onMsg(e) {
        if (e.origin !== apexOrigin) return;
        var d = e.data || {};
        if (d.type !== "aimeat_app_login") return;
        finish(d.result || null);
      }
      window.addEventListener("message", onMsg);
      iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.setAttribute("aria-hidden", "true");
      iframe.src = apexOrigin + "/app-silent.html?scope=" + encodeURIComponent(appDeclaredScopes());
      (document.body || document.documentElement).appendChild(iframe);
      timer = setTimeout(function() {
        finish(null);
      }, 8e3);
    });
  }
  function apexLogout() {
    return new Promise(function(resolve) {
      var apexOrigin;
      try {
        apexOrigin = new URL(APEX_URL).origin;
      } catch {
        resolve(false);
        return;
      }
      if (location.origin === apexOrigin) {
        resolve(false);
        return;
      }
      var settled = false, iframe = null, timer = null;
      function finish(v) {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onMsg);
        if (timer) clearTimeout(timer);
        if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
        resolve(v);
      }
      function onMsg(e) {
        if (e.origin !== apexOrigin) return;
        var d = e.data || {};
        if (d.type !== "aimeat_app_logout") return;
        finish(!!(d.result && d.result.ok));
      }
      window.addEventListener("message", onMsg);
      iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.setAttribute("aria-hidden", "true");
      iframe.src = apexOrigin + "/app-silent.html?mode=logout";
      (document.body || document.documentElement).appendChild(iframe);
      timer = setTimeout(function() {
        finish(false);
      }, 8e3);
    });
  }
  async function requestConsentPopup(app, scopeStr, manage) {
    var apexOrigin;
    try {
      apexOrigin = new URL(APEX_URL).origin;
    } catch {
      return null;
    }
    var p = await pkce();
    var state = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
    var redirectUri = location.origin + "/";
    var scope = scopeStr || appDeclaredScopes();
    var url = apexOrigin + "/v1/app-grants/authorize?response_type=code&response_mode=web_message" + (manage ? "&manage=1" : "") + "&app=" + encodeURIComponent(app) + "&scope=" + encodeURIComponent(scope) + "&redirect_uri=" + encodeURIComponent(redirectUri) + "&code_challenge=" + encodeURIComponent(p.challenge) + "&code_challenge_method=" + encodeURIComponent(p.method) + "&state=" + encodeURIComponent(state);
    var w = 460, h = 660;
    var left = window.screen && window.screen.width ? (window.screen.width - w) / 2 : 0;
    var top = window.screen && window.screen.height ? (window.screen.height - h) / 2 : 0;
    var popup = window.open(url, "aimeat_consent", "width=" + w + ",height=" + h + ",left=" + left + ",top=" + top);
    if (!popup) {
      try {
        console.warn("[aimeat-auth] consent popup blocked — app-origin sign-in needs a real user click (user activation). Synthetic/automated clicks cannot open the consent window.");
      } catch {
      }
      emit("popup-blocked", { app });
      return null;
    }
    var msg = await new Promise(function(resolve) {
      var done = false, iv = null;
      function onMsg(e) {
        if (e.origin !== apexOrigin) return;
        var d = e.data || {};
        if (d.type !== "aimeat_app_grant" || d.state !== state) return;
        done = true;
        cleanup();
        resolve(d);
      }
      function cleanup() {
        window.removeEventListener("message", onMsg);
        if (iv) clearInterval(iv);
      }
      window.addEventListener("message", onMsg);
      iv = setInterval(function() {
        if (popup.closed && !done) {
          cleanup();
          resolve(null);
        }
      }, 500);
    });
    if (msg && msg.revoked) return { revoked: true };
    if (!msg || !msg.code) return null;
    try {
      var resp = await fetch(apexOrigin + "/v1/app-grants/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", code: msg.code, code_verifier: p.verifier, redirect_uri: redirectUri })
      });
      var j = await resp.json();
      return j && j.ok && j.data && j.data.access_token ? j.data : null;
    } catch {
      return null;
    }
  }

  // src/static/sdk-libs/auth/session.js
  var currentSession = null;
  var refreshTimer = null;
  var ownerRefreshInFlight = null;
  var _appOriginLoginInFlight = null;
  var focusRefreshInFlight = null;
  function persistSession(session) {
    save("session", {
      owner: session.owner,
      gaii: session.gaii,
      ghii: session.ghii,
      jwt: session.jwt,
      publicKey: session.publicKey,
      roles: session.roles,
      displayName: session.displayName || "",
      federated: session.federated || false,
      homeNode: session.homeNode || "",
      homeUrl: session.homeUrl || "",
      // H-2 app-origin grant session metadata (drives the consent gear on the login pill).
      _appOrigin: session._appOrigin || false,
      _app: session._app || null,
      _own: session._own || false
    });
  }
  async function restoreSessionFromCookie() {
    try {
      const data = await api("/v1/auth/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "X-AIMEAT-Refresh": "1" }
      });
      const token = data && data.data && data.data.token;
      if (!token) return null;
      const payload = parseJwt(token) || {};
      const ownerName = payload.owner || payload.sub;
      if (!ownerName) return null;
      const session = createSession({
        owner: ownerName,
        ghii: String(ownerName).indexOf("@") >= 0 ? ownerName : ownerName + "@" + NODE_ID,
        gaii: null,
        jwt: token,
        roles: payload.roles || [],
        displayName: ""
      });
      persistSession(session);
      currentSession = session;
      scheduleAutoRefresh(session);
      emit("login", session);
      return session;
    } catch {
      return null;
    }
  }
  function _buildAppSession(accessToken, appId, own, displayName) {
    var payload = parseJwt(accessToken) || {};
    var ownerName = payload.owner || payload.sub;
    if (!ownerName) return null;
    var session = createSession({
      owner: ownerName,
      ghii: String(ownerName).indexOf("@") >= 0 ? ownerName : ownerName + "@" + NODE_ID,
      gaii: null,
      jwt: accessToken,
      roles: payload.roles || [],
      displayName: displayName || ""
    });
    session._appOrigin = true;
    session._app = appId || null;
    session._own = !!own;
    persistSession(session);
    currentSession = session;
    scheduleAutoRefresh(session);
    emit("login", session);
    return session;
  }
  function restoreSessionFromAppOrigin(interactive) {
    if (currentSession) return Promise.resolve(currentSession);
    if (_appOriginLoginInFlight) return _appOriginLoginInFlight;
    _appOriginLoginInFlight = (async function() {
      var r = await silentAppToken();
      var grant = r && r.ok && r.access_token ? r : null;
      var appId = r && r.app || null;
      var own = !!(r && r.own);
      if (!grant && interactive && r && r.app && (r.error === "consent_required" || r.error === "login_required" || r.error === "invalid_scope")) {
        appId = r.app;
        grant = await requestConsentPopup(r.app, r.scope);
        own = !!(grant && grant.own);
        if (grant && grant.app) appId = grant.app;
      }
      if (!grant || !grant.access_token) return null;
      return _buildAppSession(grant.access_token, appId, own, grant.display_name);
    })();
    _appOriginLoginInFlight.finally(function() {
      _appOriginLoginInFlight = null;
    });
    return _appOriginLoginInFlight;
  }
  function scheduleAutoRefresh(session) {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (!session?.jwt) return;
    try {
      const payload = JSON.parse(atob(session.jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (!payload.exp) return;
      const msUntilExpiry = payload.exp * 1e3 - Date.now();
      const refreshIn = Math.max(msUntilExpiry - 5 * 60 * 1e3, 1e4);
      refreshTimer = setTimeout(async () => {
        try {
          await session.refresh();
          emit("refreshed", session);
          scheduleAutoRefresh(session);
        } catch (e) {
          console.warn("[aimeat-auth] Auto-refresh failed:", e.message);
          emit("expired", { reason: "refresh_failed", error: e.message });
        }
      }, refreshIn);
    } catch {
    }
  }
  function createSession(data) {
    const jwtPayload = data.jwt ? parseJwt(data.jwt) : null;
    let ownerVal = data.owner;
    if (ownerVal != null && typeof ownerVal !== "string") {
      ownerVal = typeof ownerVal === "object" && typeof ownerVal.name === "string" ? ownerVal.name : String(ownerVal);
    }
    let ghiiVal = data.ghii;
    if (ghiiVal != null && typeof ghiiVal !== "string") {
      ghiiVal = typeof ghiiVal === "object" && typeof ghiiVal.ghii === "string" ? ghiiVal.ghii : String(ghiiVal);
    }
    const session = (
      /** @type {Record<string, any>} */
      {
        ghii: ghiiVal || null,
        owner: ownerVal,
        gaii: data.gaii || null,
        identity: data.gaii || ghiiVal || null,
        jwt: data.jwt,
        roles: jwtPayload?.roles || data.roles || [],
        displayName: data.displayName || "",
        // SECURITY: Private keys are non-extractable CryptoKeys in IndexedDB, NOT here. _cryptoKey = in-memory ref only.
        _cryptoKey: data._cryptoKey || null,
        publicKey: data.publicKey,
        nodeUrl: NODE_URL,
        federated: data.federated || false,
        homeNode: data.homeNode || "",
        homeUrl: data.homeUrl || "",
        // Authenticated fetch wrapper — returns parsed JSON without throwing on error so callers
        // (e.g. AIMEAT.data.get) can inspect res.ok / res.error themselves.
        async fetch(path, opts = {}) {
          if (isExpired(session.jwt)) {
            await session.refresh();
          }
          const url = NODE_URL + path;
          const headers = { "Content-Type": "application/json", "Authorization": "Bearer " + session.jwt, ...opts.headers || {} };
          const resp = await fetch(url, { ...opts, headers });
          if (resp.status === 403 && session._appOrigin && !session._scopeHealTried) {
            var missing = appScopeDrift(session);
            if (missing.length) {
              session._scopeHealTried = true;
              var t = await silentAppToken();
              if (t && t.ok && t.access_token && !appScopeDrift({ _appOrigin: true, jwt: t.access_token })) {
                session.jwt = t.access_token;
                persistSession(session);
                scheduleAutoRefresh(session);
                var retry = await fetch(url, { ...opts, headers: { ...headers, "Authorization": "Bearer " + session.jwt } });
                return retry.json();
              }
              emit("scopes-stale", { app: session._app || null, missing });
            }
          }
          return resp.json();
        },
        // Notify the signed-in owner (header bell + browser push if subscribed).
        async notify(title, opts = {}) {
          return session.fetch("/v1/notifications", {
            method: "POST",
            body: JSON.stringify({ title, body: opts.body, link: opts.link, type: opts.type })
          });
        },
        // Get a fresh access token. Owner sessions use the httpOnly refresh cookie; agent sessions
        // re-sign with their IndexedDB key. Concurrent owner refreshes share one in-flight request.
        async refresh() {
          if (session._appOrigin) {
            var t = await silentAppToken();
            if (!t || !t.access_token) throw new Error("App session expired — the owner is not logged in on the node.");
            session.jwt = t.access_token;
            session.roles = (parseJwt(session.jwt) || {}).roles || session.roles || [];
            persistSession(session);
            scheduleAutoRefresh(session);
            return session;
          }
          if (session.federated) {
            throw new Error("Federated session expired. Please log in again.");
          }
          if (session.gaii) {
            const key = session._cryptoKey || await loadKey("agent_key");
            if (!key) throw new Error("Cannot refresh — no signing key found in IndexedDB");
            const timestamp = (/* @__PURE__ */ new Date()).toISOString();
            const signature = await sign(key, session.gaii + timestamp);
            const d2 = await api("/v1/auth/token", {
              method: "POST",
              body: JSON.stringify({ gaii: session.gaii, timestamp, signature })
            });
            session.jwt = d2.data.token;
            session.roles = (parseJwt(session.jwt) || {}).roles || session.roles || [];
            persistSession(session);
            scheduleAutoRefresh(session);
            return session;
          }
          if (ownerRefreshInFlight) return ownerRefreshInFlight;
          ownerRefreshInFlight = (async () => {
            const resp = await fetch(NODE_URL + "/v1/auth/refresh", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json", "X-AIMEAT-Refresh": "1" }
            });
            let data2 = null;
            try {
              data2 = await resp.json();
            } catch {
            }
            if (!resp.ok || !data2 || data2.ok === false) {
              throw new Error(data2?.error?.message || "Session refresh failed");
            }
            session.jwt = data2.data.token;
            session.roles = (parseJwt(session.jwt) || {}).roles || session.roles || [];
            var freshClaims = parseJwt(session.jwt) || {};
            if (freshClaims.owner && freshClaims.owner !== session.owner) {
              session.owner = freshClaims.owner;
              if (freshClaims.node) session.ghii = freshClaims.owner + "@" + freshClaims.node;
              session.identity = session.gaii || session.ghii || null;
            }
            if (typeof data2.data.display_name === "string") session.displayName = data2.data.display_name;
            persistSession(session);
            scheduleAutoRefresh(session);
            return session;
          })();
          try {
            return await ownerRefreshInFlight;
          } finally {
            ownerRefreshInFlight = null;
          }
        },
        // Check if session is valid
        get valid() {
          return session.jwt && !isExpired(session.jwt);
        }
      }
    );
    return session;
  }
  function refreshOnFocus() {
    const session = currentSession;
    if (!session || !session.jwt || session.federated) return;
    const payload = parseJwt(session.jwt);
    if (!payload || !payload.exp) return;
    const msUntilExpiry = payload.exp * 1e3 - Date.now();
    if (msUntilExpiry > 5 * 60 * 1e3) return;
    if (focusRefreshInFlight) return;
    const wasExpired = msUntilExpiry <= 0;
    focusRefreshInFlight = session.refresh().then(() => {
      emit("refreshed", session);
    }).catch((e) => {
      console.warn("[aimeat-auth] Focus refresh failed:", e.message);
      if (wasExpired) emit("expired", { reason: "refresh_failed", error: e.message });
    }).finally(() => {
      focusRefreshInFlight = null;
    });
  }
  async function sessionFromLogin(data) {
    const d = data.data;
    let ownerCryptoKey = null;
    if (d.owner_private_key) {
      ownerCryptoKey = await importEd25519Key(d.owner_private_key);
      await storeKey("owner_key", ownerCryptoKey);
    }
    const session = createSession({
      ghii: d.ghii.ghii,
      owner: d.owner.name,
      gaii: null,
      jwt: d.token,
      _cryptoKey: ownerCryptoKey,
      publicKey: d.owner_public_key || "",
      displayName: d.ghii.display_name || "",
      federated: d.federated || false,
      homeNode: d.home_node || "",
      homeUrl: d.home_url || ""
    });
    if (d.key_credentials) session._keyCredentials = d.key_credentials;
    persistSession(session);
    currentSession = session;
    scheduleAutoRefresh(session);
    emit("login", session);
    return session;
  }
  var auth = {
    nodeUrl: NODE_URL,
    nodeId: NODE_ID,
    /**
     * Register a new human identity (GHII) and get an authenticated session.
     * @returns {Promise<object>} Session object with .fetch(), .refresh(), .jwt, .ghii
     */
    async register(username, displayName, opts = {}) {
      const regData = await api("/v1/ghii", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          username,
          display_name: displayName,
          bio: opts.bio,
          avatar: opts.avatar,
          locale: opts.locale,
          password: opts.password || void 0
        })
      });
      if (opts.password) {
        return this.loginWithPassword(username, opts.password);
      }
      const ownerName = regData.data.owner.name;
      const ghii = regData.data.ghii.ghii;
      const serverPrivateKey = regData.data.private_key || regData.data.owner_private_key;
      const serverPublicKey = regData.data.public_key || regData.data.owner_public_key || "";
      if (!serverPrivateKey) {
        throw new Error("Server did not return an owner signing key. Please try signing in again.");
      }
      let ownerToken = regData.data.token || null;
      if (!ownerToken) {
        const ownerTimestamp = (/* @__PURE__ */ new Date()).toISOString();
        const ownerMessage = ownerName + NODE_ID + ownerTimestamp;
        const ownerSig = await sign(serverPrivateKey, ownerMessage);
        const ownerTokenData = await api("/v1/auth/token", {
          method: "POST",
          body: JSON.stringify({ owner: ownerName, timestamp: ownerTimestamp, signature: ownerSig })
        });
        ownerToken = ownerTokenData.data.token;
      }
      const ownerCryptoKey = await importEd25519Key(serverPrivateKey);
      await storeKey("owner_key", ownerCryptoKey);
      const session = createSession({
        ghii,
        owner: ownerName,
        gaii: null,
        jwt: ownerToken,
        _cryptoKey: ownerCryptoKey,
        publicKey: serverPublicKey,
        displayName: regData.data.ghii.display_name || ""
      });
      save("session", {
        owner: ownerName,
        gaii: null,
        ghii,
        jwt: session.jwt,
        publicKey: serverPublicKey,
        roles: session.roles,
        displayName: session.displayName || ""
      });
      currentSession = session;
      scheduleAutoRefresh(session);
      emit("login", session);
      return session;
    },
    /**
     * Login with stored credentials (auto-refreshes JWT if expired).
     * @returns {Promise<object|null>} Session or null if no stored credentials
     */
    async login(username) {
      if (isAppOrigin()) return await restoreSessionFromAppOrigin(false);
      const stored = load("session");
      if (!stored) return await restoreSessionFromCookie();
      if (username && stored.owner !== username) return null;
      await migrateKeysToIndexedDB();
      if (stored.gaii) {
        stored.gaii = null;
      }
      const cryptoKey = stored.gaii ? await loadKey("agent_key") : await loadKey("owner_key");
      const session = createSession({ ...stored, _cryptoKey: cryptoKey });
      const isOwnerLocal = !session.federated && !session.gaii;
      if (isOwnerLocal || isExpired(session.jwt)) {
        try {
          await session.refresh();
        } catch {
          remove("session");
          emit("expired");
          return null;
        }
      }
      currentSession = session;
      scheduleAutoRefresh(session);
      emit("login", session);
      return session;
    },
    /**
     * Login with username + password (works from any device).
     *
     * An account with two-step sign-in refuses the first call with code TOTP_REQUIRED; call again with
     * the second factor. The password travels a second time on purpose: the server holds no partial
     * login state between the two calls, so there is nothing a stolen intermediate token could carry.
     *
     * @param {string} username
     * @param {string} password
     * @param {{ totpCode?: string, backupCode?: string }} [secondFactor] The code from the
     *   authenticator app, or one unused backup code. Pass one, not both.
     * @returns {Promise<object>} Session object
     */
    async loginWithPassword(username, password, secondFactor) {
      const body = { username, password };
      if (secondFactor && secondFactor.totpCode) body.totp_code = secondFactor.totpCode;
      else if (secondFactor && secondFactor.backupCode) body.backup_code = secondFactor.backupCode;
      const data = await api("/v1/ghii/login", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify(body)
      });
      return sessionFromLogin(data);
    },
    /**
     * Sign in with a passkey. `username` is optional and leaving it out is the better path: the
     * ceremony is discoverable, the device offers whatever it holds for this domain, and its answer
     * names the account. Ends in the same session the password path builds, because the server ends
     * in the same response.
     *
     * Throws with code PASSKEY_CANCELLED when the person closed the prompt, which a caller should
     * treat as "they changed their mind" rather than as a failure to show in red.
     */
    async signInWithPasskey(username) {
      const data = await passkeySignIn(username);
      return sessionFromLogin(data);
    },
    /** Does this browser have WebAuthn? A caller shows the passkey button only when it does. */
    passkeySupported,
    /** Add THIS device to the signed-in account. Returns the stored passkey as the node describes it. */
    async addPasskey(label) {
      if (!currentSession?.jwt) throw new Error("Sign in first");
      const data = await passkeyAdd(currentSession.jwt, label);
      return data.data.passkey;
    },
    /** Get the current session (or null if not logged in) */
    getSession() {
      return currentSession;
    },
    /**
     * Patch mutable, non-secret session metadata in place (e.g. displayName after a profile edit),
     * persist it, and notify the login pill so it re-renders live — no page reload.
     */
    updateSessionMeta(patch) {
      if (!currentSession || !patch) return;
      Object.assign(currentSession, patch);
      persistSession(currentSession);
      emit("session-updated", currentSession);
    },
    /**
     * Logout — clear stored credentials from localStorage and IndexedDB.
     * ORDER MATTERS: local state is dropped and 'logout' emitted SYNCHRONOUSLY, before the revoke.
     * "Logged out" must not depend on a network round-trip — with the revoke awaited first, every
     * subscriber reading getSession() meanwhile still saw the old session, which is how the header
     * kept the bell and "Me" next to a "Sign In" button (2026-08-07). Revoke + apex logout are
     * best-effort cleanup that runs after the UI already shows the truth.
     */
    async logout() {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      ownerRefreshInFlight = null;
      const jwt = currentSession?.jwt;
      const onAppOrigin = isAppOrigin();
      currentSession = null;
      remove("session");
      remove("owner_key");
      emit("logout");
      await deleteKey("agent_key");
      await deleteKey("owner_key");
      try {
        await fetch(NODE_URL + "/v1/auth/revoke", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...jwt ? { "Authorization": "Bearer " + jwt } : {} }
        });
      } catch {
      }
      if (onAppOrigin) {
        try {
          await apexLogout();
        } catch {
        }
      }
    },
    /**
     * Re-open the consent screen for the current app (H-2 in-app grant management).
     */
    async manageGrant() {
      const s = currentSession || load("session");
      if (!s || !s._app) return null;
      const res = await requestConsentPopup(s._app, appDeclaredScopes(), true);
      if (res && res.revoked) {
        await auth.logout();
        return { revoked: true };
      }
      if (res && res.access_token) return _buildAppSession(res.access_token, res.app || s._app, res.own != null ? !!res.own : s._own);
      return null;
    },
    /** True when running inside a published app on its isolated origin (not the apex). */
    isAppOrigin() {
      return isAppOrigin();
    },
    /** Open the sign-in modal (password + Google if configured). */
    showLoginModal(opts) {
      showLoginModal(opts || {}, function() {
      });
    },
    /** Check if there are stored credentials */
    get hasSession() {
      return !!load("session");
    },
    /** Get stored GHII without authenticating */
    get storedGhii() {
      const s = load("session");
      return s?.ghii || null;
    },
    /** Register an event listener */
    on(event, fn) {
      on(event, fn);
    },
    /** Remove an event listener */
    off(event, fn) {
      off(event, fn);
    },
    /** Check if running inside a sandboxed iframe (no localStorage access) */
    get inSandbox() {
      try {
        localStorage.getItem("_test");
        return false;
      } catch {
        return true;
      }
    },
    /**
     * Request auth credentials from the parent window via postMessage (sandboxed-iframe fallback).
     * @returns {Promise<object|null>} Session-like object with .jwt and .fetch(), or null
     */
    requestParentAuth(timeout = 3e3) {
      return new Promise((resolve) => {
        if (window === window.parent) {
          resolve(null);
          return;
        }
        let resolved = false;
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        }, timeout);
        function handler(e) {
          if (resolved) return;
          if (!e.data || e.data.type !== "aimeat-auth") return;
          resolved = true;
          clearTimeout(timer);
          window.removeEventListener("message", handler);
          const jwt = e.data.jwt;
          const parentNodeUrl = e.data.nodeUrl;
          if (!jwt) {
            resolve(null);
            return;
          }
          const effectiveNodeUrl = parentNodeUrl || NODE_URL;
          const session = (
            /** @type {Record<string, any>} */
            {
              jwt,
              nodeUrl: effectiveNodeUrl,
              owner: null,
              gaii: null,
              ghii: null,
              identity: null,
              get valid() {
                return jwt && !isExpired(jwt);
              },
              async fetch(path, opts = {}) {
                const url = effectiveNodeUrl + path;
                const headers = { "Content-Type": "application/json", "Authorization": "Bearer " + jwt, ...opts.headers || {} };
                const resp = await fetch(url, { ...opts, headers });
                return resp.json();
              },
              async notify(title, opts = {}) {
                return session.fetch("/v1/notifications", {
                  method: "POST",
                  body: JSON.stringify({ title, body: opts.body, link: opts.link, type: opts.type })
                });
              }
            }
          );
          const payload = parseJwt(jwt);
          if (payload) {
            session.gaii = payload.sub || null;
            session.owner = payload.owner || null;
            session.identity = session.gaii || session.ghii || null;
          }
          currentSession = session;
          emit("login", session);
          resolve(session);
        }
        window.addEventListener("message", handler);
        window.parent.postMessage({ type: "aimeat-request-auth" }, "*");
      });
    },
    // Capability flag so an embedding app can feature-detect the compact login pill.
    compactPill: true,
    /**
     * Mount a login/register button that handles the full flow. Delegates the render to pill.js.
     * @param {string|Element|object} selector - CSS selector, DOM element, OR (options-first) the opts.
     * @param {object} [opts] - { onLogin, onLogout, buttonText, compact }.
     */
    mountLoginButton(selector, opts = {}) {
      return mountPill(auth, selector, opts);
    }
  };

  // src/static/sdk-libs/auth/signup.js
  var USERNAME_RE = new RegExp("^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$");
  function fillTemplate(str, vars) {
    return String(str || "").replace(/\{(\w+)\}/g, function(_, k) {
      return vars[k] != null ? vars[k] : "";
    });
  }
  function cleanSignupParam() {
    try {
      var url = new URL(location.href);
      if (!url.searchParams.has("aimeat_signup")) return;
      url.searchParams.delete("aimeat_signup");
      history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
    } catch {
    }
  }
  function showSignupNoticeModal(i, opts) {
    var old = document.getElementById("aimeat-modal");
    if (old) old.remove();
    var modal = document.createElement("div");
    modal.id = "aimeat-modal";
    document.body.appendChild(modal);
    modal.innerHTML = '<style>.aimeat-go{flex:1;padding:12px;background:linear-gradient(135deg,#E8564A,#D4493F);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:15px;font-family:DM Sans,system-ui,sans-serif;box-shadow:0 2px 8px rgba(232,86,74,.25);transition:transform .15s,box-shadow .15s}.aimeat-cancel{padding:12px 20px;background:none;color:#1A1A2E;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer;font-size:15px;font-weight:500;font-family:DM Sans,system-ui,sans-serif;transition:background .15s}.aimeat-cancel:hover{background:#F3F4F6}</style><div style="position:fixed;inset:0;background:rgba(26,26,46,.4);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;z-index:99999;font-family:DM Sans,system-ui,sans-serif;padding:24px"><div style="background:#FFFFFF;border-radius:16px;max-width:440px;width:100%;margin:auto;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.15),0 0 0 1px rgba(0,0,0,.05)"><div style="padding:28px 32px 24px"><h2 style="margin:0 0 8px;font-size:21px;font-weight:800;color:#1A1A2E">' + escHtml(opts.title || "") + '</h2><p style="margin:0 0 18px;font-size:14px;color:#6B7280;line-height:1.55">' + escHtml(opts.body || "") + '</p><div style="display:flex;gap:10px"><button id="aimeat-sn-primary" class="aimeat-go">' + escHtml(opts.primaryLabel || "OK") + "</button>" + (opts.showCancel ? '<button id="aimeat-sn-cancel" class="aimeat-cancel">' + escHtml(i.signupCancelBtn || "Cancel") + "</button>" : "") + "</div></div></div></div>";
    function close() {
      modal.remove();
      cleanSignupParam();
    }
    document.getElementById("aimeat-sn-primary").addEventListener("click", function() {
      close();
      if (opts.onPrimary) opts.onPrimary();
    });
    var cancelEl = document.getElementById("aimeat-sn-cancel");
    if (cancelEl) cancelEl.addEventListener("click", close);
  }
  function showGoogleSignupModal(pending, i) {
    i = i || {};
    if (pending && pending.mode === "link_existing") {
      var hint = pending.existing_hint ? " " + fillTemplate(i.signupLinkHint || "(Username hint: {hint}.)", { hint: pending.existing_hint }) : "";
      showSignupNoticeModal(i, {
        title: i.signupLinkTitle || "This email already has an account",
        body: fillTemplate(i.signupLinkIntro || "An AIMEAT account already uses {email}, but its email has not been verified yet. Sign in with your username and password once — that verifies your email, and after that this sign-in connects to your account automatically.", { email: pending.email || "" }) + hint,
        primaryLabel: i.signupLinkSignInBtn || "Sign in with password",
        showCancel: true,
        onPrimary: function() {
          showLoginModal({ i18n: i }, function() {
          });
        }
      });
      return;
    }
    var old = document.getElementById("aimeat-modal");
    if (old) old.remove();
    var modal = document.createElement("div");
    modal.id = "aimeat-modal";
    document.body.appendChild(modal);
    var emailNote = pending.email ? '<p style="margin:0 0 14px;font-size:13px;color:#6B7280">' + escHtml(fillTemplate(i.signupEmailNote || "Signing up as {email}", { email: pending.email })) + "</p>" : "";
    modal.innerHTML = '<style>.aimeat-inp{width:100%;padding:11px 14px;border:1.5px solid #E5E7EB;border-radius:10px;font-family:DM Sans,system-ui,sans-serif;font-size:15px;color:#1A1A2E;background:#FAFAF8;box-sizing:border-box;transition:all .15s;outline:none}.aimeat-inp:focus{border-color:#E8564A;box-shadow:0 0 0 3px rgba(232,86,74,.1)}.aimeat-go{flex:1;padding:12px;background:linear-gradient(135deg,#E8564A,#D4493F);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:15px;font-family:DM Sans,system-ui,sans-serif;box-shadow:0 2px 8px rgba(232,86,74,.25);transition:transform .15s,box-shadow .15s}.aimeat-go:disabled{opacity:.55;cursor:not-allowed;box-shadow:none}.aimeat-label{display:block;margin-bottom:5px;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#6B7280}.aimeat-cancel{padding:12px 20px;background:none;color:#1A1A2E;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer;font-size:15px;font-weight:500;font-family:DM Sans,system-ui,sans-serif;transition:background .15s}.aimeat-cancel:hover{background:#F3F4F6}</style><div style="position:fixed;inset:0;background:rgba(26,26,46,.4);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;z-index:99999;font-family:DM Sans,system-ui,sans-serif;padding:24px"><div style="background:#FFFFFF;border-radius:16px;max-width:440px;width:100%;margin:auto;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.15),0 0 0 1px rgba(0,0,0,.05)"><div style="padding:28px 32px 24px"><h2 style="margin:0 0 8px;font-size:21px;font-weight:800;color:#1A1A2E">' + escHtml(i.signupTitle || "Choose your username") + '</h2><p style="margin:0 0 6px;font-size:14px;color:#6B7280;line-height:1.5">' + escHtml(i.signupIntro || "You're signing in for the first time. Pick the username for your AIMEAT account.") + "</p>" + emailNote + '<label class="aimeat-label" for="aimeat-su-name">' + escHtml(i.signupUsernameLabel || "Username") + '</label><input id="aimeat-su-name" class="aimeat-inp" autocomplete="off" autocapitalize="none" spellcheck="false" value="' + escHtml(pending.suggested || "") + '"><p id="aimeat-su-status" style="margin:6px 0 0;font-size:13px;min-height:18px"></p><p style="margin:8px 0 0;font-size:12px;color:#9CA3AF;line-height:1.45">' + escHtml(i.signupSuggestedHint || "We suggested one from your account — change it to anything you like.") + '</p><div style="margin:16px 0 0;padding:12px 14px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;font-size:13px;color:#9A3412;line-height:1.5">' + escHtml(i.signupPermanentWarning || "This username is permanent. It identifies you across AIMEAT and cannot be changed later — the only way to change it is to delete your account and create a new one.") + '</div><label class="aimeat-label" for="aimeat-su-display" style="margin-top:16px">' + escHtml(i.signupDisplayNameLabel || "Display name") + '</label><input id="aimeat-su-display" class="aimeat-inp" autocomplete="off" maxlength="80" value="' + escHtml(pending.displayName || "") + '"><p style="margin:6px 0 0;font-size:12px;color:#9CA3AF;line-height:1.45">' + escHtml(i.signupDisplayNameHint || "Shown to others — not permanent, you can change it anytime later.") + '</p><div style="display:flex;gap:10px;margin-top:20px"><button id="aimeat-su-create" class="aimeat-go">' + escHtml(i.signupCreateBtn || "Create my account") + '</button><button id="aimeat-su-cancel" class="aimeat-cancel">' + escHtml(i.signupCancelBtn || "Cancel") + '</button></div><p id="aimeat-su-err" style="margin:10px 0 0;font-size:13px;color:#ef4444;display:none"></p></div></div></div>';
    var input = (
      /** @type {any} */
      document.getElementById("aimeat-su-name")
    );
    var statusEl = document.getElementById("aimeat-su-status");
    var createBtn = (
      /** @type {any} */
      document.getElementById("aimeat-su-create")
    );
    var cancelBtn = document.getElementById("aimeat-su-cancel");
    var errEl = document.getElementById("aimeat-su-err");
    var checkTimer = null;
    var lastChecked = "";
    function setStatus(text, color) {
      statusEl.textContent = text || "";
      statusEl.style.color = color || "#6B7280";
    }
    function evaluate() {
      errEl.style.display = "none";
      var name = (input.value || "").trim().toLowerCase();
      if (!USERNAME_RE.test(name)) {
        createBtn.disabled = true;
        setStatus(i.signupInvalid || "Username must be 3–64 characters: lowercase letters, numbers and hyphens.", "#ef4444");
        return;
      }
      createBtn.disabled = true;
      setStatus("…", "#9CA3AF");
      if (checkTimer) clearTimeout(checkTimer);
      checkTimer = setTimeout(function() {
        lastChecked = name;
        api("/v1/ghii/username-available?name=" + encodeURIComponent(name)).then(function(res) {
          var d = res && res.data;
          if (!d || (input.value || "").trim().toLowerCase() !== lastChecked) return;
          if (d.valid && d.available) {
            createBtn.disabled = false;
            setStatus(i.signupAvailable || "✓ Available", "#16a34a");
          } else if (!d.valid) {
            createBtn.disabled = true;
            setStatus(i.signupInvalid || d.reason || "Invalid username", "#ef4444");
          } else {
            createBtn.disabled = true;
            setStatus(i.signupTaken || "That username is already taken — pick another.", "#ef4444");
          }
        }).catch(function() {
          createBtn.disabled = false;
          setStatus("", "#6B7280");
        });
      }, 350);
    }
    input.addEventListener("input", evaluate);
    input.addEventListener("keydown", function(e) {
      if (e.key === "Enter" && !createBtn.disabled) {
        e.preventDefault();
        createBtn.click();
      }
    });
    function close() {
      if (checkTimer) clearTimeout(checkTimer);
      modal.remove();
      cleanSignupParam();
    }
    cancelBtn.addEventListener("click", close);
    createBtn.addEventListener("click", async function() {
      var name = (input.value || "").trim().toLowerCase();
      if (!USERNAME_RE.test(name)) {
        evaluate();
        return;
      }
      var displayEl = (
        /** @type {any} */
        document.getElementById("aimeat-su-display")
      );
      var displayName = displayEl ? (displayEl.value || "").trim() : "";
      createBtn.disabled = true;
      createBtn.textContent = i.signupCreating || "Creating account...";
      errEl.style.display = "none";
      try {
        var res = await api("/v1/ghii/login/" + (pending.provider || "google").split(":").join("/") + "/finalize", {
          method: "POST",
          credentials: "include",
          body: JSON.stringify({ username: name, displayName })
        });
        cleanSignupParam();
        var redirect = res && res.data && res.data.redirect || pending.redirect || "/";
        location.href = NODE_URL + redirect;
      } catch (e) {
        var msg = e && e.message ? e.message : "Could not create account";
        if (msg.indexOf("already registered") >= 0 || msg.indexOf("NAME_TAKEN") >= 0) msg = i.signupTaken || msg;
        errEl.textContent = msg;
        errEl.style.display = "block";
        createBtn.textContent = i.signupCreateBtn || "Create my account";
        evaluate();
      }
    });
    evaluate();
  }
  function maybeShowGoogleSignup() {
    var params;
    try {
      params = new URLSearchParams(location.search);
    } catch {
      return;
    }
    if (params.get("aimeat_signup") !== "1") return;
    function showExpired() {
      function open(i) {
        showSignupNoticeModal(i || {}, {
          title: i && i.signupExpiredTitle || "Sign-in session expired",
          body: i && i.signupExpiredBody || "Your sign-in session expired or was interrupted. No password is needed — just click “Continue with Google” again to restart.",
          primaryLabel: i && i.signupExpiredOkBtn || "OK",
          showCancel: false
        });
      }
      loadModalI18n(currentModalLang()).then(open).catch(function() {
        open({});
      });
    }
    api("/v1/ghii/login/pending", { credentials: "include" }).then(function(res) {
      var pending = res && res.data;
      if (!pending) {
        showExpired();
        return;
      }
      loadModalI18n(currentModalLang()).then(function(i) {
        showGoogleSignupModal(pending, i || {});
      }).catch(function() {
        showGoogleSignupModal(pending, {});
      });
    }).catch(function() {
      showExpired();
    });
  }

  // src/static/sdk-libs/_core/namespace.js
  function namespace() {
    if (!window.AIMEAT) window.AIMEAT = {};
    return window.AIMEAT;
  }
  function attach(key, value) {
    const ns2 = namespace();
    ns2[key] = value;
    return ns2;
  }

  // src/static/sdk-libs/auth/index.js
  if (typeof document !== "undefined" && document.addEventListener) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", maybeShowGoogleSignup);
    else maybeShowGoogleSignup();
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshOnFocus();
    });
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("focus", refreshOnFocus);
  }
  auth.getLang = function(locales) {
    return aimeatReadLang(readLocales({ locales }));
  };
  auth.setLang = function(lang) {
    aimeatApplyLang(String(lang).toLowerCase());
  };
  auth.getPalette = function() {
    return aimeatReadPalette();
  };
  auth.setPalette = function(id) {
    aimeatApplyPalette(String(id).toLowerCase());
  };
  auth.getPalettes = function() {
    return PALETTES.map(function(p) {
      return { id: p.id, label: p.label, swatch: p.swatch };
    });
  };
  if (typeof document !== "undefined") {
    aimeatRestorePalette();
    aimeatRestoreMode();
  }
  var ns = attach("auth", auth);
  ns.version = "2026-07-25-002";
})();
