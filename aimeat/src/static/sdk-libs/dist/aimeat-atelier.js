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
    const ease = (cs.getPropertyValue("--ak-ease") || "").trim() || "cubic-bezier(0.2, 0.7, 0.3, 1)";
    for (let i = 0; i < kids.length; i++) {
      kids[i].animate(
        [
          { opacity: 0, transform: "translateY(" + dist + "px)" },
          { opacity: 1, transform: "translateY(0)" }
        ],
        { duration: span, delay: i * step, easing: ease, fill: "backwards" }
      );
    }
  }
  function attention(target, kind) {
    const node = typeof target === "string" ? document.querySelector(target) : target;
    if (!node || reducedMotion() || typeof node.animate !== "function") return false;
    const cs = getComputedStyle(node);
    const span = (parseFloat(cs.getPropertyValue("--ak-motion")) || 200) * 1.6;
    const accent = (cs.getPropertyValue("--ak-accent") || "").trim() || cs.color;
    const gesture = kind || "pulse";
    if (gesture === "shake") {
      node.animate([
        { transform: "translateX(0)" },
        { transform: "translateX(-7px)" },
        { transform: "translateX(7px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(0)" }
      ], { duration: span, easing: "ease-in-out" });
      return true;
    }
    if (gesture === "flash") {
      node.animate([
        { boxShadow: "0 0 0 0 " + accent },
        { boxShadow: "0 0 0 12px transparent" }
      ], { duration: span, iterations: 2, easing: "ease-out" });
      return true;
    }
    if (gesture === "rise") {
      node.animate([
        { transform: "translateY(0) scale(1)" },
        { transform: "translateY(-8px) scale(1.02)", offset: 0.45 },
        { transform: "translateY(0) scale(1)" }
      ], { duration: span, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" });
      return true;
    }
    node.animate([
      { transform: "scale(1)" },
      { transform: "scale(1.06)", offset: 0.5 },
      { transform: "scale(1)" }
    ], { duration: span / 2, iterations: 2, easing: "ease-in-out" });
    return true;
  }
  function kinetic(target, opts) {
    const node = typeof target === "string" ? document.querySelector(target) : target;
    if (!node || reducedMotion() || typeof node.animate !== "function") return false;
    if (node.getAttribute("data-ak-kinetic") === "done") return false;
    const cs = getComputedStyle(node);
    const mode = (opts && opts.mode || cs.getPropertyValue("--ak-kinetic") || "").trim();
    if (mode !== "letters" && mode !== "words") return false;
    const text = node.textContent || "";
    if (!text.trim() || text.length > 80) return false;
    const span = (parseFloat(cs.getPropertyValue("--ak-motion")) || 200) * 1.8;
    const ease = (cs.getPropertyValue("--ak-ease") || "").trim() || "cubic-bezier(0.34, 1.56, 0.64, 1)";
    const pieces = mode === "words" ? text.split(/(\s+)/) : Array.from(text);
    node.setAttribute("aria-label", text);
    node.setAttribute("data-ak-kinetic", "done");
    clear(node);
    let i = 0;
    for (const piece of pieces) {
      const s = el("span", { "aria-hidden": "true" }, piece);
      s.style.display = "inline-block";
      s.style.whiteSpace = "pre";
      node.appendChild(s);
      if (!piece.trim()) continue;
      const drop = 22 + i % 3 * 8;
      const twist = (i % 2 ? 1 : -1) * (3 + i % 3);
      s.animate(
        [
          { opacity: 0, transform: "translateY(" + drop + "px) rotate(" + twist + "deg)" },
          { opacity: 1, transform: "translateY(0) rotate(0deg)" }
        ],
        { duration: span, delay: 34 * i, easing: ease, fill: "backwards" }
      );
      i++;
    }
    return true;
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
      signInHint: "Use the account button in the top corner.",
      required: "Required",
      optional: "Optional",
      total: "Total",
      you: "You",
      next: "Next",
      previous: "Previous",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      fitView: "Fit to view",
      send: "Send",
      aideTitle: "Aide",
      aidePlaceholder: "Ask, or say what to do…",
      opsOk: "up",
      opsWarn: "degraded",
      opsDown: "down",
      "queue.waiting": "waiting",
      "queue.running": "running",
      "queue.done": "done",
      "queue.failed": "failed",
      consoleEmpty: "Nothing logged yet",
      atlasDown: "The map could not load",
      heatLess: "less",
      heatMore: "more",
      today: "Today",
      m1: "JAN",
      m2: "FEB",
      m3: "MAR",
      m4: "APR",
      m5: "MAY",
      m6: "JUN",
      m7: "JUL",
      m8: "AUG",
      m9: "SEP",
      m10: "OCT",
      m11: "NOV",
      m12: "DEC",
      aideNotice: "You are talking with an AI. Answers can be wrong; actions run only when you confirm them.",
      aideNoAi: "AI is not set up on this account yet. Connect a key under Profile, and the aide wakes up.",
      aideFailed: "That did not go through. Try again.",
      aideRun: "Run it",
      aideUnknownAction: "The model proposed something this app does not declare — nothing was run.",
      explainTitle: "What this screen holds",
      delegateGo: "Let AI handle it",
      delegateHanded: "Handed over",
      delegateFailed: "The agent could not finish it.",
      delegateNoAgents: "No agent is connected to this account yet.",
      agentActivityNone: "No agent activity yet."
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
      signInHint: "Käytä yläkulman tilinappia.",
      required: "Pakollinen",
      optional: "Valinnainen",
      total: "Yhteensä",
      you: "Sinä",
      next: "Seuraava",
      previous: "Edellinen",
      zoomIn: "Lähennä",
      zoomOut: "Loitonna",
      fitView: "Sovita näkymään",
      send: "Lähetä",
      aideTitle: "Apuri",
      aidePlaceholder: "Kysy, tai sano mitä tehdään…",
      opsOk: "toiminnassa",
      opsWarn: "takkuaa",
      opsDown: "nurin",
      "queue.waiting": "jonossa",
      "queue.running": "käynnissä",
      "queue.done": "valmis",
      "queue.failed": "epäonnistui",
      consoleEmpty: "Ei vielä lokirivejä",
      atlasDown: "Kartta ei latautunut",
      heatLess: "vähän",
      heatMore: "paljon",
      today: "Tänään",
      m1: "TAM",
      m2: "HEL",
      m3: "MAA",
      m4: "HUH",
      m5: "TOU",
      m6: "KES",
      m7: "HEI",
      m8: "ELO",
      m9: "SYY",
      m10: "LOK",
      m11: "MAR",
      m12: "JOU",
      aideNotice: "Keskustelet tekoälyn kanssa. Vastaus voi olla väärin; toiminnot ajetaan vasta kun vahvistat ne.",
      aideNoAi: "Tälle tilille ei ole vielä kytketty tekoälyä. Liitä avain profiilissa, niin apuri herää.",
      aideFailed: "Se ei mennyt läpi. Yritä uudelleen.",
      aideRun: "Aja",
      aideUnknownAction: "Malli ehdotti jotain mitä tämä appsi ei tunne — mitään ei ajettu.",
      explainTitle: "Mitä tällä näytöllä on",
      delegateGo: "Anna tekoälyn hoitaa",
      delegateHanded: "Annettu hoidettavaksi",
      delegateFailed: "Agentti ei saanut sitä valmiiksi.",
      delegateNoAgents: "Tähän tiliin ei ole vielä kytketty agenttia.",
      agentActivityNone: "Ei agenttitoimintaa vielä."
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
      signInHint: "Usa el botón de cuenta en la esquina superior.",
      required: "Obligatorio",
      optional: "Opcional",
      total: "Total",
      you: "Tú",
      next: "Siguiente",
      previous: "Anterior",
      zoomIn: "Acercar",
      zoomOut: "Alejar",
      fitView: "Ajustar a la vista",
      send: "Enviar",
      aideTitle: "Ayudante",
      aidePlaceholder: "Pregunta, o di qué hacer…",
      opsOk: "en marcha",
      opsWarn: "degradado",
      opsDown: "caído",
      "queue.waiting": "en cola",
      "queue.running": "en curso",
      "queue.done": "hecho",
      "queue.failed": "falló",
      consoleEmpty: "Sin líneas de registro todavía",
      atlasDown: "El mapa no se cargó",
      heatLess: "menos",
      heatMore: "más",
      today: "Hoy",
      m1: "ENE",
      m2: "FEB",
      m3: "MAR",
      m4: "ABR",
      m5: "MAY",
      m6: "JUN",
      m7: "JUL",
      m8: "AGO",
      m9: "SEP",
      m10: "OCT",
      m11: "NOV",
      m12: "DIC",
      aideNotice: "Estás hablando con una IA. Las respuestas pueden fallar; las acciones solo se ejecutan cuando las confirmas.",
      aideNoAi: "Esta cuenta aún no tiene IA configurada. Conecta una clave en el perfil y el ayudante despierta.",
      aideFailed: "No ha funcionado. Inténtalo otra vez.",
      aideRun: "Ejecutar",
      aideUnknownAction: "El modelo propuso algo que esta app no declara — no se ejecutó nada.",
      explainTitle: "Qué hay en esta pantalla",
      delegateGo: "Deja que la IA lo haga",
      delegateHanded: "Encargado",
      delegateFailed: "El agente no pudo terminarlo.",
      delegateNoAgents: "Esta cuenta aún no tiene ningún agente conectado.",
      agentActivityNone: "Sin actividad de agentes todavía."
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

  // src/static/sdk-libs/atelier/scenics.js
  function easeOf(node) {
    const cs = getComputedStyle(node);
    return (cs.getPropertyValue("--ak-ease") || "").trim() || "cubic-bezier(0.34, 1.56, 0.64, 1)";
  }
  function flapify(target, opts) {
    const node = typeof target === "string" ? document.querySelector(target) : target;
    if (!node || node.getAttribute("data-ak-flapped") === "done") return false;
    const text = node.textContent || "";
    if (!text.trim()) return false;
    node.setAttribute("data-ak-flapped", "done");
    node.setAttribute("aria-label", text);
    node.textContent = "";
    const wrap = document.createElement("span");
    wrap.className = "ak-flaps";
    wrap.setAttribute("aria-hidden", "true");
    const base = opts && opts.delay || 0;
    let i = 0;
    for (const ch of text) {
      const f = document.createElement("span");
      f.className = "ak-flap" + (ch === " " ? " ak-flap--space" : "");
      f.textContent = ch;
      wrap.appendChild(f);
      if (!reducedMotion() && f.animate && ch !== " ") {
        f.animate(
          [{ transform: "rotateX(90deg)", opacity: 0.2 }, { transform: "rotateX(0deg)", opacity: 1 }],
          { duration: 240, delay: base + i * 14, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" }
        );
      }
      i++;
    }
    node.appendChild(wrap);
    return true;
  }
  function ransom(target) {
    const node = typeof target === "string" ? document.querySelector(target) : target;
    if (!node || node.getAttribute("data-ak-ransomed") === "done") return false;
    const text = node.textContent || "";
    if (!text.trim()) return false;
    node.setAttribute("data-ak-ransomed", "done");
    node.setAttribute("aria-label", text);
    node.classList.add("ak-ransom");
    node.textContent = "";
    const cuts = ["cut-a", "cut-b", "cut-c", "cut-d", "cut-e", "cut-f"];
    let i = 0;
    for (const ch of text) {
      if (ch === " ") {
        node.appendChild(document.createTextNode(" "));
        continue;
      }
      const piece = document.createElement("i");
      piece.className = cuts[i % cuts.length];
      piece.textContent = ch;
      piece.setAttribute("aria-hidden", "true");
      node.appendChild(piece);
      i++;
    }
    return true;
  }
  function vu(target, values) {
    const node = typeof target === "string" ? document.querySelector(target) : target;
    if (!node || !Array.isArray(values) || !values.length) return false;
    node.classList.add("ak-vu");
    node.setAttribute("aria-hidden", "true");
    node.textContent = "";
    const max = Math.max(...values, 1);
    values.forEach((v, i) => {
      const bar = document.createElement("i");
      bar.style.height = Math.round(v / max * 100) + "%";
      node.appendChild(bar);
      if (!reducedMotion() && bar.animate) {
        bar.animate(
          [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }],
          { duration: 260, delay: i * 18, easing: easeOf(node), fill: "backwards" }
        );
      }
    });
    return true;
  }
  function typeout(target, lines, opts) {
    const node = typeof target === "string" ? document.querySelector(target) : target;
    if (!node || !Array.isArray(lines) || !lines.length) return false;
    const step = opts && opts.cps || 3;
    const reduced = reducedMotion();
    const typeLine = (li, ci) => {
      if (li >= lines.length) return;
      const row = node.children[li] || node.appendChild(Object.assign(document.createElement("div"), { className: lines[li][0] || "" }));
      const text = lines[li][1];
      if (reduced) {
        row.textContent = text;
        typeLine(li + 1, 0);
        return;
      }
      row.textContent = text.slice(0, ci);
      if (ci <= text.length) setTimeout(() => typeLine(li, ci + step), 12);
      else setTimeout(() => typeLine(li + 1, 0), 90);
    };
    typeLine(0, 0);
    return true;
  }
  function dealIn(targets, opts) {
    const list2 = typeof targets === "string" ? Array.from(document.querySelectorAll(targets)) : targets || [];
    if (reducedMotion()) return 0;
    const step = opts && opts.step || 70;
    list2.forEach((el2, i) => {
      if (!el2.animate) return;
      const rest = getComputedStyle(el2).transform;
      const at = rest && rest !== "none" ? rest + " " : "";
      el2.animate(
        [
          { opacity: 0, transform: at + "translateY(24px) scale(0.96)" },
          { opacity: 1, transform: rest === "none" ? "none" : rest }
        ],
        { duration: 380, delay: i * step, easing: easeOf(el2), fill: "backwards" }
      );
    });
    return list2.length;
  }

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
  var SIGNIN_GRACE_MS = 2500;
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
        // The sign-in card PRESENTS THE APP: its own name as the title and, when the app gave one,
        // its tagline before the how-to — a first visitor learns what this is, not only that a
        // login exists. (The second AEB review met a bare system sentence on an empty page.)
        signin: {
          title: o.title || state.title,
          hint: o.hint != null ? o.hint : (spec.tagline ? spec.tagline + " " : "") + t("signIn") + " " + t("signInHint")
        }
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
    let graceTimer = null;
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
        if (graceTimer) {
          clearTimeout(graceTimer);
          graceTimer = null;
        }
        root.classList.remove("ak-app--gate");
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
            root.classList.add("ak-app--gate");
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
      root.classList.add("ak-app--gate");
      armPoll();
      tryBoot();
      graceTimer = setTimeout(function() {
        graceTimer = null;
        if (!booted) status("signin");
      }, SIGNIN_GRACE_MS);
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
      /** @param {{ title?: string, look?: string, density?: 'comfortable'|'compact' }} patch */
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
        if (patch.density != null) root.classList.toggle("ak-app--compact", patch.density === "compact");
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
        if (graceTimer) {
          clearTimeout(graceTimer);
          graceTimer = null;
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
    requestAnimationFrame(function() {
      const appRoot = root.closest(".ak-app");
      if (!appRoot) return;
      const barTitle = appRoot.querySelector(".ak-app__bar .ak-app__title");
      if (!barTitle) return;
      const same = (barTitle.textContent || "").trim().toLowerCase() === String(state.title || "").trim().toLowerCase();
      if (same) appRoot.classList.add("ak-app--hero-titled");
    });
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
    requestAnimationFrame(function() {
      kinetic(title);
    });
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
  function drawTrend(entry, trend) {
    const values = Array.isArray(trend) ? trend.filter((v) => typeof v === "number") : [];
    if (values.length < 2) {
      if (entry.spark) {
        entry.spark.remove();
        entry.spark = null;
      }
      return;
    }
    const W22 = 96;
    const H22 = 24;
    let min = Math.min.apply(null, values);
    let max = Math.max.apply(null, values);
    if (max === min) {
      max = min + 1;
    }
    const points = values.map((v, i) => {
      const px = W22 * i / (values.length - 1);
      const py = 2 + (H22 - 4) * (1 - (v - min) / (max - min));
      return px.toFixed(1) + "," + py.toFixed(1);
    }).join(" ");
    if (!entry.spark) {
      entry.spark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      entry.spark.setAttribute("class", "ak-statrow__spark");
      entry.spark.setAttribute("viewBox", "0 0 " + W22 + " " + H22);
      entry.spark.setAttribute("aria-hidden", "true");
      entry.spark.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "polygon"));
      entry.spark.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "polyline"));
      entry.tile.appendChild(entry.spark);
    }
    entry.spark.firstChild.setAttribute("points", "0," + H22 + " " + points + " " + W22 + "," + H22);
    entry.spark.lastChild.setAttribute("points", points);
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
          const tileEl = el("div", { class: "ak-statrow__tile" }, [value, label, hint]);
          root.appendChild(tileEl);
          entry = { value: first ? tile.value : 0, node: value, label, hint, tile: tileEl, spark: null };
          shown.set(tile.id, entry);
        }
        entry.label.textContent = tile.label;
        entry.hint.textContent = tile.hint || "";
        entry.hint.hidden = !tile.hint;
        drawTrend(entry, tile.trend);
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
  var STAR_PATH = "M8 1.3l2 4.1 4.6.7-3.3 3.2.8 4.5L8 11.7l-4.1 2.1.8-4.5L1.4 6.1 6 5.4z";
  function starRow() {
    const ns = "http://www.w3.org/2000/svg";
    const node = document.createElementNS(ns, "svg");
    node.setAttribute("viewBox", "0 0 84 16");
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("class", "ak-rating__stars");
    for (let i = 0; i < 5; i++) {
      const star = document.createElementNS(ns, "path");
      star.setAttribute("d", STAR_PATH);
      star.setAttribute("transform", `translate(${i * 17} 0)`);
      node.appendChild(star);
    }
    return node;
  }
  function rating(spec) {
    const state = { value: Number(spec.value) || 0, max: Number(spec.max) > 0 ? Number(spec.max) : 5, count: spec.count };
    const root = el("div", { class: "ak-root ak-rating", role: "img" });
    if (spec.target) resolve(spec.target).appendChild(root);
    const number = el("b", { class: "ak-rating__value" });
    const track = el("span", { class: "ak-rating__track" });
    track.appendChild(starRow());
    const fill = el("span", { class: "ak-rating__fill" });
    fill.appendChild(starRow());
    track.appendChild(fill);
    const words = el("span", { class: "ak-rating__words" });
    root.appendChild(number);
    root.appendChild(track);
    root.appendChild(words);
    function paint() {
      const frac = Math.min(Math.max(state.value / state.max, 0), 1);
      number.textContent = (Math.round(state.value * 10) / 10).toLocaleString();
      fill.style.width = (frac * 100).toFixed(1) + "%";
      words.textContent = [
        spec.label || "",
        state.count != null ? "(" + Number(state.count).toLocaleString() + ")" : ""
      ].filter(Boolean).join(" ");
      root.setAttribute("aria-label", `${state.value} / ${state.max}` + (state.count != null ? ` · ${state.count}` : ""));
    }
    paint();
    return {
      el: root,
      set(patch) {
        if (patch && typeof patch.value === "number") state.value = patch.value;
        if (patch && "count" in patch) state.count = patch.count;
        paint();
      },
      destroy() {
        root.remove();
      }
    };
  }

  // src/static/sdk-libs/atelier/aide.js
  var SOURCE_CHARS_MAX = 2e3;
  var CONTEXT_CHARS_MAX = 8e3;
  var PANEL_BLOCKS_MAX = 8;
  var HISTORY_TURNS = 12;
  var ANSWER_SCHEMA = {
    type: "object",
    properties: {
      reply: { type: "string" },
      action: {
        type: "object",
        properties: { id: { type: "string" }, params: { type: "object" } },
        required: ["id"]
      },
      panel: { type: "object" }
    },
    required: ["reply"]
  };
  function aide(spec) {
    const s = spec || {};
    const history = [];
    let firstSend = true;
    const log = el("div", { class: "ak-aide__log", role: "log", "aria-live": "polite" });
    const input = (
      /** @type {HTMLTextAreaElement} */
      el("textarea", {
        class: "ak-input ak-input--area ak-aide__input",
        rows: 2,
        placeholder: t("aidePlaceholder"),
        "aria-label": t("aidePlaceholder")
      })
    );
    const sendBtn = el("button", {
      type: "button",
      class: "ak-btn ak-btn--primary",
      on: { click: function() {
        send();
      } }
    }, t("send"));
    input.addEventListener("keydown", function(ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        send();
      }
    });
    const notice = el("p", { class: "ak-aide__notice" });
    const root = el("section", { class: "ak-root ak-aide", "aria-label": "Aide" }, [
      el("header", { class: "ak-aide__head" }, [
        el("h2", { class: "ak-section__title", text: t("aideTitle") }),
        notice
      ]),
      log,
      el("div", { class: "ak-aide__row" }, [input, sendBtn])
    ]);
    if (s.target) resolve(s.target).appendChild(root);
    enter(root);
    const aiNs = (
      /** @type {any} */
      window.AIMEAT && /** @type {any} */
      window.AIMEAT.ai
    );
    if (aiNs && typeof aiNs.chatNotice === "function") {
      try {
        aiNs.chatNotice({ target: notice });
      } catch (err) {
        console.warn("aimeat-atelier: the AI notice did not render", err);
      }
    } else {
      notice.textContent = t("aideNotice");
    }
    if (s.intro) bubble("assistant", s.intro, null);
    function bubble(who, text, provenance) {
      const b = el("div", { class: "ak-aide__msg ak-aide__msg--" + who }, [
        el("p", { class: "ak-aide__text", text })
      ]);
      if (who === "assistant" && provenance && aiNs && typeof aiNs.disclose === "function") {
        const tag = el("span", { class: "ak-aide__label" });
        b.appendChild(tag);
        try {
          aiNs.disclose(provenance, { target: tag });
        } catch (err) {
          console.warn("aimeat-atelier: the provenance label did not render", err);
        }
      }
      log.appendChild(b);
      log.scrollTop = log.scrollHeight;
      return b;
    }
    async function contextText() {
      const parts = [];
      const names = Object.keys(s.sources || {});
      let budget = CONTEXT_CHARS_MAX;
      for (const name of names) {
        if (budget <= 0) break;
        let data;
        try {
          data = await Promise.resolve().then(s.sources[name]);
        } catch (err) {
          console.warn('aimeat-atelier: aide source "' + name + '" failed', err);
          continue;
        }
        const chunk = JSON.stringify(data).slice(0, Math.min(SOURCE_CHARS_MAX, budget));
        budget -= chunk.length;
        parts.push("SOURCE " + name + ": " + chunk);
      }
      return parts.join("\n");
    }
    function actionsText() {
      const list2 = s.actions || [];
      if (!list2.length) return "This app declares no actions: answer with words only.";
      return "ACTIONS you may propose (a person confirms before anything runs):\n" + list2.map(function(a) {
        const params = a.params ? " params: " + JSON.stringify(a.params) : "";
        return '- id "' + a.id + '": ' + a.summary + params;
      }).join("\n");
    }
    async function send() {
      const text = input.value.trim();
      if (!text) return;
      if (!aiNs || typeof aiNs.completeJson !== "function") {
        bubble("assistant", t("aideNoAi"), null);
        return;
      }
      const available = await aiNs.isAvailable().catch(function() {
        return false;
      });
      if (!available) {
        bubble("assistant", t("aideNoAi"), null);
        return;
      }
      input.value = "";
      bubble("user", text, null);
      history.push({ who: "user", text });
      const thinking = bubble("assistant", "…", null);
      const prompt2 = [
        'You are the in-app aide of "' + (s.appName || document.title || "this app") + '" on the AIMEAT platform.',
        "You may ONLY act through the declared actions below, and only propose one when the person asked to DO something.",
        'Answer as JSON: { "reply": "<plain words for the person>", "action"?: { "id", "params" }, "panel"?: { "blocks": [...] } when a visual answer helps }.',
        'A panel block is exactly { "id": "<short-slug>", "component": "<one of: list, statRow, table, timeline, figure, cardGrid>", "props": { "source": "<one of the SOURCE names below>", "title": "<a heading>" } } — no other component names, and only source names that appear below.',
        actionsText(),
        "DATA the screen shows right now:",
        await contextText(),
        "CONVERSATION so far:",
        history.slice(-HISTORY_TURNS).map(function(h) {
          return h.who + ": " + h.text;
        }).join("\n")
      ].join("\n\n");
      let out;
      try {
        out = await aiNs.completeJson({
          prompt: prompt2,
          schema: ANSWER_SCHEMA,
          app_id: s.appId || s.appName || "atelier-aide",
          confirm: firstSend
        });
        firstSend = false;
      } catch (err) {
        thinking.remove();
        const code = err && /** @type {any} */
        err.code;
        bubble("assistant", code === "SPEND_CANCELLED" ? t("cancel") + "." : t("aideFailed"), null);
        return;
      }
      thinking.remove();
      const body = out && out.data ? out.data : out;
      const answer = body && body.parsed ? body.parsed : body;
      const reply = answer && typeof answer.reply === "string" ? answer.reply : t("aideFailed");
      const b = bubble("assistant", reply, body && body.provenance || out && out.provenance || null);
      history.push({ who: "assistant", text: reply });
      if (answer && answer.action && answer.action.id) offerAction(answer.action, b);
      if (answer && answer.panel) renderPanel(answer.panel, b);
    }
    function offerAction(proposed, into) {
      const declared = (s.actions || []).find(function(a) {
        return a.id === proposed.id;
      });
      if (!declared) {
        into.appendChild(el("p", { class: "ak-aide__text", text: t("aideUnknownAction") }));
        return;
      }
      const row = el("div", { class: "ak-aide__confirm" }, [
        el("span", { text: declared.summary }),
        el("button", {
          type: "button",
          class: "ak-btn ak-btn--primary",
          on: { click: async function() {
            clear(row);
            row.appendChild(el("span", { text: "…" }));
            try {
              const result = await Promise.resolve(declared.run ? declared.run(proposed.params || {}) : null);
              clear(row);
              row.appendChild(el("span", { text: typeof result === "string" ? result : t("ready") }));
            } catch (err) {
              clear(row);
              row.appendChild(el("span", { text: t("aideFailed") + " " + String(err && /** @type {any} */
              err.message || "") }));
            }
          } }
        }, t("aideRun")),
        el("button", {
          type: "button",
          class: "ak-btn ak-btn--ghost",
          on: { click: function() {
            row.remove();
          } }
        }, t("cancel"))
      ]);
      into.appendChild(row);
    }
    function renderPanel(panel, into) {
      if (!panel || !Array.isArray(panel.blocks) || panel.blocks.length === 0 || panel.blocks.length > PANEL_BLOCKS_MAX) return;
      const ns = (
        /** @type {any} */
        window.AIMEAT
      );
      if (!ns || !ns.atelier || typeof ns.atelier.mosaic !== "function") return;
      const host = el("div", { class: "ak-aide__panel" });
      into.appendChild(host);
      try {
        const handle = ns.atelier.mosaic({ target: host, layout: { v: 1, blocks: panel.blocks }, sources: s.sources || {} });
        root.addEventListener("ak-destroy", function() {
          handle.destroy();
        }, { once: true });
      } catch (err) {
        console.warn("aimeat-atelier: a generated panel did not render — the words above stand alone.", err);
        host.remove();
      }
    }
    return {
      el: root,
      open() {
        input.focus();
      },
      destroy() {
        root.dispatchEvent(new Event("ak-destroy"));
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

  // src/static/sdk-libs/atelier/agentic.js
  function agentsNs() {
    const ns = (
      /** @type {any} */
      window.AIMEAT
    );
    return ns && ns.agents && typeof ns.agents.createTask === "function" ? ns.agents : null;
  }
  function delegate(spec) {
    const status = el("span", { class: "ak-delegate__status", "aria-live": "polite" });
    const btn = (
      /** @type {HTMLButtonElement} */
      el("button", {
        type: "button",
        class: "ak-btn ak-btn--ghost",
        on: { click: run }
      }, "✦ " + (spec.label || t("delegateGo")))
    );
    const root = el("div", { class: "ak-root ak-delegate" }, [btn, status]);
    if (spec.target) resolve(spec.target).appendChild(root);
    enter(root);
    let stopWatch = null;
    async function run() {
      const agents = agentsNs();
      if (!agents) {
        status.textContent = t("delegateNoAgents");
        return;
      }
      btn.disabled = true;
      status.textContent = "…";
      try {
        const created = await agents.createTask(spec.agent, {
          title: spec.task.title,
          description: spec.task.description
        }, { confirm: true });
        const id = created && (created.id || created.task_id);
        status.textContent = t("delegateHanded") + " (" + spec.agent + ")";
        if (id && typeof agents.watch === "function") {
          stopWatch = agents.watch(spec.agent, id, function(task) {
            if (task.status === "done") {
              status.textContent = t("ready");
              btn.disabled = false;
              if (stopWatch) {
                stopWatch();
                stopWatch = null;
              }
              if (spec.onDone) spec.onDone({ task, deliverable: null });
            } else if (task.status === "failed" || task.status === "stalled") {
              status.textContent = t("delegateFailed");
              btn.disabled = false;
              if (stopWatch) {
                stopWatch();
                stopWatch = null;
              }
            }
          });
        } else {
          btn.disabled = false;
        }
      } catch (err) {
        const code = err && /** @type {any} */
        err.code;
        status.textContent = code === "SPEND_CANCELLED" ? t("cancel") + "." : t("delegateFailed");
        btn.disabled = false;
      }
    }
    return {
      el: root,
      destroy() {
        if (stopWatch) stopWatch();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function agentActivity(spec) {
    const root = el("div", { class: "ak-root ak-agentactivity" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let inner = null;
    async function refresh() {
      const agents = agentsNs();
      if (inner && inner.destroy) inner.destroy();
      clear(root);
      if (!agents) {
        inner = emptyState({ target: root, tone: "quiet", title: t("agentActivityNone"), hint: t("delegateNoAgents") });
        return;
      }
      let tasks;
      try {
        tasks = await agents.tasks(spec.agent, {});
      } catch (err) {
        console.warn("aimeat-atelier: agent activity could not be read", err);
        inner = emptyState({ target: root, tone: "quiet", title: t("agentActivityNone") });
        return;
      }
      const rows = (tasks || []).slice(0, spec.limit || 8).map(function(task) {
        return {
          id: String(task.id || task.title),
          ts: task.updated_at || task.created_at || (/* @__PURE__ */ new Date()).toISOString(),
          title: task.title || task.description || "",
          sub: task.status,
          tone: task.status === "failed" ? "err" : task.status === "done" ? "ok" : "warn"
        };
      });
      if (!rows.length) {
        inner = emptyState({ target: root, tone: "quiet", title: t("agentActivityNone") });
        return;
      }
      inner = timeline({ target: root, items: rows });
    }
    refresh();
    return {
      el: root,
      refresh,
      destroy() {
        if (inner && inner.destroy) inner.destroy();
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
          for (const other of root.querySelectorAll(".ak-list__row--selected")) {
            other.classList.remove("ak-list__row--selected");
            other.removeAttribute("aria-current");
          }
          row.classList.add("ak-list__row--selected");
          row.setAttribute("aria-current", "true");
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
      const mark = function() {
        for (const row of root.querySelectorAll(".ak-list__row")) {
          const on = row.getAttribute("data-ak-id") === id;
          row.classList.toggle("ak-list__row--selected", on);
          if (on) row.setAttribute("aria-current", "true");
          else row.removeAttribute("aria-current");
        }
        renderDetail();
      };
      const picked = (
        /** @type {HTMLElement|null} */
        id != null ? Array.from(root.querySelectorAll(".ak-list__row")).find(function(r) {
          return r.getAttribute("data-ak-id") === id;
        }) ?? null : null
      );
      if (picked && typeof document.startViewTransition === "function" && !reducedMotion()) {
        picked.style.viewTransitionName = "ak-morph";
        const vt = document.startViewTransition(function() {
          picked.style.viewTransitionName = "";
          detail.style.viewTransitionName = "ak-morph";
          mark();
        });
        vt.finished.finally(function() {
          detail.style.viewTransitionName = "";
        });
      } else {
        mark();
      }
      if (id != null) {
        requestAnimationFrame(function() {
          const box = detail.getBoundingClientRect();
          const viewH = window.innerHeight || document.documentElement.clientHeight;
          if (box.top >= viewH || box.bottom <= 0) {
            detail.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
          }
        });
      }
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
      attention(c.wrap, "shake");
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

  // src/static/sdk-libs/atelier/chart-core.js
  var SVG_NS = "http://www.w3.org/2000/svg";
  function svg(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
    return node;
  }
  var SERIES_VARS = ["var(--ak-accent)", "var(--ak-spectrum-2)", "var(--ak-spectrum-3)", "var(--ak-accent-2)"];
  function tickStep(span) {
    const raw = span / 4;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) {
      if (raw <= m * pow) return m * pow;
    }
    return 10 * pow;
  }
  function fmtTick(v) {
    if (Math.abs(v) >= 1e3) return (v / 1e3).toLocaleString(void 0, { maximumFractionDigits: 1 }) + "k";
    return v.toLocaleString(void 0, { maximumFractionDigits: 2 });
  }
  function smoothPath(pts) {
    if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : "";
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x} ${p2.y}`;
    }
    return d;
  }
  var defsCounter = 0;
  function defsFor(node, seriesCount) {
    const stamp2 = ++defsCounter;
    const defs = svg("defs", {});
    const sheenId = `ak-sheen-${stamp2}`;
    const sheen = svg("linearGradient", { id: sheenId, x1: 0, y1: 0, x2: 0, y2: 1 });
    const s1 = svg("stop", { offset: "0", "stop-opacity": "0.22" });
    s1.style.stopColor = "var(--ak-chart-sheen)";
    const s2 = svg("stop", { offset: "1", "stop-opacity": "0" });
    s2.style.stopColor = "var(--ak-chart-sheen)";
    sheen.appendChild(s1);
    sheen.appendChild(s2);
    defs.appendChild(sheen);
    for (let i = 0; i < seriesCount; i++) {
      const fade = svg("linearGradient", { id: `ak-fade-${stamp2}-${i}`, x1: 0, y1: 0, x2: 0, y2: 1 });
      const f1 = svg("stop", { offset: "0", "stop-opacity": "0.20" });
      f1.style.stopColor = SERIES_VARS[i % SERIES_VARS.length];
      const f2 = svg("stop", { offset: "1", "stop-opacity": "0" });
      f2.style.stopColor = SERIES_VARS[i % SERIES_VARS.length];
      fade.appendChild(f1);
      fade.appendChild(f2);
      defs.appendChild(fade);
    }
    node.appendChild(defs);
    return { sheen: `url(#${sheenId})`, fade: (i) => `url(#ak-fade-${stamp2}-${i % SERIES_VARS.length})` };
  }

  // src/static/sdk-libs/atelier/chart-shapes.js
  var TONES = { ok: "var(--ak-ok-text)", warn: "var(--ak-warn-text)", err: "var(--ak-err-text)" };
  function renderDonut(ctx, data) {
    const slices = (data && Array.isArray(data.slices) ? data.slices : []).filter((s) => s && typeof s.value === "number" && s.value > 0);
    if (!slices.length) return ctx.empty();
    const total = slices.reduce((sum, s) => sum + s.value, 0);
    ctx.root.setAttribute("aria-label", (ctx.title ? ctx.title + " — " : "") + slices.map((s) => s.label + " " + s.value).join(", "));
    const R = 88;
    const STROKE = 26;
    const C = 2 * Math.PI * R;
    const GAP = 4;
    const wrap = el("div", { class: "ak-chart__donutwrap" });
    const node = svg("svg", { viewBox: "0 0 230 230", class: "ak-chart__svg ak-chart__svg--donut", "aria-hidden": "true" });
    node.appendChild(svg("circle", { cx: 115, cy: 115, r: R, class: "ak-chart__ring", "stroke-width": STROKE }));
    let offset = 0;
    slices.forEach((s, i) => {
      const frac = s.value / total;
      const ring = svg("circle", {
        cx: 115,
        cy: 115,
        r: R,
        class: "ak-chart__slice",
        style: `stroke:${SERIES_VARS[i % SERIES_VARS.length]}`,
        "stroke-width": STROKE,
        "stroke-linecap": slices.length > 1 ? "round" : "butt",
        "stroke-dasharray": `${Math.max(frac * C - GAP, 0.5)} ${C}`,
        "stroke-dashoffset": String(-offset * C),
        transform: "rotate(-90 115 115)"
      });
      if (!ctx.still()) {
        ring.classList.add("ak-chart__slice--enter");
        ring.style.animationDelay = `${i * 70}ms`;
      }
      node.appendChild(ring);
      offset += frac;
    });
    wrap.appendChild(node);
    const centre = el("div", { class: "ak-chart__centre" }, [
      el("b", { text: fmtTick(total) }),
      data.delta && data.delta.text ? el("span", { class: "ak-chart__delta", text: String(data.delta.text) }) : null
    ]);
    if (data.delta && TONES[data.delta.tone]) {
      centre.lastChild.style.color = TONES[data.delta.tone];
    }
    wrap.appendChild(centre);
    ctx.root.appendChild(wrap);
    const legend = el(
      "figcaption",
      { class: "ak-chart__legend" },
      slices.map((s) => el("span", { class: "ak-chart__key" }, [
        el("span", { class: "ak-chart__swatch" }),
        el("span", { text: `${s.label} · ${fmtTick(s.value)}` })
      ]))
    );
    slices.forEach((s, i) => {
      const sw = legend.children[i] && legend.children[i].firstChild;
      if (sw) sw.style.background = SERIES_VARS[i % SERIES_VARS.length];
    });
    ctx.root.appendChild(legend);
  }
  function renderCalendar(ctx, data) {
    const days = (data && Array.isArray(data.days) ? data.days : []).map((d) => ({ date: new Date(d.date), value: Number(d.value) || 0 })).filter((d) => !isNaN(d.date.getTime())).sort((a, b) => a.date.getTime() - b.date.getTime());
    if (!days.length) return ctx.empty();
    const max = days.reduce((m, d) => Math.max(m, d.value), 0) || 1;
    const start = new Date(days[0].date);
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    const spanDays = Math.round((days[days.length - 1].date.getTime() - start.getTime()) / 864e5) + 1;
    const weeks = Math.min(Math.ceil(spanDays / 7), 53);
    const CELL = 13;
    const GAP = 3;
    const width = weeks * (CELL + GAP) + GAP;
    const height = 7 * (CELL + GAP) + GAP + 16;
    ctx.root.setAttribute("aria-label", (ctx.title ? ctx.title + " — " : "") + days.length + " d");
    const byKey = /* @__PURE__ */ new Map();
    for (const d of days) byKey.set(d.date.toISOString().slice(0, 10), d.value);
    const node = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "ak-chart__svg ak-chart__svg--calendar", "aria-hidden": "true" });
    const cursor = new Date(start);
    const monthAt = [];
    for (let w = 0; w < weeks; w++) {
      for (let dow = 0; dow < 7; dow++) {
        const key = cursor.toISOString().slice(0, 10);
        const value = byKey.get(key);
        if (cursor.getDate() === 1) monthAt.push({ w, m: cursor.getMonth() });
        const cell = svg("rect", {
          x: GAP + w * (CELL + GAP),
          y: GAP + dow * (CELL + GAP),
          width: CELL,
          height: CELL,
          rx: 3,
          class: "ak-chart__day" + (value === void 0 ? " ak-chart__day--blank" : "")
        });
        if (value !== void 0) {
          cell.setAttribute("style", `fill: var(--ak-accent); fill-opacity: ${(0.15 + 0.85 * (value / max)).toFixed(3)}`);
        }
        node.appendChild(cell);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    const MONTHS = [t("m1"), t("m2"), t("m3"), t("m4"), t("m5"), t("m6"), t("m7"), t("m8"), t("m9"), t("m10"), t("m11"), t("m12")];
    for (const mark of monthAt) {
      const label = svg("text", { x: GAP + mark.w * (CELL + GAP), y: height - 4, class: "ak-chart__tick" });
      label.textContent = MONTHS[mark.m];
      node.appendChild(label);
    }
    ctx.root.appendChild(node);
    const ramp = el("figcaption", { class: "ak-chart__ramp" }, [
      el("span", { text: t("heatLess") }),
      ...[0.15, 0.43, 0.71, 1].map((o) => {
        const sw = el("span", { class: "ak-chart__rampcell" });
        sw.style.opacity = String(o);
        return sw;
      }),
      el("span", { text: t("heatMore") })
    ]);
    ctx.root.appendChild(ramp);
  }
  function renderScatter(ctx, data) {
    const points = (data && Array.isArray(data.points) ? data.points : []).filter((p) => p && typeof p.x === "number" && typeof p.y === "number");
    if (!points.length) return ctx.empty();
    ctx.root.setAttribute("aria-label", (ctx.title ? ctx.title + " — " : "") + points.length + " pts");
    const W4 = 560;
    const H4 = 300;
    const PAD3 = { top: 16, right: 16, bottom: 36, left: 50 };
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const p of points) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    if (xMax === xMin) xMax = xMin + 1;
    if (yMax === yMin) yMax = yMin + 1;
    const xStep = tickStep(xMax - xMin);
    const yStep = tickStep(yMax - yMin);
    xMin = Math.floor(xMin / xStep) * xStep;
    xMax = Math.ceil(xMax / xStep) * xStep;
    yMin = Math.floor(yMin / yStep) * yStep;
    yMax = Math.ceil(yMax / yStep) * yStep;
    const X = (v) => PAD3.left + (W4 - PAD3.left - PAD3.right) * ((v - xMin) / (xMax - xMin));
    const Y = (v) => PAD3.top + (H4 - PAD3.top - PAD3.bottom) * (1 - (v - yMin) / (yMax - yMin));
    const node = svg("svg", { viewBox: `0 0 ${W4} ${H4}`, class: "ak-chart__svg", "aria-hidden": "true" });
    for (let v = yMin; v <= yMax + yStep / 2; v += yStep) {
      node.appendChild(svg("line", { x1: PAD3.left, x2: W4 - PAD3.right, y1: Y(v), y2: Y(v), class: "ak-chart__grid" }));
      const tk = svg("text", { x: PAD3.left - 8, y: Y(v) + 4, class: "ak-chart__tick", "text-anchor": "end" });
      tk.textContent = fmtTick(v);
      node.appendChild(tk);
    }
    for (let v = xMin; v <= xMax + xStep / 2; v += xStep) {
      const tk = svg("text", { x: X(v), y: H4 - PAD3.bottom + 16, class: "ak-chart__tick", "text-anchor": "middle" });
      tk.textContent = fmtTick(v);
      node.appendChild(tk);
    }
    if (points.length >= 3) {
      const n = points.length;
      let sx = 0, sy = 0, sxy = 0, sxx = 0;
      for (const p of points) {
        sx += p.x;
        sy += p.y;
        sxy += p.x * p.y;
        sxx += p.x * p.x;
      }
      const slope = (n * sxy - sx * sy) / Math.max(n * sxx - sx * sx, 1e-9);
      const icept = (sy - slope * sx) / n;
      node.appendChild(svg("line", {
        x1: X(xMin),
        y1: Y(slope * xMin + icept),
        x2: X(xMax),
        y2: Y(slope * xMax + icept),
        class: "ak-chart__trend"
      }));
    }
    const still = ctx.still();
    points.forEach((p, i) => {
      const dot = svg("circle", { cx: X(p.x), cy: Y(p.y), r: 6, class: "ak-chart__point" });
      if (p.label) {
        const cap = svg("title", {});
        cap.textContent = String(p.label);
        dot.appendChild(cap);
      }
      if (!still) {
        dot.classList.add("ak-chart__point--enter");
        dot.style.animationDelay = `${i * 22}ms`;
      }
      node.appendChild(dot);
    });
    ctx.root.appendChild(node);
    if (data.xLabel || data.yLabel) {
      ctx.root.appendChild(el("figcaption", { class: "ak-chart__legend" }, [
        data.xLabel ? el("span", { class: "ak-chart__key", text: `x · ${data.xLabel}` }) : null,
        data.yLabel ? el("span", { class: "ak-chart__key", text: `y · ${data.yLabel}` }) : null
      ]));
    }
  }
  function renderFunnel(ctx, data) {
    const steps2 = (data && Array.isArray(data.steps) ? data.steps : []).filter((s) => s && typeof s.value === "number" && s.value >= 0);
    if (!steps2.length || steps2[0].value <= 0) return ctx.empty();
    ctx.root.setAttribute("aria-label", (ctx.title ? ctx.title + " — " : "") + steps2.map((s) => s.label + " " + s.value).join(", "));
    const W4 = 460;
    const STEP_H = 44;
    const GAP = 7;
    const BAND = 340;
    const CX = 195;
    const H4 = steps2.length * (STEP_H + GAP) - GAP + 8;
    const first = steps2[0].value;
    const node = svg("svg", { viewBox: `0 0 ${W4} ${H4}`, class: "ak-chart__svg", "aria-hidden": "true" });
    const still = ctx.still();
    const half = (v) => Math.max(v / first * BAND, 18) / 2;
    steps2.forEach((s, i) => {
      const y = 4 + i * (STEP_H + GAP);
      const topHalf = half(s.value);
      const nxt = steps2[i + 1];
      const botHalf = nxt ? half(nxt.value) : topHalf;
      const band = svg("path", {
        d: `M${CX - topHalf} ${y} L${CX + topHalf} ${y} L${CX + botHalf} ${y + STEP_H} L${CX - botHalf} ${y + STEP_H} Z`,
        class: "ak-chart__funnelband"
      });
      band.style.fill = SERIES_VARS[i % SERIES_VARS.length];
      if (!still) {
        band.classList.add("ak-chart__band--enter");
        band.style.animationDelay = `${i * 80}ms`;
      }
      node.appendChild(band);
      const name = svg("text", { x: CX, y: y + STEP_H / 2 + 5, class: "ak-chart__funnellabel", "text-anchor": "middle" });
      name.textContent = `${s.label} · ${fmtTick(s.value)}`;
      node.appendChild(name);
      const pct = svg("text", { x: W4 - 10, y: y + STEP_H / 2 + 5, class: "ak-chart__funnelpct", "text-anchor": "end" });
      pct.textContent = Math.round(s.value / first * 100) + " %";
      node.appendChild(pct);
    });
    ctx.root.appendChild(node);
  }
  function squarify(items, x, y, w, h) {
    const out = [];
    let rest = items.slice();
    while (rest.length) {
      const along = Math.min(w, h);
      let row = [rest[0]];
      let sum = rest[0].v;
      const total = rest.reduce((a, b) => a + b.v, 0);
      const worst = (r, s) => {
        const side2 = s / total * (w * h) / along;
        let bad = 0;
        for (const it of r) {
          const other = it.v / s * along;
          bad = Math.max(bad, side2 / other, other / side2);
        }
        return bad;
      };
      while (rest.length > row.length) {
        const cand = rest[row.length];
        if (worst(row.concat(cand), sum + cand.v) <= worst(row, sum)) {
          row.push(cand);
          sum += cand.v;
        } else break;
      }
      const side = sum / total * (w * h) / along;
      let run = 0;
      for (const it of row) {
        const span = it.v / sum * along;
        out.push(w <= h ? { it, x: x + run, y, w: span, h: side } : { it, x, y: y + run, w: side, h: span });
        run += span;
      }
      if (w <= h) {
        y += side;
        h -= side;
      } else {
        x += side;
        w -= side;
      }
      rest = rest.slice(row.length);
    }
    return out;
  }
  function renderTreemap(ctx, data) {
    const items = (data && Array.isArray(data.items) ? data.items : []).filter((s) => s && typeof s.value === "number" && s.value > 0).sort((a, b) => b.value - a.value);
    if (!items.length) return ctx.empty();
    ctx.root.setAttribute("aria-label", (ctx.title ? ctx.title + " — " : "") + items.map((s) => s.label + " " + s.value).join(", "));
    const W4 = 560;
    const H4 = 320;
    const node = svg("svg", { viewBox: `0 0 ${W4} ${H4}`, class: "ak-chart__svg", "aria-hidden": "true" });
    const cells = squarify(items.map((s, i) => ({ v: s.value, s, i })), 2, 2, W4 - 4, H4 - 4);
    const still = ctx.still();
    cells.forEach((c, n) => {
      const G = 2.5;
      const rect = svg("rect", {
        x: c.x + G,
        y: c.y + G,
        width: Math.max(c.w - G * 2, 1),
        height: Math.max(c.h - G * 2, 1),
        rx: 6,
        class: "ak-chart__cell"
      });
      rect.style.fill = SERIES_VARS[c.it.i % SERIES_VARS.length];
      const cap = svg("title", {});
      cap.textContent = `${c.it.s.label} · ${fmtTick(c.it.s.value)}`;
      rect.appendChild(cap);
      if (!still) {
        rect.classList.add("ak-chart__band--enter");
        rect.style.animationDelay = `${n * 45}ms`;
      }
      node.appendChild(rect);
      if (c.w > 86 && c.h > 44) {
        const name = svg("text", { x: c.x + 12, y: c.y + 24, class: "ak-chart__cellname" });
        name.textContent = String(c.it.s.label);
        node.appendChild(name);
        const val = svg("text", { x: c.x + 12, y: c.y + 42, class: "ak-chart__cellvalue" });
        val.textContent = fmtTick(c.it.s.value);
        node.appendChild(val);
      }
    });
    ctx.root.appendChild(node);
  }
  function renderFlow(ctx, data) {
    const nodes = (data && Array.isArray(data.nodes) ? data.nodes : []).filter((n) => n && n.id);
    const links = (data && Array.isArray(data.links) ? data.links : []).filter((l) => l && l.from && l.to && typeof l.value === "number" && l.value > 0);
    if (!nodes.length || !links.length) return ctx.empty();
    const byId = new Map(nodes.map((n) => [n.id, { n, in: 0, out: 0, depth: 0 }]));
    for (const l of links) {
      const a = byId.get(l.from);
      const b = byId.get(l.to);
      if (!a || !b) continue;
      a.out += l.value;
      b.in += l.value;
    }
    for (let pass = 0; pass < nodes.length; pass++) {
      let moved = false;
      for (const l of links) {
        const a = byId.get(l.from);
        const b = byId.get(l.to);
        if (a && b && b.depth < a.depth + 1 && a.depth + 1 < nodes.length) {
          b.depth = a.depth + 1;
          moved = true;
        }
      }
      if (!moved) break;
    }
    const maxDepth = Math.max(...[...byId.values()].map((m) => m.depth));
    ctx.root.setAttribute("aria-label", (ctx.title ? ctx.title + " — " : "") + nodes.map((n) => n.label || n.id).join(", "));
    const W4 = 560;
    const H4 = 320;
    const NODE_W = 12;
    const PAD_Y = 10;
    const cols = [];
    for (const m of byId.values()) (cols[m.depth] = cols[m.depth] || []).push(m);
    const scale = (H4 - PAD_Y * 2 - 8 * Math.max(...cols.map((c) => (c || []).length - 1), 0)) / Math.max(...cols.map((c) => (c || []).reduce((a, m) => a + Math.max(m.in, m.out), 0)), 1e-9);
    const colX = (d) => 8 + (maxDepth ? (W4 - NODE_W - 16) * (d / maxDepth) : 0);
    const node = svg("svg", { viewBox: `0 0 ${W4} ${H4}`, class: "ak-chart__svg", "aria-hidden": "true" });
    let colourIdx = 0;
    for (const col of cols) {
      if (!col) continue;
      col.sort((a, b) => Math.max(b.in, b.out) - Math.max(a.in, a.out));
      let y = PAD_Y;
      for (const m of col) {
        m.h = Math.max(Math.max(m.in, m.out) * scale, 4);
        m.x = colX(m.depth);
        m.y = y;
        m.colour = SERIES_VARS[colourIdx++ % SERIES_VARS.length];
        m.spentOut = 0;
        m.spentIn = 0;
        y += m.h + 8;
      }
    }
    for (const l of links) {
      const a = byId.get(l.from);
      const b = byId.get(l.to);
      if (!a || !b) continue;
      const th = l.value * scale;
      const y1 = a.y + a.spentOut + th / 2;
      const y2 = b.y + b.spentIn + th / 2;
      a.spentOut += th;
      b.spentIn += th;
      const x1 = a.x + NODE_W;
      const x2 = b.x;
      const mid = (x1 + x2) / 2;
      const ribbon = svg("path", {
        d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`,
        class: "ak-chart__ribbon",
        "stroke-width": Math.max(th, 1.5)
      });
      ribbon.style.stroke = a.colour;
      node.appendChild(ribbon);
    }
    for (const m of byId.values()) {
      const bar = svg("rect", { x: m.x, y: m.y, width: NODE_W, height: m.h, rx: 4, class: "ak-chart__flownode" });
      bar.style.fill = m.colour;
      node.appendChild(bar);
      const last = m.depth === maxDepth;
      const name = svg("text", {
        x: last ? m.x - 6 : m.x + NODE_W + 6,
        y: m.y + Math.min(m.h / 2 + 4, m.h + 2),
        class: "ak-chart__flowlabel",
        "text-anchor": last ? "end" : "start"
      });
      name.textContent = `${m.n.label || m.n.id} · ${fmtTick(Math.max(m.in, m.out))}`;
      node.appendChild(name);
    }
    ctx.root.appendChild(node);
  }
  function renderRadar(ctx, data) {
    const axes = (data && Array.isArray(data.axes) ? data.axes : []).slice(0, 10);
    const series = (data && Array.isArray(data.series) ? data.series : []).filter((s) => s && Array.isArray(s.values) && s.values.length).slice(0, 4);
    if (axes.length < 3 || !series.length) return ctx.empty();
    const max = typeof data.max === "number" && data.max > 0 ? data.max : series.reduce((m, s) => s.values.reduce((m2, v) => Math.max(m2, Number(v) || 0), m), 0) || 1;
    ctx.root.setAttribute("aria-label", (ctx.title ? ctx.title + " — " : "") + series.map((s) => s.label).join(", "));
    const W4 = 460;
    const H4 = 340;
    const CX = W4 / 2;
    const CY = H4 / 2 + 4;
    const R = 118;
    const angle = (i) => -Math.PI / 2 + 2 * Math.PI * i / axes.length;
    const at = (i, r) => `${(CX + Math.cos(angle(i)) * r).toFixed(1)} ${(CY + Math.sin(angle(i)) * r).toFixed(1)}`;
    const node = svg("svg", { viewBox: `0 0 ${W4} ${H4}`, class: "ak-chart__svg", "aria-hidden": "true" });
    for (const frac of [0.25, 0.5, 0.75, 1]) {
      node.appendChild(svg("polygon", {
        points: axes.map((a, i) => at(i, R * frac)).join(" "),
        class: "ak-chart__radarring"
      }));
    }
    axes.forEach((label, i) => {
      node.appendChild(svg("line", {
        x1: CX,
        y1: CY,
        x2: CX + Math.cos(angle(i)) * R,
        y2: CY + Math.sin(angle(i)) * R,
        class: "ak-chart__radarspoke"
      }));
      const lx = CX + Math.cos(angle(i)) * (R + 16);
      const ly = CY + Math.sin(angle(i)) * (R + 16);
      const cap = svg("text", {
        x: lx.toFixed(1),
        y: (ly + 4).toFixed(1),
        class: "ak-chart__tick",
        "text-anchor": Math.abs(Math.cos(angle(i))) < 0.3 ? "middle" : Math.cos(angle(i)) > 0 ? "start" : "end"
      });
      cap.textContent = String(label);
      node.appendChild(cap);
    });
    const still = ctx.still();
    series.forEach((s, si) => {
      const points = axes.map((a, i) => at(i, R * Math.min(Math.max((Number(s.values[i]) || 0) / max, 0), 1))).join(" ");
      const shape = svg("polygon", { points, class: "ak-chart__radarshape" });
      shape.style.fill = SERIES_VARS[si % SERIES_VARS.length];
      shape.style.stroke = SERIES_VARS[si % SERIES_VARS.length];
      if (!still) {
        shape.classList.add("ak-chart__band--enter");
        shape.style.animationDelay = `${si * 120}ms`;
      }
      node.appendChild(shape);
    });
    ctx.root.appendChild(node);
    const legend = el(
      "figcaption",
      { class: "ak-chart__legend" },
      series.map((s) => el("span", { class: "ak-chart__key" }, [
        el("span", { class: "ak-chart__swatch" }),
        el("span", { text: String(s.label) })
      ]))
    );
    series.forEach((s, i) => {
      const sw = legend.children[i] && legend.children[i].firstChild;
      if (sw) sw.style.background = SERIES_VARS[i % SERIES_VARS.length];
    });
    ctx.root.appendChild(legend);
  }

  // src/static/sdk-libs/atelier/chart.js
  var W = 560;
  var H = 300;
  var PAD = { top: 16, right: 14, bottom: 34, left: 46 };
  function chart(spec) {
    const kind = ["donut", "calendar", "scatter", "funnel", "treemap", "flow", "radar"].indexOf(spec.kind) >= 0 ? spec.kind : "axes";
    const root = el("figure", {
      class: "ak-root ak-chart" + (spec.presentation === "mural" ? " ak-chart--mural" : ""),
      role: "img"
    });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    const ctx = {
      root,
      still: () => reducedMotion(),
      empty: () => {
        const e = spec.empty || {};
        emptyCard = emptyState({ target: root, tone: "quiet", title: e.title || t("empty"), hint: e.hint || t("emptyHint") });
      },
      title: spec.title
    };
    function render(data) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      if (kind === "donut") return renderDonut(ctx, data);
      if (kind === "calendar") return renderCalendar(ctx, data);
      if (kind === "scatter") return renderScatter(ctx, data);
      if (kind === "funnel") return renderFunnel(ctx, data);
      if (kind === "treemap") return renderTreemap(ctx, data);
      if (kind === "flow") return renderFlow(ctx, data);
      if (kind === "radar") return renderRadar(ctx, data);
      renderAxes(data);
    }
    function renderAxes(data) {
      const labels = data && Array.isArray(data.labels) ? data.labels : [];
      const series = (data && Array.isArray(data.series) ? data.series : []).filter((s) => s && Array.isArray(s.values) && s.values.length > 0);
      if (!labels.length || !series.length) return ctx.empty();
      const stacked = !!data.stacked;
      const horizontal = !!data.horizontal;
      root.setAttribute("aria-label", (spec.title ? spec.title + " — " : "") + series.map((s) => s.label).join(", "));
      const bars = series.filter((s) => (s.kind || "bar") === "bar");
      const lines = series.filter((s) => s.kind === "line" || s.kind === "area");
      let min = 0;
      let max = 0;
      if (stacked && bars.length) {
        for (let i = 0; i < labels.length; i++) {
          let up = 0;
          let down = 0;
          for (const s of bars) {
            const v = s.values[i] || 0;
            if (v >= 0) up += v;
            else down += v;
          }
          if (up > max) max = up;
          if (down < min) min = down;
        }
        for (const s of lines) for (const v of s.values) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      } else {
        for (const s of series) for (const v of s.values) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (max === min) max = min + 1;
      const step = tickStep(max - min);
      min = Math.floor(min / step) * step;
      max = Math.ceil(max / step) * step;
      const width = horizontal ? H : W;
      const height = horizontal ? W : H;
      const pad = horizontal ? { top: 14, right: 20, bottom: 16, left: 86 } : PAD;
      const innerAlong = horizontal ? height - pad.top - pad.bottom : width - pad.left - pad.right;
      const innerCross = horizontal ? width - pad.left - pad.right : height - pad.top - pad.bottom;
      const along = (i) => (horizontal ? pad.top : pad.left) + innerAlong * i / labels.length;
      const slot = innerAlong / labels.length;
      const cross = (v) => horizontal ? pad.left + innerCross * ((v - min) / (max - min)) : pad.top + innerCross * (1 - (v - min) / (max - min));
      const node = svg("svg", { viewBox: `0 0 ${horizontal ? width : W} ${horizontal ? height : H}`, class: "ak-chart__svg", "aria-hidden": "true" });
      const defs = defsFor(node, series.length);
      for (let v = min; v <= max + step / 2; v += step) {
        const g = cross(v);
        node.appendChild(horizontal ? svg("line", { x1: g, x2: g, y1: pad.top, y2: height - pad.bottom, class: v === 0 ? "ak-chart__zero" : "ak-chart__grid" }) : svg("line", { x1: pad.left, x2: width - pad.right, y1: g, y2: g, class: v === 0 ? "ak-chart__zero" : "ak-chart__grid" }));
        const tick = horizontal ? svg("text", { x: g, y: height - pad.bottom + 14, class: "ak-chart__tick", "text-anchor": "middle" }) : svg("text", { x: pad.left - 8, y: g + 4, class: "ak-chart__tick", "text-anchor": "end" });
        tick.textContent = fmtTick(v);
        node.appendChild(tick);
      }
      labels.forEach((label, i) => {
        const tx = horizontal ? svg("text", { x: pad.left - 10, y: along(i) + slot / 2 + 4, class: "ak-chart__tick", "text-anchor": "end" }) : svg("text", { x: along(i) + slot / 2, y: height - pad.bottom + 18, class: "ak-chart__tick", "text-anchor": "middle" });
        tx.textContent = String(label);
        node.appendChild(tx);
      });
      const still = ctx.still();
      for (const s of series) {
        if (s.kind !== "area" || horizontal) continue;
        const si = series.indexOf(s);
        const pts = s.values.slice(0, labels.length).map((v, i) => ({ x: along(i) + slot / 2, y: cross(v) }));
        const path = smoothPath(pts) + ` L ${pts[pts.length - 1].x} ${cross(0)} L ${pts[0].x} ${cross(0)} Z`;
        node.appendChild(svg("path", { d: path, class: "ak-chart__area", fill: defs.fade(si) }));
      }
      const groupPad = slot * 0.16;
      const radius = Math.min(7, Math.max(3, (slot - groupPad * 2) / (stacked ? 1 : Math.max(bars.length, 1)) * 0.28));
      if (stacked) {
        const stackW = Math.max(slot - groupPad * 2, 2);
        for (let i = 0; i < labels.length; i++) {
          let acc = 0;
          bars.forEach((s, bi) => {
            const v = s.values[i] || 0;
            if (!v) return;
            const from = cross(acc);
            const to = cross(acc + v);
            acc += v;
            const topMost = bi === bars.length - 1;
            const rect = barRect(along(i) + groupPad, from, to, stackW, topMost ? radius : 0);
            rect.setAttribute("style", `fill:${SERIES_VARS[series.indexOf(s) % SERIES_VARS.length]}`);
            decorateBar(rect, i);
            node.appendChild(rect);
            if (topMost) node.appendChild(sheenOver(rect));
          });
        }
      } else {
        const barW = bars.length ? (slot - groupPad * 2) / bars.length : 0;
        bars.forEach((s, bi) => {
          const colour = SERIES_VARS[series.indexOf(s) % SERIES_VARS.length];
          s.values.slice(0, labels.length).forEach((v, i) => {
            const rect = barRect(along(i) + groupPad + bi * barW + 1, cross(0), cross(v), Math.max(barW - 2, 1), radius);
            rect.setAttribute("style", `fill:${colour}`);
            decorateBar(rect, i);
            node.appendChild(rect);
            node.appendChild(sheenOver(rect));
          });
        });
      }
      function barRect(alongPos, fromCross, toCross, thickness, r) {
        const lo = Math.min(fromCross, toCross);
        const span = Math.max(Math.abs(toCross - fromCross), 0.5);
        return horizontal ? svg("rect", { x: lo, y: alongPos, width: span, height: thickness, rx: r, class: "ak-chart__bar" }) : svg("rect", { x: alongPos, y: lo, width: thickness, height: span, rx: r, class: "ak-chart__bar" });
      }
      function sheenOver(rect) {
        const s = (
          /** @type {SVGRectElement} */
          rect.cloneNode(false)
        );
        s.setAttribute("style", `fill:${defs.sheen}`);
        s.setAttribute("class", "ak-chart__sheen");
        return s;
      }
      function decorateBar(rect, i) {
        if (!still) {
          rect.classList.add("ak-chart__bar--enter");
          rect.style.transformOrigin = horizontal ? `${cross(0)}px center` : `center ${cross(0)}px`;
          rect.style.animationDelay = `${i * 36}ms`;
        }
      }
      for (const s of lines) {
        if (horizontal) continue;
        const colour = SERIES_VARS[series.indexOf(s) % SERIES_VARS.length];
        const pts = s.values.slice(0, labels.length).map((v, i) => ({ x: along(i) + slot / 2, y: cross(v) }));
        const line = svg("path", { d: smoothPath(pts), class: "ak-chart__line", style: `stroke:${colour}` });
        if (!still) line.classList.add("ak-chart__line--enter");
        node.appendChild(line);
        const last = pts[pts.length - 1];
        node.appendChild(svg("circle", { cx: last.x, cy: last.y, r: 5, class: "ak-chart__dot", style: `stroke:${colour}` }));
      }
      root.appendChild(node);
      legendFor(series);
      if (!horizontal) wireTooltip(node, labels, series, along, slot);
      if (data.note && !horizontal) noteBubble(node, data.note, labels, along, slot);
      if (!still) {
        for (const line of node.querySelectorAll(".ak-chart__line--enter")) {
          const len = (
            /** @type {SVGPathElement} */
            line.getTotalLength()
          );
          line.setAttribute("stroke-dasharray", String(len));
          line.setAttribute("stroke-dashoffset", String(len));
          requestAnimationFrame(() => line.classList.add("ak-chart__line--drawn"));
        }
      }
    }
    function legendFor(series) {
      const legend = el(
        "figcaption",
        { class: "ak-chart__legend" },
        series.map((s) => el("span", { class: "ak-chart__key" }, [
          el("span", { class: "ak-chart__swatch" + (s.kind === "line" || s.kind === "area" ? " ak-chart__swatch--line" : "") }),
          el("span", { text: s.label })
        ]))
      );
      series.forEach((s, i) => {
        const sw = legend.children[i] && legend.children[i].firstChild;
        if (sw) sw.style.background = SERIES_VARS[i % SERIES_VARS.length];
      });
      root.appendChild(legend);
    }
    function wireTooltip(node, labels, series, along, slot) {
      const tip = el("div", { class: "ak-chart__tip", hidden: true });
      root.appendChild(tip);
      node.addEventListener("pointermove", (ev) => {
        const box = node.getBoundingClientRect();
        const sx = (ev.clientX - box.left) * (W / box.width);
        const i = Math.max(0, Math.min(labels.length - 1, Math.floor((sx - along(0)) / slot)));
        clear(tip);
        tip.appendChild(el("div", { class: "ak-chart__tip-label", text: String(labels[i]) }));
        series.forEach((s, si) => {
          const row = el("div", { class: "ak-chart__tip-row" }, [
            el("span", { class: "ak-chart__tip-swatch" }),
            el("span", { text: s.label }),
            el("b", { text: fmtTick(s.values[i] ?? 0) })
          ]);
          row.firstChild.style.background = SERIES_VARS[si % SERIES_VARS.length];
          tip.appendChild(row);
        });
        tip.hidden = false;
        const rootBox = root.getBoundingClientRect();
        const px = (along(i) + slot / 2) / W * box.width + (box.left - rootBox.left);
        tip.style.left = `${Math.max(8, Math.min(rootBox.width - tip.offsetWidth - 8, px - tip.offsetWidth / 2))}px`;
        tip.style.top = `${box.top - rootBox.top + 6}px`;
      });
      node.addEventListener("pointerleave", () => {
        tip.hidden = true;
      });
    }
    function noteBubble(node, note, labels, along, slot) {
      const i = labels.indexOf(note.label);
      if (i < 0 || !note.text) return;
      const bubble = el("div", { class: "ak-chart__note" }, [
        el("span", { class: "ak-chart__note-label", text: String(note.label) }),
        el("span", { text: String(note.text) })
      ]);
      root.appendChild(bubble);
      requestAnimationFrame(() => {
        const box = node.getBoundingClientRect();
        const rootBox = root.getBoundingClientRect();
        const px = (along(i) + slot / 2) / W * box.width + (box.left - rootBox.left);
        bubble.style.left = `${Math.max(8, Math.min(rootBox.width - bubble.offsetWidth - 8, px - bubble.offsetWidth / 2))}px`;
        bubble.style.top = `${box.top - rootBox.top + 4}px`;
      });
    }
    render(spec.data);
    return {
      el: root,
      /** @param {{ data: object|null }} patch */
      set(patch) {
        if (!patch) return;
        render(patch.data);
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/atelier/matrix.js
  var TONES2 = ["ok", "warn", "err", "accent", "plain"];
  function matrix(spec) {
    const root = el("div", { class: "ak-root ak-matrix" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    function render(data) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      const cols = data && Array.isArray(data.cols) ? data.cols : [];
      const rows = data && Array.isArray(data.rows) ? data.rows : [];
      if (!cols.length || !rows.length) {
        const e = spec.empty || {};
        emptyCard = emptyState({ target: root, tone: "quiet", title: e.title || t("empty"), hint: e.hint || t("emptyHint") });
        return;
      }
      const table2 = el("table", { class: "ak-matrix__table" });
      const head = el("tr", {}, [el("th", { class: "ak-matrix__corner", scope: "col" })]);
      for (const col of cols) {
        head.appendChild(el("th", { class: "ak-matrix__col", scope: "col", text: col.label }));
      }
      table2.appendChild(el("thead", {}, [head]));
      const body = el("tbody", {});
      for (const row of rows) {
        const cellsByCol = new Map((row.cells || []).map((c) => [c.col, c]));
        const tr = el("tr", {
          class: "ak-matrix__row",
          ...spec.onPick ? { tabindex: "0", role: "button" } : {}
        });
        const label = el("th", { class: "ak-matrix__label", scope: "row" }, [
          el("span", { text: row.label }),
          row.badge != null ? el("span", { class: "ak-badge ak-matrix__badge" + (row.tone ? " ak-matrix__cell--" + row.tone : ""), text: row.badge }) : null
        ]);
        tr.appendChild(label);
        for (const col of cols) {
          const cell = cellsByCol.get(col.id);
          const tone = cell && TONES2.includes(cell.tone || "") ? cell.tone : cell ? "plain" : null;
          tr.appendChild(el("td", { class: "ak-matrix__cell" }, [
            tone === null ? null : el("span", {
              class: "ak-matrix__chip ak-matrix__cell--" + tone,
              text: cell && cell.label != null ? cell.label : "●",
              ...cell && cell.label == null ? { "aria-label": tone } : {}
            })
          ]));
        }
        if (spec.onPick) {
          const pick = () => spec.onPick(row);
          tr.addEventListener("click", pick);
          tr.addEventListener("keydown", (ev) => {
            if (
              /** @type {KeyboardEvent} */
              ev.key === "Enter" || /** @type {KeyboardEvent} */
              ev.key === " "
            ) {
              ev.preventDefault();
              pick();
            }
          });
        }
        body.appendChild(tr);
      }
      table2.appendChild(body);
      root.appendChild(el("div", { class: "ak-matrix__scroll" }, [table2]));
      enter(root);
    }
    render(spec.data);
    return {
      el: root,
      /** @param {{ data: MatrixData|null }} patch */
      set(patch) {
        if (!patch) return;
        render(patch.data);
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/atelier/graph.js
  var W2 = 720;
  var H2 = 420;
  var PAD2 = 46;
  var SVG_NS2 = "http://www.w3.org/2000/svg";
  function svg2(name, attrs) {
    const node = document.createElementNS(SVG_NS2, name);
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
    return node;
  }
  function place(nodes) {
    const out = /* @__PURE__ */ new Map();
    const ringed = nodes.filter((n) => typeof n.x !== "number" || typeof n.y !== "number");
    let ringIndex = 0;
    for (const node of nodes) {
      if (typeof node.x === "number" && typeof node.y === "number") {
        out.set(node.id, {
          x: PAD2 + Math.min(Math.max(node.x, 0), 100) / 100 * (W2 - PAD2 * 2),
          y: PAD2 + Math.min(Math.max(node.y, 0), 100) / 100 * (H2 - PAD2 * 2)
        });
      } else {
        const angle = 2 * Math.PI * ringIndex / Math.max(ringed.length, 1) - Math.PI / 2;
        out.set(node.id, {
          x: W2 / 2 + Math.cos(angle) * (W2 / 2 - PAD2 * 1.6),
          y: H2 / 2 + Math.sin(angle) * (H2 / 2 - PAD2 * 1.4)
        });
        ringIndex++;
      }
    }
    return out;
  }
  function graph(spec) {
    const root = el("figure", { class: "ak-root ak-graph", role: "img" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    function render(data) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      const nodes = data && Array.isArray(data.nodes) ? data.nodes.filter((n) => n && n.id) : [];
      const edges = data && Array.isArray(data.edges) ? data.edges : [];
      if (!nodes.length) {
        const e = spec.empty || {};
        emptyCard = emptyState({ target: root, tone: "quiet", title: e.title || t("empty"), hint: e.hint || t("emptyHint") });
        return;
      }
      root.setAttribute("aria-label", (spec.title ? spec.title + " — " : "") + nodes.map((n) => n.label).join(", "));
      const at = place(nodes);
      const node = svg2("svg", { viewBox: `0 0 ${W2} ${H2}`, class: "ak-graph__svg", "aria-hidden": "true" });
      for (const edge of edges) {
        const a = at.get(edge.from);
        const b = at.get(edge.to);
        if (!a || !b) continue;
        node.appendChild(svg2("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "ak-graph__edge" }));
        if (edge.label) {
          const text = svg2("text", {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2 - 5,
            class: "ak-graph__edgelabel",
            "text-anchor": "middle"
          });
          text.textContent = edge.label;
          node.appendChild(text);
        }
      }
      for (const item of nodes) {
        const p = at.get(item.id);
        const width = Math.min(Math.max(item.label.length * 7.6 + 26, 60), 190);
        const g = svg2("g", { class: "ak-graph__node ak-graph__node--" + (item.tone || "plain"), transform: `translate(${p.x}, ${p.y})` });
        g.appendChild(svg2("rect", { x: -width / 2, y: -17, width, height: 34, rx: 17, class: "ak-graph__pill" }));
        const label = svg2("text", { x: 0, y: 5, class: "ak-graph__label", "text-anchor": "middle" });
        label.textContent = item.label.length > 24 ? item.label.slice(0, 23) + "…" : item.label;
        g.appendChild(label);
        if (spec.onPick) {
          g.setAttribute("role", "button");
          g.setAttribute("tabindex", "0");
          g.addEventListener("click", () => spec.onPick(item));
          g.addEventListener("keydown", (ev) => {
            if (
              /** @type {KeyboardEvent} */
              ev.key === "Enter"
            ) spec.onPick(item);
          });
        }
        node.appendChild(g);
      }
      root.appendChild(node);
      enter(root);
    }
    render(spec.data);
    return {
      el: root,
      /** @param {{ data: GraphData|null }} patch */
      set(patch) {
        if (!patch) return;
        render(patch.data);
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/atelier/waveform.js
  var W3 = 720;
  var H3 = 120;
  var SVG_NS3 = "http://www.w3.org/2000/svg";
  function svg3(name, attrs) {
    const node = document.createElementNS(SVG_NS3, name);
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
    return node;
  }
  function waveform(spec) {
    const root = el("figure", { class: "ak-root ak-waveform", role: "img" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    function render(data) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      const values = data && Array.isArray(data.values) ? data.values.filter((v) => typeof v === "number" && Number.isFinite(v)).map((v) => Math.max(v, 0)) : [];
      if (!values.length) {
        const e = spec.empty || {};
        emptyCard = emptyState({ target: root, tone: "quiet", title: e.title || t("empty"), hint: e.hint || t("emptyHint") });
        return;
      }
      root.setAttribute("aria-label", spec.title || t("empty"));
      const max = data && typeof data.max === "number" && data.max > 0 ? data.max : Math.max(...values, 1e-4);
      const node = svg3("svg", { viewBox: `0 0 ${W3} ${H3}`, class: "ak-waveform__svg", "aria-hidden": "true", preserveAspectRatio: "none" });
      const slot = W3 / values.length;
      const barW = Math.max(Math.min(slot * 0.62, 14), 1.5);
      values.forEach((v, i) => {
        const half = Math.max(Math.min(v / max, 1) * (H3 - 8) / 2, 1.2);
        const strength = Math.round(Math.min(v / max, 1) * 100);
        node.appendChild(svg3("rect", {
          x: i * slot + (slot - barW) / 2,
          y: H3 / 2 - half,
          width: barW,
          height: half * 2,
          rx: barW / 2,
          class: "ak-waveform__bar",
          style: `fill: color-mix(in oklab, var(--ak-accent) ${strength}%, var(--ak-ink-dim))`
        }));
      });
      root.appendChild(node);
    }
    render(spec.data);
    return {
      el: root,
      /** @param {{ data: { values: number[], max?: number }|null }} patch */
      set(patch) {
        if (!patch) return;
        render(patch.data);
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
    if (typeof self !== "undefined" && typeof self.origin === "string" && self.origin.indexOf("http") === 0) {
      return self.origin;
    }
    return cfg().baseUrl;
  }
  var NODE_URL = resolveNodeUrl();
  var APEX_URL = cfg().baseUrl;
  var NODE_ID = cfg().nodeId;
  var HEARTBEAT_MS = cfg().heartbeatMs || 3e4;

  // src/static/sdk-libs/atelier/scene3d.js
  var threePromise = null;
  function ensureThree() {
    if (window.THREE && window.THREE.Addons) return Promise.resolve(window.THREE);
    if (threePromise) return threePromise;
    threePromise = new Promise(function(ok, fail) {
      const s = document.createElement("script");
      s.src = NODE_URL + "/lib/three-world@1.min.js";
      s.onload = function() {
        ok(window.THREE);
      };
      s.onerror = function() {
        threePromise = null;
        fail(new Error("three-world failed to load"));
      };
      document.head.appendChild(s);
    });
    return threePromise;
  }
  var loadersPromise = null;
  function ensureLoaders() {
    return ensureThree().then(function(THREE) {
      if (THREE.Addons.GLTFLoader) return THREE;
      if (loadersPromise) return loadersPromise;
      loadersPromise = new Promise(function(ok, fail) {
        const s = document.createElement("script");
        s.src = NODE_URL + "/lib/three-world-loaders@1.min.js";
        s.onload = function() {
          ok(THREE);
        };
        s.onerror = function() {
          loadersPromise = null;
          fail(new Error("three-world-loaders failed to load"));
        };
        document.head.appendChild(s);
      });
      return loadersPromise;
    });
  }
  var colorCtx = null;
  function tokenColor(node, name, fallbackName) {
    const probe = document.createElement("span");
    probe.style.display = "none";
    probe.style.color = fallbackName ? "var(" + name + ", var(" + fallbackName + ", currentColor))" : "var(" + name + ", currentColor)";
    node.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    if (!colorCtx) colorCtx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    colorCtx.fillStyle = resolved;
    colorCtx.fillRect(0, 0, 1, 1);
    const px = colorCtx.getImageData(0, 0, 1, 1).data;
    return "rgb(" + px[0] + "," + px[1] + "," + px[2] + ")";
  }
  function easeOut(x) {
    return 1 - Math.pow(1 - x, 3);
  }
  function scene3d(spec) {
    const kind = ["sky", "bars", "model", "globe"].indexOf(spec.kind) >= 0 ? spec.kind : "orb";
    const root = el("figure", { class: "ak-root ak-scene", "data-ak-scene": kind });
    if (spec.target) resolve(spec.target).appendChild(root);
    if (spec.title) root.appendChild(el("figcaption", { class: "ak-scene__title" }, spec.title));
    const stage = el("div", { class: "ak-scene__stage" });
    root.appendChild(stage);
    const wait = skeleton({ target: stage, rows: 2 });
    let destroyed = false;
    let world = null;
    (kind === "model" ? ensureLoaders() : ensureThree()).then(function(THREE) {
      if (destroyed) return;
      wait.destroy();
      world = buildWorld(THREE, stage, kind, spec, root);
      world.rebuild(spec.data || null);
    }).catch(function() {
      if (destroyed) return;
      wait.destroy();
      emptyState({
        target: stage,
        title: spec.empty && spec.empty.title || "3D is resting",
        hint: spec.empty && spec.empty.hint || "The scene library could not load here."
      });
    });
    return {
      el: root,
      set: function(patch) {
        if (world && patch && "data" in patch) world.rebuild(patch.data || null);
      },
      destroy: function() {
        destroyed = true;
        if (world) world.dispose();
        root.remove();
      }
    };
  }
  function buildWorld(THREE, stage, kind, spec, root) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    stage.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    const controls = new THREE.Addons.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !reducedMotion();
    controls.enablePan = false;
    controls.enableZoom = kind === "bars" || kind === "model" || kind === "globe";
    if (kind === "sky") {
      controls.enableZoom = false;
      controls.rotateSpeed = -0.35;
    }
    if (kind === "model") {
      renderer.toneMappingExposure = 1.15;
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new THREE.Addons.RoomEnvironment(), 0.04).texture;
      const inkC = new THREE.Color(tokenColor(root, "--ak-ink"));
      const bgC = new THREE.Color(tokenColor(root, "--ak-bg"));
      const luma = (c) => c.r + c.g + c.b;
      scene.background = luma(inkC) < luma(bgC) ? inkC : bgC;
    }
    let raf = 0;
    let entranceUntil = 0;
    let settleUntil = 0;
    let disposed = false;
    const clock = { start: 0 };
    function frame(now) {
      raf = 0;
      if (disposed) return;
      const entering = now < entranceUntil;
      if (entering) {
        const p = easeOut(Math.min(1, (now - clock.start) / (entranceUntil - clock.start)));
        applyEntrance(p);
      }
      controls.update();
      renderer.render(scene, camera);
      if (entering || now < settleUntil) raf = requestAnimationFrame(frame);
    }
    function wake(settleMs) {
      settleUntil = Math.max(settleUntil, performance.now() + (settleMs || 0));
      if (!raf) raf = requestAnimationFrame(frame);
    }
    controls.addEventListener("start", function() {
      wake(60 * 1e3);
    });
    controls.addEventListener("end", function() {
      settleUntil = performance.now() + (controls.enableDamping ? 1600 : 0);
    });
    const ro = new ResizeObserver(function() {
      const w = stage.clientWidth || 1;
      const h = stage.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      wake(0);
    });
    ro.observe(stage);
    let group = new THREE.Group();
    scene.add(group);
    let applyEntrance = function() {
    };
    function disposeGroup() {
      group.traverse(function(o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(function(m) {
            m.dispose();
          });
        }
      });
      scene.remove(group);
      group = new THREE.Group();
      scene.add(group);
    }
    function frameCamera(cols) {
      if (kind === "model") {
        camera.position.set(2.6, 1.7, 4.6);
        controls.target.set(0, 1.1, 0);
        controls.update();
        return;
      }
      if (kind === "globe") {
        camera.position.set(0, 2.4, 8.4);
        controls.target.set(0, 0, 0);
      } else if (kind === "sky") {
        camera.position.set(0, 2, 0.5);
        controls.target.set(0, 16, -22);
      } else if (kind === "bars") {
        camera.position.set(cols * 2.2, cols * 2, cols * 3.2);
        controls.target.set(0, 1.4, 0);
      } else {
        camera.position.set(0, 1.2, 11.5);
        controls.target.set(0, 0, 0);
      }
      controls.update();
    }
    function rebuild(data) {
      disposeGroup();
      const accent = tokenColor(root, "--ak-accent");
      const ink = tokenColor(root, "--ak-ink");
      const surface = tokenColor(root, "--ak-surface-2", "--ak-surface");
      scene.fog = null;
      let barCols = 3;
      if (kind === "model") {
        const url = data && data.url ? String(data.url) : "";
        if (!url) {
          applyEntrance = function() {
          };
          wake(0);
          return;
        }
        const shimmer = skeleton({ target: stage, rows: 2 });
        new THREE.Addons.GLTFLoader().load(url, function(gltf) {
          shimmer.destroy();
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const centre = box.getCenter(new THREE.Vector3());
          const scale = 2.6 / Math.max(size.x, size.y, size.z, 1e-6);
          model.scale.setScalar(scale);
          model.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
          group.add(model);
          const c = document.createElement("canvas");
          c.width = c.height = 128;
          const g2 = c.getContext("2d");
          const grad = g2.createRadialGradient(64, 64, 8, 64, 64, 64);
          const channels = function(s) {
            return (s.match(/\d+/g) || ["0", "0", "0"]).map(Number);
          };
          const inkCh = channels(ink);
          const surfCh = channels(surface);
          const shadow = (inkCh[0] + inkCh[1] + inkCh[2] <= surfCh[0] + surfCh[1] + surfCh[2] ? inkCh : surfCh).map(function(v) {
            return Math.round(v * 0.3);
          }).join(",");
          grad.addColorStop(0, "rgba(" + shadow + ",0.42)");
          grad.addColorStop(1, "rgba(" + shadow + ",0)");
          g2.fillStyle = grad;
          g2.fillRect(0, 0, 128, 128);
          const disc = new THREE.Mesh(
            new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
          );
          disc.position.y = 1e-3;
          group.add(disc);
          applyEntrance = function(p) {
            model.rotation.y = (1 - p) * 1.2;
            model.position.y = -box.min.y * scale + (1 - p) * 0.35;
          };
          frameCamera(3);
          clock.start = performance.now();
          entranceUntil = reducedMotion() ? clock.start : clock.start + 900;
          if (reducedMotion()) applyEntrance(1);
          wake(reducedMotion() ? 0 : 950);
        }, void 0, function() {
          shimmer.destroy();
          emptyState({
            target: stage,
            title: spec.empty && spec.empty.title || "3D is resting",
            hint: spec.empty && spec.empty.hint || "The model could not load from its address."
          });
        });
        applyEntrance = function() {
        };
        return;
      }
      if (kind === "globe") {
        const R = 3;
        const accentC = new THREE.Color(accent);
        const inkC = new THREE.Color(ink);
        const surfaceC = new THREE.Color(surface);
        const ball = new THREE.Group();
        group.add(ball);
        ball.add(new THREE.Mesh(
          new THREE.SphereGeometry(R - 0.02, 48, 32),
          new THREE.MeshStandardMaterial({ color: surfaceC.clone().lerp(inkC, 0.05), roughness: 0.9, metalness: 0.02 })
        ));
        ball.add(new THREE.Mesh(
          new THREE.SphereGeometry(R * 1.045, 48, 32),
          new THREE.MeshBasicMaterial({ color: accentC, transparent: true, opacity: 0.16, side: THREE.BackSide, depthWrite: false })
        ));
        const gratMat = new THREE.LineBasicMaterial({ color: inkC, transparent: true, opacity: 0.22 });
        const toV = function(lat, lon, r) {
          return new THREE.Vector3().setFromSphericalCoords(
            r || R,
            THREE.MathUtils.degToRad(90 - lat),
            THREE.MathUtils.degToRad(lon + 180)
          );
        };
        for (let lat = -60; lat <= 60; lat += 20) {
          const pts = [];
          for (let lon = 0; lon <= 360; lon += 6) pts.push(toV(lat, lon));
          ball.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gratMat));
        }
        for (let lon = 0; lon < 360; lon += 20) {
          const pts = [];
          for (let lat = -90; lat <= 90; lat += 6) pts.push(toV(lat, lon));
          ball.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gratMat));
        }
        const points = (data && Array.isArray(data.points) ? data.points : []).filter(function(p) {
          return p && typeof p.lat === "number" && typeof p.lon === "number";
        });
        const dotGeo = new THREE.SphereGeometry(0.085, 12, 8);
        const dotMat = new THREE.MeshBasicMaterial({ color: accentC });
        for (const p of points) {
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(toV(p.lat, p.lon, R + 0.02));
          ball.add(dot);
        }
        const routes = (data && Array.isArray(data.routes) ? data.routes : []).filter(function(r2) {
          return r2 && Array.isArray(r2.from) && Array.isArray(r2.to);
        });
        const arcMat = new THREE.MeshBasicMaterial({ color: accentC, transparent: true, opacity: 0.7 });
        for (const r2 of routes) {
          const a = toV(Number(r2.from[0]) || 0, Number(r2.from[1]) || 0, R + 0.02);
          const b = toV(Number(r2.to[0]) || 0, Number(r2.to[1]) || 0, R + 0.02);
          const sum = a.clone().add(b);
          if (sum.lengthSq() < 1e-6) sum.set(0, R, 0);
          const lift = R + 0.25 + a.distanceTo(b) * 0.3;
          const mid = sum.normalize().multiplyScalar(lift);
          const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
          ball.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.025, 6, false), arcMat));
        }
        const centre = new THREE.Vector3();
        for (const p of points) centre.add(toV(p.lat, p.lon, 1));
        for (const r2 of routes) {
          centre.add(toV(Number(r2.from[0]) || 0, Number(r2.from[1]) || 0, 1));
          centre.add(toV(Number(r2.to[0]) || 0, Number(r2.to[1]) || 0, 1));
        }
        const baseY = centre.lengthSq() > 1e-6 ? -Math.atan2(centre.x, centre.z) : 0;
        ball.rotation.y = baseY;
        applyEntrance = function(p) {
          ball.rotation.y = baseY + (1 - p) * 1.4;
          ball.scale.setScalar(0.6 + 0.4 * p);
        };
      } else if (kind === "sky") {
        const sky = new THREE.Addons.Sky();
        sky.scale.setScalar(300);
        group.add(sky);
        const dark = root.closest('[data-theme="dark"]') !== null || matchMedia("(prefers-color-scheme: dark)").matches && root.closest('[data-theme="light"]') === null;
        const elevation = dark ? 1.6 : 18;
        const phi = THREE.MathUtils.degToRad(90 - elevation);
        const theta = THREE.MathUtils.degToRad(160);
        const sun = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
        sky.material.uniforms.sunPosition.value.copy(sun);
        sky.material.uniforms.turbidity.value = dark ? 6 : 8;
        sky.material.uniforms.rayleigh.value = dark ? 0.6 : 2.2;
        applyEntrance = function() {
        };
      } else if (kind === "bars") {
        const items = data && data.items || [];
        const n = Math.min(items.length, 64);
        if (n === 0) {
          applyEntrance = function() {
          };
        } else {
          const max = items.reduce(function(m, it) {
            return Math.max(m, Number(it.value) || 0);
          }, 0) || 1;
          const box = new THREE.BoxGeometry(0.8, 1, 0.8);
          box.translate(0, 0.5, 0);
          const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.08 });
          const mesh = new THREE.InstancedMesh(box, mat, n);
          const cols = Math.ceil(Math.sqrt(n));
          barCols = cols;
          const accentC = new THREE.Color(accent);
          const surfaceC = new THREE.Color(surface);
          const heights = [];
          const m4 = new THREE.Matrix4();
          for (let i = 0; i < n; i++) {
            const h = 0.15 + 4.6 * ((Number(items[i].value) || 0) / max);
            heights.push(h);
            const x = (i % cols - (cols - 1) / 2) * 1.15;
            const z = (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * 1.15;
            m4.makeScale(1, 1e-3, 1).setPosition(x, 0, z);
            mesh.setMatrixAt(i, m4);
            mesh.setColorAt(i, surfaceC.clone().lerp(accentC, 0.25 + 0.75 * (heights[i] / 4.75)));
          }
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          group.add(mesh);
          const ground = new THREE.Mesh(
            new THREE.CylinderGeometry(cols * 0.95 + 1, cols * 0.95 + 1, 0.12, 48),
            new THREE.MeshStandardMaterial({ color: new THREE.Color(surface), roughness: 0.9 })
          );
          ground.position.y = -0.06;
          group.add(ground);
          applyEntrance = function(p) {
            const v = new THREE.Matrix4();
            for (let i = 0; i < n; i++) {
              mesh.getMatrixAt(i, v);
              const pos = new THREE.Vector3().setFromMatrixPosition(v);
              v.makeScale(1, Math.max(1e-3, heights[i] * p), 1).setPosition(pos.x, 0, pos.z);
              mesh.setMatrixAt(i, v);
            }
            mesh.instanceMatrix.needsUpdate = true;
          };
        }
      } else {
        const geo = new THREE.IcosahedronGeometry(3.1, 1);
        const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
          color: new THREE.Color(accent),
          flatShading: true,
          roughness: 0.35,
          metalness: 0.15
        }));
        const frame3 = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: new THREE.Color(ink), transparent: true, opacity: 0.35 })
        );
        group.add(body, frame3);
        applyEntrance = function(p) {
          const s = 0.25 + 0.75 * p;
          group.scale.setScalar(s);
          group.rotation.y = (1 - p) * 0.9;
        };
      }
      if (kind !== "sky") {
        const sun = new THREE.DirectionalLight();
        sun.intensity = 2.2;
        sun.position.set(4, 8, 6);
        const fill = new THREE.HemisphereLight(new THREE.Color(surface), new THREE.Color(ink), 0.7);
        group.add(sun, fill);
      }
      frameCamera(barCols);
      clock.start = performance.now();
      entranceUntil = reducedMotion() ? clock.start : clock.start + 750;
      if (reducedMotion()) applyEntrance(1);
      wake(reducedMotion() ? 0 : 800);
    }
    return {
      rebuild,
      dispose: function() {
        disposed = true;
        if (raf) cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        disposeGroup();
        renderer.dispose();
        clear(stage);
      }
    };
  }

  // src/static/sdk-libs/atelier/disclose.js
  function slideOpen(panel, opening, span, ease) {
    if (reducedMotion() || typeof panel.animate !== "function") {
      panel.style.height = opening ? "auto" : "0px";
      return;
    }
    const from = panel.getBoundingClientRect().height;
    panel.style.height = "auto";
    const to = opening ? panel.getBoundingClientRect().height : 0;
    panel.style.height = from + "px";
    const anim = panel.animate(
      [{ height: from + "px", opacity: opening ? 0.4 : 1 }, { height: to + "px", opacity: opening ? 1 : 0.4 }],
      { duration: span, easing: ease }
    );
    const settle = function() {
      panel.style.height = opening ? "auto" : "0px";
    };
    anim.onfinish = settle;
    anim.oncancel = settle;
  }
  function reveal(spec) {
    const root = el("div", { class: "ak-root ak-reveal" });
    if (spec.target) resolve(spec.target).appendChild(root);
    const single = spec.mode !== "many";
    const panes = /* @__PURE__ */ new Map();
    function motion() {
      const cs = getComputedStyle(root);
      return {
        span: parseFloat(cs.getPropertyValue("--ak-motion")) || 200,
        ease: (cs.getPropertyValue("--ak-ease") || "").trim() || "cubic-bezier(0.2, 0.7, 0.3, 1)"
      };
    }
    function setOpen(id, want) {
      const pane = panes.get(id);
      if (!pane) return;
      const isOpen = pane.head.getAttribute("aria-expanded") === "true";
      if (isOpen === want) return;
      const { span, ease } = motion();
      if (want && single) {
        for (const [otherId, other] of panes) {
          if (otherId !== id && other.head.getAttribute("aria-expanded") === "true") {
            other.head.setAttribute("aria-expanded", "false");
            slideOpen(other.panel, false, span, ease);
          }
        }
      }
      pane.head.setAttribute("aria-expanded", String(want));
      slideOpen(pane.panel, want, span, ease);
    }
    function render(items) {
      clear(root);
      panes.clear();
      const openIds = spec.open || [];
      for (const item of items) {
        const panelId = "ak-rv-" + uid();
        const headId = panelId + "-h";
        const startOpen = openIds.indexOf(item.id) >= 0;
        const head = el("button", {
          type: "button",
          class: "ak-reveal__head",
          id: headId,
          "aria-expanded": String(startOpen),
          "aria-controls": panelId,
          on: {
            click: function() {
              setOpen(item.id, head.getAttribute("aria-expanded") !== "true");
            }
          }
        }, [
          el("span", { class: "ak-reveal__titles" }, [
            el("span", { class: "ak-reveal__title", text: item.title }),
            item.sub != null ? el("span", { class: "ak-reveal__sub", text: item.sub }) : null
          ]),
          el("span", { class: "ak-reveal__chevron", "aria-hidden": "true" }, "⌄")
        ]);
        const panel = el("div", {
          class: "ak-reveal__panel",
          id: panelId,
          role: "region",
          "aria-labelledby": headId
        });
        const inner = el("div", { class: "ak-reveal__inner" });
        if (item.text) inner.appendChild(el("p", { class: "ak-reveal__text", text: item.text }));
        if (item.body) item.body(inner);
        panel.appendChild(inner);
        panel.style.height = startOpen ? "auto" : "0px";
        root.appendChild(el("div", { class: "ak-reveal__pane" }, [head, panel]));
        panes.set(item.id, { head, panel });
      }
      enter(root);
    }
    render(spec.items || []);
    return {
      el: root,
      set(patch) {
        if (patch && patch.items) render(patch.items);
      },
      open(id) {
        setOpen(id, true);
      },
      close(id) {
        setOpen(id, false);
      },
      destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function drawer(spec) {
    const side = spec.side === "right" ? "right" : spec.side === "bottom" ? "bottom" : "left";
    const node = (
      /** @type {HTMLDialogElement} */
      el("dialog", {
        class: "ak-root ak-drawer ak-drawer--" + side,
        "aria-label": spec.title || t("menu")
      })
    );
    const panel = el("div", { class: "ak-drawer__panel" });
    const head = el("div", { class: "ak-drawer__head" }, [
      el("span", { class: "ak-drawer__title", text: spec.title || t("menu") }),
      el("button", {
        type: "button",
        class: "ak-btn ak-btn--ghost ak-drawer__x",
        "aria-label": t("close"),
        on: { click: function() {
          close();
        } }
      }, "✕")
    ]);
    panel.appendChild(head);
    const list2 = el("nav", { class: "ak-drawer__list" });
    for (const item of spec.items || []) {
      list2.appendChild(el("button", {
        type: "button",
        class: "ak-drawer__item",
        ...item.current ? { "aria-current": "page" } : {},
        on: {
          click: function() {
            if (spec.onPick) spec.onPick(item.id);
            close();
          }
        }
      }, [
        el("span", { class: "ak-drawer__label", text: item.label }),
        item.sub != null ? el("span", { class: "ak-drawer__sub", text: item.sub }) : null
      ]));
    }
    if ((spec.items || []).length) panel.appendChild(list2);
    if (spec.body) {
      const host = el("div", { class: "ak-drawer__body" });
      spec.body(host);
      panel.appendChild(host);
    }
    node.appendChild(panel);
    document.body.appendChild(node);
    const travel = side === "bottom" ? "0, 100%" : side === "right" ? "100%, 0" : "-100%, 0";
    function motion() {
      const cs = getComputedStyle(node);
      return {
        span: parseFloat(cs.getPropertyValue("--ak-motion")) || 200,
        ease: (cs.getPropertyValue("--ak-ease") || "").trim() || "cubic-bezier(0.2, 0.7, 0.3, 1)"
      };
    }
    function open() {
      if (node.open) return;
      node.showModal();
      if (reducedMotion() || typeof panel.animate !== "function") return;
      const { span, ease } = motion();
      panel.animate(
        [{ transform: "translate(" + travel + ")" }, { transform: "none" }],
        { duration: span * 1.4, easing: ease }
      );
    }
    function close() {
      if (!node.open) return;
      const done = function() {
        if (node.open) node.close();
        if (spec.onClose) spec.onClose();
      };
      if (reducedMotion() || typeof panel.animate !== "function") return done();
      const { span, ease } = motion();
      const anim = panel.animate(
        [{ transform: "none" }, { transform: "translate(" + travel + ")" }],
        { duration: span, easing: ease }
      );
      anim.onfinish = done;
      anim.oncancel = done;
    }
    node.addEventListener("cancel", function(ev) {
      ev.preventDefault();
      close();
    });
    node.addEventListener("click", function(ev) {
      if (ev.target === node) close();
    });
    return {
      el: node,
      open,
      close,
      destroy() {
        if (node.open) node.close();
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    };
  }

  // src/static/sdk-libs/atelier/mosaic-bind.js
  function patchFor(kind, data) {
    if (kind === "statRow") return { tiles: Array.isArray(data) ? data : [] };
    if (kind === "table") return { rows: Array.isArray(data) ? data : data && data.rows || [] };
    if (kind === "figure") return data && typeof data === "object" ? data : { value: 0 };
    if (kind === "chart" || kind === "matrix" || kind === "graph" || kind === "waveform" || kind === "gauge" || kind === "console" || kind === "atlas" || kind === "map" || kind === "scene3d" || kind === "kanban" || kind === "plan" || kind === "schedule" || kind === "steps" || kind === "rating" || kind === "crt") {
      return { data: data && typeof data === "object" && !Array.isArray(data) ? data : null };
    }
    if (kind === "health" || kind === "queue") {
      return { data: { items: Array.isArray(data) ? data : data && data.items || [] } };
    }
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
  var LIVE_MIN_INTERVAL_MS = 4e3;
  var LIVE_DEFAULT_INTERVAL_MS = 8e3;
  function wireLive(spec, refresh) {
    const live = spec.live;
    if (!live || typeof live !== "object") return function() {
    };
    const ns = (
      /** @type {any} */
      window.AIMEAT
    );
    if (!ns || !ns.live || typeof ns.live.subscribe !== "function") return function() {
    };
    const offs = [];
    for (const name of Object.keys(live)) {
      const conf = live[name] || {};
      const domains = Array.isArray(conf.domains) && conf.domains.length ? conf.domains : ["memory"];
      const wantsMemory = domains.indexOf("memory") >= 0;
      if (wantsMemory && !conf.keyPrefix) {
        console.warn('aimeat-atelier: live source "' + name + '" subscribes to memory without a keyPrefix — refused (that would re-fetch on every write anyone makes).');
        continue;
      }
      const minIntervalMs = Math.max(Number(conf.minIntervalMs) || LIVE_DEFAULT_INTERVAL_MS, LIVE_MIN_INTERVAL_MS);
      offs.push(ns.live.subscribe(domains, function() {
        refresh(name);
      }, {
        keyPrefix: conf.keyPrefix,
        minIntervalMs
      }));
    }
    return function() {
      for (const off of offs) {
        try {
          off();
        } catch {
        }
      }
    };
  }

  // src/static/sdk-libs/atelier/mosaic-motion.js
  function transition(run) {
    if (typeof document.startViewTransition === "function" && !reducedMotion()) {
      document.startViewTransition(run);
    } else {
      run();
    }
  }
  function morph(moving, run) {
    if (typeof document.startViewTransition !== "function" || reducedMotion()) {
      run();
      return;
    }
    moving.style.viewTransitionName = "ak-morph";
    const vt = document.startViewTransition(run);
    vt.finished.finally(function() {
      moving.style.viewTransitionName = "";
    });
  }

  // src/static/sdk-libs/atelier/mosaic-layout.js
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

  // src/static/sdk-libs/atelier/mosaic-canvas.js
  var CANVAS_MIN = 0.35;
  var CANVAS_MAX = 1.6;
  var CANVAS_STEP = 1.18;
  function projectCanvas(units, morph2) {
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
      morph2(u.el, function() {
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
      morph2(u.el, function() {
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

  // src/static/sdk-libs/atelier/mosaic-projections.js
  function projectStack(units, alive) {
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
  function projectOverlay(units, alive) {
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
  function projectPicker(units, mode, alive) {
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
  function projectDeck(units, alive) {
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

  // src/static/sdk-libs/atelier/ops.js
  var SVG_NS4 = "http://www.w3.org/2000/svg";
  function svg4(name, attrs) {
    const node = document.createElementNS(SVG_NS4, name);
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
    return node;
  }
  var TONES3 = ["ok", "warn", "err", "plain"];
  function toneOf(value) {
    return TONES3.indexOf(value) >= 0 ? value : "plain";
  }
  function health(spec) {
    const root = el("div", { class: "ak-root ak-health", role: "list" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    function render(data) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      const items = data && Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        const e = spec.empty || {};
        emptyCard = emptyState({ target: root, tone: "quiet", title: e.title || t("empty"), hint: e.hint || t("emptyHint") });
        return;
      }
      for (const item of items) {
        const tone = toneOf(item.tone);
        const row = el(spec.onPick ? "button" : "div", {
          class: "ak-health__row",
          role: "listitem",
          type: spec.onPick ? "button" : void 0
        }, [
          el("span", { class: "ak-health__lamp ak-health__lamp--" + tone, "aria-hidden": "true" }),
          el("span", { class: "ak-health__name" }, [
            el("span", { class: "ak-health__label", text: item.label || item.id }),
            item.sub ? el("span", { class: "ak-health__sub", text: item.sub }) : null
          ]),
          item.reading != null ? el("span", { class: "ak-health__reading", text: String(item.reading) }) : null,
          el("span", { class: "ak-sr-only", text: tone === "ok" ? t("opsOk") : tone === "err" ? t("opsDown") : tone === "warn" ? t("opsWarn") : "" })
        ]);
        if (spec.onPick) row.addEventListener("click", function() {
          spec.onPick(item);
        });
        root.appendChild(row);
      }
    }
    render(spec.data);
    return {
      el: root,
      set(patch) {
        if (patch && "data" in patch) render(patch.data);
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        root.remove();
      }
    };
  }
  var QUEUE_STATES = ["waiting", "running", "done", "failed"];
  var QUEUE_TONE = { waiting: "plain", running: "warn", done: "ok", failed: "err" };
  function queue(spec) {
    const root = el("div", { class: "ak-root ak-queue" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    function render(data) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      const items = data && Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        const e = spec.empty || {};
        emptyCard = emptyState({ target: root, tone: "quiet", title: e.title || t("empty"), hint: e.hint || t("emptyHint") });
        return;
      }
      const counts = {};
      for (const item of items) {
        const s = QUEUE_STATES.indexOf(item.state) >= 0 ? item.state : "waiting";
        counts[s] = (counts[s] || 0) + 1;
      }
      const strip = el("div", { class: "ak-queue__strip", role: "status" });
      for (const s of QUEUE_STATES) {
        if (!counts[s]) continue;
        strip.appendChild(el(
          "span",
          { class: "ak-queue__count ak-queue__count--" + QUEUE_TONE[s] },
          [el("strong", { text: String(counts[s]) }), el("span", { text: " " + t("queue." + s) })]
        ));
      }
      root.appendChild(strip);
      const list2 = el("div", { class: "ak-queue__list", role: "list" });
      for (const item of items) {
        const s = QUEUE_STATES.indexOf(item.state) >= 0 ? item.state : "waiting";
        const row = el(spec.onPick ? "button" : "div", {
          class: "ak-queue__row",
          role: "listitem",
          type: spec.onPick ? "button" : void 0
        }, [
          el("span", { class: "ak-queue__state ak-queue__state--" + s, text: t("queue." + s) }),
          el("span", { class: "ak-queue__words" }, [
            el("span", { class: "ak-queue__title", text: item.title || item.id }),
            item.sub ? el("span", { class: "ak-queue__sub", text: item.sub }) : null
          ])
        ]);
        if (spec.onPick) row.addEventListener("click", function() {
          spec.onPick(item);
        });
        list2.appendChild(row);
      }
      root.appendChild(list2);
    }
    render(spec.data);
    return {
      el: root,
      set(patch) {
        if (patch && "data" in patch) render(patch.data);
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        root.remove();
      }
    };
  }
  function gauge(spec) {
    const root = el("figure", { class: "ak-root ak-gauge", role: "img" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    const R = 96;
    const CX = 120;
    const CY = 118;
    function pointAt(frac, radius) {
      const rad = Math.PI + Math.PI * Math.max(0, Math.min(1, frac));
      return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
    }
    function arcPath(fromFrac, toFrac, radius) {
      const [x1, y1] = pointAt(fromFrac, radius);
      const [x2, y2] = pointAt(toFrac, radius);
      return "M " + x1.toFixed(1) + " " + y1.toFixed(1) + " A " + radius + " " + radius + " 0 0 1 " + x2.toFixed(1) + " " + y2.toFixed(1);
    }
    function render(data) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      if (!data || typeof data.value !== "number") {
        const e = spec.empty || {};
        emptyCard = emptyState({ target: root, tone: "quiet", title: e.title || t("empty"), hint: e.hint || t("emptyHint") });
        return;
      }
      const min = typeof data.min === "number" ? data.min : 0;
      const max = typeof data.max === "number" && data.max > min ? data.max : min + 100;
      const frac = Math.max(0, Math.min(1, (data.value - min) / (max - min)));
      const bands = Array.isArray(data.bands) && data.bands.length ? data.bands : [];
      let tone = "plain";
      for (const band of bands) {
        if (data.value <= band.upTo) {
          tone = toneOf(band.tone);
          break;
        }
      }
      if (bands.length && data.value > bands[bands.length - 1].upTo) tone = toneOf(bands[bands.length - 1].tone);
      root.setAttribute("aria-label", (data.label ? data.label + ": " : "") + data.value + (data.unit || ""));
      const node = svg4("svg", { viewBox: "0 0 240 132", class: "ak-gauge__svg", "aria-hidden": "true" });
      node.appendChild(svg4("path", { d: arcPath(0, 1, R), class: "ak-gauge__track" }));
      const value = svg4("path", { d: arcPath(0, Math.max(frac, 5e-3), R), class: "ak-gauge__value ak-gauge__value--" + tone });
      node.appendChild(value);
      for (const band of bands.slice(0, -1)) {
        const f = Math.max(0, Math.min(1, (band.upTo - min) / (max - min)));
        const [x1, y1] = pointAt(f, R - 12);
        const [x2, y2] = pointAt(f, R + 12);
        node.appendChild(svg4("line", { x1, y1, x2, y2, class: "ak-gauge__tickmark" }));
      }
      const [dx, dy] = pointAt(frac, R);
      node.appendChild(svg4("circle", { cx: dx, cy: dy, r: 8, class: "ak-gauge__marker ak-gauge__marker--" + tone }));
      root.appendChild(node);
      if (!reducedMotion()) {
        const len = (
          /** @type {SVGPathElement} */
          value.getTotalLength()
        );
        value.setAttribute("stroke-dasharray", String(len));
        value.setAttribute("stroke-dashoffset", String(len));
        requestAnimationFrame(function() {
          value.classList.add("ak-gauge__value--drawn");
        });
      }
      root.appendChild(el("figcaption", { class: "ak-gauge__words" }, [
        el(
          "span",
          { class: "ak-gauge__reading ak-gauge__reading--" + tone },
          [el("strong", { text: String(data.value) }), data.unit ? el("span", { text: data.unit }) : null]
        ),
        data.label ? el("span", { class: "ak-gauge__label", text: data.label }) : null,
        data.sub ? el("span", { class: "ak-gauge__label", text: data.sub }) : null
      ]));
    }
    render(spec.data);
    return {
      el: root,
      set(patch) {
        if (patch && "data" in patch) render(patch.data);
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        root.remove();
      }
    };
  }

  // src/static/sdk-libs/atelier/planner.js
  var TONES4 = ["ok", "warn", "err", "accent"];
  function toneOf2(value, fallback) {
    return TONES4.indexOf(value) >= 0 ? value : fallback || "accent";
  }
  function emptyInto(root, spec) {
    const e = spec.empty || {};
    return emptyState({ target: root, tone: "quiet", title: e.title || t("empty"), hint: e.hint || t("emptyHint") });
  }
  function kanban(spec) {
    const root = el("div", { class: "ak-root ak-kanban" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    let current2 = null;
    function moveCard(cardId, toColumn) {
      if (!current2) return;
      const card = (current2.cards || []).find((c) => c && c.id === cardId);
      if (!card || card.column === toColumn) return;
      card.column = toColumn;
      render(current2);
      const again = root.querySelector(`[data-card="${cardId}"]`);
      if (again) again.focus();
      if (spec.onMove) spec.onMove(cardId, toColumn);
    }
    function render(data) {
      current2 = data;
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      const columns = data && Array.isArray(data.columns) ? data.columns.filter((c) => c && c.id) : [];
      const cards = data && Array.isArray(data.cards) ? data.cards.filter((c) => c && c.id) : [];
      if (!columns.length) {
        emptyCard = emptyInto(root, spec);
        return;
      }
      const movable = !!spec.onMove;
      columns.forEach((col, colIdx) => {
        const inCol = cards.filter((c) => c.column === col.id);
        const lane = el("div", { class: "ak-kanban__col", "data-col": col.id, role: "group", "aria-label": `${col.label} · ${inCol.length}` });
        lane.appendChild(el("div", { class: "ak-kanban__head ak-kanban__head--" + toneOf2(col.tone, "accent") }, [
          el("span", { class: "ak-kanban__colname", text: col.label || col.id }),
          el("span", { class: "ak-kanban__count", text: String(inCol.length) })
        ]));
        const well = el("div", { class: "ak-kanban__well" });
        if (movable) {
          well.addEventListener("dragover", (ev) => {
            ev.preventDefault();
            well.classList.add("ak-kanban__well--over");
          });
          well.addEventListener("dragleave", () => well.classList.remove("ak-kanban__well--over"));
          well.addEventListener("drop", (ev) => {
            ev.preventDefault();
            well.classList.remove("ak-kanban__well--over");
            const id = ev.dataTransfer ? ev.dataTransfer.getData("text/plain") : "";
            if (id) moveCard(id, col.id);
          });
        }
        inCol.forEach((card, i) => {
          const node = el("div", {
            class: "ak-kanban__card" + (TONES4.indexOf(card.tone) >= 0 ? " ak-kanban__card--" + card.tone : ""),
            "data-card": card.id,
            tabindex: movable ? "0" : void 0,
            role: movable ? "button" : void 0
          }, [
            el("span", { class: "ak-kanban__cardtitle", text: card.title || card.id }),
            card.sub ? el("span", { class: "ak-kanban__cardsub", text: card.sub }) : null,
            card.badge ? el("span", { class: "ak-kanban__badge", text: card.badge }) : null
          ]);
          if (!reducedMotion()) {
            node.classList.add("ak-kanban__card--enter");
            node.style.animationDelay = `${i * 40}ms`;
          }
          if (movable) {
            node.draggable = true;
            node.addEventListener("dragstart", (ev) => {
              if (ev.dataTransfer) {
                ev.dataTransfer.setData("text/plain", card.id);
                ev.dataTransfer.effectAllowed = "move";
              }
              node.classList.add("ak-kanban__card--lift");
            });
            node.addEventListener("dragend", () => node.classList.remove("ak-kanban__card--lift"));
            node.addEventListener("keydown", (ev) => {
              const dir = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
              if (!dir) return;
              const next = columns[colIdx + dir];
              if (next) {
                ev.preventDefault();
                moveCard(card.id, next.id);
              }
            });
          }
          well.appendChild(node);
        });
        lane.appendChild(well);
        root.appendChild(lane);
      });
    }
    render(spec.data || null);
    return {
      el: root,
      set: (patch) => {
        if (patch && "data" in patch) render(patch.data || null);
      },
      destroy: () => root.remove()
    };
  }
  var DAY_MS = 864e5;
  function day(value) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  function plan(spec) {
    const root = el("div", { class: "ak-root ak-plan" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    function render(data) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      const rows = (data && Array.isArray(data.rows) ? data.rows : []).map((r) => ({
        label: r && r.label || "",
        spans: (r && Array.isArray(r.spans) ? r.spans : []).map((s) => ({ from: day(s.from), to: day(s.to), label: s.label, tone: s.tone })).filter((s) => s.from && s.to && s.to.getTime() >= s.from.getTime())
      })).filter((r) => r.spans.length);
      if (!rows.length) {
        emptyCard = emptyInto(root, spec);
        return;
      }
      let min = data.start ? day(data.start) : null;
      let max = data.end ? day(data.end) : null;
      for (const r of rows) for (const s of r.spans) {
        if (!min || s.from < min) min = s.from;
        if (!max || s.to > max) max = s.to;
      }
      const span = Math.max(max.getTime() - min.getTime(), DAY_MS);
      const X = (d) => Math.min(Math.max((d.getTime() - min.getTime()) / span, 0), 1) * 100;
      const head = el("div", { class: "ak-plan__months" });
      const cursor = new Date(min.getFullYear(), min.getMonth(), 1);
      while (cursor.getTime() <= max.getTime()) {
        if (cursor.getTime() >= min.getTime()) {
          const mark = el("span", { class: "ak-plan__month", text: t("m" + (cursor.getMonth() + 1)) });
          mark.style.left = X(cursor) + "%";
          head.appendChild(mark);
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
      root.appendChild(head);
      const body = el("div", { class: "ak-plan__rows" });
      rows.forEach((r, ri) => {
        const lane = el("div", { class: "ak-plan__row" }, [
          el("span", { class: "ak-plan__rowname", text: r.label })
        ]);
        const track = el("span", { class: "ak-plan__track" });
        r.spans.forEach((s, si) => {
          const left = X(s.from);
          const width = Math.max(X(new Date(s.to.getTime() + DAY_MS)) - left, 1.2);
          const bar = el("span", {
            class: "ak-plan__span ak-plan__span--" + toneOf2(s.tone, "accent"),
            title: (s.label ? s.label + " · " : "") + `${s.from.toISOString().slice(0, 10)} → ${s.to.toISOString().slice(0, 10)}`
          }, s.label && width > 8 ? [el("span", { class: "ak-plan__spanlabel", text: s.label })] : []);
          bar.style.left = left + "%";
          bar.style.width = width + "%";
          if (!reducedMotion()) {
            bar.classList.add("ak-plan__span--enter");
            bar.style.animationDelay = `${(ri * 2 + si) * 60}ms`;
          }
          track.appendChild(bar);
        });
        lane.appendChild(track);
        body.appendChild(lane);
      });
      const today = data.today ? day(data.today) : /* @__PURE__ */ new Date();
      if (today && today.getTime() >= min.getTime() && today.getTime() <= max.getTime()) {
        const line = el("span", { class: "ak-plan__today", title: t("today") });
        line.style.left = X(today) + "%";
        body.appendChild(line);
      }
      root.appendChild(body);
    }
    render(spec.data || null);
    return {
      el: root,
      set: (patch) => {
        if (patch && "data" in patch) render(patch.data || null);
      },
      destroy: () => root.remove()
    };
  }
  function minutes(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function schedule(spec) {
    const root = el("div", { class: "ak-root ak-schedule" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    function render(data) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      const days = (data && Array.isArray(data.days) && data.days.length ? data.days : ["Mon", "Tue", "Wed", "Thu", "Fri"]).slice(0, 7);
      const events = (data && Array.isArray(data.events) ? data.events : []).map((e) => ({ ...e, fromMin: minutes(e.from), toMin: minutes(e.to) })).filter((e) => e && typeof e.day === "number" && e.day >= 0 && e.day < days.length && e.fromMin !== null && e.toMin !== null && e.toMin > e.fromMin);
      if (!events.length) {
        emptyCard = emptyInto(root, spec);
        return;
      }
      const open = minutes(data.from) ?? Math.max(Math.floor(Math.min(...events.map((e) => e.fromMin)) / 60) * 60 - 60, 0);
      const close = minutes(data.to) ?? Math.min(Math.ceil(Math.max(...events.map((e) => e.toMin)) / 60) * 60 + 60, 1440);
      const span = Math.max(close - open, 60);
      const Y = (m) => Math.min(Math.max((m - open) / span, 0), 1) * 100;
      const grid = el("div", { class: "ak-schedule__grid" });
      const hours = el("div", { class: "ak-schedule__hours" });
      for (let m = Math.ceil(open / 60) * 60; m <= close; m += 60) {
        const line = el("span", { class: "ak-schedule__hour", text: `${String(Math.floor(m / 60)).padStart(2, "0")}:00` });
        line.style.top = Y(m) + "%";
        hours.appendChild(line);
      }
      grid.appendChild(hours);
      days.forEach((label, di) => {
        const inDay = events.filter((e) => e.day === di);
        const col = el("div", { class: "ak-schedule__day", role: "group", "aria-label": `${label} · ${inDay.length}` }, [
          el("span", { class: "ak-schedule__dayname", text: label })
        ]);
        const well = el("div", { class: "ak-schedule__well" });
        inDay.forEach((e, i) => {
          const block = el(spec.onPick ? "button" : "span", {
            class: "ak-schedule__event ak-schedule__event--" + toneOf2(e.tone, "accent"),
            type: spec.onPick ? "button" : void 0,
            title: `${e.label} · ${e.from}–${e.to}`
          }, [
            el("span", { class: "ak-schedule__eventname", text: e.label }),
            // A short booking has room for its name only; the title carries the hours anyway.
            e.toMin - e.fromMin >= 75 ? el("span", { class: "ak-schedule__eventtime", text: `${e.from}–${e.to}` }) : null
          ]);
          block.style.top = Y(e.fromMin) + "%";
          block.style.height = Math.max(Y(e.toMin) - Y(e.fromMin), 4) + "%";
          if (spec.onPick) block.addEventListener("click", () => spec.onPick(e));
          if (!reducedMotion()) {
            block.classList.add("ak-schedule__event--enter");
            block.style.animationDelay = `${(di * 3 + i) * 50}ms`;
          }
          well.appendChild(block);
        });
        col.appendChild(well);
        grid.appendChild(col);
      });
      root.appendChild(grid);
    }
    render(spec.data || null);
    return {
      el: root,
      set: (patch) => {
        if (patch && "data" in patch) render(patch.data || null);
      },
      destroy: () => root.remove()
    };
  }
  function steps(spec) {
    const root = el("ol", { class: "ak-root ak-steps" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    function render(data) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      const items = (data && Array.isArray(data.steps) ? data.steps : []).filter((s) => s && s.label);
      if (!items.length) {
        emptyCard = emptyInto(root, spec);
        return;
      }
      const current2 = Math.min(Math.max(Number(data.current) || 0, 0), items.length - 1);
      items.forEach((s, i) => {
        const state = i < current2 ? "done" : i === current2 ? "now" : "ahead";
        root.appendChild(el("li", {
          class: "ak-steps__step ak-steps__step--" + state,
          "aria-current": state === "now" ? "step" : void 0
        }, [
          el("span", { class: "ak-steps__dot", "aria-hidden": "true" }, state === "done" ? "✓" : String(i + 1)),
          el("span", { class: "ak-steps__words" }, [
            el("span", { class: "ak-steps__label", text: s.label }),
            s.sub ? el("span", { class: "ak-steps__sub", text: s.sub }) : null
          ])
        ]));
      });
    }
    render(spec.data || null);
    return {
      el: root,
      set: (patch) => {
        if (patch && "data" in patch) render(patch.data || null);
      },
      destroy: () => root.remove()
    };
  }

  // src/static/sdk-libs/atelier/konsole.js
  var CAP_DEFAULT = 400;
  var TONES5 = ["ok", "warn", "err", "plain"];
  function stamp(ts) {
    if (ts == null) return "";
    const d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function konsole(spec) {
    const cap = typeof spec.cap === "number" && spec.cap > 0 ? Math.min(spec.cap, 2e3) : CAP_DEFAULT;
    const root = el("div", { class: "ak-root ak-console" });
    if (spec.target) resolve(spec.target).appendChild(root);
    const vane = el("div", { class: "ak-console__vane", role: "log", "aria-live": "polite", tabindex: "0" });
    root.appendChild(vane);
    let emptyCard = null;
    function atTail() {
      return vane.scrollHeight - vane.scrollTop - vane.clientHeight < 24;
    }
    function lineNode(line, entering) {
      const tone = TONES5.indexOf(line.tone) >= 0 ? line.tone : "plain";
      const node = el("div", { class: "ak-console__line ak-console__line--" + tone }, [
        line.ts != null ? el("span", { class: "ak-console__ts", text: stamp(line.ts) }) : null,
        el("span", { class: "ak-console__text", text: String(line.text == null ? "" : line.text) })
      ]);
      if (entering && !reducedMotion()) node.classList.add("ak-console__line--enter");
      return node;
    }
    function trim() {
      while (vane.children.length > cap) vane.removeChild(vane.firstChild);
    }
    function render(data) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(vane);
      const lines = data && Array.isArray(data.lines) ? data.lines : [];
      if (!lines.length) {
        const e = spec.empty || {};
        emptyCard = emptyState({ target: vane, tone: "quiet", title: e.title || t("consoleEmpty"), hint: e.hint || "" });
        return;
      }
      for (const line of lines.slice(-cap)) vane.appendChild(lineNode(line, false));
      vane.scrollTop = vane.scrollHeight;
    }
    render(spec.data);
    return {
      el: root,
      set(patch) {
        if (patch && "data" in patch) render(patch.data);
      },
      /** @param {Array<{ ts?: any, tone?: string, text: string }>} lines */
      append(lines) {
        if (!Array.isArray(lines) || !lines.length) return;
        if (emptyCard) {
          emptyCard.destroy();
          emptyCard = null;
        }
        const follow = atTail();
        for (const line of lines) vane.appendChild(lineNode(line, true));
        trim();
        if (follow) vane.scrollTop = vane.scrollHeight;
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        root.remove();
      }
    };
  }

  // src/static/sdk-libs/atelier/commercial-i18n.js
  var STRINGS = {
    en: {
      "legal.title": "The pages this app answers with",
      "legal.intro": "These pages are the app’s own, written by its owner. The app answers for what it does; the node it runs on has its own terms, which cover the node and not this app.",
      "legal.open": "Open",
      "legal.missing": "Still to write",
      "legal.none": "Not written",
      "legal.loadFailed": "The legal pages could not be read right now.",
      "legal.readinessSells": "This app sells something, so it answers for the sale: who is selling, on what terms, how to withdraw, how the data is handled, and how the shop can be used by everyone.",
      "legal.readinessPlain": "A published app answers for its own terms and for the personal data it handles.",
      "legal.readinessMissing": "{n} of those pages are still to write.",
      "legal.readinessOk": "Every recommended page exists.",
      "kind.terms.title": "Terms of use",
      "kind.terms.why": "The contract between the app and the person using it. Every app store asks for it; a shop or a paid tool cannot do without it.",
      "kind.privacy.title": "Privacy notice",
      "kind.privacy.why": "What personal data the app handles, why, for how long, who else sees it and how to reach whoever answers for it (GDPR Art. 13).",
      "kind.imprint.title": "Imprint",
      "kind.imprint.why": "Who is behind this app: name, address, contact, trade register where there is one.",
      "kind.refunds.title": "Refunds and withdrawal",
      "kind.refunds.why": "The 14-day right of withdrawal and how a refund works, for an app that sells anything.",
      "kind.accessibility.title": "Accessibility statement",
      "kind.accessibility.why": "How the app meets accessibility requirements. The European Accessibility Act asks this of e-commerce services.",
      "kind.cookies.title": "Cookies and browser storage",
      "kind.cookies.why": "What the app keeps in the browser and why, when it keeps anything beyond what running requires.",
      "kind.support.title": "Support",
      "kind.support.why": "How to reach whoever answers for the app.",
      "chip.pages": "{n} legal pages still to write",
      "frame.updated": "Published by {who} for the app “{app}”. Updated {date}.",
      "frame.footer": "This page is written and published by the app’s owner, who answers for the app and for what this page says. The node it runs on has its own terms, which cover the node and not this app.",
      "audit.title": "What happened",
      "audit.intro": "An append-only trail. Rows are written as things happen and never rewritten.",
      "audit.empty": "Nothing recorded yet.",
      "audit.loadFailed": "The trail could not be read.",
      "audit.twoHands": "Two hands open this trail: the organism names the app in the row space, and you approve the organism:rows scope at sign-in.",
      "audit.more": "Show {n} more",
      "feedback.title": "Leave feedback",
      "feedback.topic": "Topic",
      "feedback.message": "Message",
      "feedback.contact": "How to reach you (optional)",
      "feedback.send": "Send",
      "feedback.sent": "Thank you. Your message went through.",
      "feedback.failed": "That did not go through.",
      "feedback.messageRequired": "A message is needed.",
      "reviewer.line": "Reviewed by {name}, who answers for this app.",
      "reviewer.lifts": "A named review lifts the visible AI-content label where the law allows it; a notice that you are interacting with an AI is never lifted.",
      "reviewer.law": "EU AI Act, Article 50",
      "marks.title": "Marks on the served app",
      "marks.badge": "The “publish your own app” badge",
      "marks.badgeOn": "Shown on the served app.",
      "marks.badgeOff": "Hidden.",
      "marks.install": "The browser install offer",
      "marks.installOn": "Offered on the served app.",
      "marks.installOff": "Hidden.",
      "marks.turnOn": "Turn on",
      "marks.turnOff": "Turn off",
      "marks.ownerOnly": "These switches belong to the app’s owner.",
      "marks.saveFailed": "The change did not go through.",
      "sample.badge": "Sample content",
      "sample.formNote": "A sample — nothing is sent from here."
    },
    fi: {
      "legal.title": "Sivut joilla tämä sovellus vastaa",
      "legal.intro": "Nämä sivut ovat sovelluksen omia, sen omistajan kirjoittamia. Sovellus vastaa siitä mitä se tekee; noodilla jolla se pyörii on omat ehtonsa, jotka koskevat noodia eivätkä tätä sovellusta.",
      "legal.open": "Avaa",
      "legal.missing": "Kirjoittamatta",
      "legal.none": "Ei kirjoitettu",
      "legal.loadFailed": "Lakisivuja ei juuri nyt saatu luettua.",
      "legal.readinessSells": "Tämä sovellus myy jotain, joten se vastaa kaupasta: kuka myy, millä ehdoilla, miten kaupan saa purettua, miten tietoja käsitellään ja miten kauppa on kaikkien käytettävissä.",
      "legal.readinessPlain": "Julkaistu sovellus vastaa omista ehdoistaan ja käsittelemästään henkilötiedosta.",
      "legal.readinessMissing": "Noista sivuista {n} on vielä kirjoittamatta.",
      "legal.readinessOk": "Kaikki suositellut sivut ovat olemassa.",
      "kind.terms.title": "Käyttöehdot",
      "kind.terms.why": "Sopimus sovelluksen ja sen käyttäjän välillä. Jokainen sovelluskauppa kysyy sitä; kauppa tai maksullinen työkalu ei pärjää ilman.",
      "kind.privacy.title": "Tietosuojaseloste",
      "kind.privacy.why": "Mitä henkilötietoa sovellus käsittelee, miksi, kuinka kauan, kuka muu sen näkee ja miten tavoittaa se joka siitä vastaa (GDPR 13 art.).",
      "kind.imprint.title": "Yhteystiedot ja vastuutaho",
      "kind.imprint.why": "Kuka tämän sovelluksen takana on: nimi, osoite, yhteystiedot, kaupparekisteri jos sellainen on.",
      "kind.refunds.title": "Palautukset ja peruuttaminen",
      "kind.refunds.why": "14 päivän peruuttamisoikeus ja miten palautus toimii, kun sovellus myy jotain.",
      "kind.accessibility.title": "Saavutettavuusseloste",
      "kind.accessibility.why": "Miten sovellus täyttää saavutettavuusvaatimukset. Esteettömyysdirektiivi vaatii tätä verkkokaupoilta.",
      "kind.cookies.title": "Evästeet ja selaimen muisti",
      "kind.cookies.why": "Mitä sovellus säilyttää selaimessa ja miksi, jos se säilyttää jotain muutakin kuin toimintansa vaatiman.",
      "kind.support.title": "Tuki",
      "kind.support.why": "Miten tavoittaa se joka sovelluksesta vastaa.",
      "chip.pages": "{n} lakisivua vielä kirjoittamatta",
      "frame.updated": "Julkaisija {who}, sovellukselle ”{app}”. Päivitetty {date}.",
      "frame.footer": "Tämän sivun on kirjoittanut ja julkaissut sovelluksen omistaja, joka vastaa sovelluksesta ja tämän sivun sisällöstä. Noodilla jolla sovellus pyörii on omat ehtonsa, jotka koskevat noodia eivätkä tätä sovellusta.",
      "audit.title": "Mitä tapahtui",
      "audit.intro": "Vain lisättävä loki. Rivit kirjoitetaan kun asiat tapahtuvat, eikä niitä koskaan kirjoiteta uusiksi.",
      "audit.empty": "Ei vielä kirjauksia.",
      "audit.loadFailed": "Lokia ei saatu luettua.",
      "audit.twoHands": "Tämän lokin avaa kaksi kättä: organismi nimeää sovelluksen rivitilaansa, ja sinä hyväksyt organism:rows-oikeuden kirjautuessasi.",
      "audit.more": "Näytä {n} lisää",
      "feedback.title": "Anna palautetta",
      "feedback.topic": "Aihe",
      "feedback.message": "Viesti",
      "feedback.contact": "Miten sinut tavoittaa (valinnainen)",
      "feedback.send": "Lähetä",
      "feedback.sent": "Kiitos. Viestisi meni perille.",
      "feedback.failed": "Lähetys ei mennyt läpi.",
      "feedback.messageRequired": "Viesti tarvitaan.",
      "reviewer.line": "Tarkastanut {name}, joka vastaa tästä sovelluksesta.",
      "reviewer.lifts": "Nimetty tarkastus poistaa näkyvän tekoälysisältö-merkinnän siellä missä laki sen sallii; ilmoitusta siitä että keskustelet tekoälyn kanssa ei poisteta koskaan.",
      "reviewer.law": "EU:n tekoälyasetus, 50 artikla",
      "marks.title": "Merkit tarjoillussa sovelluksessa",
      "marks.badge": "”Julkaise oma sovellus” -merkki",
      "marks.badgeOn": "Näkyy tarjoillussa sovelluksessa.",
      "marks.badgeOff": "Piilotettu.",
      "marks.install": "Selaimen asennustarjous",
      "marks.installOn": "Tarjotaan tarjoillussa sovelluksessa.",
      "marks.installOff": "Piilotettu.",
      "marks.turnOn": "Kytke päälle",
      "marks.turnOff": "Kytke pois",
      "marks.ownerOnly": "Nämä kytkimet kuuluvat sovelluksen omistajalle.",
      "marks.saveFailed": "Muutos ei mennyt läpi.",
      "sample.badge": "Näytesisältö",
      "sample.formNote": "Näyte — täältä ei lähetetä mitään."
    },
    es: {
      "legal.title": "Las páginas con las que responde esta app",
      "legal.intro": "Estas páginas son de la propia app, escritas por su dueño. La app responde por lo que hace; el nodo donde corre tiene sus propios términos, que cubren el nodo y no esta app.",
      "legal.open": "Abrir",
      "legal.missing": "Por escribir",
      "legal.none": "Sin escribir",
      "legal.loadFailed": "Las páginas legales no se pudieron leer ahora mismo.",
      "legal.readinessSells": "Esta app vende algo, así que responde por la venta: quién vende, con qué condiciones, cómo desistir, cómo se tratan los datos y cómo puede usar la tienda todo el mundo.",
      "legal.readinessPlain": "Una app publicada responde por sus propios términos y por los datos personales que maneja.",
      "legal.readinessMissing": "De esas páginas, {n} siguen por escribir.",
      "legal.readinessOk": "Todas las páginas recomendadas existen.",
      "kind.terms.title": "Condiciones de uso",
      "kind.terms.why": "El contrato entre la app y la persona que la usa. Todas las tiendas de apps lo piden; una tienda o una herramienta de pago no puede prescindir de él.",
      "kind.privacy.title": "Aviso de privacidad",
      "kind.privacy.why": "Qué datos personales maneja la app, por qué, cuánto tiempo, quién más los ve y cómo llegar a quien responde por ello (art. 13 del RGPD).",
      "kind.imprint.title": "Aviso legal",
      "kind.imprint.why": "Quién está detrás de esta app: nombre, dirección, contacto, registro mercantil si lo hay.",
      "kind.refunds.title": "Devoluciones y desistimiento",
      "kind.refunds.why": "El derecho de desistimiento de 14 días y cómo funciona una devolución, para una app que vende algo.",
      "kind.accessibility.title": "Declaración de accesibilidad",
      "kind.accessibility.why": "Cómo cumple la app los requisitos de accesibilidad. La ley europea de accesibilidad lo pide al comercio electrónico.",
      "kind.cookies.title": "Cookies y almacenamiento del navegador",
      "kind.cookies.why": "Qué guarda la app en el navegador y por qué, cuando guarda algo más de lo que su funcionamiento exige.",
      "kind.support.title": "Soporte",
      "kind.support.why": "Cómo llegar a quien responde por la app.",
      "chip.pages": "{n} páginas legales siguen por escribir",
      "frame.updated": "Publicado por {who} para la app “{app}”. Actualizado {date}.",
      "frame.footer": "Esta página la escribe y publica el dueño de la app, que responde por la app y por lo que dice esta página. El nodo donde corre tiene sus propios términos, que cubren el nodo y no esta app.",
      "audit.title": "Qué pasó",
      "audit.intro": "Un registro solo de añadir. Las filas se escriben cuando las cosas pasan y nunca se reescriben.",
      "audit.empty": "Todavía no hay registros.",
      "audit.loadFailed": "El registro no se pudo leer.",
      "audit.twoHands": "Este registro lo abren dos manos: el organismo nombra la app en su espacio de filas, y tú apruebas el permiso organism:rows al iniciar sesión.",
      "audit.more": "Mostrar {n} más",
      "feedback.title": "Deja tu opinión",
      "feedback.topic": "Tema",
      "feedback.message": "Mensaje",
      "feedback.contact": "Cómo contactarte (opcional)",
      "feedback.send": "Enviar",
      "feedback.sent": "Gracias. Tu mensaje llegó.",
      "feedback.failed": "No se pudo enviar.",
      "feedback.messageRequired": "Hace falta un mensaje.",
      "reviewer.line": "Revisado por {name}, que responde por esta app.",
      "reviewer.lifts": "Una revisión con nombre levanta la etiqueta visible de contenido de IA donde la ley lo permite; el aviso de que interactúas con una IA no se levanta nunca.",
      "reviewer.law": "Reglamento europeo de IA, artículo 50",
      "marks.title": "Marcas en la app servida",
      "marks.badge": "La insignia “publica tu propia app”",
      "marks.badgeOn": "Se muestra en la app servida.",
      "marks.badgeOff": "Oculta.",
      "marks.install": "La oferta de instalación del navegador",
      "marks.installOn": "Se ofrece en la app servida.",
      "marks.installOff": "Oculta.",
      "marks.turnOn": "Activar",
      "marks.turnOff": "Desactivar",
      "marks.ownerOnly": "Estos interruptores pertenecen al dueño de la app.",
      "marks.saveFailed": "El cambio no se aplicó.",
      "sample.badge": "Contenido de muestra",
      "sample.formNote": "Una muestra — desde aquí no se envía nada."
    }
  };
  function tc(key, vars) {
    const hosted = i18n.t("commercial." + key, vars);
    if (hosted !== "commercial." + key) return hosted;
    const lang = i18n.lang();
    const table2 = (
      /** @type {Record<string, string>} */
      STRINGS[
        /** @type {'en'|'fi'|'es'} */
        lang
      ] || STRINGS.en
    );
    const text = table2[key] || STRINGS.en[key] || key;
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, function(whole, name) {
      return vars[name] == null ? whole : String(vars[name]);
    });
  }

  // src/static/sdk-libs/atelier/commercial.js
  var LAW_URL = "https://eur-lex.europa.eu/eli/reg/2024/1689/oj#art_50";
  var KINDS = ["terms", "privacy", "imprint", "refunds", "accessibility", "cookies", "support"];
  function isPlaceholder(v) {
    return /^\s*</.test(String(v == null ? "" : v));
  }
  function wantsSample(spec, keys) {
    if (spec && spec.sample === true) return true;
    for (const k of keys || []) if (spec && isPlaceholder(spec[k])) return true;
    return false;
  }
  function sampleBadge() {
    return el("span", { class: "ak-com-sample" }, tc("sample.badge"));
  }
  var SAMPLE_LEGAL = {
    legal: {
      terms: { format: "markdown", updatedAt: "2026-08-29T16:12:00Z" },
      privacy: { format: "markdown", updatedAt: "2026-08-29T16:12:00Z" },
      imprint: { format: "markdown", updatedAt: "2026-08-29T16:12:00Z" },
      cookies: { format: "markdown", updatedAt: "2026-08-29T16:12:00Z" },
      support: { format: "markdown", updatedAt: "2026-08-29T16:12:00Z" }
    },
    links: [],
    readiness: {
      recommended: KINDS.slice(),
      missing: ["refunds", "accessibility"]
    }
  };
  var SAMPLE_AUDIT_ROWS = [
    { occurredAt: "2026-08-30T19:12:00Z", body: { kind: "order", detail: "forty loaves for Harvest Fest", actor: "kim@node" } },
    { occurredAt: "2026-08-29T17:38:00Z", body: { kind: "legal.set", detail: "privacy · markdown", actor: "kim@node" } },
    { occurredAt: "2026-08-29T16:12:00Z", body: { kind: "other", detail: "published v1 (ai-generated, declared)", actor: "kim@node" } }
  ];
  function apiBase() {
    const ns = (
      /** @type {any} */
      window.AIMEAT
    );
    if (ns && ns.auth && ns.auth.nodeUrl) return String(ns.auth.nodeUrl).replace(/\/+$/, "");
    return APEX_URL;
  }
  function selfRef(spec) {
    if (spec && spec.owner && spec.filename) return { owner: String(spec.owner), filename: String(spec.filename) };
    const ref = appRef();
    if (ref) return ref;
    const meta = document.querySelector('meta[name="aimeat-app"]');
    const filename = spec && spec.filename ? String(spec.filename) : meta && meta.getAttribute("content") || null;
    return filename && spec && spec.owner ? { owner: String(spec.owner), filename } : null;
  }
  function ownerPart(principal) {
    let s = String(principal || "");
    const hash = s.lastIndexOf("#");
    if (hash >= 0) s = s.slice(hash + 1);
    const at = s.indexOf("@");
    return at >= 0 ? s.slice(0, at) : s;
  }
  function legalPath(ref) {
    return apiBase() + "/v1/apps/" + encodeURIComponent(ref.owner) + "/" + encodeURIComponent(ref.filename) + "/legal";
  }
  async function fetchLegal(ref) {
    const res = await fetch(legalPath(ref), { headers: { Accept: "application/json" } });
    const body = await res.json().catch(function() {
      return null;
    });
    if (!body || body.ok === false) throw new Error(body && body.error && body.error.message || "legal state unavailable");
    return body.data;
  }
  function readinessSentence(readiness) {
    const sells = (readiness && readiness.recommended || []).length > 2;
    return tc(sells ? "legal.readinessSells" : "legal.readinessPlain");
  }
  function legalLinks(spec) {
    const s = spec || {};
    const root = el("section", { class: "ak-root ak-com ak-com-legal" });
    if (s.target) resolve(s.target).appendChild(root);
    const ref = selfRef(s);
    function render(data, sample) {
      clear(root);
      root.appendChild(el("h3", { class: "ak-com__title" }, [
        s.title || tc("legal.title"),
        sample ? sampleBadge() : null
      ].filter(Boolean)));
      root.appendChild(el("p", { class: "ak-com__intro" }, tc("legal.intro")));
      if (!data) {
        emptyState({ target: root, tone: "quiet", title: tc("legal.loadFailed") });
        return;
      }
      const readiness = data.readiness || { recommended: [], missing: [] };
      const missing = readiness.missing || [];
      root.appendChild(el(
        "p",
        { class: "ak-com__aside" },
        readinessSentence(readiness) + " " + (missing.length ? tc("legal.readinessMissing", { n: missing.length }) : tc("legal.readinessOk"))
      ));
      const listEl = el("div", { class: "ak-com-legal__rows" });
      for (const kind of KINDS) {
        const st = data.legal && data.legal[kind];
        let link = null;
        for (const l of data.links || []) if (l.kind === kind) link = l;
        const isMissing = missing.indexOf(kind) >= 0;
        const state = st ? el(
          "span",
          { class: "ak-com-state ak-com-state--on" },
          st.format + " · " + String(st.updatedAt || "").split("T")[0]
        ) : el(
          "span",
          { class: "ak-com-state" + (isMissing ? " ak-com-state--missing" : "") },
          tc(isMissing ? "legal.missing" : "legal.none")
        );
        const head = el("div", { class: "ak-com-legal__head" }, [
          el("span", { class: "ak-com-legal__name" }, tc("kind." + kind + ".title")),
          state,
          link ? el("a", {
            class: "ak-com-legal__open",
            href: link.href,
            target: "_blank",
            rel: "noopener noreferrer"
          }, tc("legal.open") + " →") : null
        ].filter(Boolean));
        const row = el("div", { class: "ak-com-legal__row" + (isMissing ? " is-missing" : "") }, [head]);
        if (s.showWhy !== false) row.appendChild(el("p", { class: "ak-com-legal__why" }, tc("kind." + kind + ".why")));
        listEl.appendChild(row);
      }
      root.appendChild(listEl);
      enter(root);
    }
    function reload() {
      clear(root);
      if (wantsSample(s, ["owner", "filename"])) {
        render(SAMPLE_LEGAL, true);
        return;
      }
      if (!ref) {
        render(null);
        return;
      }
      const wait = skeleton({ target: root, rows: 3 });
      fetchLegal(ref).then(
        function(data) {
          wait.destroy();
          render(data);
        },
        function() {
          wait.destroy();
          render(null);
        }
      );
    }
    reload();
    return { el: root, reload, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }
  function readinessChip(spec) {
    const s = spec || {};
    const root = el("button", { type: "button", class: "ak-root ak-com-chip", hidden: true, on: {
      click: function() {
        if (s.onPick) s.onPick();
      }
    } });
    if (s.target) resolve(s.target).appendChild(root);
    if (wantsSample(s, ["owner", "filename"])) {
      root.textContent = "■ " + tc("chip.pages", { n: 2 });
      root.setAttribute("disabled", "");
      root.hidden = false;
      enter(root);
      return { el: root, destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      } };
    }
    const ref = selfRef(s);
    const who = s.session ? ownerPart(s.session.ghii || s.session.gaii) : "";
    if (ref && who && who === ownerPart(ref.owner)) {
      fetchLegal(ref).then(function(data) {
        const n = (data.readiness && data.readiness.missing || []).length;
        if (!n) return;
        root.textContent = "■ " + tc("chip.pages", { n });
        root.hidden = false;
        enter(root);
      }, function() {
      });
    }
    return { el: root, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }
  function legalPageFrame(spec) {
    const title = spec.title || (spec.kind ? tc("kind." + spec.kind + ".title") : "");
    const body = el("div", { class: "ak-com-frame__body" });
    if (spec.html != null) body.innerHTML = spec.html;
    else for (const para of String(spec.text || "").split(/\n{2,}/)) {
      if (para.trim()) body.appendChild(el("p", {}, para.trim()));
    }
    const root = el("article", { class: "ak-root ak-com ak-com-frame" }, [
      el("p", { class: "ak-com-frame__crumb" }, spec.appName),
      el("h2", { class: "ak-com-frame__title" }, title),
      el("p", { class: "ak-com-frame__meta" }, tc("frame.updated", {
        who: spec.publishedBy,
        app: spec.appName,
        date: String(spec.updatedAt || "").split("T")[0] || ""
      })),
      body,
      el("footer", { class: "ak-com-frame__footer" }, tc("frame.footer"))
    ]);
    if (spec.target) resolve(spec.target).appendChild(root);
    enter(root);
    return { el: root, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }
  function auditTrail(spec) {
    const root = el("section", { class: "ak-root ak-com ak-com-audit" });
    if (spec.target) resolve(spec.target).appendChild(root);
    let shown = Math.max(1, Math.min(100, spec.limit || 12));
    function head() {
      clear(root);
      root.appendChild(el("h3", { class: "ak-com__title" }, spec.title || tc("audit.title")));
      root.appendChild(el("p", { class: "ak-com__intro" }, spec.hint || tc("audit.intro")));
    }
    function renderRows(rows, sample) {
      head();
      if (sample) {
        const h = root.querySelector(".ak-com__title");
        if (h) h.appendChild(sampleBadge());
      }
      if (!rows.length) {
        emptyState({ target: root, tone: "quiet", title: tc("audit.empty") });
        return;
      }
      const ol = el("ol", { class: "ak-com-audit__rows" });
      for (const r of rows.slice(0, shown)) {
        const b = r.body || {};
        ol.appendChild(el("li", { class: "ak-com-audit__row" }, [
          el("span", { class: "ak-com-audit__when" }, String(r.occurred_at || r.occurredAt || "").replace("T", " ").slice(0, 16)),
          el(
            "span",
            { class: "ak-com-audit__what" },
            [b.kind, b.detail && typeof b.detail === "string" ? b.detail : null].filter(Boolean).join(" · ") || "·"
          ),
          el("span", { class: "ak-com-audit__who" }, ownerPart(b.actor || ""))
        ]));
      }
      root.appendChild(ol);
      if (rows.length > shown) {
        root.appendChild(el("button", { type: "button", class: "ak-btn ak-btn--ghost", on: {
          click: function() {
            shown += 25;
            renderRows(rows);
          }
        } }, tc("audit.more", { n: rows.length - shown })));
      }
      enter(root);
    }
    function renderRefusal(err) {
      head();
      emptyState({ target: root, tone: "quiet", title: String(err && err.message || tc("audit.loadFailed")), hint: tc("audit.twoHands") });
    }
    function reload() {
      if (wantsSample(spec, ["org", "ws", "space"])) {
        renderRows(SAMPLE_AUDIT_ROWS, true);
        return;
      }
      const ns = (
        /** @type {any} */
        window.AIMEAT
      );
      if (!ns || !ns.rows) {
        head();
        emptyState({ target: root, tone: "quiet", title: tc("audit.loadFailed"), hint: "aimeat-rows.js" });
        return;
      }
      head();
      const wait = skeleton({ target: root, rows: 3 });
      ns.rows.read(spec.org, spec.ws, spec.space, { limit: 200, order: "desc", where: spec.where }).then(
        function(out) {
          wait.destroy();
          renderRows(out && out.rows || []);
        },
        function(err) {
          wait.destroy();
          renderRefusal(err);
        }
      );
    }
    reload();
    return { el: root, reload, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }
  function recordEvent(ev) {
    const ns = (
      /** @type {any} */
      window.AIMEAT
    );
    if (!ns || !ns.rows) return Promise.reject(new Error("aimeat-rows.js is not loaded"));
    const at = ev.occurredAt || (/* @__PURE__ */ new Date()).toISOString();
    return ns.rows.append(
      ev.org,
      ev.ws,
      ev.space,
      { app: ev.app, kind: ev.kind, actor: ev.actor, at, detail: ev.detail == null ? null : ev.detail },
      { rowId: ev.rowId, occurredAt: at }
    );
  }
  function feedbackForm(spec) {
    const names = { topic: "topic", message: "message", contact: "contact", ...spec.fields || {} };
    const sample = wantsSample(spec, ["org", "ws", "formId"]);
    const root = el("section", { class: "ak-root ak-com ak-com-feedback" });
    if (spec.target) resolve(spec.target).appendChild(root);
    root.appendChild(el("h3", { class: "ak-com__title" }, [
      spec.title || tc("feedback.title"),
      sample ? sampleBadge() : null
    ].filter(Boolean)));
    if (spec.hint) root.appendChild(el("p", { class: "ak-com__intro" }, spec.hint));
    if (sample) root.appendChild(el("p", { class: "ak-com__intro" }, tc("sample.formNote")));
    const done = el("p", { class: "ak-com__aside", hidden: true }, tc("feedback.sent"));
    const f = form({
      target: root,
      submitLabel: tc("feedback.send"),
      fields: [
        { name: names.topic, label: tc("feedback.topic"), type: "text", maxLength: 200 },
        { name: names.message, label: tc("feedback.message"), type: "textarea", required: true, maxLength: 4e3 },
        { name: names.contact, label: tc("feedback.contact"), type: "text", maxLength: 200 }
      ],
      onSubmit(values) {
        if (sample) throw { field: names.message, message: tc("sample.formNote") };
        const ns = (
          /** @type {any} */
          window.AIMEAT
        );
        if (!ns || !ns.intake) throw { field: names.message, message: tc("feedback.failed") };
        if (!String(values[names.message] || "").trim()) throw { field: names.message, message: tc("feedback.messageRequired") };
        const hp = (
          /** @type {HTMLInputElement|null} */
          root.querySelector(".ak-com-hp input")
        );
        const payload = { ...values };
        payload.company_url = hp ? hp.value : "";
        return ns.intake.submit(spec.org, spec.ws, spec.formId, payload).then(function() {
          f.setValues({ [names.topic]: "", [names.message]: "", [names.contact]: "" });
          done.hidden = false;
        }, function(err) {
          throw { field: names.message, message: String(err && err.message || tc("feedback.failed")) };
        });
      }
    });
    f.el.appendChild(el("div", { class: "ak-com-hp", "aria-hidden": "true" }, [
      el("input", { type: "text", name: "company_url", tabindex: "-1", autocomplete: "off" })
    ]));
    root.appendChild(done);
    enter(root);
    return { el: root, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }
  function reviewerLine(spec) {
    const s = spec || {};
    const sample = wantsSample(s, ["name"]);
    const meta = document.querySelector('meta[name="aimeat-reviewed-by"]');
    const name = sample ? "Kim Virtanen" : s.name || meta && meta.getAttribute("content") || "";
    const root = el("aside", { class: "ak-root ak-com ak-com-reviewer", hidden: !name });
    if (name) {
      if (sample) root.appendChild(sampleBadge());
      root.appendChild(el("p", { class: "ak-com-reviewer__line" }, tc("reviewer.line", { name })));
      root.appendChild(el("p", { class: "ak-com-reviewer__lifts" }, [
        el("span", {}, tc("reviewer.lifts") + " "),
        el("a", { href: LAW_URL, target: "_blank", rel: "noopener noreferrer" }, tc("reviewer.law") + " →")
      ]));
    }
    if (s.target) resolve(s.target).appendChild(root);
    if (name) enter(root);
    return { el: root, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }
  function marksSwitches(spec) {
    const s = spec || {};
    const sample = wantsSample(s, ["filename"]);
    const root = el("section", { class: "ak-root ak-com ak-com-marks", hidden: true });
    if (s.target) resolve(s.target).appendChild(root);
    const ref = selfRef(s);
    const session = s.session || null;
    let marks = null;
    let busyNow = false;
    function sessionFetch(path, opts) {
      if (session && typeof session.fetch === "function") return session.fetch(path, opts).then(function(r) {
        return r && typeof r.json === "function" ? r.json() : r;
      });
      return Promise.reject(new Error("no session"));
    }
    function switchRow(key) {
      const on = marks[key] !== false;
      return el("div", { class: "ak-com-marks__row" }, [
        el("span", { class: "ak-com-marks__name" }, tc("marks." + key)),
        el("span", { class: "ak-com-marks__meaning" }, tc("marks." + key + (on ? "On" : "Off"))),
        el("button", { type: "button", class: "ak-btn ak-btn--ghost", disabled: busyNow || sample ? true : null, on: {
          click: function() {
            if (busyNow || sample) return;
            busyNow = true;
            render();
            const next = {};
            next[key] = !on;
            sessionFetch("/v1/apps/" + encodeURIComponent(ref.filename), {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ marks: next })
            }).then(function(res) {
              busyNow = false;
              if (res && res.ok !== false && res.data && res.data.marks) {
                marks = { badge: res.data.marks.badge !== false, install: res.data.marks.install !== false };
              } else if (res && res.error) {
                marks[key] = on;
              }
              render();
            }, function() {
              busyNow = false;
              render();
            });
          }
        } }, tc(on ? "marks.turnOff" : "marks.turnOn"))
      ]);
    }
    function render() {
      clear(root);
      root.appendChild(el("h3", { class: "ak-com__title" }, [
        s.title || tc("marks.title"),
        sample ? sampleBadge() : null
      ].filter(Boolean)));
      root.appendChild(el("div", {}, [switchRow("badge"), switchRow("install")]));
      root.appendChild(el("p", { class: "ak-com__intro" }, tc("marks.ownerOnly")));
    }
    function reload() {
      if (sample) {
        marks = { badge: true, install: false };
        root.hidden = false;
        render();
        enter(root);
        return;
      }
      if (!ref || !session) return;
      const who = ownerPart(session.ghii || session.gaii);
      if (!who || who !== ownerPart(ref.owner)) return;
      sessionFetch("/v1/apps?limit=200").then(function(res) {
        const apps = res && res.data && res.data.apps || [];
        for (const a of apps) {
          if (a.filename === ref.filename) {
            const m = a.manifest && a.manifest.marks || {};
            marks = { badge: m.badge !== false, install: m.install !== false };
            root.hidden = false;
            render();
            enter(root);
            return;
          }
        }
      }, function() {
      });
    }
    reload();
    return { el: root, reload, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }

  // src/static/sdk-libs/atelier/mtv.js
  function rowsOf(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  }
  function crt(spec) {
    const s = spec || {};
    const root = el("figure", { class: "ak-root ak-crt" });
    if (s.target) resolve(s.target).appendChild(root);
    const d = s.data || null;
    if (!d || !d.title && !d.artist) {
      const e = s.empty || {};
      emptyState({ target: root, tone: "quiet", title: e.title || s.title || "CRT", hint: e.hint });
      return { el: root, destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      } };
    }
    root.appendChild(el("div", { class: "ak-crt__status" }, [
      el("span", {}, d.channel || ""),
      el("span", { class: "ak-crt__status-mid" }, d.status || ""),
      d.live ? el("span", { class: "ak-crt__live" }, "● LIVE") : null
    ].filter(Boolean)));
    const bars = Array.isArray(d.bars) && d.bars.length ? d.bars : [0.35, 0.7, 0.5, 0.9, 0.6, 0.8, 0.45, 0.65];
    const screen = el("div", { class: "ak-crt__screen", "aria-hidden": "true" });
    const vu2 = el("div", { class: "ak-crt__vu" });
    bars.slice(0, 16).forEach(function(v, i) {
      const h = Math.round(Math.max(0.06, Math.min(Number(v) || 0, 1)) * 100);
      vu2.appendChild(el("span", {
        class: "ak-crt__bar ak-crt__bar--" + (i % 4 + 1),
        style: "height:" + h + "%"
      }));
    });
    screen.appendChild(vu2);
    root.appendChild(screen);
    root.appendChild(el("figcaption", { class: "ak-crt__credits" }, [
      d.artist ? el("strong", { class: "ak-crt__artist" }, d.artist) : null,
      d.title ? el("em", { class: "ak-crt__title" }, "“" + d.title + "”") : null,
      d.meta ? el("span", { class: "ak-crt__meta" }, d.meta) : null
    ].filter(Boolean)));
    const p = d.progress;
    if (p && p.total > 0) {
      const pct = Math.round(Math.max(0, Math.min(p.value / p.total, 1)) * 100);
      root.appendChild(el("div", { class: "ak-crt__foot" }, [
        el("span", {}, "TRACKING " + p.value + " / " + p.total),
        el(
          "span",
          { class: "ak-crt__track", "aria-hidden": "true" },
          [el("span", { class: "ak-crt__track-fill", style: "width:" + pct + "%" })]
        ),
        d.note ? el("span", {}, d.note) : null
      ].filter(Boolean)));
    } else if (d.note) {
      root.appendChild(el("div", { class: "ak-crt__foot" }, [el("span", {}, d.note)]));
    }
    enter(root);
    return { el: root, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }
  function countdown(spec) {
    const s = spec || {};
    const root = el("ol", { class: "ak-root ak-countdown" });
    if (s.target) resolve(s.target).appendChild(root);
    const rows = rowsOf(s.data);
    if (!rows.length) {
      const e = s.empty || {};
      emptyState({ target: root, tone: "quiet", title: e.title || s.title || "—", hint: e.hint });
      return { el: root, destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      } };
    }
    rows.forEach(function(row, i) {
      const rank = row.rank != null ? row.rank : rows.length - i;
      const li = el("li", { class: "ak-countdown__row ak-countdown__row--" + (i % 4 + 1), on: s.onPick ? {
        click: function() {
          s.onPick(row);
        }
      } : void 0 }, [
        el("span", { class: "ak-countdown__rank" }, String(rank)),
        el("span", { class: "ak-countdown__body" }, [
          el("span", { class: "ak-countdown__title" }, String(row.title || "")),
          row.sub ? el("span", { class: "ak-countdown__sub" }, String(row.sub)) : null
        ].filter(Boolean)),
        row.votes != null ? el("span", { class: "ak-countdown__votes" }, "♥ " + row.votes) : null
      ].filter(Boolean));
      root.appendChild(li);
    });
    enter(root);
    return { el: root, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }
  function crawl(spec) {
    const s = spec || {};
    const root = el("p", {
      class: "ak-root ak-crawl" + (s.tone === "ink" ? " ak-crawl--ink" : "")
    });
    if (s.target) resolve(s.target).appendChild(root);
    const items = rowsOf(s.data).map(function(x) {
      return typeof x === "string" ? x : String(x && x.text || "");
    }).filter(Boolean);
    root.textContent = items.length ? "★ " + items.join("  ★  ") : "★";
    enter(root);
    return { el: root, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }

  // src/static/sdk-libs/atelier/atlas.js
  var SVG_NS5 = "http://www.w3.org/2000/svg";
  function svg5(name, attrs) {
    const node = document.createElementNS(SVG_NS5, name);
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
    return node;
  }
  var TONES6 = ["ok", "warn", "err"];
  var geoPromise = null;
  function ensureGeometry() {
    if (geoPromise) return geoPromise;
    geoPromise = fetch(NODE_URL + "/lib/aimeat-atlas@1.json").then(function(res) {
      if (!res.ok) throw new Error("atlas geometry " + res.status);
      return res.json();
    }).catch(function(err) {
      geoPromise = null;
      throw err;
    });
    return geoPromise;
  }
  function atlas(spec) {
    const root = el("figure", { class: "ak-root ak-atlas", role: "img" });
    if (spec.target) resolve(spec.target).appendChild(root);
    const wait = skeleton({ target: root, rows: 3 });
    let destroyed = false;
    let geo = null;
    let pending = spec.data === void 0 ? null : spec.data;
    ensureGeometry().then(function(loaded) {
      if (destroyed) return;
      wait.destroy();
      geo = loaded;
      render(pending);
    }).catch(function() {
      if (destroyed) return;
      wait.destroy();
      emptyState({
        target: root,
        title: spec.empty && spec.empty.title || t("atlasDown"),
        hint: spec.empty && spec.empty.hint || ""
      });
    });
    function matchRegion(row, byName, byId) {
      if (row.id != null && byId.has(String(row.id))) return byId.get(String(row.id));
      if (row.name) return byName.get(String(row.name).toLowerCase()) || null;
      return null;
    }
    function project(lon, lat) {
      return [(lon + 180) / 360 * geo.w, (90 - lat) / 180 * geo.h];
    }
    function render(data) {
      clear(root);
      const regions = data && Array.isArray(data.regions) ? data.regions : [];
      const markers = data && Array.isArray(data.markers) ? data.markers : [];
      const byName = /* @__PURE__ */ new Map();
      const byId = /* @__PURE__ */ new Map();
      for (const c of geo.countries) {
        byName.set(c.name.toLowerCase(), c);
        byId.set(c.id, c);
      }
      let maxValue = 0;
      const matched = [];
      const extent = [Infinity, Infinity, -Infinity, -Infinity];
      function grow(x0, y0, x1, y1) {
        if (x0 < extent[0]) extent[0] = x0;
        if (y0 < extent[1]) extent[1] = y0;
        if (x1 > extent[2]) extent[2] = x1;
        if (y1 > extent[3]) extent[3] = y1;
      }
      for (const row of regions) {
        const c = matchRegion(row, byName, byId);
        if (!c) continue;
        matched.push({ row, country: c });
        if (typeof row.value === "number" && row.value > maxValue) maxValue = row.value;
        grow(c.bbox[0], c.bbox[1], c.bbox[2], c.bbox[3]);
      }
      for (const m of markers) {
        if (typeof m.lon !== "number" || typeof m.lat !== "number") continue;
        const [x, y] = project(m.lon, m.lat);
        grow(x - 2, y - 2, x + 2, y + 2);
      }
      let vb = [0, 0, geo.w, geo.h];
      if (spec.fit !== "world" && extent[0] < extent[2]) {
        const padX = Math.max((extent[2] - extent[0]) * 0.25, 3);
        const padY = Math.max((extent[3] - extent[1]) * 0.25, 2);
        let x0 = Math.max(0, extent[0] - padX);
        let y0 = Math.max(0, extent[1] - padY);
        let x1 = Math.min(geo.w, extent[2] + padX);
        let y1 = Math.min(geo.h, extent[3] + padY);
        const minW = Math.max((extent[2] - extent[0]) * 3, 22);
        if (x1 - x0 < minW) {
          const cx = (x0 + x1) / 2;
          x0 = Math.max(0, cx - minW / 2);
          x1 = Math.min(geo.w, cx + minW / 2);
        }
        if (y1 - y0 < (x1 - x0) / 2) {
          const cy = (y0 + y1) / 2;
          const half = (x1 - x0) / 4;
          y0 = Math.max(0, cy - half);
          y1 = Math.min(geo.h, cy + half);
        }
        vb = [x0, y0, x1 - x0, y1 - y0];
      }
      root.setAttribute("aria-label", (spec.title ? spec.title + " — " : "") + matched.map(function(m) {
        return m.country.name + (m.row.value != null ? " " + m.row.value : "");
      }).join(", "));
      const node = svg5("svg", { viewBox: vb.join(" "), class: "ak-atlas__svg", "aria-hidden": "true" });
      const still = reducedMotion();
      for (const c of geo.countries) node.appendChild(svg5("path", { d: c.d, class: "ak-atlas__land" }));
      matched.forEach(function(m, i) {
        const tone = TONES6.indexOf(m.row.tone) >= 0 ? m.row.tone : null;
        const attrs = { d: m.country.d, class: "ak-atlas__region" + (tone ? " ak-atlas__region--" + tone : "") };
        if (!tone) {
          const frac = maxValue > 0 && typeof m.row.value === "number" ? m.row.value / maxValue : 1;
          attrs.style = "fill: var(--ak-accent); fill-opacity: " + (0.25 + 0.75 * frac).toFixed(3);
        }
        const path = svg5("path", attrs);
        if (!still) {
          path.classList.add("ak-atlas__region--enter");
          path.style.animationDelay = i * 40 + "ms";
        }
        if (spec.onPick) {
          path.classList.add("ak-atlas__region--pick");
          path.addEventListener("click", function() {
            spec.onPick(m.row);
          });
        }
        node.appendChild(path);
      });
      const dotR = vb[2] / 160;
      markers.forEach(function(m, i) {
        if (typeof m.lon !== "number" || typeof m.lat !== "number") return;
        const [x, y] = project(m.lon, m.lat);
        const tone = TONES6.indexOf(m.tone) >= 0 ? m.tone : null;
        const dot = svg5("circle", { cx: x, cy: y, r: dotR, class: "ak-atlas__marker" + (tone ? " ak-atlas__marker--" + tone : "") });
        if (!still) {
          dot.classList.add("ak-atlas__marker--enter");
          dot.style.animationDelay = 120 + i * 60 + "ms";
        }
        node.appendChild(dot);
        if (m.label) {
          const label = svg5("text", { x: x + dotR * 1.8, y: y + dotR * 0.8, class: "ak-atlas__label", "font-size": String(Math.max(vb[2] / 60, 4)) });
          label.textContent = String(m.label);
          node.appendChild(label);
        }
      });
      root.appendChild(node);
      if (!matched.length && !markers.length) {
        root.appendChild(el("figcaption", { class: "ak-atlas__note", text: spec.empty && spec.empty.title || t("empty") }));
      }
    }
    return {
      el: root,
      set: function(patch) {
        if (!patch || !("data" in patch)) return;
        pending = patch.data;
        if (geo) render(patch.data);
      },
      destroy: function() {
        destroyed = true;
        root.remove();
      }
    };
  }

  // src/static/sdk-libs/atelier/map.js
  var leafletPromise = null;
  function ensureLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function(ok, fail) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = NODE_URL + "/lib/leaflet@1/leaflet.css";
      document.head.appendChild(css);
      const s = document.createElement("script");
      s.src = NODE_URL + "/lib/leaflet@1/leaflet.js";
      s.onload = function() {
        ok(window.L);
      };
      s.onerror = function() {
        leafletPromise = null;
        fail(new Error("leaflet failed to load"));
      };
      document.head.appendChild(s);
    });
    return leafletPromise;
  }
  var TONES7 = ["ok", "warn", "err"];
  function map(spec) {
    const root = el("figure", { class: "ak-root ak-map" });
    if (spec.target) resolve(spec.target).appendChild(root);
    if (spec.title) root.appendChild(el("figcaption", { class: "ak-map__title" }, spec.title));
    const stage = el("div", { class: "ak-map__stage" });
    root.appendChild(stage);
    const wait = skeleton({ target: stage, rows: 3 });
    let destroyed = false;
    let world = null;
    let pending = spec.data === void 0 ? null : spec.data;
    ensureLeaflet().then(function(L) {
      if (destroyed) return;
      wait.destroy();
      const leaflet = L.map(stage, { zoomControl: true, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        // The licence's condition, and simple honesty about whose map this is.
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(leaflet);
      const layer = L.layerGroup().addTo(leaflet);
      world = { L, leaflet, layer };
      render(pending);
    }).catch(function() {
      if (destroyed) return;
      wait.destroy();
      emptyState({
        target: stage,
        title: spec.empty && spec.empty.title || t("atlasDown"),
        hint: spec.empty && spec.empty.hint || ""
      });
    });
    function pinIcon(L, tone) {
      const cls = TONES7.indexOf(tone) >= 0 ? " ak-map__pin--" + tone : "";
      return L.divIcon({
        className: "ak-map__pinwrap",
        html: '<span class="ak-map__pin' + cls + '"></span>',
        iconSize: [26, 32],
        iconAnchor: [13, 30],
        popupAnchor: [0, -28]
      });
    }
    function render(data) {
      if (!world) {
        pending = data;
        return;
      }
      const L = world.L;
      world.layer.clearLayers();
      const markers = data && Array.isArray(data.markers) ? data.markers.filter(function(m) {
        return typeof m.lon === "number" && typeof m.lat === "number";
      }) : [];
      for (const m of markers) {
        const pin = L.marker([m.lat, m.lon], { icon: pinIcon(L, m.tone) });
        if (m.label) pin.bindPopup(String(m.label));
        if (spec.onPick) pin.on("click", function() {
          spec.onPick(m);
        });
        pin.addTo(world.layer);
      }
      if (markers.length > 1) {
        world.leaflet.fitBounds(L.latLngBounds(markers.map(function(m) {
          return [m.lat, m.lon];
        })), { padding: [36, 36] });
      } else if (markers.length === 1) {
        world.leaflet.setView([markers[0].lat, markers[0].lon], data && data.zoom || spec.zoom || 12);
      } else if (data && data.center) {
        world.leaflet.setView([data.center.lat, data.center.lon], data.zoom || spec.zoom || 10);
      } else {
        world.leaflet.setView([30, 10], 2);
      }
    }
    return {
      el: root,
      set: function(patch) {
        if (!patch || !("data" in patch)) return;
        pending = patch.data;
        render(patch.data);
      },
      destroy: function() {
        destroyed = true;
        if (world) world.leaflet.remove();
        root.remove();
        clear(stage);
      }
    };
  }

  // src/static/sdk-libs/atelier/mosaic.js
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
        case "aide": {
          alive.handles.push(aide({
            target: into,
            appName: p.title || document.title,
            intro: p.intro,
            appId: p.title,
            sources: spec.sources || {},
            actions: spec.actions || []
          }));
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
        case "rating":
          return bound("rating", function(data) {
            const d = patchFor("rating", data).data || {};
            return rating({ target: into, value: Number(d.value) || 0, max: d.max, count: d.count, label: d.label || p.title });
          });
        case "steps":
          return bound("steps", function(data) {
            return steps({ target: into, data: patchFor("steps", data).data, empty });
          });
        case "list":
          return bound("list", function(data) {
            return list({ target: into, items: patchFor("list", data).items, empty, onPick: pick });
          });
        case "cardGrid":
          return bound("cardGrid", function(data) {
            return cardGrid({ target: into, items: patchFor("cardGrid", data).items, empty, onPick: pick });
          });
        case "chart":
          return bound("chart", function(data) {
            return chart({
              target: into,
              data: patchFor("chart", data).data,
              title: p.title,
              empty,
              presentation: p.presentation === "mural" ? "mural" : "tile",
              kind: p.kind
            });
          });
        case "health":
          return bound("health", function(data) {
            return health({ target: into, data: patchFor("health", data).data, empty, onPick: pick });
          });
        case "queue":
          return bound("queue", function(data) {
            return queue({ target: into, data: patchFor("queue", data).data, empty, onPick: pick });
          });
        case "gauge":
          return bound("gauge", function(data) {
            return gauge({ target: into, data: patchFor("gauge", data).data, empty });
          });
        case "console":
          return bound("console", function(data) {
            return konsole({ target: into, data: patchFor("console", data).data, cap: p.cap, empty });
          });
        case "kanban":
          return bound("kanban", function(data) {
            return kanban({
              target: into,
              data: patchFor("kanban", data).data,
              empty,
              onMove: spec.onMove ? function(cardId, toColumn) {
                spec.onMove(block.id, cardId, toColumn);
              } : void 0
            });
          });
        case "plan":
          return bound("plan", function(data) {
            return plan({ target: into, data: patchFor("plan", data).data, empty });
          });
        case "schedule":
          return bound("schedule", function(data) {
            return schedule({ target: into, data: patchFor("schedule", data).data, empty, onPick: pick });
          });
        case "atlas":
          return bound("atlas", function(data) {
            return atlas({ target: into, data: patchFor("atlas", data).data, title: p.title, fit: p.fit, empty, onPick: pick });
          });
        case "map":
          return bound("map", function(data) {
            return map({ target: into, data: patchFor("map", data).data, title: p.title, zoom: p.zoom, empty, onPick: pick });
          });
        case "matrix":
          return bound("matrix", function(data) {
            return matrix({ target: into, data: patchFor("matrix", data).data, empty, onPick: pick });
          });
        case "graph":
          return bound("graph", function(data) {
            return graph({ target: into, data: patchFor("graph", data).data, title: p.title, empty, onPick: pick });
          });
        case "waveform":
          return bound("waveform", function(data) {
            return waveform({ target: into, data: patchFor("waveform", data).data, title: p.title, empty });
          });
        // ── The broadcast family: the CRT binds its record whole, the countdown its rows, the
        //    crawl its lines — the Music Television genre's parts in the block vocabulary.
        case "crt":
          return bound("crt", function(data) {
            return crt({ target: into, data: patchFor("crt", data).data, title: p.title, empty });
          });
        case "countdown":
          return bound("countdown", function(data) {
            return countdown({ target: into, data: patchFor("countdown", data).items, title: p.title, empty, onPick: pick });
          });
        case "crawl":
          return bound("crawl", function(data) {
            return crawl({ target: into, data: patchFor("crawl", data).items, tone: p.tone });
          });
        case "scene3d": {
          if (p.source) {
            return bound("scene3d", function(data) {
              const shaped = p.kind === "model" || p.kind === "globe" ? data && !Array.isArray(data) ? data : null : { items: patchFor("scene3d", data).items };
              return scene3d({ target: into, kind: p.kind, data: shaped, title: p.title, empty });
            });
          }
          alive.handles.push(scene3d({ target: into, kind: p.kind, title: p.title }));
          return;
        }
        case "reveal":
          return bound("reveal", function(data) {
            return reveal({ target: into, items: patchFor("reveal", data).items, mode: p.mode === "many" ? "many" : "one" });
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
        // ── The commercial side: self-sourced blocks (the app's own public legal surface, the
        //    organism row space and the intake form the props name), no memory source to bind.
        case "legalLinks": {
          alive.handles.push(legalLinks({ target: into, title: p.title }));
          return;
        }
        case "auditTrail": {
          alive.handles.push(auditTrail({
            target: into,
            org: p.org,
            ws: p.ws,
            space: p.space,
            title: p.title,
            hint: p.hint
          }));
          return;
        }
        case "feedbackForm": {
          alive.handles.push(feedbackForm({
            target: into,
            org: p.org,
            ws: p.ws,
            formId: p.formId,
            title: p.title,
            hint: p.hint
          }));
          return;
        }
        case "reviewerLine": {
          alive.handles.push(reviewerLine({ target: into }));
          return;
        }
        default:
          console.warn('aimeat-atelier: this kit build has no renderer for "' + block.component + '" — skipping block "' + block.id + '".');
      }
    }
    let viewerOverlay = spec.overlay || null;
    function applyViewerOverlay(layout, o) {
      if (!o) return layout;
      const out = { v: layout.v, look: layout.look, nav: o.nav || layout.nav, tokens: layout.tokens, meta: layout.meta, blocks: layout.blocks.slice() };
      if (Array.isArray(o.hidden) && o.hidden.length) {
        out.blocks = out.blocks.filter(function(b) {
          return o.hidden.indexOf(b.id) < 0;
        });
      }
      if (Array.isArray(o.order) && o.order.length) {
        out.blocks.sort(function(a, b) {
          const ia = o.order.indexOf(a.id);
          const ib = o.order.indexOf(b.id);
          return (ia < 0 ? o.order.length : ia) - (ib < 0 ? o.order.length : ib);
        });
      }
      return out;
    }
    function render(layout) {
      for (const h of alive.handles) {
        if (h && h.destroy) h.destroy();
      }
      for (const fn of alive.cleanup) fn();
      alive = { handles: [], bound: [], cleanup: [] };
      clear(root);
      if (!layout || !Array.isArray(layout.blocks)) return;
      layout = applyViewerOverlay(layout, viewerOverlay);
      if (layout.look && spec.app && spec.app.set) spec.app.set({ look: layout.look });
      root.setAttribute("data-ak-nav", layout.nav || "stack");
      root.setAttribute("data-ak-choreo", layout.choreography === "cinema" ? "cinema" : "still");
      const tokenHost = (
        /** @type {any} */
        spec.app && spec.app.el ? spec.app.el : root
      );
      if (tokenHost.__akTokens) {
        for (const name of tokenHost.__akTokens) tokenHost.style.removeProperty(name);
      }
      tokenHost.__akTokens = [];
      if (tokenHost.__akSigStyle) {
        tokenHost.__akSigStyle.remove();
        tokenHost.__akSigStyle = null;
      }
      if (layout.tokens && typeof layout.tokens === "object") {
        for (const name of Object.keys(layout.tokens)) {
          if (name.indexOf("--ak-") !== 0) continue;
          const value = String(layout.tokens[name]);
          if (name === "--ak-accent" && value.indexOf("/") >= 0) {
            const halves = value.split("/");
            const light = halves[0].trim();
            const dark = (halves[1] || halves[0]).trim();
            if (!/^#[0-9a-fA-F]{3,6}$/.test(light) || !/^#[0-9a-fA-F]{3,6}$/.test(dark)) continue;
            const style = document.createElement("style");
            style.textContent = ":root{--ak-accent:" + light + '}\n:root[data-theme="dark"]{--ak-accent:' + dark + "}";
            document.head.appendChild(style);
            tokenHost.__akSigStyle = style;
            continue;
          }
          tokenHost.style.setProperty(name, value);
          tokenHost.__akTokens.push(name);
        }
      }
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
      if (nav === "tabs" || nav === "bottom-bar") root.appendChild(projectPicker(units, nav, alive));
      else if (nav === "deck") root.appendChild(projectDeck(units, alive));
      else if (nav === "flow") root.appendChild(projectFlow(units));
      else if (nav === "canvas") root.appendChild(projectCanvas(units, morph));
      else if (nav === "rail") root.appendChild(projectRail(units));
      else if (nav === "overlay") root.appendChild(projectOverlay(units, alive));
      else root.appendChild(projectStack(units, alive));
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
    const stopLive = wireLive(spec, function(name) {
      api.refresh(name);
    });
    const api = {
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
      /**
       * ONE DECLARATION, FOUR DOORS: expose this mosaic's declared actions to an in-browser agent
       * through WebMCP. The same { id, summary, params, run } the buttons and the aide use
       * becomes the visiting agent's tool — same handler, same limits, nothing extra. Returns the
       * registration surface name, or 'none' when the page has no agent API or no actions.
       * @returns {Promise<string>}
       */
      async exposeActions() {
        const ns = (
          /** @type {any} */
          window.AIMEAT
        );
        if (!ns || !ns.webmcp || typeof ns.webmcp.register !== "function") return "none";
        const tools = (spec.actions || []).map(function(a) {
          const properties = {};
          const params = a.params || {};
          for (const key of Object.keys(params)) {
            properties[key] = { type: params[key] === "number" ? "number" : "string" };
          }
          return {
            name: "app-" + a.id,
            description: a.summary + " (a declared action of this app; runs the same handler its button runs).",
            inputSchema: { type: "object", properties },
            execute: async function(input) {
              const result = await Promise.resolve(a.run ? a.run(input || {}) : null);
              return typeof result === "string" ? result : "done";
            }
          };
        });
        if (!tools.length) return "none";
        return ns.webmcp.register(tools);
      },
      /**
       * The viewer's overlay: set (or clear with null) and re-render. The APP owns loading and
       * saving the overlay record (the viewer's own memory) — the mosaic only applies it.
       * @param {{ hidden?: string[], order?: string[], nav?: string }|null} o
       */
      setOverlay(o) {
        viewerOverlay = o || null;
        render(currentLayout);
      },
      /**
       * EXPLAIN THIS SCREEN, generated from the declarations rather than from a hand-written help
       * text that would drift: every visible block, its name and what it draws from, in words.
       * Returns the lines; also renders them as a designed panel when `target` is given.
       * @param {{ target?: string|Element }} [opts]
       */
      explain(opts) {
        const layout = currentLayout ? applyViewerOverlay(currentLayout, viewerOverlay) : null;
        const lines = (layout && Array.isArray(layout.blocks) ? layout.blocks : []).filter(function(b) {
          return !b.hidden;
        }).map(function(b) {
          const p = b.props || {};
          const name = p.title || labelOf(b);
          return name + " — " + b.component + (p.source ? " (" + t("open").toLowerCase() + ": " + p.source + ")" : "");
        });
        if (opts && opts.target) {
          const host2 = resolve(opts.target);
          const panel = el("div", { class: "ak-root ak-explain" }, [
            el("h3", { class: "ak-section__title", text: t("explainTitle") }),
            el("ul", { class: "ak-explain__list" }, lines.map(function(line) {
              return el("li", { text: line });
            }))
          ]);
          host2.appendChild(panel);
          enter(panel);
        }
        return lines;
      },
      destroy() {
        destroyed = true;
        stopLive();
        for (const h of alive.handles) {
          if (h && h.destroy) h.destroy();
        }
        for (const fn of alive.cleanup) fn();
        alive = { handles: [], bound: [], cleanup: [] };
        const host2 = (
          /** @type {any} */
          spec.app && spec.app.el ? spec.app.el : root
        );
        if (host2.__akSigStyle) {
          host2.__akSigStyle.remove();
          host2.__akSigStyle = null;
        }
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
    return api;
  }

  // src/static/sdk-libs/atelier/dialog.js
  var ENTER_FROM = { center: "12px", bottom: "100%" };
  var TONES8 = ["plain", "danger", "celebrate", "ai"];
  var SIZES = ["compact", "roomy", "wide"];
  function dialog(spec) {
    const from = spec.from === "bottom" ? "bottom" : "center";
    const tone = TONES8.indexOf(spec.tone || "") >= 0 ? spec.tone : "plain";
    const size = SIZES.indexOf(spec.size || "") >= 0 ? spec.size : "compact";
    const dismissible = spec.dismissible !== false;
    const node = (
      /** @type {HTMLDialogElement} */
      el("dialog", {
        class: "ak-root ak-dialog ak-dialog--" + from + " ak-dialog--" + tone + " ak-dialog--" + size,
        "aria-labelledby": "ak-dlg-title"
      })
    );
    const head = el("div", { class: "ak-dialog__head" }, [
      el("h2", { class: "ak-dialog__title", id: "ak-dlg-title", text: spec.title }),
      dismissible ? el("button", {
        type: "button",
        class: "ak-btn ak-btn--ghost ak-dialog__x",
        "aria-label": t("close"),
        on: { click: function() {
          close("dismiss");
        } }
      }, "✕") : null
    ]);
    const body = el("div", { class: "ak-dialog__body" });
    if (spec.text) body.appendChild(el("p", { class: "ak-dialog__text", text: spec.text }));
    if (spec.layout) {
      mosaic({ target: body, layout: spec.layout, sources: spec.sources || {} });
    }
    if (spec.body) spec.body(body);
    const foot = el("div", { class: "ak-dialog__actions" });
    for (const action of spec.actions || []) {
      foot.appendChild(el("button", {
        type: "button",
        class: "ak-btn ak-btn--" + (action.tone === "danger" ? "danger" : action.tone === "primary" ? "primary" : "ghost"),
        "data-ak-action": action.id,
        on: { click: function() {
          if (action.run) action.run();
        } }
      }, action.label));
    }
    node.appendChild(el(
      "div",
      { class: "ak-dialog__panel" },
      [head, body, (spec.actions || []).length ? foot : null]
    ));
    document.body.appendChild(node);
    let closed = false;
    function close(reason) {
      if (closed) return;
      closed = true;
      const done = function() {
        if (node.open) node.close();
        if (node.parentNode) node.parentNode.removeChild(node);
        if (spec.onClose) spec.onClose(reason || "close");
      };
      if (reducedMotion() || typeof node.animate !== "function") return done();
      const span = parseFloat(getComputedStyle(node).getPropertyValue("--ak-motion")) || 200;
      const anim = node.animate(
        [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(" + ENTER_FROM[from] + ")" }],
        { duration: span, easing: "ease-in" }
      );
      anim.onfinish = done;
      anim.oncancel = done;
    }
    node.addEventListener("cancel", function(ev) {
      ev.preventDefault();
      if (dismissible) close("dismiss");
    });
    if (dismissible) {
      node.addEventListener("click", function(ev) {
        if (ev.target === node) close("dismiss");
      });
    }
    node.showModal();
    if (!reducedMotion() && typeof node.animate === "function") {
      const span = parseFloat(getComputedStyle(node).getPropertyValue("--ak-motion")) || 200;
      const ease = (getComputedStyle(node).getPropertyValue("--ak-ease") || "").trim() || "cubic-bezier(0.2, 0.7, 0.3, 1)";
      node.animate(
        [{ opacity: 0, transform: "translateY(" + ENTER_FROM[from] + ")" }, { opacity: 1, transform: "none" }],
        { duration: span * 1.2, easing: ease }
      );
    }
    return {
      el: node,
      close,
      destroy() {
        close("destroy");
      }
    };
  }
  function confirm(spec) {
    return new Promise(function(resolve2) {
      let answer = false;
      const handle = dialog({
        title: spec.title,
        text: spec.text,
        from: "center",
        tone: spec.tone === "danger" ? "danger" : "plain",
        actions: [
          { id: "cancel", label: spec.cancelLabel || t("cancel"), tone: "ghost", run: function() {
            handle.close("cancel");
          } },
          {
            id: "confirm",
            label: spec.confirmLabel || t("confirm"),
            tone: spec.tone === "danger" ? "danger" : "primary",
            run: function() {
              answer = true;
              handle.close("confirm");
            }
          }
        ],
        onClose: function() {
          resolve2(answer);
        }
      });
      const go = handle.el.querySelector('[data-ak-action="confirm"]');
      if (go) go.focus();
    });
  }
  function prompt(spec) {
    return new Promise(function(resolve2) {
      let answer = null;
      let field = null;
      const handle = dialog({
        title: spec.title,
        text: spec.text,
        from: "center",
        body: function(host) {
          const id = "ak-prompt-" + Math.random().toString(36).slice(2, 8);
          host.appendChild(el("label", { class: "ak-form__label", for: id, text: spec.label }));
          field = /** @type {HTMLInputElement} */
          el(spec.multiline ? "textarea" : "input", {
            class: "ak-input ak-dialog__field",
            id,
            ...spec.placeholder ? { placeholder: spec.placeholder } : {}
          });
          if (spec.value != null) field.value = spec.value;
          if (!spec.multiline) {
            field.addEventListener("keydown", function(ev) {
              if (
                /** @type {KeyboardEvent} */
                ev.key === "Enter"
              ) {
                ev.preventDefault();
                submit();
              }
            });
          }
          host.appendChild(field);
        },
        actions: [
          { id: "cancel", label: t("cancel"), tone: "ghost", run: function() {
            handle.close("cancel");
          } },
          { id: "submit", label: spec.submitLabel || t("confirm"), tone: "primary", run: function() {
            submit();
          } }
        ],
        onClose: function() {
          resolve2(answer);
        }
      });
      function submit() {
        answer = field ? String(field.value) : null;
        handle.close("submit");
      }
      if (field) field.focus();
    });
  }
  function sheet(spec) {
    return dialog({ ...spec, from: "bottom" });
  }

  // src/static/sdk-libs/atelier/index.js
  var atelier = {
    /**
     * The library version, so an app can require a floor before using a newer component. It MUST
     * match the newest entry in the /lib/aimeat-atelier.css version history; e2e-libs.ts fails
     * when the two drift, because a version string that never moves is worse than none.
     */
    version: "0.40.0",
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
    rating,
    aide,
    delegate,
    agentActivity,
    /**
     * Read something aloud through the platform's speech library, when the page carries it.
     * Opt-in by construction: nothing speaks until the app puts a control on the screen and a
     * person presses it. Returns false when the speech library is absent, so the app can hide
     * the control instead of showing a dead one.
     * @param {Element|string} target - an element (its text is read) or the text itself
     * @returns {boolean}
     */
    readAloud(target) {
      const ns = (
        /** @type {any} */
        window.AIMEAT
      );
      if (!ns || !ns.speech || typeof ns.speech.say !== "function") return false;
      const text = target instanceof Element ? target.textContent || "" : String(target);
      if (text.trim()) ns.speech.say(text.trim());
      return true;
    },
    // ── Content ──
    list,
    listDetail,
    cardGrid,
    mediaCard,
    timeline,
    chart,
    matrix,
    graph,
    waveform,
    scene3d,
    // ── The ops family and the maps (an admin panel is an arrangement, not app code) ──
    health,
    queue,
    gauge,
    console: konsole,
    atlas,
    map,
    // ── The work-planning family (work against people and time) ──
    kanban,
    plan,
    schedule,
    steps,
    // ── The things that open ──
    reveal,
    drawer,
    dialog,
    confirm,
    prompt,
    sheet,
    // ── The commercial side (legal pages, marks, reviewer, audit trail, feedback) ──
    legalLinks,
    readinessChip,
    legalPageFrame,
    auditTrail,
    recordEvent,
    feedbackForm,
    reviewerLine,
    marksSwitches,
    // ── The broadcast family (the Music Television genre's parts as components) ──
    crt,
    countdown,
    crawl,
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
    kinetic,
    countUp,
    attention,
    // ── Scenic props (the genre stagecraft) ──
    flapify,
    ransom,
    vu,
    typeout,
    dealIn
  };
  attach("atelier", atelier);
})();
