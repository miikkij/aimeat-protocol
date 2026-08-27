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
    const list2 = Array.isArray(kids) ? kids : [kids];
    for (const c of list2) {
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
      you: "You",
      next: "Next",
      previous: "Previous",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      fitView: "Fit to view"
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
      you: "Sinä",
      next: "Seuraava",
      previous: "Edellinen",
      zoomIn: "Lähennä",
      zoomOut: "Loitonna",
      fitView: "Sovita näkymään"
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
      you: "Tú",
      next: "Siguiente",
      previous: "Anterior",
      zoomIn: "Acercar",
      zoomOut: "Alejar",
      fitView: "Ajustar a la vista"
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
    const mount = resolve(spec.target, document.body);
    mount.appendChild(root);
    const fullFrame = mount === document.body;
    if (fullFrame) document.body.classList.add("ak-body");
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
    setTimeout(startBoot, 0);
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
        if (fullFrame) document.body.classList.remove("ak-body");
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
    const scrim = el("span", { class: "ak-hero__scrim", "aria-hidden": "true" });
    const root = el("div", {
      class: "ak-root ak-hero",
      "data-ak-hero": true,
      "aria-labelledby": titleId
    }, [scrim, inner]);
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
  function figure(spec) {
    const state = { value: spec.value || 0, label: spec.label || "", sub: spec.sub, delta: spec.delta };
    const fmt = spec.format || function(n) {
      return String(Math.round(n));
    };
    const label = el("span", { class: "ak-figure__label", text: state.label });
    const value = el("span", { class: "ak-figure__value", text: fmt(state.value) });
    const delta = el("span", { class: "ak-figure__delta", text: state.delta || "" });
    delta.hidden = !state.delta;
    const sub = el("p", { class: "ak-figure__sub", text: state.sub || "" });
    sub.hidden = !state.sub;
    const root = el("div", { class: "ak-root ak-figure" }, [
      label,
      el("div", { class: "ak-figure__row" }, [value, delta]),
      sub
    ]);
    if (spec.target) resolve(spec.target).appendChild(root);
    enter(root);
    return {
      el: root,
      /** @param {{ value?: number, label?: string, sub?: string, delta?: string }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.label != null) {
          state.label = patch.label;
          label.textContent = state.label;
        }
        if (patch.sub !== void 0) {
          state.sub = patch.sub;
          sub.textContent = state.sub || "";
          sub.hidden = !state.sub;
        }
        if (patch.delta !== void 0) {
          state.delta = patch.delta;
          delta.textContent = state.delta || "";
          delta.hidden = !state.delta;
        }
        if (patch.value != null && patch.value !== state.value) {
          countUp(value, state.value, patch.value, { format: fmt });
          state.value = patch.value;
        }
      },
      destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/atelier/list.js
  function fillRow(row, item) {
    clear(row);
    const text = el("span", { class: "ak-list__text" }, [
      el("span", { class: "ak-list__title", text: item.title }),
      item.sub != null ? el("span", { class: "ak-list__sub", text: item.sub }) : null
    ]);
    const side = item.meta != null || item.badge != null ? el("span", { class: "ak-list__side" }, [
      item.badge != null ? el("span", { class: "ak-badge", text: item.badge }) : null,
      item.meta != null ? el("span", { class: "ak-list__meta", text: item.meta }) : null
    ]) : null;
    append(row, side ? [text, side] : [text]);
  }
  function list(spec) {
    const shown = /* @__PURE__ */ new Map();
    const pickable = typeof spec.onPick === "function";
    const root = el("div", { class: "ak-root ak-list", role: pickable ? "list" : null });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    function buildRow(item) {
      const row = el(pickable ? "button" : "div", {
        class: "ak-list__row",
        type: pickable ? "button" : null,
        role: pickable ? "listitem" : null,
        "data-ak-noguard": true,
        "data-ak-id": item.id,
        on: pickable ? { click: function() {
          if (spec.onPick) spec.onPick(shown.get(item.id)?.item || item);
        } } : null
      });
      fillRow(row, item);
      return row;
    }
    function render(items, first) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      if (!items.length) {
        for (const [, entry] of shown) entry.row.remove();
        shown.clear();
        const e = spec.empty || {};
        emptyCard = emptyState({
          target: root,
          tone: "quiet",
          title: e.title || t("empty"),
          hint: e.hint || t("emptyHint"),
          action: e.action || null
        });
        return;
      }
      const seen = /* @__PURE__ */ new Set();
      let previous = null;
      for (const item of items) {
        seen.add(item.id);
        let entry = shown.get(item.id);
        if (!entry) {
          const row = buildRow(item);
          if (previous) previous.after(row);
          else root.prepend(row);
          if (!first && !reducedMotion() && typeof row.animate === "function") {
            row.animate(
              [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
              { duration: 200, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" }
            );
          }
          entry = { row, item };
          shown.set(item.id, entry);
        } else {
          const changed = entry.item.title !== item.title || entry.item.sub !== item.sub || entry.item.meta !== item.meta || entry.item.badge !== item.badge;
          if (changed) {
            fillRow(entry.row, item);
            entry.row.classList.remove("ak-list__row--changed");
            void entry.row.offsetWidth;
            entry.row.classList.add("ak-list__row--changed");
          }
          entry.item = item;
          if (previous) previous.after(entry.row);
          else root.prepend(entry.row);
        }
        previous = entry.row;
      }
      for (const [id, entry] of shown) {
        if (!seen.has(id)) {
          entry.row.remove();
          shown.delete(id);
        }
      }
    }
    render(spec.items || [], true);
    enter(root);
    return {
      el: root,
      /** @param {{ items: ListItem[] }} patch */
      set(patch) {
        if (!patch || !patch.items) return;
        render(patch.items, false);
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function listDetail(spec) {
    let selected = null;
    let items = spec.items || [];
    const detailBody = el("div", { class: "ak-listdetail__body" });
    const backBtn = el("button", {
      type: "button",
      class: "ak-btn ak-btn--ghost ak-listdetail__back",
      "data-ak-noguard": true,
      on: { click: function() {
        select(null);
      } }
    }, "↩ " + t("back"));
    const detail = el("div", { class: "ak-listdetail__detail" }, [backBtn, detailBody]);
    const master = list({
      items,
      empty: spec.empty,
      onPick: function(item) {
        select(item.id);
      }
    });
    const root = el("div", { class: "ak-root ak-listdetail" }, [
      el("div", { class: "ak-listdetail__master" }, master.el),
      detail
    ]);
    if (spec.target) resolve(spec.target).appendChild(root);
    let detailEmptyCard = null;
    function renderDetail() {
      if (detailEmptyCard) {
        detailEmptyCard.destroy();
        detailEmptyCard = null;
      }
      clear(detailBody);
      const item = items.find(function(i) {
        return i.id === selected;
      }) || null;
      root.classList.toggle("ak-listdetail--open", !!item);
      if (!item) {
        const e = spec.detailEmpty || {};
        detailEmptyCard = emptyState({
          target: detailBody,
          tone: "quiet",
          title: e.title || t("open"),
          hint: e.hint
        });
        return;
      }
      spec.renderDetail(item, detailBody);
    }
    function select(id) {
      selected = id;
      for (const row of root.querySelectorAll(".ak-list__row")) {
        row.classList.toggle("ak-list__row--selected", row.getAttribute("data-ak-id") === id);
      }
      renderDetail();
    }
    renderDetail();
    return {
      el: root,
      /** @param {{ items: ListItem[] }} patch */
      set(patch) {
        if (!patch || !patch.items) return;
        items = patch.items;
        master.set({ items });
        if (selected && !items.some(function(i) {
          return i.id === selected;
        })) selected = null;
        select(selected);
      },
      select,
      destroy() {
        if (detailEmptyCard) detailEmptyCard.destroy();
        master.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/atelier/grid.js
  function imageLayer2(url) {
    if (!url) return null;
    const v = String(url);
    if (/^data:/i.test(v)) {
      console.warn("aimeat-atelier: card image data: URIs are refused — upload the image to storage and pass its URL.");
      return null;
    }
    return 'url("' + v.replace(/"/g, "%22") + '")';
  }
  function washOf(id) {
    let h = 0;
    const s = String(id);
    for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) | 0;
    return Math.abs(h) % 3 + 1;
  }
  function buildCard(item, pickable, onPick) {
    const layer = imageLayer2(item.image);
    const art = el("span", {
      class: "ak-card__art ak-card__art--w" + washOf(item.id),
      "aria-hidden": "true",
      vars: layer ? { "--ak-card-image": layer } : null
    }, layer ? null : el("span", {
      class: "ak-card__monogram",
      // Array.from splits by code point: an emoji-led title keeps its emoji instead of showing
      // a broken surrogate half — found in the first real-data experiment run.
      text: (Array.from(item.title || "?")[0] || "?").toUpperCase()
    }));
    if (layer) art.classList.add("ak-card__art--image");
    const body = el("span", { class: "ak-card__body" }, [
      el("span", { class: "ak-card__title", text: item.title }),
      item.sub != null ? el("span", { class: "ak-card__sub", text: item.sub }) : null
    ]);
    const card = el(pickable ? "button" : "div", {
      class: "ak-card",
      type: pickable ? "button" : null,
      "data-ak-noguard": true,
      "data-ak-id": item.id,
      on: pickable && onPick ? { click: function() {
        onPick(item);
      } } : null
    }, [art, item.badge != null ? el("span", { class: "ak-badge ak-card__badge", text: item.badge }) : null, body]);
    return card;
  }
  function cardGrid(spec) {
    const pickable = typeof spec.onPick === "function";
    const root = el("div", { class: "ak-root ak-grid" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    function render(items) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      if (!items.length) {
        const e = spec.empty || {};
        emptyCard = emptyState({
          target: root,
          tone: "quiet",
          title: e.title || t("empty"),
          hint: e.hint || t("emptyHint"),
          action: e.action || null
        });
        return;
      }
      for (const item of items) root.appendChild(buildCard(item, pickable, spec.onPick));
      enter(root);
    }
    render(spec.items || []);
    return {
      el: root,
      /** @param {{ items: CardItem[] }} patch */
      set(patch) {
        if (!patch || !patch.items) return;
        render(patch.items);
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function mediaCard(spec) {
    let card = buildCard(spec.item, typeof spec.onPick === "function" && !spec.actions, spec.onPick);
    const actions = spec.actions && spec.actions.length ? el("span", { class: "ak-card__actions" }, spec.actions.map(function(action) {
      const kind = action.kind || "plain";
      return el("button", {
        type: "button",
        class: "ak-btn" + (kind === "plain" ? "" : " ak-btn--" + kind),
        "data-ak-id": action.id,
        on: { click: function() {
          if (action.onClick) action.onClick(action);
        } }
      }, action.label);
    })) : null;
    const root = el("div", { class: "ak-root ak-mediacard" }, [card, actions]);
    if (spec.target) resolve(spec.target).appendChild(root);
    enter(root);
    return {
      el: root,
      /** @param {{ item: CardItem }} patch */
      set(patch) {
        if (!patch || !patch.item) return;
        const next = buildCard(patch.item, typeof spec.onPick === "function" && !spec.actions, spec.onPick);
        card.replaceWith(next);
        card = next;
      },
      destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/atelier/form.js
  function form(spec) {
    const controls = /* @__PURE__ */ new Map();
    const root = el("form", { class: "ak-root ak-form", novalidate: true });
    if (spec.target) resolve(spec.target).appendChild(root);
    function buildControl(field) {
      const type = field.type || "text";
      const id = uid("ak-f");
      const hintId = id + "-hint";
      const errId = id + "-err";
      const describedBy = (field.hint ? hintId + " " : "") + errId;
      let input;
      if (type === "textarea") {
        input = el("textarea", { id, class: "ak-input ak-input--area", rows: 3, maxlength: field.maxLength || null, "aria-describedby": describedBy });
        input.value = field.value != null ? String(field.value) : "";
      } else if (type === "select") {
        input = el(
          "select",
          { id, class: "ak-input", "aria-describedby": describedBy },
          (field.options || []).map(function(o) {
            return el("option", { value: o.value, selected: field.value === o.value ? true : null }, o.label);
          })
        );
      } else if (type === "checkbox" || type === "toggle") {
        input = el("input", {
          id,
          type: "checkbox",
          class: type === "toggle" ? "ak-toggle" : "ak-check",
          checked: field.value ? true : null,
          "aria-describedby": describedBy
        });
      } else {
        input = el("input", {
          id,
          type,
          class: "ak-input",
          min: field.min != null ? String(field.min) : null,
          max: field.max != null ? String(field.max) : null,
          maxlength: field.maxLength || null,
          "aria-describedby": describedBy
        });
        if (field.value != null) input.value = String(field.value);
      }
      const label = el("label", { class: "ak-form__label", for: id }, [
        field.label,
        field.required ? el("span", { class: "ak-form__req", "aria-hidden": "true", text: "*" }) : null,
        field.required ? el("span", { class: "ak-sr-only", text: " (" + t("required") + ")" }) : null
      ]);
      const hint = field.hint ? el("p", { class: "ak-form__hint", id: hintId, text: field.hint }) : null;
      const error = el("p", { class: "ak-form__error", id: errId, role: "alert" });
      error.hidden = true;
      const inline = type === "checkbox" || type === "toggle";
      const wrap = el(
        "div",
        { class: "ak-form__field" + (inline ? " ak-form__field--inline" : "") },
        inline ? [input, label, hint, error] : [label, input, hint, error]
      );
      controls.set(field.name, { field, input, error, wrap });
      return wrap;
    }
    function setError(name, message) {
      const c = controls.get(name);
      if (!c) return;
      c.error.textContent = message;
      c.error.hidden = false;
      c.wrap.classList.add("ak-form__field--invalid");
      c.input.setAttribute("aria-invalid", "true");
    }
    function clearErrors() {
      for (const [, c] of controls) {
        c.error.hidden = true;
        c.error.textContent = "";
        c.wrap.classList.remove("ak-form__field--invalid");
        c.input.removeAttribute("aria-invalid");
      }
    }
    function values() {
      const out = {};
      for (const [name, c] of controls) {
        const type = c.field.type || "text";
        if (type === "checkbox" || type === "toggle") out[name] = /** @type {HTMLInputElement} */
        c.input.checked;
        else if (type === "number") {
          const raw = (
            /** @type {HTMLInputElement} */
            c.input.value
          );
          out[name] = raw === "" ? null : Number(raw);
        } else out[name] = /** @type {HTMLInputElement} */
        c.input.value;
      }
      return out;
    }
    function validate() {
      clearErrors();
      let firstBad = null;
      for (const [name, c] of controls) {
        const f = c.field;
        const type = f.type || "text";
        const v = values()[name];
        let problem = null;
        if (f.required && (v === "" || v == null || v === false)) problem = f.label + ": " + t("required").toLowerCase();
        else if (type === "number" && v != null && Number.isNaN(v)) problem = f.label + ": " + t("required").toLowerCase();
        else if (type === "number" && v != null && f.min != null && v < f.min) problem = f.label + " ≥ " + f.min;
        else if (type === "number" && v != null && f.max != null && v > f.max) problem = f.label + " ≤ " + f.max;
        if (problem) {
          setError(name, problem);
          if (!firstBad) firstBad = name;
        }
      }
      return firstBad;
    }
    const submitBtn = el(
      "button",
      { type: "submit", class: "ak-btn ak-btn--primary", "data-ak-noguard": true },
      spec.submitLabel || t("save")
    );
    const bar = el("div", { class: "ak-form__bar" }, [
      spec.cancel ? el("button", {
        type: "button",
        class: "ak-btn ak-btn--ghost",
        "data-ak-noguard": true,
        on: { click: function() {
          if (spec.cancel && spec.cancel.onClick) spec.cancel.onClick();
        } }
      }, spec.cancel.label || t("cancel")) : null,
      submitBtn
    ]);
    function render(fields) {
      controls.clear();
      clear(root);
      for (const field of fields) root.appendChild(buildControl(field));
      root.appendChild(bar);
      enter(root);
    }
    render(spec.fields || []);
    root.addEventListener("submit", function(ev) {
      ev.preventDefault();
      const bad = validate();
      if (bad) {
        const c = controls.get(bad);
        if (c) c.input.focus();
        return;
      }
      whileBusy(submitBtn, Promise.resolve().then(function() {
        return spec.onSubmit(values());
      })).catch(function(e) {
        const named = e && e.field && controls.has(e.field);
        if (named) {
          setError(e.field, e.message || String(e));
          const c = controls.get(e.field);
          if (c) c.input.focus();
        } else {
          setError(controls.keys().next().value, e && e.message || String(e));
        }
      });
    });
    return {
      el: root,
      values,
      /** @param {Record<string, any>} next */
      setValues(next) {
        for (const name in next) {
          const c = controls.get(name);
          if (!c) continue;
          const type = c.field.type || "text";
          if (type === "checkbox" || type === "toggle") c.input.checked = !!next[name];
          else c.input.value = next[name] == null ? "" : String(next[name]);
        }
      },
      setError,
      clearErrors,
      /** @param {{ fields?: FormField[] }} patch */
      set(patch) {
        if (patch && patch.fields) render(patch.fields);
      },
      destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/atelier/table.js
  function table(spec) {
    const columns = spec.columns || [];
    let rows = spec.rows || [];
    let sort = null;
    const thead = el("thead");
    const tbody = el("tbody");
    const tableEl = el("table", { class: "ak-table__table" }, [
      spec.caption ? el("caption", { class: "ak-sr-only", text: spec.caption }) : null,
      thead,
      tbody
    ]);
    const root = el("div", { class: "ak-root ak-table" }, tableEl);
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    function renderHead() {
      clear(thead);
      const tr = el("tr");
      for (const col of columns) {
        const sorted = sort && sort.key === col.key ? sort.dir === 1 ? "ascending" : "descending" : null;
        const th = el("th", {
          scope: "col",
          class: col.align === "right" ? "ak-table__num" : null,
          "aria-sort": sorted
        });
        if (col.sortable) {
          th.appendChild(el("button", {
            type: "button",
            class: "ak-table__sort",
            "data-ak-noguard": true,
            on: {
              click: function() {
                sort = sort && sort.key === col.key ? { key: col.key, dir: sort.dir === 1 ? -1 : 1 } : { key: col.key, dir: 1 };
                renderHead();
                renderBody();
              }
            }
          }, col.label + (sorted ? sorted === "ascending" ? " ↑" : " ↓" : "")));
        } else {
          th.textContent = col.label;
        }
        tr.appendChild(th);
      }
      thead.appendChild(tr);
    }
    function sortedRows() {
      if (!sort) return rows;
      const key = sort.key;
      const dir = sort.dir;
      return rows.slice().sort(function(a, b) {
        const av = a[key];
        const bv = b[key];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }
    function renderBody() {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(tbody);
      tableEl.hidden = !rows.length;
      if (!rows.length) {
        const e = spec.empty || {};
        emptyCard = emptyState({
          target: root,
          tone: "quiet",
          title: e.title || t("empty"),
          hint: e.hint || t("emptyHint")
        });
        return;
      }
      const pickable = typeof spec.onPick === "function";
      for (const row of sortedRows()) {
        const tr = el("tr", {
          class: pickable ? "ak-table__row--pick" : null,
          tabindex: pickable ? "0" : null,
          on: pickable ? {
            click: function() {
              if (spec.onPick) spec.onPick(row);
            },
            keydown: function(ev) {
              if (ev.key === "Enter" && spec.onPick) spec.onPick(row);
            }
          } : null
        });
        for (const col of columns) {
          const raw = row[col.key];
          const text = col.format ? col.format(raw, row) : raw == null ? "" : String(raw);
          tr.appendChild(el("td", { class: col.align === "right" ? "ak-table__num" : null, text }));
        }
        tbody.appendChild(tr);
      }
    }
    renderHead();
    renderBody();
    enter(root);
    return {
      el: root,
      /** @param {{ rows?: any[] }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.rows) {
          rows = patch.rows;
          renderBody();
        }
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  var SEARCH_DEBOUNCE_MS = 250;
  function searchBar(spec) {
    let timer = null;
    const input = el("input", {
      type: "search",
      class: "ak-input ak-search__input",
      placeholder: spec.placeholder || t("search"),
      "aria-label": spec.label || t("search"),
      on: {
        input: function() {
          if (!spec.onChange) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(function() {
            timer = null;
            if (spec.onChange) spec.onChange(inputEl.value);
          }, SEARCH_DEBOUNCE_MS);
        },
        keydown: function(ev) {
          if (ev.key === "Enter" && spec.onSubmit) {
            ev.preventDefault();
            spec.onSubmit(inputEl.value);
          }
        }
      }
    });
    const inputEl = (
      /** @type {HTMLInputElement} */
      input
    );
    if (spec.value != null) inputEl.value = spec.value;
    const clearBtn = el("button", {
      type: "button",
      class: "ak-search__clear",
      "aria-label": t("close"),
      "data-ak-noguard": true,
      on: {
        click: function() {
          inputEl.value = "";
          inputEl.focus();
          if (spec.onChange) spec.onChange("");
        }
      }
    }, "×");
    const root = el("div", { class: "ak-root ak-search", role: "search" }, [input, clearBtn]);
    if (spec.target) resolve(spec.target).appendChild(root);
    return {
      el: root,
      /** @param {{ value?: string }} patch */
      set(patch) {
        if (patch && patch.value != null) inputEl.value = patch.value;
      },
      destroy() {
        if (timer) clearTimeout(timer);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/atelier/timeline.js
  function fmtTs(ts) {
    if (typeof ts === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ts)) {
      return (/* @__PURE__ */ new Date(ts + "T12:00:00")).toLocaleDateString(void 0, { dateStyle: "medium" });
    }
    const d = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toLocaleString(void 0, { dateStyle: "medium", timeStyle: "short" });
  }
  function timeline(spec) {
    const fmt = spec.format || fmtTs;
    const root = el("ol", { class: "ak-root ak-timeline" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    function render(items) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      if (!items.length) {
        const e = spec.empty || {};
        emptyCard = emptyState({
          target: root,
          tone: "quiet",
          title: e.title || t("empty"),
          hint: e.hint || t("emptyHint")
        });
        return;
      }
      for (const item of items) {
        root.appendChild(el("li", { class: "ak-timeline__item", "data-ak-id": item.id }, [
          el("span", { class: "ak-timeline__dot ak-timeline__dot--" + (item.tone || "plain"), "aria-hidden": "true" }),
          el("div", { class: "ak-timeline__body" }, [
            el("span", { class: "ak-timeline__when", text: fmt(item.ts) }),
            el("span", { class: "ak-timeline__title", text: item.title }),
            item.sub != null ? el("span", { class: "ak-timeline__sub", text: item.sub }) : null
          ])
        ]));
      }
      enter(root);
    }
    render(spec.items || []);
    return {
      el: root,
      /** @param {{ items: TimelineItem[] }} patch */
      set(patch) {
        if (!patch || !patch.items) return;
        render(patch.items);
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
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

  // src/static/sdk-libs/atelier/mosaic.js
  var CANVAS_MIN = 0.35;
  var CANVAS_MAX = 1.6;
  var CANVAS_STEP = 1.18;
  function appRef() {
    try {
      const node = document.getElementById("aimeat-app-ref");
      if (!node) return null;
      const text = (node.textContent || "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      const parsed = JSON.parse(text);
      return parsed && parsed.owner && parsed.app_id ? { owner: String(parsed.owner), filename: String(parsed.app_id) } : null;
    } catch {
      return null;
    }
  }
  async function loadLayout(owner, filename) {
    try {
      const base = APEX_URL || "";
      const res = await fetch(base + "/v1/apps/" + encodeURIComponent(owner) + "/" + encodeURIComponent(filename) + "/ui");
      if (!res.ok) return null;
      const body = await res.json();
      return body && body.data && body.data.layout || null;
    } catch {
      return null;
    }
  }
  function labelOf(block) {
    const p = block.props || {};
    return p.title || p.caption || block.component;
  }
  function patchFor(kind, data) {
    if (kind === "statRow") return { tiles: Array.isArray(data) ? data : [] };
    if (kind === "table") return { rows: Array.isArray(data) ? data : data && data.rows || [] };
    if (kind === "figure") return data && typeof data === "object" ? data : { value: 0 };
    return { items: Array.isArray(data) ? data : [] };
  }
  function derivedColumns(rows) {
    if (!rows.length) return [];
    return Object.keys(rows[0]).filter(function(key) {
      return key !== "id";
    }).map(function(key) {
      return { key, label: key, sortable: true };
    });
  }
  function mosaic(spec) {
    const host = spec.app ? spec.app.main : resolve(spec.target, document.body);
    const root = el("div", { class: "ak-root ak-mosaic" });
    host.appendChild(root);
    let alive = { handles: [], bound: [], cleanup: [] };
    let destroyed = false;
    function resolveSource(name) {
      const fn = (spec.sources || {})[name];
      if (typeof fn !== "function") {
        console.warn('aimeat-atelier: the layout binds source "' + name + '" but the app declares no resolver for it.');
        return Promise.resolve(null);
      }
      return Promise.resolve().then(fn);
    }
    function buildBlock(block, into) {
      const p = block.props || {};
      const pick = spec.onPick ? function(item) {
        spec.onPick(block.id, item);
      } : void 0;
      const empty = { title: p.emptyTitle, hint: p.emptyHint };
      function bound(kind, create) {
        const wait = skeleton({ target: into, rows: 2 });
        resolveSource(p.source).then(function(data) {
          if (destroyed) return;
          wait.destroy();
          const handle = create(data == null ? [] : data);
          alive.handles.push(handle);
          alive.bound.push({ name: p.source, kind, handle });
        });
      }
      switch (block.component) {
        case "hero": {
          alive.handles.push(hero({ target: into, title: p.title, sub: p.sub, image: p.image }));
          return;
        }
        case "statRow":
          return bound("statRow", function(data) {
            return statRow({ target: into, tiles: patchFor("statRow", data).tiles });
          });
        case "figure":
          return bound("figure", function(data) {
            const d = patchFor("figure", data);
            return figure({ target: into, value: d.value, label: d.label || p.title || "", sub: d.sub, delta: d.delta });
          });
        case "list":
          return bound("list", function(data) {
            return list({ target: into, items: patchFor("list", data).items, empty, onPick: pick });
          });
        case "cardGrid":
          return bound("cardGrid", function(data) {
            return cardGrid({ target: into, items: patchFor("cardGrid", data).items, empty, onPick: pick });
          });
        case "table":
          return bound("table", function(data) {
            const rows = patchFor("table", data).rows;
            const columns = data && !Array.isArray(data) && data.columns || derivedColumns(rows);
            return table({ target: into, columns, rows, caption: p.caption, onPick: pick });
          });
        case "timeline":
          return bound("timeline", function(data) {
            return timeline({ target: into, items: patchFor("timeline", data).items });
          });
        case "searchBar": {
          alive.handles.push(searchBar({
            target: into,
            onChange: spec.onSearch ? function(q) {
              spec.onSearch(p.bind || block.id, q);
            } : void 0
          }));
          return;
        }
        case "tabs": {
          const items = (p.items || []).map(function(label, i) {
            return { id: String(i), label };
          });
          alive.handles.push(tabs({
            target: into,
            items,
            onChange: spec.onPick ? function(id) {
              spec.onPick(block.id, items[Number(id)] && items[Number(id)].label);
            } : void 0
          }));
          return;
        }
        case "section": {
          const s = section({ target: into, title: p.title, hint: p.hint });
          alive.handles.push(s);
          const fillFn = (spec.fill || {})[block.id];
          if (fillFn) fillFn(s.body);
          return;
        }
        case "emptyState": {
          alive.handles.push(emptyState({ target: into, title: p.title, hint: p.hint, tone: p.tone }));
          return;
        }
        case "mediaCard": {
          alive.handles.push(mediaCard({
            target: into,
            item: { id: block.id, title: p.title, sub: p.sub, image: p.image },
            onPick: pick
          }));
          return;
        }
        default:
          console.warn('aimeat-atelier: this kit build has no renderer for "' + block.component + '" — skipping block "' + block.id + '".');
      }
    }
    function transition(run) {
      if (typeof document.startViewTransition === "function" && !reducedMotion()) {
        document.startViewTransition(run);
      } else {
        run();
      }
    }
    function projectStack(units) {
      const box = el("div", { class: "ak-mosaic__units ak-mosaic__units--grid" });
      for (const u of units) {
        u.el.classList.add("ak-mosaic__unit--" + (u.block.span || "full"));
        box.appendChild(u.el);
      }
      if (!reducedMotion() && typeof IntersectionObserver === "function") {
        const io = new IntersectionObserver(function(entries) {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add("ak-reveal--in");
              io.unobserve(entry.target);
            }
          }
        }, { threshold: 0, rootMargin: "0px 0px -12% 0px" });
        for (const u of units) {
          u.el.classList.add("ak-reveal");
          io.observe(u.el);
        }
        alive.cleanup.push(function() {
          io.disconnect();
        });
      }
      return box;
    }
    function projectOverlay(units) {
      const box = el("div", { class: "ak-mosaic__units" });
      for (const u of units) {
        u.el.hidden = true;
        box.appendChild(u.el);
      }
      let current2 = 0;
      let open = false;
      const items = [];
      const heading = el("h2", { class: "ak-mosaic__unittitle" });
      const panel = el("div", {
        class: "ak-mosaic__overlay",
        role: "dialog",
        "aria-label": t("menu"),
        on: { click: function(ev) {
          if (ev.target === panel) close();
        } }
      });
      panel.hidden = true;
      const trigger = el("button", {
        type: "button",
        class: "ak-mosaic__overlaytrigger",
        "aria-expanded": "false",
        "data-ak-noguard": true,
        on: { click: function() {
          if (open) {
            close();
          } else {
            show();
          }
        } }
      }, t("menu"));
      const closeBtn = el("button", {
        type: "button",
        class: "ak-mosaic__overlayclose",
        "aria-label": t("close"),
        "data-ak-noguard": true,
        on: { click: function() {
          close();
        } }
      }, "×");
      panel.appendChild(closeBtn);
      function mark() {
        items.forEach(function(btn, i) {
          btn.classList.toggle("ak-mosaic__overlayitem--on", i === current2);
          if (i === current2) btn.setAttribute("aria-current", "true");
          else btn.removeAttribute("aria-current");
        });
        heading.textContent = units[current2] ? units[current2].label : "";
      }
      function show(index) {
        if (typeof index === "number") {
          transition(function() {
            units[current2].el.hidden = true;
            current2 = index;
            units[current2].el.hidden = false;
            mark();
            enter(units[current2].el);
          });
          close();
          return;
        }
        open = true;
        panel.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        enter(panel);
        const on = (
          /** @type {HTMLElement|null} */
          panel.querySelector(".ak-mosaic__overlayitem--on") || panel.querySelector("button")
        );
        if (on) on.focus();
      }
      function close() {
        open = false;
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
      }
      function onKey(ev) {
        if (ev.key === "Escape" && open) close();
      }
      document.addEventListener("keydown", onKey);
      alive.cleanup.push(function() {
        document.removeEventListener("keydown", onKey);
      });
      units.forEach(function(u, i) {
        const btn = el("button", {
          type: "button",
          class: "ak-mosaic__overlayitem",
          "data-ak-noguard": true,
          on: { click: function() {
            show(i);
          } }
        }, [
          el("span", { class: "ak-mosaic__overlaynum", text: String(i + 1).padStart(2, "0") }),
          u.label
        ]);
        items.push(btn);
        panel.appendChild(btn);
      });
      if (units.length) units[0].el.hidden = false;
      mark();
      return el("div", { class: "ak-mosaic__overlaywrap" }, [
        el("div", { class: "ak-mosaic__overlaybar" }, [heading, trigger]),
        box,
        panel
      ]);
    }
    function projectRail(units) {
      const box = el("div", { class: "ak-mosaic__units" });
      for (const u of units) {
        u.el.hidden = true;
        box.appendChild(u.el);
      }
      let current2 = 0;
      const items = [];
      function show(index) {
        if (index === current2 && !units[index].el.hidden) return;
        transition(function() {
          units[current2].el.hidden = true;
          current2 = index;
          units[current2].el.hidden = false;
          items.forEach(function(btn, i) {
            btn.classList.toggle("ak-mosaic__railitem--on", i === index);
          });
          enter(units[current2].el);
        });
      }
      const rail = el("nav", { class: "ak-mosaic__rail" }, units.map(function(u, i) {
        const btn = el("button", {
          type: "button",
          class: "ak-mosaic__railitem" + (i === 0 ? " ak-mosaic__railitem--on" : ""),
          "data-ak-noguard": true,
          on: { click: function() {
            show(i);
          } }
        }, u.label);
        items.push(btn);
        return btn;
      }));
      if (units.length) units[0].el.hidden = false;
      return el("div", { class: "ak-mosaic__railwrap" }, [rail, box]);
    }
    function projectPicker(units, mode) {
      const box = el("div", { class: "ak-mosaic__units" });
      for (const u of units) {
        u.el.hidden = true;
        box.appendChild(u.el);
      }
      let current2 = 0;
      function show(index) {
        if (index === current2 && !units[index].el.hidden) return;
        transition(function() {
          units[current2].el.hidden = true;
          current2 = index;
          units[current2].el.hidden = false;
          enter(units[current2].el);
        });
      }
      const items = units.map(function(u, i) {
        return { id: String(i), label: u.label };
      });
      const chrome = mode === "tabs" ? tabs({ items, value: "0", onChange: function(id) {
        show(Number(id));
      } }) : bottomNav({
        items: items.map(function(item, i) {
          return { id: item.id, label: item.label, onPick: function() {
            show(i);
          } };
        }),
        value: "0"
      });
      alive.handles.push(chrome);
      if (units.length) units[0].el.hidden = false;
      return el(
        "div",
        { class: "ak-mosaic__picker ak-mosaic__picker--" + mode },
        mode === "tabs" ? [chrome.el, box] : [box, chrome.el]
      );
    }
    function projectDeck(units) {
      const strip = el("div", { class: "ak-mosaic__deck", role: "group" });
      const dots = el("div", { class: "ak-mosaic__dots", "aria-hidden": "true" });
      units.forEach(function(u, i) {
        strip.appendChild(el("div", { class: "ak-mosaic__deckcard", "aria-label": u.label }, u.el));
        dots.appendChild(el("span", { class: "ak-mosaic__dot" + (i === 0 ? " ak-mosaic__dot--on" : "") }));
      });
      const onScroll = function() {
        const i = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth));
        Array.prototype.forEach.call(dots.children, function(dot, j) {
          dot.classList.toggle("ak-mosaic__dot--on", j === i);
        });
      };
      strip.addEventListener("scroll", onScroll, { passive: true });
      alive.cleanup.push(function() {
        strip.removeEventListener("scroll", onScroll);
      });
      return el("div", { class: "ak-mosaic__deckwrap" }, [strip, dots]);
    }
    function projectFlow(units) {
      const box = el("div", { class: "ak-mosaic__units" });
      for (const u of units) {
        u.el.hidden = true;
        box.appendChild(u.el);
      }
      let current2 = 0;
      const where = el("span", { class: "ak-mosaic__flowstep", "aria-live": "polite" });
      function show(index) {
        transition(function() {
          units[current2].el.hidden = true;
          current2 = Math.max(0, Math.min(units.length - 1, index));
          units[current2].el.hidden = false;
          where.textContent = current2 + 1 + " / " + units.length;
          prev.disabled = current2 === 0;
          next.disabled = current2 === units.length - 1;
          enter(units[current2].el);
        });
      }
      const prev = (
        /** @type {HTMLButtonElement} */
        el("button", {
          type: "button",
          class: "ak-btn ak-btn--ghost",
          "data-ak-noguard": true,
          on: { click: function() {
            show(current2 - 1);
          } }
        }, t("previous"))
      );
      const next = (
        /** @type {HTMLButtonElement} */
        el("button", {
          type: "button",
          class: "ak-btn ak-btn--primary",
          "data-ak-noguard": true,
          on: { click: function() {
            show(current2 + 1);
          } }
        }, t("next"))
      );
      if (units.length) {
        units[0].el.hidden = false;
        where.textContent = "1 / " + units.length;
        prev.disabled = true;
        next.disabled = units.length === 1;
      }
      return el("div", { class: "ak-mosaic__flow" }, [
        box,
        el("div", { class: "ak-mosaic__flowbar" }, [prev, where, next])
      ]);
    }
    function projectCanvas(units) {
      const field = el("div", { class: "ak-mosaic__field" });
      const cam = { x: 0, y: 0, scale: 0.6 };
      let focused = null;
      function apply() {
        field.style.transform = "translate(" + cam.x + "px," + cam.y + "px) scale(" + cam.scale + ")";
      }
      const viewport = el("div", { class: "ak-mosaic__canvas" }, field);
      units.forEach(function(u) {
        const cover = el("button", {
          type: "button",
          class: "ak-mosaic__tilecover",
          "data-ak-noguard": true,
          "aria-label": t("open") + ": " + u.label,
          on: { click: function() {
            focus(u);
          } }
        });
        u.tile = el("div", { class: "ak-mosaic__tile" }, [
          el("span", { class: "ak-mosaic__tilelabel", text: u.label }),
          u.el,
          cover
        ]);
        field.appendChild(u.tile);
      });
      const focusHost = el("div", { class: "ak-mosaic__focus", hidden: true });
      const backBtn = el("button", {
        type: "button",
        class: "ak-btn ak-btn--ghost",
        "data-ak-noguard": true,
        on: { click: function() {
          unfocus();
        } }
      }, "↩ " + t("back"));
      function focus(u) {
        transition(function() {
          focused = u;
          focusHost.hidden = false;
          viewport.hidden = true;
          zoombar.hidden = true;
          clear(focusHost);
          focusHost.appendChild(backBtn);
          focusHost.appendChild(u.el);
          enter(focusHost);
        });
      }
      function unfocus() {
        if (!focused) return;
        const u = focused;
        transition(function() {
          focused = null;
          u.tile.insertBefore(u.el, u.tile.lastChild);
          focusHost.hidden = true;
          viewport.hidden = false;
          zoombar.hidden = false;
        });
      }
      let drag = null;
      viewport.addEventListener("pointerdown", function(ev) {
        const at = (
          /** @type {Element|null} */
          ev.target instanceof Element ? ev.target : null
        );
        if (at && at.closest(".ak-mosaic__tilecover")) return;
        drag = { x: ev.clientX, y: ev.clientY };
        viewport.setPointerCapture(ev.pointerId);
      });
      viewport.addEventListener("pointermove", function(ev) {
        if (!drag) return;
        cam.x += ev.clientX - drag.x;
        cam.y += ev.clientY - drag.y;
        drag = { x: ev.clientX, y: ev.clientY };
        apply();
      });
      viewport.addEventListener("pointerup", function() {
        drag = null;
      });
      viewport.addEventListener("wheel", function(ev) {
        ev.preventDefault();
        const factor = ev.deltaY < 0 ? CANVAS_STEP : 1 / CANVAS_STEP;
        const next = Math.max(CANVAS_MIN, Math.min(CANVAS_MAX, cam.scale * factor));
        const rect = viewport.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        cam.x = px - (px - cam.x) * (next / cam.scale);
        cam.y = py - (py - cam.y) * (next / cam.scale);
        cam.scale = next;
        apply();
      }, { passive: false });
      function zoomBtn(label, aria, factor) {
        return el("button", {
          type: "button",
          class: "ak-btn ak-btn--ghost",
          "aria-label": aria,
          "data-ak-noguard": true,
          on: {
            click: function() {
              cam.scale = factor === 0 ? 0.6 : Math.max(CANVAS_MIN, Math.min(CANVAS_MAX, cam.scale * factor));
              if (factor === 0) {
                cam.x = 0;
                cam.y = 0;
              }
              apply();
            }
          }
        }, label);
      }
      const zoombar = el("div", { class: "ak-mosaic__zoombar" }, [
        zoomBtn("−", t("zoomOut"), 1 / CANVAS_STEP),
        zoomBtn("⤢", t("fitView"), 0),
        zoomBtn("+", t("zoomIn"), CANVAS_STEP)
      ]);
      apply();
      return el("div", { class: "ak-mosaic__canvaswrap" }, [viewport, zoombar, focusHost]);
    }
    function render(layout) {
      for (const h of alive.handles) {
        if (h && h.destroy) h.destroy();
      }
      for (const fn of alive.cleanup) fn();
      alive = { handles: [], bound: [], cleanup: [] };
      clear(root);
      if (!layout || !Array.isArray(layout.blocks)) return;
      if (layout.look && spec.app && spec.app.set) spec.app.set({ look: layout.look });
      root.setAttribute("data-ak-nav", layout.nav || "stack");
      const visible = layout.blocks.filter(function(b) {
        return !b.hidden;
      });
      const band = el("div", { class: "ak-mosaic__band" });
      const units = [];
      for (const block of visible) {
        if (block.component === "hero") {
          buildBlock(block, band);
          continue;
        }
        const unitEl = el("section", { class: "ak-mosaic__unit", "data-ak-block": block.id });
        buildBlock(block, unitEl);
        units.push({ el: unitEl, label: labelOf(block), block });
      }
      if (band.childNodes.length) root.appendChild(band);
      const nav = layout.nav || "stack";
      if (!units.length) return;
      if (nav === "tabs" || nav === "bottom-bar") root.appendChild(projectPicker(units, nav));
      else if (nav === "deck") root.appendChild(projectDeck(units));
      else if (nav === "flow") root.appendChild(projectFlow(units));
      else if (nav === "canvas") root.appendChild(projectCanvas(units));
      else if (nav === "rail") root.appendChild(projectRail(units));
      else if (nav === "overlay") root.appendChild(projectOverlay(units));
      else root.appendChild(projectStack(units));
    }
    let currentLayout = null;
    async function boot() {
      let layout = spec.layout || null;
      if (!layout) {
        const ref = spec.owner && spec.filename ? { owner: spec.owner, filename: spec.filename } : appRef();
        if (ref) layout = await loadLayout(ref.owner, ref.filename);
      }
      if (destroyed) return;
      currentLayout = layout || spec.fallback || null;
      render(currentLayout);
    }
    const booting = boot();
    return {
      el: root,
      /** Replace the whole rendered layout — what a live layout-change event calls. */
      set(layout) {
        currentLayout = layout || spec.fallback || null;
        render(currentLayout);
      },
      /** Re-fetch the stored layout and re-render — after the app knows it changed. */
      async reload() {
        await booting;
        const ref = spec.owner && spec.filename ? { owner: spec.owner, filename: spec.filename } : appRef();
        const layout = ref ? await loadLayout(ref.owner, ref.filename) : null;
        if (destroyed) return;
        currentLayout = layout || spec.fallback || null;
        render(currentLayout);
      },
      /**
       * Re-resolve one source (or all) and hand the fresh rows to every component bound to it.
       * The change paints with the components' own motion — this is the app's line to call when
       * its data moved.
       * @param {string} [name]
       */
      async refresh(name) {
        await booting;
        const targets = alive.bound.filter(function(b) {
          return !name || b.name === name;
        });
        await Promise.all(targets.map(function(b) {
          return resolveSource(b.name).then(function(data) {
            if (!destroyed && data != null) b.handle.set(patchFor(b.kind, data));
          });
        }));
      },
      destroy() {
        destroyed = true;
        for (const h of alive.handles) {
          if (h && h.destroy) h.destroy();
        }
        for (const fn of alive.cleanup) fn();
        alive = { handles: [], bound: [], cleanup: [] };
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
    version: "0.10.0",
    // ── Shell and navigation ──
    app,
    section,
    tabs,
    bottomNav,
    // ── The stored layout, rendered ──
    mosaic,
    appRef,
    // ── Focal content ──
    hero,
    statRow,
    figure,
    // ── Content ──
    list,
    listDetail,
    cardGrid,
    mediaCard,
    timeline,
    // ── Data ──
    form,
    table,
    searchBar,
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
