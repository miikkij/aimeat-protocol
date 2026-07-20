// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/header/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-header.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/header/index.js
  if (!window.__AIMEAT_HEADER_MOUNTED__) {
    window.__AIMEAT_HEADER_MOUNTED__ = true;
    main();
  }
  function main() {
    var THEME_KEY = "aimeat-theme";
    var LANG_KEY = "aimeat-lang";
    var NAV_FALLBACK = {
      "nav.try": "Try it",
      "nav.devView": "For Developers",
      "nav.help": "Help",
      "nav.apps": "Apps",
      "nav.profile": "Profile",
      "nav.admin": "Admin",
      "nav.themeToDark": "Switch to dark mode",
      "nav.themeToLight": "Switch to light mode"
    };
    function readLang() {
      try {
        var u = new URLSearchParams(location.search).get("lang");
        if (u === "en" || u === "fi") return u;
        var s = localStorage.getItem(LANG_KEY);
        if (s === "en" || s === "fi") return s;
      } catch {
      }
      return (navigator.language || "en").slice(0, 2).toLowerCase() === "fi" ? "fi" : "en";
    }
    function readTheme() {
      try {
        var s = localStorage.getItem(THEME_KEY);
        if (s === "light" || s === "dark") return s;
      } catch {
      }
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    function applyTheme(t) {
      document.documentElement.dataset.theme = t;
      try {
        localStorage.setItem(THEME_KEY, t);
      } catch {
      }
    }
    function flatten(obj, prefix, out) {
      out = out || {};
      prefix = prefix || "";
      for (var k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        var key = prefix ? prefix + "." + k : k;
        var v = obj[k];
        if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
        else out[key] = v;
      }
      return out;
    }
    function ensureThemeCss() {
      var present = Array.prototype.some.call(document.querySelectorAll("link[rel=stylesheet]"), function(l) {
        return (l.getAttribute("href") || "").indexOf("/css/theme.css") !== -1;
      });
      if (present) return;
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/css/theme.css";
      link.setAttribute("data-aimeat-theme-css", "");
      document.head.insertBefore(link, document.head.firstChild);
    }
    function loadScript(src) {
      return new Promise(function(resolve) {
        var existing = document.querySelector('script[src="' + src + '"]');
        if (existing) {
          resolve(void 0);
          return;
        }
        var s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = resolve;
        document.head.appendChild(s);
      });
    }
    async function loadTranslations(lang) {
      var v = Date.now();
      var t = {};
      try {
        var enRes = await fetch("/locales/en.json?v=" + v);
        if (enRes.ok) t = flatten(await enRes.json());
      } catch {
      }
      if (lang !== "en") {
        try {
          var locRes = await fetch("/locales/" + lang + ".json?v=" + v);
          if (locRes.ok) {
            var loc = flatten(await locRes.json());
            for (var k in loc) if (Object.prototype.hasOwnProperty.call(loc, k)) t[k] = loc[k];
          }
        } catch {
        }
      }
      return t;
    }
    function modalI18n(t) {
      var keys = [
        "descNew",
        "descReturning",
        "usernameLabel",
        "usernamePlaceholder",
        "passwordLabel",
        "passwordPlaceholder",
        "displayNameLabel",
        "displayNameHint",
        "displayNamePlaceholder",
        "signInBtn",
        "cancelBtn",
        "working",
        "errUserShort",
        "errPassShort",
        "errWrongPass",
        "loggedIn",
        "logoutBtn",
        "forgotPassword",
        "forgotUsername",
        "resetPasswordTitle",
        "resetPasswordDesc",
        "sendResetCode",
        "backToLogin",
        "resetCodeSent",
        "enterNewPasswordTitle",
        "codeLabel",
        "newPasswordLabel",
        "newPasswordPlaceholder",
        "errPassWeak",
        "resetPassword",
        "resetSuccess",
        "recoverUsernameTitle",
        "recoverUsernameDesc",
        "emailLabel",
        "sendUsername",
        "usernameSent",
        "whyTitle",
        "whyGhii",
        "whyPrivacy",
        "whyAgents",
        "whyMorsels"
      ];
      var obj = {};
      for (var i = 0; i < keys.length; i++) {
        var val = t["modal." + keys[i]];
        if (typeof val === "string") obj[keys[i]] = val;
      }
      return obj;
    }
    function buildMarkup(t) {
      function label(k) {
        return t[k] || NAV_FALLBACK[k] || k;
      }
      var nav = document.createElement("nav");
      nav.className = "topnav";
      nav.innerHTML = '<div style="display:flex;align-items:center;gap:20px"><a href="/v1/portal" class="topnav-brand">AIME<span class="heart">♥</span><span class="brand-at">AT</span></a><span class="brand-morsels" data-morsels style="display:none"></span></div><div class="topnav-right"><button class="topnav-burger" aria-label="Menu" data-burger>☰</button><div class="topnav-menu" data-menu><a href="/v1/classic">' + label("nav.try") + '</a><a href="/v1/portal?view=dev">' + label("nav.devView") + '</a><a href="/v1/help">' + label("nav.help") + '</a><a href="/app-catalog.html" target="_blank" data-auth-only style="display:none">' + label("nav.apps") + '</a><a href="/v1/profile" class="profile-link visible" data-auth-only style="display:none">' + label("nav.profile") + '</a><a href="/v1/admin" data-operator-only style="display:none">' + label("nav.admin") + '</a><div class="topnav-center"><button class="lang-btn" data-lang="en">EN</button><button class="lang-btn" data-lang="fi">FI</button></div></div><span class="header-auth-slot" id="headerAuth"></span></div>';
      return nav;
    }
    function wire(nav, t, lang) {
      var burger = nav.querySelector("[data-burger]");
      var menu = nav.querySelector("[data-menu]");
      burger.addEventListener("click", function() {
        menu.classList.toggle("open");
      });
      nav.querySelectorAll("[data-lang]").forEach(function(b) {
        if (b.getAttribute("data-lang") === lang) b.classList.add("active");
        b.addEventListener("click", function() {
          var next = b.getAttribute("data-lang");
          try {
            localStorage.setItem(LANG_KEY, next);
            document.cookie = "aimeat-lang=" + next + ";path=/;max-age=31536000;SameSite=Lax";
          } catch {
          }
          location.reload();
        });
      });
    }
    function refreshSession(nav) {
      var hasSession = !!(window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.hasSession);
      var session = hasSession && window.AIMEAT.auth.getSession ? window.AIMEAT.auth.getSession() : null;
      nav.querySelectorAll("[data-auth-only]").forEach(function(el) {
        el.style.display = session ? "" : "none";
      });
      var isOp = session && session.roles && session.roles.indexOf("operator") !== -1;
      nav.querySelectorAll("[data-operator-only]").forEach(function(el) {
        el.style.display = isOp ? "" : "none";
      });
      var morselEl = (
        /** @type {HTMLElement} */
        nav.querySelector("[data-morsels]")
      );
      if (session && session.jwt) {
        fetch("/v1/wallet", { headers: { "Authorization": "Bearer " + session.jwt } }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (d && d.ok && d.data && d.data.balance != null) {
            morselEl.textContent = d.data.balance;
            morselEl.style.display = "inline-flex";
          } else {
            morselEl.style.display = "none";
          }
        }).catch(function() {
          morselEl.style.display = "none";
        });
      } else {
        morselEl.style.display = "none";
      }
    }
    async function init() {
      applyTheme(readTheme());
      ensureThemeCss();
      var lang = readLang();
      document.documentElement.lang = lang;
      var t = await loadTranslations(lang);
      var nav = buildMarkup(t);
      var mount = document.getElementById("aimeat-header");
      if (mount) {
        mount.appendChild(nav);
      } else {
        document.body.insertBefore(nav, document.body.firstChild);
      }
      wire(nav, t, lang);
      await loadScript("/v1/libs/aimeat-auth.js");
      if (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.login) {
        try {
          await window.AIMEAT.auth.login();
        } catch {
        }
      }
      function mountPill() {
        try {
          if (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.mountLoginButton) {
            var pillI18n = modalI18n(t);
            pillI18n.themeToDark = t["nav.themeToDark"] || NAV_FALLBACK["nav.themeToDark"];
            pillI18n.themeToLight = t["nav.themeToLight"] || NAV_FALLBACK["nav.themeToLight"];
            window.AIMEAT.auth.mountLoginButton("#headerAuth", {
              onLogin: function() {
                window.dispatchEvent(new Event("aimeat-auth-change"));
              },
              onLogout: function() {
                window.dispatchEvent(new Event("aimeat-auth-change"));
              },
              i18n: pillI18n
            });
          }
        } catch (e) {
          console.error("AIMEAT header: auth mount failed", e);
        }
      }
      mountPill();
      refreshSession(nav);
      window.addEventListener("aimeat-auth-change", function() {
        refreshSession(nav);
      });
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function() {
        init();
      });
    } else {
      init();
    }
  }
})();
