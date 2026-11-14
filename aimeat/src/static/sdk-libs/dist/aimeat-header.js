// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/header/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-header.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/lang.js
  var LANG_KEY = "aimeat-lang";
  var LANG_CHOSEN_KEY = "aimeat-lang-chosen";
  var COOKIE_MAX_AGE = 31536e3;
  function servedPageLang() {
    if (typeof document === "undefined" || typeof document.querySelector !== "function") return null;
    const m = (
      /** @type {HTMLMetaElement|null} */
      document.querySelector('meta[name="aimeat-page-lang"]')
    );
    const code = m && m.content ? m.content.trim().toLowerCase() : "";
    return /^[a-z]{2}$/.test(code) ? code : null;
  }
  function readLang(locales) {
    const list = Array.isArray(locales) ? locales : null;
    const pick = list ? function(v) {
      return v && list.indexOf(v) >= 0 ? v : null;
    } : function(v) {
      return v ? String(v).slice(0, 2) : null;
    };
    const served = pick(servedPageLang());
    if (served) return served;
    try {
      const u = pick(new URLSearchParams(location.search).get("lang"));
      if (u) return u;
      const s = pick(localStorage.getItem(LANG_KEY));
      if (s) return s;
      const c = document.cookie.match(/(?:^|;\s*)aimeat-lang=([a-z]{2})(?:;|$)/);
      const cv = c ? pick(c[1]) : null;
      if (cv) return cv;
    } catch {
    }
    const cfg = typeof window !== "undefined" ? window.__AIMEAT_SDK_CFG__ : void 0;
    const node = pick(cfg && cfg.defaultLocale);
    if (node) return node;
    let nav = null;
    try {
      nav = pick(String(navigator.language || "").slice(0, 2).toLowerCase());
    } catch {
    }
    if (nav) return nav;
    return list ? list[0] : "en";
  }
  function writeLang(lang) {
    const keep = ";path=/;max-age=" + COOKIE_MAX_AGE + ";SameSite=Lax";
    try {
      document.cookie = LANG_KEY + "=" + lang + keep;
      document.cookie = LANG_CHOSEN_KEY + "=1" + keep;
      localStorage.setItem(LANG_KEY, lang);
      localStorage.setItem(LANG_CHOSEN_KEY, "1");
    } catch {
    }
  }

  // src/static/sdk-libs/header/nav.js
  var PUBLIC_LINKS = [
    { id: "howItWorks", path: "/v1/how-it-works", key: "nav.howItWorks", fallback: "How it works", when: "anon" },
    { id: "learn", site: "learn", key: "nav.learn", fallback: "Learn", when: "anon", external: true },
    { id: "business", path: "/v1/business", key: "nav.business", fallback: "For your business", when: "anon" },
    { id: "help", path: "/v1/help", key: "nav.help", fallback: "Help" }
  ];
  var SIGNED_IN_LINKS = [
    { id: "home", path: "/v1/home", key: "nav.home", fallback: "Home" },
    { id: "messages", path: "/v1/profile?tab=messages", key: "nav.messages", fallback: "Messages" },
    { id: "agents", path: "/v1/home?agents=1", key: "nav.agents", fallback: "Agents" },
    { id: "chat", path: "/v1/chat", key: "nav.chat", fallback: "Chat" },
    { id: "apps", path: "/v1/appcat", key: "nav.apps", fallback: "Apps" },
    { id: "profile", path: "/v1/profile", key: "nav.profile", fallback: "Settings & Controls", cls: "profile-link visible" },
    { id: "admin", path: "/v1/admin", key: "nav.admin", fallback: "Admin", operator: true }
  ];
  function brandPath(signedIn) {
    return signedIn ? "/v1/home" : "/v1/portal";
  }
  function headerLinks(site, navConfig) {
    const s = site || {};
    const declared = PUBLIC_LINKS.map((l) => l.id);
    const stored = navConfig && Array.isArray(navConfig.order) ? navConfig.order.filter((id) => typeof id === "string" && declared.indexOf(id) !== -1) : [];
    const order = stored.concat(declared.filter((id) => stored.indexOf(id) === -1));
    const hidden = navConfig && Array.isArray(navConfig.hidden) ? navConfig.hidden : [];
    const out = [];
    for (const id of order) {
      const link = PUBLIC_LINKS.find((l) => l.id === id);
      if (!link || hidden.indexOf(id) !== -1) continue;
      if (s.customerNode && id !== "help") continue;
      const href = link.site ? String(s[link.site] || "").trim() : String(link.path);
      if (!href) continue;
      if (link.when === "anon" && s.signedInOnly) continue;
      out.push({
        id,
        href,
        key: link.key,
        fallback: link.fallback,
        show: link.when === "anon" ? "anon" : s.signedInOnly ? "auth" : "always",
        external: !!link.external,
        cls: ""
      });
    }
    for (const link of SIGNED_IN_LINKS) {
      if (link.operator && s.customerNode) continue;
      out.push({
        id: link.id,
        href: link.path,
        key: link.key,
        fallback: link.fallback,
        show: link.operator ? "operator" : "auth",
        external: false,
        cls: link.cls || ""
      });
    }
    return out;
  }
  function linkShown(link, session) {
    if (link.show === "always") return true;
    if (link.show === "anon") return !session;
    if (link.show === "auth") return !!session;
    return !!(session && Array.isArray(session.roles) && session.roles.indexOf("operator") !== -1);
  }

  // src/static/sdk-libs/header/index.js
  if (!window.__AIMEAT_HEADER_MOUNTED__) {
    window.__AIMEAT_HEADER_MOUNTED__ = true;
    main();
  }
  function main() {
    var THEME_KEY = "aimeat-theme";
    var LANGS = ["en", "fi", "es"];
    var NAV_FALLBACK = {
      "nav.themeToDark": "Switch to dark mode",
      "nav.themeToLight": "Switch to light mode"
    };
    function readLang2() {
      return (
        /** @type {string} */
        readLang(LANGS)
      );
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
    async function loadNavConfig() {
      try {
        var r = await fetch("/v1/site/header-nav");
        var d = r.ok ? await r.json() : null;
        return d && d.ok && d.data ? d.data : null;
      } catch (err) {
        console.warn("AIMEAT header: the order of the public links was not read; the declared order stands", err);
        return null;
      }
    }
    function esc(v) {
      return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
        "whyMorsels",
        // Two-tab modal. Without these the FIRST paint falls back to English and the modal visibly
        // re-renders once the node's full dictionary arrives.
        "tabSignIn",
        "tabRegister",
        "identifierLabel",
        "identifierPlaceholder",
        "signInOnlyBtn",
        "createAccountBtn",
        "usernameHint",
        "registerEmailHint",
        "displayNameOptional",
        "errIdentifierRequired",
        "errPassRequired",
        "errWrongCredentials",
        "errNameTaken"
      ];
      var obj = {};
      for (var i = 0; i < keys.length; i++) {
        var val = t["modal." + keys[i]];
        if (typeof val === "string") obj[keys[i]] = val;
      }
      return obj;
    }
    function nodeHref(path) {
      var m = /^(https?:\/\/)[^.]+\.apps\.(.+)$/.exec(location.origin);
      return m ? m[1] + m[2] + path : path;
    }
    function buildMarkup(t, links) {
      var nav = document.createElement("nav");
      nav.className = "topnav";
      nav.innerHTML = '<div style="display:flex;align-items:center;gap:20px"><a href="' + nodeHref(brandPath(false)) + '" class="topnav-brand" data-brand>AIME<span class="heart">♥</span><span class="brand-at">AT</span></a><span class="brand-morsels" data-morsels style="display:none"></span></div><div class="topnav-right"><button class="topnav-burger" aria-label="Menu" data-burger>☰</button><div class="topnav-menu" data-menu>' + // The shell's links (./nav.js): the marketing pages for someone who has not signed in,
      // and Home, Messages, Agents, Chat, Apps and Settings the moment there is a session.
      // Every one is drawn hidden and refreshSession shows the ones this session gets.
      links.map(function(l, i) {
        return '<a href="' + esc(l.external ? l.href : nodeHref(l.href)) + '" data-link="' + i + '"' + (l.cls ? ' class="' + l.cls + '"' : "") + (l.external ? ' target="_blank" rel="noopener"' : "") + ' style="display:none">' + esc(t[l.key] || l.fallback) + "</a>";
      }).join("") + '<div class="topnav-center">' + // Theme toggle now lives inside the login pill (mountLoginButton) — see init().
      LANGS.map(function(l) {
        return '<button class="lang-btn" data-lang="' + l + '">' + l.toUpperCase() + "</button>";
      }).join("") + '</div></div><a data-node-update href="' + nodeHref("/v1/admin?nodeUpdate=1") + '" style="display:none;padding:.1rem .45rem;border:1px solid var(--text);background:var(--sun);color:var(--on-sun);font-family:var(--font-mono);font-size:.68rem;font-weight:500;letter-spacing:.04em;text-decoration:none"></a><span class="header-auth-slot" id="headerAuth"></span></div>';
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
          writeLang(b.getAttribute("data-lang"));
          var u = new URL(location.href);
          if (u.searchParams.has("lang")) {
            u.searchParams.delete("lang");
            location.replace(u.pathname + u.search + u.hash);
            return;
          }
          location.reload();
        });
      });
    }
    function fitBar(nav) {
      var menu = nav.querySelector("[data-menu]");
      var wasCompact = nav.classList.contains("topnav--compact");
      if (wasCompact) nav.classList.remove("topnav--compact");
      var group = (
        /** @type {HTMLElement|null} */
        nav.lastElementChild
      );
      var contentRight = nav.getBoundingClientRect().right - (parseFloat(getComputedStyle(nav).paddingRight) || 0);
      var overflows = nav.scrollWidth > nav.clientWidth + 1 || !!group && (group.scrollWidth > group.clientWidth + 1 || group.getBoundingClientRect().right > contentRight + 1);
      nav.classList.toggle("topnav--compact", overflows);
      if (!overflows && wasCompact && menu) menu.classList.remove("open");
    }
    function refreshSession(nav, t, links, site) {
      var hasSession = !!(window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.hasSession);
      var session = hasSession && window.AIMEAT.auth.getSession ? window.AIMEAT.auth.getSession() : null;
      nav.querySelectorAll("[data-link]").forEach(function(el) {
        var link = links[Number(el.getAttribute("data-link"))];
        el.style.display = link && linkShown(link, session) ? "" : "none";
      });
      var brand = nav.querySelector("[data-brand]");
      if (brand) brand.setAttribute("href", nodeHref(brandPath(!!session)));
      var isOp = session && session.roles && session.roles.indexOf("operator") !== -1;
      var updateEl = (
        /** @type {HTMLElement} */
        nav.querySelector("[data-node-update]")
      );
      updateEl.style.display = "none";
      if (isOp && session.jwt) {
        fetch("/v1/admin/node-update", { headers: { "Authorization": "Bearer " + session.jwt } }).then(function(r) {
          return r.json();
        }).then(function(d) {
          var s = d && d.ok && d.data;
          if (!s || !s.enabled || !s.updateAvailable) return;
          updateEl.textContent = (t["nodeUpdate.pill"] || "New: {version}").replace("{version}", s.latest);
          updateEl.title = t["nodeUpdate.pillTitle"] || "";
          updateEl.style.display = "inline-block";
        }).catch(function() {
          updateEl.style.display = "none";
        });
      }
      var morselEl = (
        /** @type {HTMLElement} */
        nav.querySelector("[data-morsels]")
      );
      if (session && session.jwt && !site.customerNode) {
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
      var lang = readLang2();
      document.documentElement.lang = lang;
      var site = window.__AIMEAT_HEADER_CFG__ || {};
      var loaded = await Promise.all([loadTranslations(lang), loadNavConfig()]);
      var t = loaded[0];
      var links = headerLinks(site, loaded[1]);
      var nav = buildMarkup(t, links);
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
              nameHref: nodeHref("/v1/home?settings=1"),
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
      refreshSession(nav, t, links, site);
      window.addEventListener("aimeat-auth-change", function() {
        refreshSession(nav, t, links, site);
      });
      var raf = 0;
      function schedule() {
        if (raf) return;
        raf = requestAnimationFrame(function() {
          raf = 0;
          fitBar(nav);
        });
      }
      if (typeof ResizeObserver !== "undefined") {
        var ro = new ResizeObserver(schedule);
        ro.observe(nav);
        var slot = nav.querySelector("#headerAuth");
        if (slot) ro.observe(slot);
      }
      window.addEventListener("resize", schedule);
      window.addEventListener("aimeat-auth-change", schedule);
      schedule();
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
