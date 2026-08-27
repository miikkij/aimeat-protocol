// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/atelier/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-atelier.js (with a per-node config prelude).
"use strict";
(() => {
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

  // src/static/sdk-libs/atelier/dom.js
  var SPECIAL = { text: 1, on: 1, vars: 1, children: 1 };
  var ENTER_MAX = 12;
  var seq = 0;
  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "text") {
          node.textContent = String(v);
          continue;
        }
        if (k === "on") {
          for (const type in v) node.addEventListener(type, v[type]);
          continue;
        }
        if (k === "vars") {
          for (const name in v) node.style.setProperty(name, String(v[name]));
          continue;
        }
        if (SPECIAL[k]) continue;
        node.setAttribute(k, v === true ? "" : String(v));
      }
      if (attrs.children != null) append(node, attrs.children);
    }
    if (kids != null) append(node, kids);
    return node;
  }
  function append(parent, kids) {
    const list = Array.isArray(kids) ? kids : [kids];
    for (const c of list) {
      if (c == null || c === false) continue;
      parent.appendChild(typeof c === "object" ? (
        /** @type {Node} */
        c
      ) : document.createTextNode(String(c)));
    }
  }
  function $(sel, root) {
    return (
      /** @type {HTMLElement|null} */
      (root || document).querySelector(sel)
    );
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }
  function uid(prefix) {
    seq += 1;
    return (prefix || "ak") + "-" + seq;
  }
  function reducedMotion() {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function resolve(target, fallback) {
    if (!target) return fallback || document.body;
    if (typeof target === "string") return $(target) || fallback || document.body;
    return target;
  }
  function injectStyle(opts) {
    const o = opts || {};
    const head = document.head || document.getElementsByTagName("head")[0];
    let link = (
      /** @type {HTMLLinkElement|null} */
      document.getElementById("ak-style")
    );
    if (!link) {
      link = document.createElement("link");
      link.id = "ak-style";
      link.rel = "stylesheet";
      link.href = o.href || "/lib/aimeat-atelier.css";
      head.insertBefore(link, head.firstChild);
    }
    let style = (
      /** @type {HTMLStyleElement|null} */
      document.getElementById("ak-style-extra")
    );
    if (o.extraCss) {
      if (!style) {
        style = document.createElement("style");
        style.id = "ak-style-extra";
        head.appendChild(style);
      }
      style.textContent = o.extraCss;
    }
    return { link, style };
  }
  var busyMap = /* @__PURE__ */ new WeakMap();
  function busy(node) {
    if (!node) return function() {
    };
    const known = busyMap.get(node);
    if (known) return known;
    node.classList.add("ak-busy");
    node.setAttribute("aria-busy", "true");
    const wasDisabled = (
      /** @type {HTMLButtonElement} */
      node.disabled
    );
    if ("disabled" in node) node.disabled = true;
    const release = function() {
      busyMap.delete(node);
      node.classList.remove("ak-busy");
      node.removeAttribute("aria-busy");
      if ("disabled" in node) node.disabled = !!wasDisabled;
    };
    busyMap.set(node, release);
    return release;
  }
  function guardButtons(target, opts) {
    const root = resolve(
      /** @type {any} */
      target,
      document.body
    ) || document.body;
    const ms = opts && opts.ms || 700;
    const onClick = function(ev) {
      const start = (
        /** @type {Element|null} */
        ev.target
      );
      if (!start || !start.closest) return;
      const btn = start.closest('button, [role="button"], .ak-btn');
      if (!btn || btn.hasAttribute("data-ak-noguard")) return;
      if (busyMap.has(btn)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      const release = busy(btn);
      setTimeout(release, ms);
    };
    root.addEventListener("click", onClick, true);
    return function() {
      root.removeEventListener("click", onClick, true);
    };
  }
  function whileBusy(node, work) {
    const release = busy(node);
    return Promise.resolve(work).then(
      function(v) {
        release();
        return v;
      },
      function(e) {
        release();
        throw e;
      }
    );
  }
  function enter(root, opts) {
    if (!root || reducedMotion() || typeof root.animate !== "function") return;
    const cs = getComputedStyle(root);
    const dist = parseFloat(cs.getPropertyValue("--ak-enter-distance")) || 0;
    const step = parseFloat(cs.getPropertyValue("--ak-enter-stagger")) || 0;
    const span = parseFloat(cs.getPropertyValue("--ak-motion")) || 200;
    if (dist === 0 && step === 0) return;
    const max = opts && opts.max || ENTER_MAX;
    const kids = Array.prototype.slice.call(root.children, 0, max);
    for (let i = 0; i < kids.length; i++) {
      kids[i].animate(
        [
          { opacity: 0, transform: "translateY(" + dist + "px)" },
          { opacity: 1, transform: "translateY(0)" }
        ],
        { duration: span, delay: i * step, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "backwards" }
      );
    }
  }
  function countUp(node, from, to, opts) {
    if (!node) return;
    const fmt = opts && opts.format || function(n) {
      return String(Math.round(n));
    };
    if (reducedMotion() || from === to || typeof requestAnimationFrame !== "function") {
      node.textContent = fmt(to);
      return;
    }
    const span = opts && opts.ms || 600;
    const t0 = performance.now();
    const tick = function(now) {
      const p = Math.min(1, (now - t0) / span);
      const eased = 1 - (1 - p) * (1 - p);
      node.textContent = fmt(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // src/static/sdk-libs/atelier/i18n.js
  var BASE = {
    en: {
      loading: "Loading…",
      ready: "Ready.",
      retry: "Try again",
      close: "Close",
      back: "Back",
      cancel: "Cancel",
      save: "Save",
      confirm: "Confirm",
      search: "Search",
      menu: "Menu",
      more: "More",
      open: "Open",
      empty: "Nothing here yet",
      emptyHint: "What you add will appear here.",
      noResults: "Nothing matched",
      noResultsHint: "Try a different word.",
      loadFailed: "This did not load",
      loadFailedHint: "Check your connection and try again.",
      signIn: "Log in to continue.",
      required: "Required",
      optional: "Optional",
      total: "Total",
      you: "You"
    },
    fi: {
      loading: "Ladataan…",
      ready: "Valmis.",
      retry: "Yritä uudelleen",
      close: "Sulje",
      back: "Takaisin",
      cancel: "Peruuta",
      save: "Tallenna",
      confirm: "Vahvista",
      search: "Hae",
      menu: "Valikko",
      more: "Lisää",
      open: "Avaa",
      empty: "Täällä ei ole vielä mitään",
      emptyHint: "Lisäämäsi asiat näkyvät tässä.",
      noResults: "Ei osumia",
      noResultsHint: "Kokeile toista sanaa.",
      loadFailed: "Tämä ei latautunut",
      loadFailedHint: "Tarkista yhteys ja yritä uudelleen.",
      signIn: "Kirjaudu sisään jatkaaksesi.",
      required: "Pakollinen",
      optional: "Valinnainen",
      total: "Yhteensä",
      you: "Sinä"
    },
    es: {
      loading: "Cargando…",
      ready: "Listo.",
      retry: "Inténtalo otra vez",
      close: "Cerrar",
      back: "Atrás",
      cancel: "Cancelar",
      save: "Guardar",
      confirm: "Confirmar",
      search: "Buscar",
      menu: "Menú",
      more: "Más",
      open: "Abrir",
      empty: "Aquí todavía no hay nada",
      emptyHint: "Lo que añadas aparecerá aquí.",
      noResults: "Sin coincidencias",
      noResultsHint: "Prueba con otra palabra.",
      loadFailed: "Esto no se cargó",
      loadFailedHint: "Revisa tu conexión e inténtalo otra vez.",
      signIn: "Inicia sesión para continuar.",
      required: "Obligatorio",
      optional: "Opcional",
      total: "Total",
      you: "Tú"
    }
  };
  var HOST = { en: {}, fi: {}, es: {} };
  var listeners = [];
  var current = detect();
  function detect() {
    try {
      const ns = (
        /** @type {any} */
        window.AIMEAT
      );
      if (ns && ns.auth && typeof ns.auth.getLang === "function") {
        const l = ns.auth.getLang();
        if (l) return String(l).slice(0, 2);
      }
      const stored = localStorage.getItem("aimeat-lang");
      if (stored) return stored.slice(0, 2);
    } catch {
    }
    return (navigator.language || "en").slice(0, 2);
  }
  function announce(lang) {
    for (const cb of listeners.slice()) {
      try {
        cb(lang);
      } catch {
      }
    }
  }
  if (typeof window !== "undefined") {
    window.addEventListener("aimeat-lang-change", function(ev) {
      const detail = (
        /** @type {any} */
        ev.detail
      );
      const lang = detail && detail.lang || detect();
      if (lang === current) return;
      current = String(lang).slice(0, 2);
      announce(current);
    });
  }
  var i18n = {
    /** The languages the kit itself ships. A host may add more via `use()`. */
    langs: ["en", "fi", "es"],
    /** The language in force right now. @returns {string} */
    lang() {
      return current;
    },
    /**
     * Set the language for the kit AND the platform (one key, `aimeat-lang`, shared with the site).
     * @param {string} lang
     */
    setLang(lang) {
      const next = String(lang).slice(0, 2);
      if (next === current) return;
      current = next;
      try {
        const ns = (
          /** @type {any} */
          window.AIMEAT
        );
        if (ns && ns.auth && typeof ns.auth.setLang === "function") ns.auth.setLang(next);
        else localStorage.setItem("aimeat-lang", next);
      } catch {
      }
      announce(current);
    },
    /**
     * Merge the host's dictionary over the kit's. Either `{ en: {...}, fi: {...} }` or a flat
     * object for the current language.
     * @param {Record<string, any>} dict
     */
    use(dict) {
      if (!dict) return;
      const looksNested = Object.keys(dict).every(function(k) {
        return dict[k] && typeof dict[k] === "object" && !Array.isArray(dict[k]);
      });
      if (looksNested) {
        for (const lang in dict) {
          HOST[lang] = Object.assign({}, HOST[lang] || {}, dict[lang]);
        }
      } else {
        HOST[current] = Object.assign({}, HOST[current] || {}, dict);
      }
      announce(current);
    },
    /**
     * Look up a string: host(current) → kit(current) → kit(en) → the key itself. `{name}` in the
     * text is replaced from `vars`.
     * @param {string} key
     * @param {Record<string, any>} [vars]
     * @returns {string}
     */
    t(key, vars) {
      const text = HOST[current] && HOST[current][key] || BASE[current] && BASE[current][key] || HOST.en && HOST.en[key] || BASE.en[key] || key;
      if (!vars) return String(text);
      return String(text).replace(/\{(\w+)\}/g, function(whole, name) {
        return vars[name] == null ? whole : String(vars[name]);
      });
    },
    /**
     * Run a callback whenever the language changes (host `use()` counts — new words arrived).
     * @param {(lang: string) => void} cb
     * @returns {() => void}  stop listening
     */
    onChange(cb) {
      listeners.push(cb);
      return function() {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    }
  };
  var t = i18n.t;

  // src/static/sdk-libs/atelier/state.js
  function emptyState(spec) {
    const state = { title: spec.title, hint: spec.hint, action: spec.action || null };
    const tone = spec.tone || "quiet";
    const mark = el("div", { class: "ak-empty__mark", "aria-hidden": "true" }, [
      el("span", { class: "ak-empty__mark-a" }),
      el("span", { class: "ak-empty__mark-b" }),
      el("span", { class: "ak-empty__mark-c" })
    ]);
    const title = el("h3", { class: "ak-empty__title" });
    const hint = el("p", { class: "ak-empty__hint" });
    const actions = el("div", { class: "ak-empty__actions" });
    const root = el("div", {
      class: "ak-root ak-empty ak-empty--" + tone,
      role: tone === "error" ? "alert" : null
    }, [mark, title, hint, actions]);
    if (spec.target) resolve(spec.target).appendChild(root);
    function render() {
      title.textContent = state.title;
      hint.textContent = state.hint || "";
      hint.hidden = !state.hint;
      clear(actions);
      actions.hidden = !state.action;
      if (state.action) {
        actions.appendChild(el("button", {
          type: "button",
          class: "ak-btn ak-btn--primary",
          on: { click: function() {
            if (state.action && state.action.onClick) state.action.onClick();
          } }
        }, state.action.label));
      }
    }
    render();
    enter(root);
    return {
      el: root,
      /** @param {{ title?: string, hint?: string, action?: any }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.title != null) state.title = patch.title;
        if (patch.hint !== void 0) state.hint = patch.hint;
        if (patch.action !== void 0) state.action = patch.action;
        render();
      },
      destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function skeleton(spec) {
    const s = spec || {};
    const rows = Math.max(1, Math.min(8, s.rows || 3));
    const lines = Math.max(1, Math.min(4, s.lines || 2));
    const root = el("div", { class: "ak-root ak-skeleton", role: "status", "aria-live": "polite" });
    for (let r = 0; r < rows; r++) {
      const row = el("div", { class: "ak-skeleton__row" });
      for (let l = 0; l < lines; l++) {
        row.appendChild(el("span", {
          class: "ak-skeleton__line" + (l === 0 ? " ak-skeleton__line--lead" : ""),
          "aria-hidden": "true"
        }));
      }
      root.appendChild(row);
    }
    if (s.target) resolve(s.target).appendChild(root);
    return {
      el: root,
      destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/atelier/shell.js
  var BOOT_POLL_MS = 300;
  function app(spec) {
    injectStyle();
    const state = { title: spec.title, look: spec.look || "vivid" };
    const titleId = uid("ak-app-title");
    const heading = el("span", { class: "ak-app__title", id: titleId, text: state.title });
    const pill = el("span", { class: "ak-app__pill", id: "login" });
    const bar = el("header", { class: "ak-app__bar" }, [heading, pill]);
    const statusHost = el("div", { class: "ak-app__status" });
    const main = el("main", { class: "ak-app__main ak-scroll" });
    const footer = spec.footer != null ? el("footer", { class: "ak-app__foot", text: spec.footer }) : null;
    const root = el("div", {
      class: "ak-root ak-app",
      "data-ak-look": state.look,
      "aria-labelledby": titleId
    }, [bar, statusHost, main, footer]);
    let nav = null;
    if (spec.navItems && spec.navItems.length) {
      nav = bottomNav({ items: spec.navItems });
      root.appendChild(nav.el);
      root.classList.add("ak-app--bottomnav");
    }
    resolve(spec.target, document.body).appendChild(root);
    let statusCard = null;
    function status(kind, opts) {
      const o = opts || {};
      if (statusCard) {
        statusCard.destroy();
        statusCard = null;
      }
      clear(statusHost);
      if (kind === "none" || kind === "ready") {
        statusHost.hidden = true;
        return;
      }
      statusHost.hidden = false;
      if (kind === "loading") {
        statusHost.appendChild(el("div", { class: "ak-loading", role: "status", "aria-live": "polite" }, [
          el("span", { class: "ak-loading__pulse", "aria-hidden": "true" }),
          el("span", { text: o.title || t("loading") })
        ]));
        return;
      }
      const kinds = {
        empty: { title: o.title || t("empty"), hint: o.hint || t("emptyHint") },
        error: { title: o.title || t("loadFailed"), hint: o.hint || t("loadFailedHint") },
        signin: { title: o.title || t("signIn"), hint: o.hint }
      };
      const chosen = kinds[kind] || kinds.error;
      statusCard = emptyState({
        target: statusHost,
        tone: kind === "error" ? "error" : "quiet",
        title: chosen.title,
        hint: chosen.hint,
        action: kind === "error" && o.onRetry ? { label: t("retry"), onClick: o.onRetry } : null
      });
    }
    const requireLogin = spec.requireLogin !== false;
    let booted = false;
    let pollTimer = null;
    function auth() {
      const ns = (
        /** @type {any} */
        window.AIMEAT
      );
      return ns && ns.auth ? ns.auth : null;
    }
    function tryBoot() {
      if (booted) return;
      const a = auth();
      const session = a && typeof a.getSession === "function" ? a.getSession() : null;
      if (session && session.jwt) {
        booted = true;
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        status("none");
        if (spec.onReady) spec.onReady(session);
      }
    }
    function startBoot() {
      const a = auth();
      if (a && typeof a.mountLoginButton === "function") {
        a.mountLoginButton(pill, {
          onLogin: function() {
            tryBoot();
          },
          onLogout: function() {
            booted = false;
            status("signin");
            if (spec.onLogout) spec.onLogout();
            armPoll();
          }
        });
      }
      if (!requireLogin) {
        booted = true;
        status("none");
        if (spec.onReady) spec.onReady(a && a.getSession ? a.getSession() : null);
        return;
      }
      status("loading");
      armPoll();
      tryBoot();
    }
    function armPoll() {
      if (pollTimer) return;
      pollTimer = setInterval(function() {
        tryBoot();
        if (booted && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }, BOOT_POLL_MS);
    }
    const stopLang = i18n.onChange(function() {
      heading.textContent = state.title;
    });
    startBoot();
    return {
      el: root,
      main,
      /** @param {{ title?: string, look?: string }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.title != null) {
          state.title = patch.title;
          heading.textContent = state.title;
        }
        if (patch.look != null) {
          state.look = patch.look;
          root.setAttribute("data-ak-look", state.look);
        }
      },
      status,
      t,
      i18n,
      destroy() {
        stopLang();
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (statusCard) statusCard.destroy();
        if (nav) nav.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function section(spec) {
    const s = spec || {};
    const heading = s.title != null ? el("h2", { class: "ak-section__title", text: s.title }) : null;
    const hint = s.hint != null ? el("p", { class: "ak-section__hint", text: s.hint }) : null;
    const body = el("div", { class: "ak-section__body" });
    if (s.body != null) append(body, s.body);
    const root = el("section", {
      class: "ak-root ak-section" + (s.flush ? " ak-section--flush" : "")
    }, [heading, hint, body]);
    if (s.target) resolve(s.target).appendChild(root);
    enter(body);
    return {
      el: root,
      body,
      /** @param {{ title?: string, hint?: string, body?: any }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.title != null && heading) heading.textContent = patch.title;
        if (patch.hint != null && hint) hint.textContent = patch.hint;
        if (patch.body !== void 0) {
          clear(body);
          append(body, patch.body);
        }
      },
      destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function tabs(spec) {
    const state = { items: spec.items || [], value: spec.value || (spec.items && spec.items[0] ? spec.items[0].id : "") };
    const root = el("div", { class: "ak-root ak-tabs", role: "tablist" });
    if (spec.target) resolve(spec.target).appendChild(root);
    function render() {
      clear(root);
      for (const item of state.items) {
        const active = item.id === state.value;
        root.appendChild(el("button", {
          type: "button",
          class: "ak-tab" + (active ? " ak-tab--active" : ""),
          role: "tab",
          "aria-selected": active ? "true" : "false",
          "data-ak-noguard": true,
          on: {
            click: function() {
              if (item.id === state.value) return;
              state.value = item.id;
              render();
              if (spec.onChange) spec.onChange(item.id);
            }
          }
        }, item.label));
      }
    }
    render();
    return {
      el: root,
      /** @param {{ value?: string, items?: Array<{ id: string, label: string }> }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.items) state.items = patch.items;
        if (patch.value != null) state.value = patch.value;
        render();
      },
      destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function bottomNav(spec) {
    const state = { items: spec.items || [], value: spec.value || "" };
    const root = el("nav", { class: "ak-root ak-bottomnav" });
    if (spec.target) resolve(spec.target).appendChild(root);
    function render() {
      clear(root);
      for (const item of state.items) {
        const active = item.id === state.value;
        root.appendChild(el("button", {
          type: "button",
          class: "ak-bottomnav__item" + (active ? " ak-bottomnav__item--active" : ""),
          "aria-current": active ? "page" : null,
          "data-ak-noguard": true,
          on: {
            click: function() {
              state.value = item.id;
              render();
              if (item.onPick) item.onPick(item);
            }
          }
        }, item.label));
      }
    }
    render();
    return {
      el: root,
      /** @param {{ value?: string, items?: any[] }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.items) state.items = patch.items;
        if (patch.value != null) state.value = patch.value;
        render();
      },
      destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/atelier/hero.js
  function imageLayer(url) {
    if (!url) return null;
    const v = String(url);
    if (/^data:/i.test(v)) {
      console.warn("aimeat-atelier: hero image data: URIs are refused — upload the image to storage and pass its URL.");
      return null;
    }
    return 'url("' + v.replace(/"/g, "%22") + '")';
  }
  function hero(spec) {
    const state = { title: spec.title, sub: spec.sub, actions: spec.actions || [] };
    const titleId = uid("ak-hero-title");
    const title = el("h1", { class: "ak-hero__title", id: titleId });
    const sub = el("p", { class: "ak-hero__sub" });
    const actions = el("div", { class: "ak-hero__actions" });
    const inner = el("div", { class: "ak-hero__inner" }, [title, sub, actions]);
    const root = el("div", {
      class: "ak-root ak-hero",
      "data-ak-hero": true,
      "aria-labelledby": titleId
    }, [inner]);
    const layer = imageLayer(spec.image);
    if (layer) {
      root.style.setProperty("--ak-hero-image", layer);
      root.classList.add("ak-hero--image");
    }
    if (spec.target) resolve(spec.target).appendChild(root);
    function render() {
      title.textContent = state.title;
      sub.textContent = state.sub || "";
      sub.hidden = !state.sub;
      clear(actions);
      actions.hidden = !state.actions.length;
      for (const action of state.actions) {
        const kind = action.kind || "plain";
        actions.appendChild(el("button", {
          type: "button",
          class: "ak-btn" + (kind === "plain" ? "" : " ak-btn--" + kind),
          "data-ak-id": action.id,
          on: { click: function() {
            if (action.onClick) action.onClick(action);
          } }
        }, action.label));
      }
    }
    render();
    enter(inner);
    return {
      el: root,
      /** @param {{ title?: string, sub?: string, image?: string|null, actions?: HeroAction[] }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.title != null) state.title = patch.title;
        if (patch.sub !== void 0) state.sub = patch.sub;
        if (patch.actions) state.actions = patch.actions;
        if (patch.image !== void 0) {
          const next = imageLayer(patch.image);
          if (next) {
            root.style.setProperty("--ak-hero-image", next);
            root.classList.add("ak-hero--image");
          } else {
            root.style.removeProperty("--ak-hero-image");
            root.classList.remove("ak-hero--image");
          }
        }
        render();
      },
      destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function statRow(spec) {
    const shown = /* @__PURE__ */ new Map();
    const root = el("div", { class: "ak-root ak-statrow" });
    if (spec.target) resolve(spec.target).appendChild(root);
    function render(tiles, first) {
      const seen = /* @__PURE__ */ new Set();
      for (const tile of tiles) {
        seen.add(tile.id);
        const fmt = tile.format || function(n) {
          return String(Math.round(n));
        };
        let entry = shown.get(tile.id);
        if (!entry) {
          const value = el("span", { class: "ak-statrow__value", text: fmt(first ? tile.value : 0) });
          const label = el("span", { class: "ak-statrow__label", text: tile.label });
          const hint = el("span", { class: "ak-statrow__hint", text: tile.hint || "" });
          hint.hidden = !tile.hint;
          root.appendChild(el("div", { class: "ak-statrow__tile" }, [value, label, hint]));
          entry = { value: first ? tile.value : 0, node: value, label, hint };
          shown.set(tile.id, entry);
        }
        entry.label.textContent = tile.label;
        entry.hint.textContent = tile.hint || "";
        entry.hint.hidden = !tile.hint;
        if (entry.value !== tile.value) {
          countUp(entry.node, entry.value, tile.value, { format: fmt });
          entry.value = tile.value;
        } else if (first) {
          entry.node.textContent = fmt(tile.value);
        }
      }
      for (const [id, entry] of shown) {
        if (!seen.has(id)) {
          const tileEl = entry.node.parentNode;
          if (tileEl && tileEl.parentNode) tileEl.parentNode.removeChild(tileEl);
          shown.delete(id);
        }
      }
    }
    render(spec.tiles || [], true);
    enter(root);
    const stopLang = i18n.onChange(function() {
    });
    return {
      el: root,
      /** @param {{ tiles: StatTile[] }} patch */
      set(patch) {
        if (!patch || !patch.tiles) return;
        render(patch.tiles, false);
      },
      destroy() {
        stopLang();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/atelier/index.js
  var atelier = {
    /**
     * The library version, so an app can require a floor before using a newer component. It MUST
     * match the newest entry in the /lib/aimeat-atelier.css version history; e2e-libs.ts fails
     * when the two drift, because a version string that never moves is worse than none.
     */
    version: "0.2.0",
    // ── Shell and navigation ──
    app,
    section,
    tabs,
    bottomNav,
    // ── Focal content ──
    hero,
    statRow,
    // ── Designed states ──
    emptyState,
    skeleton,
    // ── Theme, i18n, helpers ──
    injectStyle,
    i18n,
    el,
    append,
    $,
    $$,
    clear,
    uid,
    busy,
    whileBusy,
    guardButtons,
    reducedMotion,
    enter,
    countUp
  };
  attach("atelier", atelier);
})();
