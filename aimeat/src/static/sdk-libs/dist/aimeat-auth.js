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

  // src/static/sdk-libs/auth/theme.js
  function escHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
  var AIMEAT_THEME_KEY = "aimeat-theme";
  function aimeatReadTheme() {
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
  function themeToggleHtml(i) {
    var dark = aimeatReadTheme() === "dark";
    var title = dark ? i.themeToLight || "Switch to light mode" : i.themeToDark || "Switch to dark mode";
    return '<button id="aimeat-theme-toggle" class="aimeat-theme-toggle" title="' + escHtml(title) + '" aria-label="' + escHtml(title) + '" style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 auto;background:transparent;border:1px solid rgba(127,127,127,.4);border-radius:8px;cursor:pointer;font-size:15px;line-height:1;padding:0;color:currentColor">' + (dark ? "☀" : "☾") + "</button>";
  }
  function wireThemeToggle(container, i) {
    var btn = container.querySelector("#aimeat-theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function() {
      var next = aimeatReadTheme() === "dark" ? "light" : "dark";
      aimeatApplyTheme(next);
      var dark = next === "dark";
      btn.textContent = dark ? "☀" : "☾";
      var title = dark ? i.themeToLight || "Switch to light mode" : i.themeToDark || "Switch to dark mode";
      btn.title = title;
      btn.setAttribute("aria-label", title);
    });
  }
  function ensureAuthPillStyles() {
    if (document.getElementById("aimeat-auth-pill-css")) return;
    var st = document.createElement("style");
    st.id = "aimeat-auth-pill-css";
    st.textContent = [
      ".aimeat-auth-wrap{position:relative;display:inline-flex;align-items:center}",
      ".aimeat-auth-compact{display:none;align-items:center;gap:7px;padding:5px 11px 5px 9px;cursor:pointer;",
      "background:linear-gradient(160deg,#3d2e1a 0%,#6b4c2a 15%,#c9a84c 30%,#f5e6a3 45%,#c9a84c 55%,#8b6914 70%,#4a3520 100%);",
      "border:1px solid rgba(201,168,76,.6);border-top-color:rgba(245,230,163,.5);border-bottom-color:rgba(75,53,32,.8);",
      "border-radius:10px;box-shadow:0 1px 0 rgba(245,230,163,.3) inset,0 -1px 0 rgba(75,53,32,.5) inset,0 3px 10px rgba(0,0,0,.4);",
      "font-family:system-ui;font-size:13px;color:#2a1800;text-shadow:0 1px 0 rgba(245,230,163,.5)}",
      ".aimeat-auth-compact .cdot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;",
      "background:radial-gradient(circle at 35% 35%,#b0ffc8,#00c853 40%,#00802e 80%,#003d15);box-shadow:0 0 5px rgba(0,200,83,.6)}",
      ".aimeat-auth-compact .cini{font-weight:800;letter-spacing:.3px;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".aimeat-auth-compact .ccar{font-size:9px;opacity:.75;transition:transform .18s}",
      ".aimeat-auth-wrap.aimeat-open .aimeat-auth-compact .ccar{transform:rotate(180deg)}",
      "@media (max-width:600px){",
      ".aimeat-auth-compact{display:inline-flex}",
      ".aimeat-auth-wrap>.aimeat-auth-pill{position:absolute;top:calc(100% + 8px);right:0;z-index:1000;",
      "display:none!important;flex-wrap:wrap!important;justify-content:flex-start;row-gap:9px;",
      "min-width:210px;max-width:calc(100vw - 24px)}",
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
  function currentModalLang() {
    try {
      var u = new URLSearchParams(location.search).get("lang");
      if (u === "en" || u === "fi") return u;
      var s = localStorage.getItem(MODAL_LANG_KEY);
      if (s === "en" || s === "fi") return s;
    } catch {
    }
    return (navigator.language || "en").slice(0, 2).toLowerCase() === "fi" ? "fi" : "en";
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

  // src/static/sdk-libs/auth/modal.js
  function showLoginModal(opts, renderBtn) {
    var i = opts.i18n || {};
    var lang = currentModalLang();
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
      return { u: g("aimeat-username"), p: g("aimeat-password"), d: g("aimeat-displayname") };
    }
    function restoreInputs(vals) {
      var s = function(id, val) {
        var el = (
          /** @type {any} */
          document.getElementById(id)
        );
        if (el && val) el.value = val;
      };
      s("aimeat-username", vals.u);
      s("aimeat-password", vals.p);
      s("aimeat-displayname", vals.d);
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
      modal.innerHTML = buildModalInner(i, lang, anim);
      wireModal();
    }
    document.body.appendChild(modal);
    render(true);
    loadModalI18n(lang).then(function(fresh) {
      if (!fresh || !Object.keys(fresh).length) return;
      if (fresh.signInBtn === i.signInBtn && fresh.descNew === i.descNew) return;
      var vals = captureInputs();
      i = fresh;
      render(false);
      restoreInputs(vals);
    });
    function buildModalInner(i2, lang2, anim) {
      return '<style>.aimeat-inp{width:100%;padding:11px 14px;border:1.5px solid #E5E7EB;border-radius:10px;font-family:DM Sans,system-ui,sans-serif;font-size:15px;color:#1A1A2E;background:#FAFAF8;box-sizing:border-box;transition:all .15s;outline:none}.aimeat-inp:focus{border-color:#E8564A;box-shadow:0 0 0 3px rgba(232,86,74,.1)}.aimeat-inp::placeholder{color:#9CA3AF}.aimeat-go{flex:1;padding:12px;background:linear-gradient(135deg,#E8564A,#D4493F);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:15px;font-family:DM Sans,system-ui,sans-serif;box-shadow:0 2px 8px rgba(232,86,74,.25);transition:transform .15s,box-shadow .15s}.aimeat-go:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(232,86,74,.35)}.aimeat-label{display:block;margin-bottom:5px;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#6B7280}.aimeat-cancel{padding:12px 20px;background:none;color:#1A1A2E;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer;font-size:15px;font-weight:500;font-family:DM Sans,system-ui,sans-serif;transition:background .15s}.aimeat-cancel:hover{background:#F3F4F6}.aimeat-fi{width:20px;height:20px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;margin-top:1px}.aimeat-langsw{position:absolute;top:24px;right:28px;display:flex;gap:5px}.aimeat-lang{padding:4px 9px;border:1px solid #E5E7EB;background:#fff;color:#6B7280;border-radius:7px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:.4px;line-height:1;font-family:DM Sans,system-ui,sans-serif;transition:all .15s}.aimeat-lang:hover{border-color:#E8564A;color:#E8564A}.aimeat-lang.active{background:#E8564A;color:#fff;border-color:#E8564A;cursor:default}@keyframes aimeatModalIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}</style><div style="position:fixed;inset:0;background:rgba(26,26,46,.4);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;z-index:99999;font-family:DM Sans,system-ui,sans-serif;padding:24px"><div style="background:#FFFFFF;border-radius:16px;max-width:420px;width:100%;margin:auto;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.15),0 0 0 1px rgba(0,0,0,.05);' + (anim ? "animation:aimeatModalIn .3s ease" : "") + '"><div style="padding:28px 32px 0;position:relative"><div class="aimeat-langsw"><button type="button" class="aimeat-lang' + (lang2 === "en" ? " active" : "") + '" data-lang="en">EN</button><button type="button" class="aimeat-lang' + (lang2 === "fi" ? " active" : "") + '" data-lang="fi">FI</button></div><h2 style="margin:0;font-size:22px;font-weight:800;display:flex;align-items:center;gap:8px;color:#1A1A2E">AIME <span style="width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,#E8564A,#D4493F);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:14px">♥</span> AT Sign In</h2><p style="margin:8px 0 0;font-size:14px;color:#6B7280;line-height:1.5">' + escHtml(i2.descNew || "New? Pick a username and password to create an account.") + " " + escHtml(i2.descReturning || "Already have an account? Enter your username and password.") + '</p></div><div id="aimeat-modal-body" style="padding:24px 32px"><div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i2.usernameLabel || "Username") + '</label><input id="aimeat-username" class="aimeat-inp" placeholder="' + escHtml(i2.usernamePlaceholder || "Username") + '"></div><div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i2.passwordLabel || "Password") + '</label><input id="aimeat-password" type="password" class="aimeat-inp" placeholder="' + escHtml(i2.passwordPlaceholder || "Password (min 4 chars)") + '"></div><div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i2.displayNameLabel || "Display Name") + ' <span style="font-weight:400;text-transform:none;letter-spacing:0">(' + escHtml(i2.displayNameHint || "optional, for new accounts") + ')</span></label><input id="aimeat-displayname" class="aimeat-inp" placeholder="' + escHtml(i2.displayNamePlaceholder || "Display Name") + '"></div><div style="display:flex;gap:10px;margin-top:20px"><button id="aimeat-go-btn" class="aimeat-go">' + escHtml(i2.signInBtn || "Sign In / Register") + '</button><button id="aimeat-cancel-btn" class="aimeat-cancel">' + escHtml(i2.cancelBtn || "Cancel") + '</button></div><p id="aimeat-error" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p>' + (AUTH_PROVIDERS.length ? '<div style="display:flex;align-items:center;gap:12px;margin:18px 0 14px;color:#9CA3AF;font-size:12px;font-weight:600;letter-spacing:.5px"><span style="flex:1;height:1px;background:#E5E7EB"></span>' + escHtml(i2.orLabel || "OR") + '<span style="flex:1;height:1px;background:#E5E7EB"></span></div>' + AUTH_PROVIDERS.map(function(p) {
        return '<button type="button" class="aimeat-oauth-btn" data-provider="' + escHtml(p.id) + '" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;padding:11px;margin-bottom:8px;background:#fff;color:#1A1A2E;border:1.5px solid #E5E7EB;border-radius:10px;cursor:pointer;font-weight:600;font-size:15px;font-family:DM Sans,system-ui,sans-serif;transition:background .15s,border-color .15s">' + (PROVIDER_ICONS[p.id] || "") + escHtml(i2[p.i18nKey] || p.label) + "</button>";
      }).join("") : "") + '<div style="margin-top:14px;display:flex;gap:16px"><a href="#" id="aimeat-forgot-pw" style="font-size:13px;color:#6B7280;cursor:pointer;text-decoration:underline">' + escHtml(i2.forgotPassword || "Forgot password?") + '</a><a href="#" id="aimeat-forgot-user" style="font-size:13px;color:#6B7280;cursor:pointer;text-decoration:underline">' + escHtml(i2.forgotUsername || "Forgot username?") + '</a></div></div><div id="aimeat-forgot-pw-view" style="padding:24px 32px;display:none"><div id="aimeat-fpw-step1"><h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i2.resetPasswordTitle || "Reset Password") + '</h3><p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i2.resetPasswordDesc || "Enter your username to receive a reset code by email.") + '</p><div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i2.usernameLabel || "Username") + '</label><input id="aimeat-fpw-username" class="aimeat-inp" placeholder="' + escHtml(i2.usernamePlaceholder || "Username") + '"></div><div style="display:flex;gap:10px"><button id="aimeat-fpw-send" class="aimeat-go">' + escHtml(i2.sendResetCode || "Send Reset Code") + '</button><button id="aimeat-fpw-back" class="aimeat-cancel">' + escHtml(i2.backToLogin || "Back to Login") + '</button></div><p id="aimeat-fpw-msg" style="margin:8px 0 0;font-size:13px;color:#22C55E;display:none"></p><p id="aimeat-fpw-err" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p></div><div id="aimeat-fpw-step2" style="display:none"><h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i2.enterNewPasswordTitle || "Enter New Password") + '</h3><p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i2.resetCodeSent || "A reset code was sent to your email. Enter it below with your new password.") + '</p><div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i2.codeLabel || "Reset Code") + '</label><input id="aimeat-fpw-code" class="aimeat-inp" placeholder="123456" maxlength="6"></div><div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i2.newPasswordLabel || "New Password") + '</label><input id="aimeat-fpw-newpass" type="password" class="aimeat-inp" placeholder="' + escHtml(i2.newPasswordPlaceholder || "New password (min 8 chars)") + '"></div><div style="display:flex;gap:10px"><button id="aimeat-fpw-reset" class="aimeat-go">' + escHtml(i2.resetPassword || "Reset Password") + '</button><button id="aimeat-fpw-back2" class="aimeat-cancel">' + escHtml(i2.backToLogin || "Back to Login") + '</button></div><p id="aimeat-fpw-msg2" style="margin:8px 0 0;font-size:13px;color:#22C55E;display:none"></p><p id="aimeat-fpw-err2" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p></div></div><div id="aimeat-forgot-user-view" style="padding:24px 32px;display:none"><h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i2.recoverUsernameTitle || "Recover Username") + '</h3><p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i2.recoverUsernameDesc || "Enter the email address associated with your account.") + '</p><div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i2.emailLabel || "Email") + '</label><input id="aimeat-fu-email" class="aimeat-inp" type="email" placeholder="you@example.com"></div><div style="display:flex;gap:10px"><button id="aimeat-fu-send" class="aimeat-go">' + escHtml(i2.sendUsername || "Send My Username") + '</button><button id="aimeat-fu-back" class="aimeat-cancel">' + escHtml(i2.backToLogin || "Back to Login") + '</button></div><p id="aimeat-fu-msg" style="margin:8px 0 0;font-size:13px;color:#22C55E;display:none"></p></div><div id="aimeat-email-view" style="padding:24px 32px;display:none"><div id="aimeat-em-step1"><h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i2.completeAccountTitle || "One last step") + '</h3><p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i2.completeAccountDesc || "Add an email to finish setting up your account. We’ll send a verification code to confirm it.") + '</p><div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i2.emailLabel || "Email") + '</label><input id="aimeat-em-email" class="aimeat-inp" type="email" placeholder="you@example.com"></div><div style="display:flex;gap:10px"><button id="aimeat-em-send" class="aimeat-go">' + escHtml(i2.sendVerificationCode || "Send Verification Code") + '</button><button id="aimeat-em-back" class="aimeat-cancel">' + escHtml(i2.backToLogin || "Back to Login") + '</button></div><p id="aimeat-em-err" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p></div><div id="aimeat-em-step2" style="display:none"><h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i2.enterCodeTitle || "Enter Verification Code") + '</h3><p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i2.enterCodeDesc || "We sent a 6-digit code to your email. Enter it below to finish and sign in.") + '</p><div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i2.codeLabel || "Verification Code") + '</label><input id="aimeat-em-code" class="aimeat-inp" placeholder="123456" maxlength="6" inputmode="numeric"></div><div style="display:flex;gap:10px"><button id="aimeat-em-confirm" class="aimeat-go">' + escHtml(i2.confirmAndSignIn || "Confirm & Sign In") + '</button><button id="aimeat-em-back2" class="aimeat-cancel">' + escHtml(i2.backToLogin || "Back to Login") + '</button></div><p id="aimeat-em-msg2" style="margin:8px 0 0;font-size:13px;color:#22C55E;display:none"></p><p id="aimeat-em-err2" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p></div></div><div style="padding:20px 32px 28px;background:#F9FAFB;border-top:1px solid #E5E7EB"><h4 style="margin:0 0 12px;font-size:13px;font-weight:700;color:#1A1A2E;display:flex;align-items:center;gap:6px">✨ ' + escHtml(i2.whyTitle || "What do you get?") + '</h4><div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;margin-bottom:8px;line-height:1.45"><div class="aimeat-fi" style="background:#FFF1F0;color:#E8564A">♥</div><span>' + escHtml(i2.whyGhii || "A free GHII (Global Human Intelligence Identifier), your personal AI identity") + '</span></div><div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;margin-bottom:8px;line-height:1.45"><div class="aimeat-fi" style="background:#EFF6FF;color:#3B82F6">🔒</div><span>' + escHtml(i2.whyPrivacy || "Your own private memory space, protected by your password") + '</span></div><div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;margin-bottom:8px;line-height:1.45"><div class="aimeat-fi" style="background:#F0FDF4;color:#22C55E">🤖</div><span>' + escHtml(i2.whyAgents || "Connect AI agents that remember you and work on your behalf") + '</span></div><div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;line-height:1.45"><div class="aimeat-fi" style="background:#FFF1F0;color:#E8564A">♥</div><span><strong>' + escHtml(i2.whyMorsels || "Your own AI-built apps and agents work for you — a digital agency under your own roof.") + "</strong></span></div></div></div></div>";
    }
    function wireModal() {
      modal.querySelectorAll(".aimeat-lang").forEach(function(b) {
        b.addEventListener("click", function() {
          switchLang(b.getAttribute("data-lang"));
        });
      });
      document.getElementById("aimeat-cancel-btn").addEventListener("click", () => modal.remove());
      modal.querySelectorAll(".aimeat-oauth-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var id = btn.getAttribute("data-provider");
          var back = encodeURIComponent(location.pathname + location.search + location.hash);
          location.href = NODE_URL + "/v1/ghii/login/" + id + "?redirect=" + back;
        });
      });
      function showView(view) {
        document.getElementById("aimeat-modal-body").style.display = view === "login" ? "" : "none";
        document.getElementById("aimeat-forgot-pw-view").style.display = view === "forgot-pw" ? "" : "none";
        document.getElementById("aimeat-forgot-user-view").style.display = view === "forgot-user" ? "" : "none";
        document.getElementById("aimeat-email-view").style.display = view === "email" ? "" : "none";
      }
      var pendingEmailLogin = null;
      function openEmailCompletion(user, pass, hasEmail, mode, displayName) {
        pendingEmailLogin = { username: user, password: pass, mode: mode || "attach", displayName: displayName || user };
        showView("email");
        document.getElementById("aimeat-em-step1").style.display = "";
        document.getElementById("aimeat-em-step2").style.display = "none";
        var emailInput = (
          /** @type {any} */
          document.getElementById("aimeat-em-email")
        );
        emailInput.value = "";
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
      document.getElementById("aimeat-em-send").addEventListener("click", async function() {
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
                email
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
      });
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
      ["aimeat-username", "aimeat-password", "aimeat-displayname"].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("keydown", function(e) {
          if (e.key !== "Enter") return;
          e.preventDefault();
          var btn = (
            /** @type {any} */
            document.getElementById("aimeat-go-btn")
          );
          if (btn && !btn.disabled) btn.click();
        });
      });
      document.getElementById("aimeat-go-btn").addEventListener("click", async () => {
        let username = (
          /** @type {any} */
          document.getElementById("aimeat-username").value.trim().toLowerCase()
        );
        const password = (
          /** @type {any} */
          document.getElementById("aimeat-password").value
        );
        const errEl = document.getElementById("aimeat-error");
        let isGhii = false;
        let isFederated = false;
        let fullUsername = username;
        if (username.includes("@")) {
          const atIdx = username.indexOf("@");
          const nodePart = username.substring(atIdx + 1);
          if (nodePart && nodePart !== NODE_ID) {
            isFederated = true;
            isGhii = true;
          } else {
            username = username.substring(0, atIdx);
            isGhii = true;
          }
        }
        const displayName = (
          /** @type {any} */
          document.getElementById("aimeat-displayname").value.trim() || username
        );
        if (!username || username.length < 3) {
          errEl.textContent = i.errUserShort || "Username must be at least 3 characters";
          errEl.style.display = "block";
          return;
        }
        if (!password || password.length < 4) {
          errEl.textContent = i.errPassShort || "Password must be at least 4 characters";
          errEl.style.display = "block";
          return;
        }
        const btn = (
          /** @type {any} */
          document.getElementById("aimeat-go-btn")
        );
        btn.textContent = i.working || "Working...";
        btn.disabled = true;
        if (isGhii) {
          try {
            if (isFederated) {
              btn.textContent = i.connectingHome || "Connecting to home node...";
            }
            const loginUser = isFederated ? fullUsername : username;
            const session = await auth.loginWithPassword(loginUser, password);
            modal.remove();
            renderBtn();
            if (opts.onLogin) opts.onLogin(session);
          } catch (e2) {
            if (e2.code === "EMAIL_NOT_VERIFIED" && !isFederated) {
              btn.textContent = i.signInBtn || "Sign In / Register";
              btn.disabled = false;
              openEmailCompletion(username, password, !!(e2.details && e2.details.has_email));
              return;
            }
            errEl.textContent = e2.message.includes("Invalid username or password") ? i.errWrongPass || "Wrong password for that username." : e2.message;
            errEl.style.display = "block";
            btn.textContent = i.signInBtn || "Sign In / Register";
            btn.disabled = false;
          }
          return;
        }
        try {
          const session = await auth.register(username, displayName, { password });
          modal.remove();
          renderBtn();
          if (opts.onLogin) opts.onLogin(session);
        } catch (e) {
          if (e.code === "EMAIL_REQUIRED") {
            btn.textContent = i.signInBtn || "Sign In / Register";
            btn.disabled = false;
            openEmailCompletion(username, password, false, "register", displayName);
            return;
          }
          if (e.message.includes("already registered") || e.message.includes("NAME_TAKEN")) {
            try {
              const session = await auth.loginWithPassword(username, password);
              modal.remove();
              renderBtn();
              if (opts.onLogin) opts.onLogin(session);
            } catch (e2) {
              if (e2.code === "EMAIL_NOT_VERIFIED") {
                btn.textContent = i.signInBtn || "Sign In / Register";
                btn.disabled = false;
                openEmailCompletion(username, password, !!(e2.details && e2.details.has_email));
                return;
              }
              errEl.textContent = e2.message.includes("Invalid username or password") ? i.errWrongPass || "Wrong password for that username." : e2.message;
              errEl.style.display = "block";
              btn.textContent = i.signInBtn || "Sign In";
              btn.disabled = false;
            }
          } else {
            errEl.textContent = e.message;
            errEl.style.display = "block";
            btn.textContent = i.signInBtn || "Sign In / Register";
            btn.disabled = false;
          }
        }
      });
    }
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
    const i = opts.i18n || {};
    const useCompact = opts.compact !== void 0 ? !!opts.compact : isAppOrigin();
    function render() {
      const stored = auth2.getSession() || load("session");
      if (stored) {
        var pillHtml = '<div class="aimeat-auth-pill" style="display:inline-flex;align-items:center;gap:10px;padding:8px 18px;background:linear-gradient(160deg,#3d2e1a 0%,#6b4c2a 15%,#c9a84c 30%,#f5e6a3 45%,#c9a84c 55%,#8b6914 70%,#4a3520 100%);border:1px solid rgba(201,168,76,.6);border-top-color:rgba(245,230,163,.5);border-bottom-color:rgba(75,53,32,.8);border-radius:10px;box-shadow:0 1px 0 rgba(245,230,163,.3) inset,0 -1px 0 rgba(75,53,32,.5) inset,0 3px 10px rgba(0,0,0,.4),0 0 20px rgba(201,168,76,.15);font-family:system-ui;font-size:14px"><span class="aimeat-auth-dot" style="display:inline-block;flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#b0ffc8,#00c853 40%,#00802e 80%,#003d15);box-shadow:0 0 5px rgba(0,200,83,.7),0 0 12px rgba(0,200,83,.3),inset 0 -1px 2px rgba(0,0,0,.3)"></span><span class="aimeat-auth-label" style="display:inline-flex;align-items:center;font-size:12px;font-weight:600;letter-spacing:.5px;color:#a0ffb8;text-shadow:0 0 4px rgba(0,210,80,.6),0 0 10px rgba(0,180,70,.3)">' + escHtml(i.loggedIn || "logged in") + '</span><span class="aimeat-auth-ghii" style="color:rgba(90,65,20,.7);font-weight:700;letter-spacing:.5px;font-size:13px;text-shadow:0 1px 0 rgba(245,230,163,.6),0 -1px 0 rgba(50,35,10,.3);-webkit-text-stroke:.2px rgba(120,85,20,.3)">' + escHtml(stored.displayName || stored.ghii || stored.owner) + "</span>" + (stored.federated ? '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;letter-spacing:.5px;color:#7dd3fc;background:rgba(56,189,248,.15);padding:2px 6px;border-radius:4px;border:1px solid rgba(56,189,248,.3)">🌐 ' + escHtml(i.federated || "Federated") + "</span>" : "") + (stored._appOrigin && stored._app && !stored._own ? '<button id="aimeat-grant-gear" title="' + escHtml(i.manageAccess || "Manage permissions") + '" aria-label="' + escHtml(i.manageAccess || "Manage permissions") + '" style="background:rgba(90,65,20,.18);color:#5a4114;border:1px solid rgba(120,85,20,.35);border-radius:6px;padding:3px 8px;cursor:pointer;font-size:13px;line-height:1">⚙️</button>' : "") + themeToggleHtml(i) + '<button id="aimeat-logout-btn" class="aimeat-auth-logout" style="background:radial-gradient(ellipse at 50% 30%,#ff6b6b 0%,#dc2626 35%,#991b1b 70%,#7f1d1d 100%);color:#ffd7d7;border:1px solid rgba(220,38,38,.6);border-top-color:rgba(255,130,130,.4);border-bottom-color:rgba(100,20,20,.8);border-radius:6px;padding:3px 10px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:.3px;box-shadow:0 1px 0 rgba(255,140,140,.25) inset,0 -1px 0 rgba(80,10,10,.4) inset,0 2px 6px rgba(153,27,27,.5);text-shadow:0 1px 1px rgba(0,0,0,.4)">' + escHtml(i.logoutBtn || "Logout") + "</button></div>";
        if (useCompact) {
          ensureAuthPillStyles();
          var ini = pillInitials(stored.displayName || stored.ghii || stored.owner);
          container.innerHTML = '<div class="aimeat-auth-wrap"><button class="aimeat-auth-compact" id="aimeat-auth-compact" aria-haspopup="true" aria-expanded="false" aria-label="' + escHtml(i.account || "Account") + '"><span class="cdot" aria-hidden="true"></span><span class="cini">' + escHtml(ini) + '</span><span class="ccar" aria-hidden="true">▾</span></button>' + pillHtml + "</div>";
        } else {
          container.innerHTML = pillHtml;
        }
        document.getElementById("aimeat-logout-btn").addEventListener("click", () => {
          auth2.logout();
          render();
          if (opts.onLogout) opts.onLogout();
        });
        var gearBtn = document.getElementById("aimeat-grant-gear");
        if (gearBtn) gearBtn.addEventListener("click", () => {
          auth2.manageGrant().then((res) => {
            render();
            if (res && res.revoked && opts.onLogout) opts.onLogout();
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
        container.innerHTML = '<style>.aimeat-sign-btn{padding:8px 18px;background:linear-gradient(160deg,#3d2e1a 0%,#6b4c2a 15%,#c9a84c 30%,#f5e6a3 45%,#c9a84c 55%,#8b6914 70%,#4a3520 100%);color:#2a1800;border:1px solid rgba(201,168,76,.6);border-top-color:rgba(245,230,163,.5);border-bottom-color:rgba(75,53,32,.8);border-radius:10px;cursor:pointer;font-weight:800;font-family:system-ui;font-size:14px;letter-spacing:.3px;box-shadow:0 1px 0 rgba(245,230,163,.3) inset,0 -1px 0 rgba(75,53,32,.5) inset,0 3px 10px rgba(0,0,0,.4),0 0 20px rgba(201,168,76,.15);text-shadow:0 1px 0 rgba(245,230,163,.5);transition:transform .15s,box-shadow .15s}.aimeat-sign-btn:hover{transform:translateY(-1px);box-shadow:0 1px 0 rgba(245,230,163,.3) inset,0 -1px 0 rgba(75,53,32,.5) inset,0 5px 16px rgba(0,0,0,.5),0 0 30px rgba(201,168,76,.3)}</style><span style="display:inline-flex;align-items:center;gap:10px">' + themeToggleHtml(i) + '<button id="aimeat-login-btn" class="aimeat-sign-btn">' + (opts.buttonText || i.signInBtn || "❤️ Sign In") + "</button></span>";
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
      wireThemeToggle(container, i);
    }
    render();
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
    auth2.on("logout", render);
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

  // src/static/sdk-libs/auth/session.js
  var currentSession = null;
  var refreshTimer = null;
  var ownerRefreshInFlight = null;
  var _appOriginLoginInFlight = null;
  var focusRefreshInFlight = null;
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
  function _b64url(buf) {
    var bytes = new Uint8Array(buf), s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function _pkce() {
    var verifier = _b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
    if (crypto.subtle && crypto.subtle.digest) {
      var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      return { verifier, challenge: _b64url(digest), method: "S256" };
    }
    return { verifier, challenge: verifier, method: "plain" };
  }
  async function requestConsentPopup(app, scopeStr, manage) {
    var apexOrigin;
    try {
      apexOrigin = new URL(APEX_URL).origin;
    } catch {
      return null;
    }
    var p = await _pkce();
    var state = _b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
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
      if (!grant && interactive && r && (r.error === "consent_required" || r.error === "login_required") && r.app) {
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
     * @returns {Promise<object>} Session object
     */
    async loginWithPassword(username, password) {
      const data = await api("/v1/ghii/login", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ username, password })
      });
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
    /** Logout — clear stored credentials from localStorage and IndexedDB */
    async logout() {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      ownerRefreshInFlight = null;
      try {
        await fetch(NODE_URL + "/v1/auth/revoke", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...currentSession?.jwt ? { "Authorization": "Bearer " + currentSession.jwt } : {}
          }
        });
      } catch {
      }
      if (isAppOrigin()) {
        try {
          await apexLogout();
        } catch {
        }
      }
      currentSession = null;
      remove("session");
      remove("owner_key");
      await deleteKey("agent_key");
      await deleteKey("owner_key");
      emit("logout");
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
        var res = await api("/v1/ghii/login/" + (pending.provider || "google") + "/finalize", {
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
  var ns = attach("auth", auth);
  ns.version = "2026-07-02-001";
})();
