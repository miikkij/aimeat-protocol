// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/game/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-game.js (with a per-node config prelude).
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

  // src/static/sdk-libs/game/dom.js
  var SPECIAL = { text: 1, on: 1, vars: 1, children: 1 };
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
    return (prefix || "ag") + "-" + seq;
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
      document.getElementById("ag-style")
    );
    if (!link) {
      link = document.createElement("link");
      link.id = "ag-style";
      link.rel = "stylesheet";
      link.href = o.href || "/lib/aimeat-game.css";
      head.insertBefore(link, head.firstChild);
    }
    let style = (
      /** @type {HTMLStyleElement|null} */
      document.getElementById("ag-style-extra")
    );
    if (o.extraCss) {
      if (!style) {
        style = document.createElement("style");
        style.id = "ag-style-extra";
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
    node.classList.add("ag-busy");
    node.setAttribute("aria-busy", "true");
    const wasDisabled = (
      /** @type {HTMLButtonElement} */
      node.disabled
    );
    if ("disabled" in node) node.disabled = true;
    const release = function() {
      busyMap.delete(node);
      node.classList.remove("ag-busy");
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
      const btn = start.closest('button, [role="button"], .ag-btn');
      if (!btn || btn.hasAttribute("data-ag-noguard")) return;
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

  // src/static/sdk-libs/game/i18n.js
  var BASE = {
    en: {
      close: "Close",
      back: "Back",
      cancel: "Cancel",
      confirm: "Confirm",
      menu: "Menu",
      locked: "Locked",
      done: "Done",
      open: "Open",
      now: "Now",
      later: "Later",
      comingSoon: "Coming soon",
      notifyMe: "Tell me when this opens",
      notified: "We will tell you",
      eta: "Expected {when}",
      empty: "Nothing here yet",
      nobodyYet: "No one on the board yet — the first entry sets the mark",
      you: "You",
      total: "Total",
      points: "{a} / {b}",
      earned: "Earned",
      notEarned: "Not earned yet",
      earnedOn: "Earned {when}",
      best: "Best {n}",
      inARow: "{n} in a row",
      sortBy: "Sort by",
      morsels: "morsels",
      target: "Target {n}",
      fix: "Fix this"
    },
    fi: {
      close: "Sulje",
      back: "Takaisin",
      cancel: "Peruuta",
      confirm: "Vahvista",
      menu: "Valikko",
      locked: "Lukossa",
      done: "Tehty",
      open: "Auki",
      now: "Nyt",
      later: "Myöhemmin",
      comingSoon: "Tulossa",
      notifyMe: "Kerro kun tämä aukeaa",
      notified: "Ilmoitamme sinulle",
      eta: "Arvio {when}",
      empty: "Täällä ei ole vielä mitään",
      nobodyYet: "Taululla ei ole vielä ketään — ensimmäinen asettaa rajan",
      you: "Sinä",
      total: "Yhteensä",
      points: "{a} / {b}",
      earned: "Ansaittu",
      notEarned: "Vielä ansaitsematta",
      earnedOn: "Ansaittu {when}",
      best: "Paras {n}",
      inARow: "{n} peräkkäin",
      sortBy: "Järjestys",
      morsels: "morselia",
      target: "Tavoite {n}",
      fix: "Korjaa tämä"
    }
  };
  var HOST = { en: {}, fi: {} };
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
    langs: ["en", "fi"],
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

  // src/static/sdk-libs/game/units.js
  var MONEY_UNIT = 1e6;
  function money(micros, currency) {
    const s = ((Number(micros) || 0) / MONEY_UNIT).toFixed(6).replace(/(\.\d{2}\d*?)0+$/, "$1");
    return currency ? s + " " + currency : s;
  }
  function morsels(n, opts) {
    const v = Math.round(Number(n) || 0);
    return opts && opts.bare ? String(v) : v + " " + i18n.t("morsels");
  }
  function isMoneyCurrency(currency) {
    return !!currency && currency !== "morsel" && currency !== "MORSEL";
  }

  // src/static/sdk-libs/game/menu.js
  function menu(spec) {
    const state = {
      title: spec.title,
      subtitle: spec.subtitle,
      entries: spec.entries || [],
      /** @type {MenuEntry[]} the chain of opened submenus */
      trail: []
    };
    const titleId = uid("ag-menu-title");
    const heading = el("h2", { class: "ag-title", id: titleId });
    const sub = el("p", { class: "ag-menu__sub" });
    const crumb = el("div", { class: "ag-menu__crumb" });
    const titles = el("div", { class: "ag-menu__titles" }, [crumb, heading, sub]);
    const closeBtn = el("button", {
      type: "button",
      class: "ag-btn ag-btn--ghost",
      on: { click: function() {
        api.close();
      } }
    }, spec.closeLabel || t("close"));
    const head = spec.head === false ? null : el("div", { class: "ag-menu__head" }, [titles, closeBtn]);
    const list = el("div", {
      class: "ag-menu__list ag-scroll",
      role: "menu",
      "aria-labelledby": titleId,
      on: { keydown: onKey }
    });
    const full = spec.full !== false;
    const root = el("div", {
      class: "ag-root ag-menu" + (full ? "" : " ag-menu--inline") + (head ? "" : " ag-menu--nohead"),
      role: full ? "dialog" : "group",
      "aria-modal": full ? "true" : null,
      "aria-labelledby": titleId
    }, head ? [head, list] : [list]);
    const host = resolve(spec.target, document.body);
    host.appendChild(root);
    const stopLang = i18n.onChange(function() {
      render(false);
    });
    function level() {
      const last = state.trail[state.trail.length - 1];
      return last ? last.entries || [] : state.entries;
    }
    function pathIds() {
      return state.trail.map(function(e) {
        return e.id;
      });
    }
    function render(moveFocus) {
      const depth = state.trail.length;
      const here = state.trail[depth - 1];
      heading.textContent = here ? here.label : state.title;
      const subText = here ? here.sublabel || "" : state.subtitle || "";
      sub.textContent = subText;
      sub.hidden = !subText;
      clear(crumb);
      if (depth) {
        crumb.appendChild(el("button", {
          type: "button",
          class: "ag-btn ag-btn--ghost",
          on: { click: back }
        }, "↩ " + t("back")));
        crumb.appendChild(el("span", { class: "ag-label", text: state.title }));
      }
      clear(list);
      if (!head && depth) {
        list.appendChild(el("div", {
          class: "ag-menu__item ag-menu__item--back",
          role: "menuitem",
          tabindex: "0",
          on: { click: back }
        }, el("div", { class: "ag-menu__inner" }, el("span", {}, el("span", { class: "ag-menu__label", text: "↩ " + t("back") })))));
      }
      const entries = level();
      if (!entries.length) {
        list.appendChild(el("p", { class: "ag-empty", text: t("empty") }));
        return;
      }
      for (const entry of entries) list.appendChild(item(entry));
      if (moveFocus) {
        const first = (
          /** @type {HTMLElement|null} */
          list.querySelector(".ag-menu__item")
        );
        if (first) first.focus();
      }
    }
    function item(entry) {
      const st = entry.state || "available";
      const locked = st === "locked";
      const nested = !!(entry.entries && entry.entries.length);
      const marks = el("div", { class: "ag-menu__marks" });
      if (entry.badge) marks.appendChild(el("span", { class: "ag-chip ag-chip--accent", text: entry.badge }));
      if (st === "done") marks.appendChild(el("span", { class: "ag-chip ag-chip--ok", text: "✓ " + t("done") }));
      if (locked) marks.appendChild(el("span", { class: "ag-chip", text: t("locked") }));
      if (nested && !locked) marks.appendChild(el("span", { class: "ag-menu__arrow", text: "→", "aria-hidden": "true" }));
      const body = el("span", {}, [
        el("span", { class: "ag-menu__label", text: entry.label }),
        entry.sublabel ? el("span", { class: "ag-menu__sublabel", text: entry.sublabel }) : null,
        locked && entry.lockReason ? el("span", { class: "ag-menu__reason", text: entry.lockReason }) : null
      ]);
      return el("div", {
        class: "ag-menu__item" + (locked ? " ag-menu__item--locked" : "") + (st === "done" ? " ag-menu__item--done" : ""),
        role: "menuitem",
        tabindex: "0",
        "data-ag-id": entry.id,
        "aria-disabled": locked ? "true" : null,
        on: { click: function() {
          pick(entry);
        } }
      }, el("div", { class: "ag-menu__inner" }, [body, marks]));
    }
    function pick(entry) {
      const path = pathIds();
      if (spec.onPick) spec.onPick(entry, path);
      if ((entry.state || "available") === "locked") return;
      if (entry.entries && entry.entries.length) {
        state.trail.push(entry);
        render(true);
      }
    }
    function back() {
      if (!state.trail.length) return api.close();
      state.trail.pop();
      render(true);
    }
    function onKey(ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        back();
        return;
      }
      if (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar") {
        const active = (
          /** @type {HTMLElement|null} */
          document.activeElement
        );
        if (active && active.classList.contains("ag-menu__item")) {
          ev.preventDefault();
          active.click();
        }
        return;
      }
      const items = (
        /** @type {HTMLElement[]} */
        Array.prototype.slice.call(list.querySelectorAll(".ag-menu__item"))
      );
      if (!items.length) return;
      const at = items.indexOf(
        /** @type {HTMLElement} */
        document.activeElement
      );
      let next = -1;
      if (ev.key === "ArrowDown" || ev.key === "ArrowRight") next = at < 0 ? 0 : (at + 1) % items.length;
      else if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
      else if (ev.key === "Home") next = 0;
      else if (ev.key === "End") next = items.length - 1;
      if (next < 0) return;
      ev.preventDefault();
      items[next].focus();
    }
    const api = {
      el: root,
      /**
       * Update in place. Position and focus are kept — a live update never moves the player.
       * @param {{ title?: string, subtitle?: string, entries?: MenuEntry[] }} patch
       */
      set(patch) {
        if (!patch) return;
        if (patch.title != null) state.title = patch.title;
        if (patch.subtitle != null) state.subtitle = patch.subtitle;
        if (patch.entries) {
          state.entries = patch.entries;
          const ids = pathIds();
          state.trail = [];
          let scope = state.entries;
          for (const id of ids) {
            const found = scope.find(function(e) {
              return e.id === id;
            });
            if (!found || !found.entries) break;
            state.trail.push(found);
            scope = found.entries;
          }
        }
        render(false);
      },
      open() {
        root.hidden = false;
        render(true);
      },
      close() {
        root.hidden = true;
        if (spec.onClose) spec.onClose();
      },
      path() {
        return pathIds();
      },
      destroy() {
        stopLang();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
    root.hidden = spec.open === false;
    render(full && spec.open !== false);
    return api;
  }

  // src/static/sdk-libs/game/screen.js
  function screen(spec) {
    const titleId = uid("ag-screen-title");
    const state = {
      title: spec.title,
      subtitle: spec.subtitle,
      actions: spec.actions || []
    };
    const heading = el("h2", { class: "ag-title", id: titleId });
    const sub = el("p", { class: "ag-screen__sub" });
    const titles = el("div", { class: "ag-screen__titles" }, [heading, sub]);
    const backBtn = spec.onBack ? el("button", {
      type: "button",
      class: "ag-btn ag-btn--ghost",
      on: { click: function() {
        if (spec.onBack) spec.onBack();
      } }
    }, "↩ " + (spec.backLabel || t("back"))) : null;
    const head = el("div", {
      class: "ag-screen__head" + (backBtn ? "" : " ag-screen__head--noback")
    }, backBtn ? [backBtn, titles] : [titles]);
    const body = el("div", { class: "ag-screen__body ag-scroll" });
    if (spec.body != null) append(body, spec.body);
    const bar = el("div", { class: "ag-screen__actions" });
    const full = spec.full != null ? spec.full : !spec.target;
    const root = el("div", {
      class: "ag-root ag-screen" + (full ? " ag-screen--full" : ""),
      "aria-labelledby": titleId
    }, [head, body, bar]);
    resolve(spec.target, document.body).appendChild(root);
    const stopLang = i18n.onChange(function() {
      renderHead();
    });
    function renderHead() {
      heading.textContent = state.title;
      sub.textContent = state.subtitle || "";
      sub.hidden = !state.subtitle;
      if (backBtn) backBtn.textContent = "↩ " + (spec.backLabel || t("back"));
    }
    function renderActions() {
      clear(bar);
      for (const action of state.actions) {
        const kind = action.kind || "plain";
        bar.appendChild(el("button", {
          type: "button",
          class: "ag-btn" + (kind === "plain" ? "" : " ag-btn--" + kind),
          disabled: action.disabled ? true : null,
          "data-ag-id": action.id,
          on: { click: function() {
            if (action.onClick) action.onClick(action);
          } }
        }, action.label));
      }
    }
    renderHead();
    renderActions();
    return {
      el: root,
      body,
      /**
       * @param {{ title?: string, subtitle?: string, body?: any, actions?: ScreenAction[] }} patch
       */
      set(patch) {
        if (!patch) return;
        if (patch.title != null) state.title = patch.title;
        if (patch.subtitle != null) state.subtitle = patch.subtitle;
        if (patch.title != null || patch.subtitle != null) renderHead();
        if (patch.body !== void 0) {
          clear(body);
          append(body, patch.body);
        }
        if (patch.actions) {
          state.actions = patch.actions;
          renderActions();
        }
      },
      destroy() {
        stopLang();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/game/overlay.js
  var FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  var TOAST_MARK = { ok: "✓", err: "✗", warn: "!", info: "i" };
  function modal(spec) {
    const dismissible = spec.dismissible !== false;
    const titleId = uid("ag-modal-title");
    const returnTo = (
      /** @type {HTMLElement|null} */
      document.activeElement
    );
    const heading = el("h2", { class: "ag-title", id: titleId, text: spec.title });
    const closeBtn = el("button", {
      type: "button",
      class: "ag-btn ag-btn--ghost",
      "aria-label": spec.closeLabel || t("close"),
      on: { click: function() {
        api.close();
      } }
    }, "✗");
    const head = el("div", { class: "ag-modal__head" }, [heading, dismissible ? closeBtn : null]);
    const body = el("div", { class: "ag-modal__body ag-scroll" });
    if (spec.body != null) append(body, spec.body);
    const bar = el("div", { class: "ag-modal__actions" });
    const dialog = el("div", {
      class: "ag-modal__dialog",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": titleId,
      tabindex: "-1"
    }, [head, body, bar]);
    const root = el("div", {
      class: "ag-root ag-modal",
      on: {
        mousedown: function(ev) {
          if (dismissible && ev.target === root) api.close();
        },
        keydown: onKey
      }
    }, dialog);
    document.body.appendChild(root);
    dialog.focus();
    function onKey(ev) {
      if (ev.key === "Escape" && dismissible) {
        ev.preventDefault();
        api.close();
        return;
      }
      if (ev.key !== "Tab") return;
      const items = (
        /** @type {HTMLElement[]} */
        Array.prototype.slice.call(dialog.querySelectorAll(FOCUSABLE)).filter(function(n) {
          return !/** @type {HTMLButtonElement} */
          n.disabled;
        })
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    }
    function renderActions(actions) {
      clear(bar);
      for (const action of actions) {
        const kind = action.kind || "plain";
        bar.appendChild(el("button", {
          type: "button",
          class: "ag-btn" + (kind === "plain" ? "" : " ag-btn--" + kind),
          "data-ag-id": action.id,
          on: { click: function() {
            if (action.onClick) action.onClick(action);
          } }
        }, action.label));
      }
    }
    renderActions(spec.actions || []);
    const api = {
      el: root,
      body,
      /** @param {{ title?: string, body?: any, actions?: OverlayAction[] }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.title != null) heading.textContent = patch.title;
        if (patch.body !== void 0) {
          clear(body);
          append(body, patch.body);
        }
        if (patch.actions) renderActions(patch.actions);
      },
      close() {
        api.destroy();
        if (spec.onClose) spec.onClose();
      },
      destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
        if (returnTo && typeof returnTo.focus === "function") returnTo.focus();
      }
    };
    return api;
  }
  function toastHost() {
    let host = document.getElementById("ag-toasts");
    if (!host) {
      host = el("div", { class: "ag-root ag-toasts", id: "ag-toasts", role: "status", "aria-live": "polite" });
      document.body.appendChild(host);
    }
    return (
      /** @type {HTMLElement} */
      host
    );
  }
  function toast(msg, kind, opts) {
    const k = kind || "info";
    const node = el("div", { class: "ag-toast ag-toast--" + k }, [
      el("span", { class: "ag-toast__mark", text: TOAST_MARK[k] || "i", "aria-hidden": "true" }),
      el("span", { text: msg })
    ]);
    toastHost().appendChild(node);
    const close = function() {
      if (node.parentNode) node.parentNode.removeChild(node);
    };
    const ms = opts && opts.ms != null ? opts.ms : 3200;
    if (ms > 0) setTimeout(close, ms);
    return { el: node, close };
  }
  function confirm(spec) {
    return new Promise(function(resolveWith) {
      let settled = false;
      const finish = function(answer) {
        if (settled) return;
        settled = true;
        resolveWith(answer);
      };
      const dialog = modal({
        title: spec.title,
        body: spec.body,
        onClose: function() {
          finish(false);
        },
        actions: [
          {
            id: "cancel",
            label: spec.cancelLabel || t("cancel"),
            kind: "ghost",
            onClick: function() {
              finish(false);
              dialog.destroy();
            }
          },
          {
            id: "confirm",
            label: spec.confirmLabel || t("confirm"),
            kind: spec.danger ? "danger" : "primary",
            onClick: function() {
              finish(true);
              dialog.destroy();
            }
          }
        ]
      });
    });
  }

  // src/static/sdk-libs/game/progress.js
  function pct(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, v));
  }
  function rail(spec) {
    const cfg = Array.isArray(spec) ? { steps: spec } : spec || { steps: [] };
    let steps = cfg.steps || [];
    const root = el("div", { class: "ag-root ag-rail", role: "list" });
    function render() {
      clear(root);
      steps.forEach(function(step, i) {
        const st = step.state || "future";
        const mark = st === "done" ? "✓" : String(i + 1);
        const kids = [
          el("span", { class: "ag-rail__dot", "aria-hidden": "true", text: mark }),
          el("span", { class: "ag-rail__name", text: step.label })
        ];
        const attrs = {
          class: "ag-rail__step ag-rail__step--" + st,
          role: "listitem",
          "data-ag-id": step.id,
          "aria-current": st === "current" ? "step" : null,
          "aria-label": step.label + " — " + t(st === "done" ? "done" : st === "current" ? "now" : "later")
        };
        if (cfg.onPick) {
          root.appendChild(el("button", Object.assign({ type: "button" }, attrs, {
            on: { click: function() {
              if (cfg.onPick) cfg.onPick(step, i);
            } }
          }), kids));
        } else {
          root.appendChild(el("div", attrs, kids));
        }
      });
    }
    const stopLang = i18n.onChange(render);
    render();
    return {
      el: root,
      /** @param {RailStep[]} next */
      set(next) {
        if (next) steps = next;
        render();
      },
      destroy() {
        stopLang();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function meter(spec) {
    const state = {
      label: spec.label,
      value: pct(spec.value),
      threshold: spec.threshold,
      hint: spec.hint,
      tone: spec.tone || "accent",
      suffix: spec.suffix != null ? spec.suffix : "%"
    };
    const name = el("span", { class: "ag-label" });
    const value = el("span", { class: "ag-meter__value ag-num" });
    const top = el("div", { class: "ag-meter__top" }, [name, value]);
    const fill = el("div", { class: "ag-meter__fill" });
    const track = el("div", {
      class: "ag-meter__track",
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": "100"
    }, fill);
    const hint = el("p", { class: "ag-meter__hint" });
    const root = el("div", { class: "ag-root ag-meter" }, [top, track, hint]);
    function render() {
      root.className = "ag-root ag-meter ag-meter--" + state.tone;
      name.textContent = state.label;
      value.textContent = Math.round(state.value) + state.suffix;
      fill.style.setProperty("--ag-fill", state.value + "%");
      track.setAttribute("aria-valuenow", String(Math.round(state.value)));
      track.setAttribute("aria-label", state.label);
      const existing = track.querySelector(".ag-meter__mark");
      if (existing) track.removeChild(existing);
      if (state.threshold != null) {
        track.appendChild(el("div", {
          class: "ag-meter__mark",
          "aria-hidden": "true",
          vars: { "--ag-at": pct(state.threshold) + "%" }
        }));
      }
      const text = state.hint || (state.threshold != null ? t("target", { n: Math.round(pct(state.threshold)) + state.suffix }) : "");
      hint.textContent = text;
      hint.hidden = !text;
    }
    const stopLang = i18n.onChange(render);
    render();
    return {
      el: root,
      /** @param {{ value?: number, label?: string, threshold?: number, hint?: string, tone?: 'accent'|'ok'|'warn'|'err' }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.value != null) state.value = pct(patch.value);
        if (patch.label != null) state.label = patch.label;
        if (patch.threshold !== void 0) state.threshold = patch.threshold;
        if (patch.hint !== void 0) state.hint = patch.hint;
        if (patch.tone) state.tone = patch.tone;
        render();
      },
      destroy() {
        stopLang();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function counter(spec) {
    const format = spec.format || function(n) {
      return String(Math.round(n));
    };
    const duration = spec.durationMs || 900;
    let shown = spec.from != null ? spec.from : 0;
    let target = Number(spec.value) || 0;
    let frame = 0;
    const num = el("span", { class: "ag-counter__n ag-num" });
    const label = el("span", { class: "ag-label" });
    const root = el("div", { class: "ag-root ag-counter" }, [num, label]);
    function paintLabel() {
      label.textContent = spec.label || "";
      label.hidden = !spec.label;
    }
    function animate(to) {
      if (frame) cancelAnimationFrame(frame);
      if (reducedMotion() || duration <= 0) {
        shown = to;
        num.textContent = format(shown);
        return;
      }
      const from = shown;
      const started = performance.now();
      const step = function(now) {
        const p = Math.min(1, (now - started) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        shown = from + (to - from) * eased;
        num.textContent = format(shown);
        if (p < 1) frame = requestAnimationFrame(step);
        else {
          frame = 0;
          shown = to;
          num.textContent = format(shown);
        }
      };
      frame = requestAnimationFrame(step);
    }
    paintLabel();
    num.textContent = format(shown);
    animate(target);
    return {
      el: root,
      /** @param {number|{ value?: number, label?: string }} next */
      set(next) {
        if (typeof next === "number") {
          target = next;
          animate(target);
          return;
        }
        if (!next) return;
        if (next.label !== void 0) {
          spec.label = next.label;
          paintLabel();
        }
        if (next.value != null) {
          target = next.value;
          animate(target);
        }
      },
      destroy() {
        if (frame) cancelAnimationFrame(frame);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function streak(spec) {
    const state = {
      count: Number(spec.count) || 0,
      periods: spec.periods || [],
      best: spec.best,
      unitLabel: spec.unitLabel
    };
    const count = el("span", { class: "ag-streak__count ag-num" });
    const unit = el("span", { class: "ag-label" });
    const best = el("span", { class: "ag-dim" });
    const top = el("div", { class: "ag-streak__top" }, [count, unit, best]);
    const cells = el("div", { class: "ag-streak__cells" });
    const root = el("div", { class: "ag-root ag-streak" }, [top, cells]);
    function render() {
      count.textContent = t("inARow", { n: state.count });
      unit.textContent = state.unitLabel || "";
      unit.hidden = !state.unitLabel;
      best.textContent = state.best != null ? t("best", { n: state.best }) : "";
      best.hidden = state.best == null;
      clear(cells);
      for (const p of state.periods) {
        cells.appendChild(el("div", {
          class: "ag-streak__cell" + (p.done ? " ag-streak__cell--done" : ""),
          title: p.label
        }, [
          el("span", { class: "ag-streak__box", "aria-hidden": "true", text: p.done ? "✓" : "" }),
          el("span", { class: "ag-streak__tick", text: p.label })
        ]));
      }
    }
    const stopLang = i18n.onChange(render);
    render();
    return {
      el: root,
      /** @param {{ count?: number, periods?: any[], best?: number, unitLabel?: string }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.count != null) state.count = patch.count;
        if (patch.periods) state.periods = patch.periods;
        if (patch.best !== void 0) state.best = patch.best;
        if (patch.unitLabel !== void 0) state.unitLabel = patch.unitLabel;
        render();
      },
      destroy() {
        stopLang();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/game/score.js
  function scoreBreakdown(spec) {
    const state = {
      title: spec.title,
      rows: spec.rows || [],
      total: spec.total,
      threshold: spec.threshold
    };
    const big = el("span", { class: "ag-score__big ag-num" });
    const bar = meter({
      label: spec.totalLabel || t("total"),
      value: 0,
      threshold: spec.threshold
    });
    const totalBox = el("div", { class: "ag-score__total" }, [big, bar.el]);
    const rows = el("div", { class: "ag-score__rows" });
    const heading = el("h3", { class: "ag-title" });
    const root = el("div", { class: "ag-root ag-score" }, [heading, totalBox, rows]);
    function totals() {
      if (state.total) return state.total;
      let points = 0;
      let max = 0;
      for (const r of state.rows) {
        points += Number(r.points) || 0;
        max += Number(r.max) || 0;
      }
      return { points, max };
    }
    function toneOf(row) {
      if (row.tone) return row.tone;
      const p = Number(row.points) || 0;
      const m = Number(row.max) || 0;
      if (m > 0 && p >= m) return "full";
      return p > 0 ? "part" : "zero";
    }
    function render() {
      heading.textContent = state.title || "";
      heading.hidden = !state.title;
      const sum = totals();
      const share = sum.max > 0 ? sum.points / sum.max * 100 : 0;
      big.textContent = String(Math.round(sum.points));
      bar.set({
        value: share,
        label: (spec.totalLabel || t("total")) + " · " + t("points", { a: Math.round(sum.points), b: Math.round(sum.max) })
      });
      totalBox.hidden = spec.showTotal === false;
      clear(rows);
      if (!state.rows.length) {
        rows.appendChild(el("p", { class: "ag-empty", text: t("empty") }));
        return;
      }
      for (const row of state.rows) {
        const tone = toneOf(row);
        rows.appendChild(el("button", {
          type: "button",
          class: "ag-score__row ag-score__row--" + tone,
          "data-ag-id": row.id,
          "aria-label": row.label + " — " + t("points", { a: row.points, b: row.max }),
          on: { click: function() {
            if (spec.onPick) spec.onPick(row);
          } }
        }, [
          el("span", {}, [
            el("span", { class: "ag-score__name", text: row.label }),
            row.reason ? el("span", { class: "ag-score__why", text: row.reason }) : null
          ]),
          el("span", { class: "ag-score__pts" }, [
            el("span", { text: t("points", { a: row.points, b: row.max }) }),
            el("span", { class: "ag-score__go", text: "→", "aria-hidden": "true" })
          ])
        ]));
      }
    }
    const stopLang = i18n.onChange(render);
    render();
    return {
      el: root,
      /** @param {{ rows?: ScoreRow[], total?: any, title?: string, threshold?: number }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.rows) state.rows = patch.rows;
        if (patch.total !== void 0) state.total = patch.total;
        if (patch.title !== void 0) state.title = patch.title;
        if (patch.threshold !== void 0) {
          state.threshold = patch.threshold;
          bar.set({ threshold: patch.threshold });
        }
        render();
      },
      destroy() {
        stopLang();
        bar.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/game/markers.js
  function badge(spec) {
    const state = {
      title: spec.title,
      description: spec.description,
      earned: !!spec.earned,
      earnedAt: spec.earnedAt
    };
    const seal = el("span", { class: "ag-badge__seal", "aria-hidden": "true" });
    const name = el("span", { class: "ag-badge__name" });
    const desc = el("span", { class: "ag-badge__desc" });
    const when = el("span", { class: "ag-badge__when" });
    const text = el("span", {}, [name, desc, when]);
    const root = el("div", { class: "ag-root ag-badge" }, [seal, text]);
    function whenText() {
      if (!state.earned) return t("notEarned");
      if (state.earnedAt == null) return t("earned");
      const d = state.earnedAt instanceof Date ? state.earnedAt : new Date(state.earnedAt);
      const shown = Number.isNaN(d.getTime()) ? String(state.earnedAt) : d.toLocaleDateString(i18n.lang());
      return t("earnedOn", { when: shown });
    }
    function render() {
      root.className = "ag-root ag-badge" + (state.earned ? " ag-badge--earned" : "");
      seal.textContent = state.earned ? spec.glyph || "✓" : "";
      name.textContent = state.title;
      desc.textContent = state.description || "";
      desc.hidden = !state.description;
      when.textContent = whenText();
    }
    const stopLang = i18n.onChange(render);
    render();
    return {
      el: root,
      /** @param {{ earned?: boolean, earnedAt?: any, title?: string, description?: string }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.earned != null) state.earned = !!patch.earned;
        if (patch.earnedAt !== void 0) state.earnedAt = patch.earnedAt;
        if (patch.title != null) state.title = patch.title;
        if (patch.description !== void 0) state.description = patch.description;
        render();
      },
      destroy() {
        stopLang();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function comingSoon(spec) {
    const state = {
      title: spec.title,
      description: spec.description,
      eta: spec.eta,
      notified: !!(spec.notify && spec.notify.already)
    };
    const name = el("h3", { class: "ag-title" });
    const chip = el("span", { class: "ag-chip ag-chip--info" });
    const top = el("div", { class: "ag-soon__top" }, [name, chip]);
    const what = el("p", { class: "ag-soon__what" });
    const foot = el("div", { class: "ag-soon__foot" });
    const root = el("div", { class: "ag-root ag-card ag-soon" }, [top, what, foot]);
    function render() {
      name.textContent = state.title;
      chip.textContent = spec.chipLabel || t("comingSoon");
      what.textContent = state.description;
      clear(foot);
      if (state.eta) foot.appendChild(el("span", { class: "ag-soon__eta", text: t("eta", { when: state.eta }) }));
      if (!spec.notify) return;
      if (state.notified) {
        foot.appendChild(el("span", { class: "ag-chip ag-chip--ok", text: "✓ " + (spec.notify.doneLabel || t("notified")) }));
        return;
      }
      foot.appendChild(el("button", {
        type: "button",
        class: "ag-btn",
        on: {
          click: function(ev) {
            const btn = (
              /** @type {HTMLElement} */
              ev.currentTarget
            );
            whileBusy(btn, spec.notify ? spec.notify.onNotify() : null).then(function() {
              state.notified = true;
              render();
            }).catch(function() {
            });
          }
        }
      }, spec.notify.label || t("notifyMe")));
    }
    const stopLang = i18n.onChange(render);
    render();
    return {
      el: root,
      /** @param {{ title?: string, description?: string, eta?: string, notified?: boolean }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.title != null) state.title = patch.title;
        if (patch.description != null) state.description = patch.description;
        if (patch.eta !== void 0) state.eta = patch.eta;
        if (patch.notified != null) state.notified = !!patch.notified;
        render();
      },
      destroy() {
        stopLang();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/game/board.js
  function leaderboard(spec) {
    const metrics = spec.metrics && spec.metrics.length ? spec.metrics : [{ id: "score", label: "Score" }];
    let active = spec.metric || metrics[0].id;
    let rows = spec.rows || [];
    const heading = el("h3", { class: "ag-title" });
    const tabs = el("div", { class: "ag-lb__metrics", role: "group" });
    const list = el("div", { class: "ag-lb__rows" });
    const root = el("div", { class: "ag-root ag-lb" }, [heading, tabs, list]);
    function current2() {
      return metrics.find(function(m) {
        return m.id === active;
      }) || metrics[0];
    }
    function show(v, m) {
      if (m.format) return m.format(v);
      if (v == null) return "—";
      return typeof v === "number" ? String(v) : String(v);
    }
    function renderTabs() {
      clear(tabs);
      if (metrics.length < 2) return;
      tabs.setAttribute("aria-label", t("sortBy"));
      for (const m of metrics) {
        tabs.appendChild(el("button", {
          type: "button",
          class: "ag-lb__metric",
          "data-ag-id": m.id,
          "aria-pressed": m.id === active ? "true" : "false",
          on: {
            click: function() {
              active = m.id;
              if (spec.onSort) spec.onSort(active);
              renderTabs();
              renderRows();
            }
          }
        }, m.label));
      }
    }
    function renderRows() {
      clear(list);
      const m = current2();
      if (!rows.length) {
        list.appendChild(el("p", { class: "ag-empty", text: spec.emptyText || t("nobodyYet") }));
        return;
      }
      const dir = m.direction === "asc" ? 1 : -1;
      const sorted = rows.slice().sort(function(a, b) {
        const av = Number(a.values ? a.values[m.id] : 0) || 0;
        const bv = Number(b.values ? b.values[m.id] : 0) || 0;
        return (av - bv) * dir;
      });
      sorted.forEach(function(row, i) {
        const kids = [
          el("span", { class: "ag-lb__rank ag-num", text: String(row.rank != null ? row.rank : i + 1) }),
          el("span", { class: "ag-lb__who" }, [
            el("span", { class: "ag-lb__name", text: row.name + (row.you ? " · " + t("you") : "") }),
            row.sublabel ? el("span", { class: "ag-lb__sub", text: row.sublabel }) : null
          ]),
          el("span", { class: "ag-lb__val", text: show(row.values ? row.values[m.id] : null, m) })
        ];
        const attrs = {
          class: "ag-lb__row" + (row.you ? " ag-lb__row--you" : ""),
          "data-ag-id": row.id
        };
        if (spec.onPick) {
          list.appendChild(el("button", Object.assign({ type: "button" }, attrs, {
            on: { click: function() {
              if (spec.onPick) spec.onPick(row);
            } }
          }), kids));
        } else {
          list.appendChild(el("div", attrs, kids));
        }
      });
    }
    function render() {
      heading.textContent = spec.title || "";
      heading.hidden = !spec.title;
      renderTabs();
      renderRows();
    }
    const stopLang = i18n.onChange(render);
    render();
    return {
      el: root,
      /** @param {{ rows?: BoardRow[], metric?: string, title?: string }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.rows) rows = patch.rows;
        if (patch.metric) active = patch.metric;
        if (patch.title !== void 0) spec.title = patch.title;
        render();
      },
      metric() {
        return active;
      },
      destroy() {
        stopLang();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function statGrid(spec) {
    let tiles = Array.isArray(spec) ? spec : spec && spec.tiles || [];
    const root = el("div", { class: "ag-root ag-stats" });
    function render() {
      clear(root);
      if (!tiles.length) {
        root.appendChild(el("p", { class: "ag-empty", text: t("empty") }));
        return;
      }
      for (const tile of tiles) {
        const tone = tile.deltaTone || (tile.delta == null ? "flat" : Number(tile.delta) > 0 ? "up" : Number(tile.delta) < 0 ? "down" : "flat");
        root.appendChild(el("div", { class: "ag-stat", "data-ag-id": tile.id }, [
          el("span", { class: "ag-label", text: tile.label }),
          el("span", { class: "ag-stat__v" }, [
            el("span", { text: String(tile.value) }),
            tile.unit ? el("span", { class: "ag-stat__u", text: tile.unit }) : null
          ]),
          tile.delta != null ? el("span", { class: "ag-stat__d ag-stat__d--" + tone, text: String(tile.delta) }) : null
        ]));
      }
    }
    const stopLang = i18n.onChange(render);
    render();
    return {
      el: root,
      /** @param {StatTile[]} next */
      set(next) {
        if (next) tiles = next;
        render();
      },
      destroy() {
        stopLang();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function dataTable(spec) {
    let rows = spec.rows || [];
    const columns = spec.columns || [];
    const head = el("thead");
    const body = el("tbody");
    const table = el("table", {}, [head, body]);
    const root = el("div", { class: "ag-root ag-table" }, table);
    function render() {
      clear(head);
      head.appendChild(el("tr", {}, columns.map(function(c) {
        return el("th", { class: c.num ? "ag-th--num" : null, scope: "col", text: c.label });
      })));
      clear(body);
      if (!rows.length) {
        body.appendChild(el("tr", {}, el("td", {
          colspan: String(Math.max(1, columns.length))
        }, el("p", { class: "ag-empty", text: spec.emptyText || t("empty") }))));
        return;
      }
      for (const row of rows) {
        const cells = columns.map(function(c) {
          const raw = row[c.id];
          const text = c.format ? c.format(raw, row) : raw == null ? "—" : String(raw);
          return el("td", { class: c.num ? "ag-td--num" : null, text });
        });
        const tr = el("tr", { "data-ag-pick": spec.onPick ? "" : null }, cells);
        if (spec.onPick) tr.addEventListener("click", function() {
          if (spec.onPick) spec.onPick(row);
        });
        body.appendChild(tr);
      }
    }
    const stopLang = i18n.onChange(render);
    render();
    return {
      el: root,
      /** @param {{ rows?: any[] }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.rows) rows = patch.rows;
        render();
      },
      destroy() {
        stopLang();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function card(spec) {
    const state = {
      title: spec.title,
      author: spec.author,
      metric: spec.metric,
      image: spec.image,
      tags: spec.tags || []
    };
    const body = el("div", { class: "ag-showcase__body" });
    const tag = spec.onPick ? "button" : "div";
    const root = el(tag, Object.assign(
      { class: "ag-root ag-card ag-showcase" },
      spec.onPick ? { type: "button", on: { click: function() {
        if (spec.onPick) spec.onPick();
      } } } : {}
    ));
    function render() {
      clear(root);
      if (state.image) {
        root.appendChild(el("img", {
          class: "ag-showcase__img",
          src: state.image,
          alt: spec.imageAlt || state.title,
          loading: "lazy"
        }));
      }
      clear(body);
      body.appendChild(el("span", { class: "ag-showcase__title", text: state.title }));
      if (state.author) body.appendChild(el("span", { class: "ag-showcase__by", text: state.author }));
      if (state.metric) {
        body.appendChild(el("span", { class: "ag-showcase__metric" }, [
          el("span", { class: "ag-showcase__mv ag-num", text: String(state.metric.value) }),
          el("span", { class: "ag-label", text: state.metric.label })
        ]));
      }
      if (state.tags.length) {
        body.appendChild(el("span", { class: "ag-showcase__tags" }, state.tags.map(function(x) {
          return el("span", { class: "ag-chip", text: x });
        })));
      }
      root.appendChild(body);
    }
    render();
    return {
      el: root,
      /** @param {{ title?: string, author?: string, metric?: any, image?: string, tags?: string[] }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.title != null) state.title = patch.title;
        if (patch.author !== void 0) state.author = patch.author;
        if (patch.metric !== void 0) state.metric = patch.metric;
        if (patch.image !== void 0) state.image = patch.image;
        if (patch.tags) state.tags = patch.tags;
        render();
      },
      destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/game/index.js
  var game = {
    /** The library version, so an app can require a floor before using a newer component. */
    version: "1.0.0",
    // ── Shell and navigation ──
    menu,
    screen,
    modal,
    toast,
    confirm,
    // ── Progression ──
    rail,
    meter,
    scoreBreakdown,
    badge,
    comingSoon,
    counter,
    streak,
    // ── Competition and tables ──
    leaderboard,
    statGrid,
    dataTable,
    card,
    // ── Units (money and morsels never render in one figure) ──
    money,
    morsels,
    isMoneyCurrency,
    MONEY_UNIT,
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
    reducedMotion
  };
  attach("game", game);
})();
