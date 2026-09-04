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
  var MOTION_KEY = "ak.motion";
  var MOTION_ATTR = "data-ak-motion";
  function reducedMotion() {
    if (typeof document !== "undefined" && document.documentElement && document.documentElement.getAttribute(MOTION_ATTR) === "less") return true;
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function setMotion(mode) {
    const next = mode === "less" ? "less" : "auto";
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.setAttribute(MOTION_ATTR, next);
    }
    try {
      localStorage.setItem(MOTION_KEY, next);
    } catch {
    }
    try {
      window.dispatchEvent(new CustomEvent("ak-motion", { detail: { motion: next } }));
    } catch {
    }
    return next;
  }
  var motionRestored = false;
  function restoreMotion() {
    if (motionRestored || typeof document === "undefined" || !document.documentElement) return;
    motionRestored = true;
    try {
      const saved = localStorage.getItem(MOTION_KEY);
      if (saved === "less" || saved === "auto") document.documentElement.setAttribute(MOTION_ATTR, saved);
    } catch {
    }
  }
  restoreMotion();
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
    const known2 = busyMap.get(node);
    if (known2) return known2;
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
    const tick = function(now2) {
      const p = Math.min(1, (now2 - t0) / span);
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
      lessMotion: "Less motion",
      ambient: "Ambient",
      ambientOff: "Off",
      ambientCalm: "Calm",
      ambientFull: "Full",
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
      lessMotion: "Vähemmän liikettä",
      ambient: "Taustaliike",
      ambientOff: "Pois",
      ambientCalm: "Rauhallinen",
      ambientFull: "Täysi",
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
      lessMotion: "Menos movimiento",
      ambient: "Ambiente",
      ambientOff: "Apagado",
      ambientCalm: "Suave",
      ambientFull: "Completo",
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

  // src/static/sdk-libs/atelier/transitions.js
  var SCREEN_KINDS = ["fade", "wipe", "curtain", "zoom", "iris", "slide"];
  var PANEL_KINDS = ["crossfade", "slide", "flip", "morph", "push"];
  var CURTAIN_KINDS = ["band", "halves", "iris"];
  var TINTS = ["accent", "ink", "surface"];
  var DIRECTIONS = ["left", "right", "up", "down"];
  var AWAY = { left: "translateX(-100%)", right: "translateX(100%)", up: "translateY(-100%)", down: "translateY(100%)" };
  var TOWARD = { left: "translateX(100%)", right: "translateX(-100%)", up: "translateY(100%)", down: "translateY(-100%)" };
  var STAND_IN = { fade: "band", wipe: "band", slide: "band", zoom: "halves", curtain: "halves", iris: "iris" };
  var INTRO_HOLD_MS = 120;
  var INTRO_CAP_MS = 1500;
  var lastPoint = null;
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("pointerdown", function(ev) {
      lastPoint = { x: ev.clientX, y: ev.clientY };
    }, { capture: true, passive: true });
  }
  function originOf(from) {
    if (from && typeof from.x === "number" && typeof from.y === "number") return { x: from.x, y: from.y };
    if (lastPoint) return { x: lastPoint.x, y: lastPoint.y };
    const w = typeof window !== "undefined" ? window.innerWidth : 0;
    const h = typeof window !== "undefined" ? window.innerHeight : 0;
    return { x: w / 2, y: h / 2 };
  }
  function spanOf(node, ms) {
    if (ms) return ms;
    const cs = getComputedStyle(node);
    return (parseFloat(cs.getPropertyValue("--ak-motion")) || 200) * 2;
  }
  function easeOf2(node) {
    const cs = getComputedStyle(node);
    return (cs.getPropertyValue("--ak-ease") || "").trim() || "cubic-bezier(0.2, 0.7, 0.3, 1)";
  }
  function oneOf(set, value) {
    return set.indexOf(value) >= 0 ? String(value) : set[0];
  }
  function playAll(runs) {
    const settled = runs.map(function(r) {
      if (typeof r.node.animate !== "function") return Promise.resolve();
      const anim = r.node.animate(r.frames, r.timing);
      return anim.finished.then(function() {
        anim.cancel();
      }, function() {
      });
    });
    return Promise.all(settled).then(function() {
    });
  }
  function reachOf(point) {
    const w = typeof window !== "undefined" ? window.innerWidth : 0;
    const h = typeof window !== "undefined" ? window.innerHeight : 0;
    const dx = Math.max(point.x, w - point.x);
    const dy = Math.max(point.y, h - point.y);
    return Math.ceil(Math.sqrt(dx * dx + dy * dy));
  }
  function originIn(host, from) {
    const r = host.getBoundingClientRect();
    const src = from && typeof from.x === "number" ? from : lastPoint;
    if (src) {
      const x = src.x - r.left;
      const y = src.y - r.top;
      if (x >= 0 && y >= 0 && x <= r.width && y <= r.height) return { x, y };
    }
    return { x: r.width / 2, y: r.height / 2 };
  }
  function curtain(opts) {
    const o = opts || {};
    const kind = oneOf(CURTAIN_KINDS, o.kind);
    const tint = o.colour && TINTS.indexOf(o.colour) >= 0 ? o.colour : "ink";
    const dir = oneOf(DIRECTIONS, o.direction);
    const axis = dir === "up" || dir === "down" ? "y" : "x";
    const host = o.host ? (
      /** @type {HTMLElement} */
      resolve(o.host)
    ) : null;
    const point = host ? originIn(host, o.from) : originOf(o.from);
    const reach = host ? Math.ceil(Math.hypot(host.clientWidth, host.clientHeight)) : reachOf(point);
    const layer = el("div", {
      class: "ak-root ak-curtain ak-curtain--" + kind + " ak-curtain--" + tint + " ak-curtain--axis-" + axis,
      "aria-hidden": "true"
    });
    const leaves = [];
    if (kind === "halves") {
      leaves.push(el("div", { class: "ak-curtain__half ak-curtain__half--a" }));
      leaves.push(el("div", { class: "ak-curtain__half ak-curtain__half--b" }));
    } else {
      leaves.push(el("div", { class: kind === "iris" ? "ak-curtain__iris" : "ak-curtain__band" }));
    }
    const open = kind === "iris" ? ["circle(0px at " + point.x + "px " + point.y + "px)"] : kind === "halves" ? [AWAY[axis === "y" ? "up" : "left"], AWAY[axis === "y" ? "down" : "right"]] : [TOWARD[dir]];
    const shut = kind === "iris" ? ["circle(" + reach + "px at " + point.x + "px " + point.y + "px)"] : ["none", "none"];
    const past = kind === "band" ? [AWAY[dir]] : open;
    const begun = o.start === "covered" ? shut : open;
    let parked = begun;
    leaves.forEach(function(leaf, i) {
      if (kind === "iris") leaf.style.clipPath = begun[i];
      else leaf.style.transform = begun[i];
      layer.appendChild(leaf);
    });
    if (host) {
      host.classList.add("ak-curtain-host");
      layer.classList.add("ak-curtain--inset");
      host.appendChild(layer);
    } else {
      document.body.appendChild(layer);
    }
    const ms = spanOf(layer, o.duration);
    const ease = easeOf2(layer);
    let covered = o.start === "covered";
    if (covered) layer.classList.add("ak-curtain--on");
    let gone = false;
    function travel3(from, to) {
      if (gone) return Promise.resolve();
      const land = function() {
        leaves.forEach(function(leaf, i) {
          if (kind === "iris") leaf.style.clipPath = to[i];
          else leaf.style.transform = to[i];
        });
      };
      if (reducedMotion() || typeof leaves[0].animate !== "function") {
        land();
        return Promise.resolve();
      }
      const runs = leaves.map(function(leaf, i) {
        return {
          node: leaf,
          frames: kind === "iris" ? [{ clipPath: from[i] }, { clipPath: to[i] }] : [{ transform: from[i] }, { transform: to[i] }],
          timing: { duration: ms, easing: ease, fill: (
            /** @type {FillMode} */
            "both"
          ) }
        };
      });
      return playAll(runs).then(land);
    }
    return {
      cover() {
        if (covered) return Promise.resolve();
        covered = true;
        layer.classList.add("ak-curtain--on");
        const was = parked;
        parked = shut;
        return travel3(was, shut);
      },
      uncover() {
        if (!covered) return Promise.resolve();
        covered = false;
        parked = past;
        return travel3(shut, past).then(function() {
          layer.classList.remove("ak-curtain--on");
        });
      },
      destroy() {
        gone = true;
        if (layer.parentNode) layer.parentNode.removeChild(layer);
        if (host && !host.querySelector(".ak-curtain")) host.classList.remove("ak-curtain-host");
      }
    };
  }
  function intro(opts) {
    const o = opts || {};
    const hold = typeof o.hold === "number" && o.hold >= 0 ? Math.min(o.hold, INTRO_CAP_MS) : INTRO_HOLD_MS;
    const cover = curtain({
      kind: (
        /** @type {'band'|'halves'|'iris'} */
        oneOf(CURTAIN_KINDS, o.kind)
      ),
      colour: o.colour,
      start: "covered"
    });
    const waits = [new Promise(function(settle3) {
      setTimeout(settle3, hold);
    })];
    const fonts = typeof document !== "undefined" ? (
      /** @type {any} */
      document.fonts
    ) : null;
    if (fonts && fonts.ready && typeof fonts.ready.then === "function") {
      waits.push(fonts.ready.then(
        function() {
        },
        function() {
        }
      ));
    }
    let capTimer = (
      /** @type {any} */
      null
    );
    const capped = new Promise(function(settle3) {
      capTimer = setTimeout(settle3, INTRO_CAP_MS);
    });
    const done = function() {
      clearTimeout(capTimer);
    };
    return Promise.race([Promise.all(waits), capped]).then(function() {
      done();
      return cover.uncover();
    }).then(function() {
      cover.destroy();
    }, function(err) {
      done();
      cover.destroy();
      throw err;
    });
  }
  function screenTransition(kind, run, opts) {
    const o = opts || {};
    const move = oneOf(SCREEN_KINDS, kind);
    const root = document.documentElement;
    if (reducedMotion()) return Promise.resolve(run()).then(function() {
    });
    if (typeof document.startViewTransition !== "function") {
      const cover = curtain({
        kind: (
          /** @type {'band'|'halves'|'iris'} */
          STAND_IN[move]
        ),
        colour: o.colour,
        from: o.from,
        direction: o.direction,
        duration: o.duration
      });
      return cover.cover().then(function() {
        return run();
      }).then(function() {
        return cover.uncover();
      }).then(function() {
        cover.destroy();
      }, function(err) {
        cover.destroy();
        throw err;
      });
    }
    const point = originOf(o.from);
    root.setAttribute("data-ak-transition", move);
    if (o.direction && DIRECTIONS.indexOf(o.direction) >= 0) root.setAttribute("data-ak-transition-dir", o.direction);
    if (o.colour && TINTS.indexOf(o.colour) >= 0) root.setAttribute("data-ak-transition-colour", o.colour);
    root.style.setProperty("--ak-iris-x", point.x + "px");
    root.style.setProperty("--ak-iris-y", point.y + "px");
    if (o.duration) root.style.setProperty("--ak-transition-span", o.duration + "ms");
    const clear2 = function() {
      root.removeAttribute("data-ak-transition");
      root.removeAttribute("data-ak-transition-dir");
      root.removeAttribute("data-ak-transition-colour");
      root.style.removeProperty("--ak-iris-x");
      root.style.removeProperty("--ak-iris-y");
      root.style.removeProperty("--ak-transition-span");
    };
    return document.startViewTransition(run).finished.then(clear2, clear2);
  }
  function heightOf(node) {
    const cs = getComputedStyle(node);
    const box = node.getBoundingClientRect().height;
    if (cs.boxSizing === "border-box") return box;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const edge = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    return Math.max(0, box - pad - edge);
  }
  function whenMorphDone(moving, cap) {
    return new Promise(function(settle3) {
      let done = false;
      const finish = function() {
        if (done) return;
        done = true;
        if (obs) obs.disconnect();
        clearTimeout(timer);
        settle3();
      };
      const obs = typeof MutationObserver === "function" ? new MutationObserver(function() {
        if (!moving.style.viewTransitionName) finish();
      }) : null;
      if (obs) obs.observe(moving, { attributes: true, attributeFilter: ["style"] });
      const timer = setTimeout(finish, cap);
    });
  }
  function panelTransition(from, to, kind, opts) {
    const o = opts || {};
    const move = oneOf(PANEL_KINDS, kind);
    const parent = (
      /** @type {HTMLElement|null} */
      from && from.parentElement
    );
    if (!parent || !to || from === to) return Promise.resolve();
    const swap = function() {
      parent.insertBefore(to, from);
      if (from.parentNode) from.parentNode.removeChild(from);
    };
    if (reducedMotion() || typeof from.animate !== "function") {
      swap();
      return Promise.resolve();
    }
    const ms = spanOf(from, o.duration);
    const ease = easeOf2(from);
    const dir = oneOf(DIRECTIONS, o.direction);
    const moving = (
      /** @type {HTMLElement|null} */
      o.moving || null
    );
    if (move === "morph") {
      if (!moving || typeof document.startViewTransition !== "function") {
        return panelTransition(from, to, "crossfade", o);
      }
      const done = whenMorphDone(moving, ms * 6);
      morph(moving, swap);
      return done;
    }
    const outgoing = (
      /** @type {HTMLElement} */
      from
    );
    const incoming = (
      /** @type {HTMLElement} */
      to
    );
    const box = outgoing.getBoundingClientRect();
    const seat = parent.getBoundingClientRect();
    const pcs = getComputedStyle(parent);
    const startH = heightOf(parent);
    const kept = { position: parent.style.position, overflow: parent.style.overflow };
    if (pcs.position === "static") parent.style.position = "relative";
    parent.style.overflow = "hidden";
    if (move === "flip") parent.classList.add("ak-swap--flip");
    parent.insertBefore(incoming, outgoing);
    outgoing.style.position = "absolute";
    outgoing.style.boxSizing = "border-box";
    outgoing.style.margin = "0";
    outgoing.style.top = box.top - seat.top - (parseFloat(pcs.borderTopWidth) || 0) + parent.scrollTop + "px";
    outgoing.style.left = box.left - seat.left - (parseFloat(pcs.borderLeftWidth) || 0) + parent.scrollLeft + "px";
    outgoing.style.width = box.width + "px";
    outgoing.style.height = box.height + "px";
    const endH = heightOf(parent);
    const runs = [];
    if (Math.abs(endH - startH) > 1) {
      runs.push({
        node: parent,
        frames: [{ height: startH + "px" }, { height: endH + "px" }],
        timing: { duration: ms, easing: ease, fill: (
          /** @type {FillMode} */
          "backwards"
        ) }
      });
    }
    if (move === "flip") {
      const half = Math.round(ms / 2);
      runs.push({
        node: outgoing,
        frames: [{ transform: "rotateY(0deg)", opacity: 1 }, { transform: "rotateY(-90deg)", opacity: 0 }],
        timing: { duration: half, easing: "ease-in", fill: (
          /** @type {FillMode} */
          "forwards"
        ) }
      });
      runs.push({
        node: incoming,
        frames: [{ transform: "rotateY(90deg)", opacity: 0 }, { transform: "rotateY(0deg)", opacity: 1 }],
        timing: { duration: half, delay: half, easing: "ease-out", fill: (
          /** @type {FillMode} */
          "backwards"
        ) }
      });
    } else if (move === "crossfade") {
      runs.push({ node: outgoing, frames: [{ opacity: 1 }, { opacity: 0 }], timing: { duration: ms, easing: ease, fill: (
        /** @type {FillMode} */
        "forwards"
      ) } });
      runs.push({ node: incoming, frames: [{ opacity: 0 }, { opacity: 1 }], timing: { duration: ms, easing: ease, fill: (
        /** @type {FillMode} */
        "backwards"
      ) } });
    } else {
      const fade = move === "slide";
      runs.push({
        node: outgoing,
        frames: [{ transform: "none", opacity: 1 }, { transform: AWAY[dir], opacity: fade ? 0 : 1 }],
        timing: { duration: ms, easing: ease, fill: (
          /** @type {FillMode} */
          "forwards"
        ) }
      });
      runs.push({
        node: incoming,
        frames: [{ transform: TOWARD[dir], opacity: fade ? 0 : 1 }, { transform: "none", opacity: 1 }],
        timing: { duration: ms, easing: ease, fill: (
          /** @type {FillMode} */
          "backwards"
        ) }
      });
    }
    return playAll(runs).then(function() {
      if (outgoing.parentNode) outgoing.parentNode.removeChild(outgoing);
      incoming.style.removeProperty("transform");
      incoming.style.removeProperty("opacity");
      parent.classList.remove("ak-swap--flip");
      parent.style.position = kept.position;
      parent.style.overflow = kept.overflow;
      parent.style.removeProperty("height");
    });
  }

  // src/static/sdk-libs/atelier/token-color.js
  var colorCtx = null;
  function tokenRgb(node, name, fallbackName) {
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
    return [px[0], px[1], px[2]];
  }
  function tokenColor(node, name, fallbackName) {
    const c = tokenRgb(node, name, fallbackName);
    return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
  }

  // src/static/sdk-libs/atelier/ambient-presets.js
  var PRESET_IDS = ["waves", "aurora", "dust", "grid", "static", "ink"];
  var BASE_ALPHA = { waves: 0.22, aurora: 0.3, dust: 0.6, grid: 0.5, static: 0.25, ink: 0.35 };
  var PEAK = { waves: 0.35, aurora: 0.26, dust: 0.5, grid: 0.6, static: 0.3, ink: 0.22 };
  var FPS = { waves: 30, aurora: 0, dust: 30, grid: 30, static: 12, ink: 24 };
  var CSS_PRESETS = { aurora: true };
  var TAU = Math.PI * 2;
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function() {
      a = a + 1831565813 >>> 0;
      let t2 = a;
      t2 = Math.imul(t2 ^ t2 >>> 15, t2 | 1);
      t2 ^= t2 + Math.imul(t2 ^ t2 >>> 7, t2 | 61);
      return ((t2 ^ t2 >>> 14) >>> 0) / 4294967296;
    };
  }
  function rgba(c, a) {
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }
  var waves = {
    scale: 2,
    setup(w, h, palette2, rng) {
      const colours = [palette2.accent, palette2.spectrum2, palette2.spectrum3];
      const ribbons = [];
      for (let i = 0; i < 3; i++) {
        ribbons.push({
          base: 0.38 + i * 0.13 + (rng() - 0.5) * 0.06,
          a1: 0.05 + rng() * 0.05,
          k1: (1.2 + rng() * 1.2) * TAU / w,
          w1: 0.25 + rng() * 0.2,
          a2: 0.02 + rng() * 0.03,
          k2: (3 + rng() * 2) * TAU / w,
          w2: 0.4 + rng() * 0.3,
          thick: 0.05 + rng() * 0.05,
          colour: colours[i % 3]
        });
      }
      const specks = [];
      for (let i = 0; i < 12; i++) {
        specks.push({ x: rng(), y: rng(), r: 0.8 + rng() * 1.6, v: 0.01 + rng() * 0.02, phase: rng() * TAU });
      }
      return { ribbons, specks };
    },
    frame(ctx, state, t2, w, h, palette2) {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = palette2.dark ? "lighter" : "source-over";
      const step = 8;
      for (const r of state.ribbons) {
        const y = function(x, off) {
          return h * (r.base + off) + h * (r.a1 * Math.sin(r.k1 * x + r.w1 * t2) + r.a2 * Math.sin(r.k2 * x - r.w2 * t2));
        };
        ctx.beginPath();
        ctx.moveTo(0, y(0, -r.thick / 2));
        for (let x = step; x <= w + step; x += step) ctx.lineTo(x, y(x, -r.thick / 2));
        for (let x = w + step; x >= 0; x -= step) ctx.lineTo(x, y(x, r.thick / 2));
        ctx.closePath();
        ctx.fillStyle = rgba(r.colour, 0.55);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, y(0, 0));
        for (let x = step; x <= w + step; x += step) ctx.lineTo(x, y(x, 0));
        ctx.lineWidth = h * r.thick * 2.2;
        ctx.lineCap = "round";
        ctx.strokeStyle = rgba(r.colour, 0.14);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      for (const s of state.specks) {
        const sy = ((s.y - t2 * s.v) % 1 + 1) % 1;
        const sx = ((s.x + Math.sin(t2 * 0.3 + s.phase) * 0.01) % 1 + 1) % 1;
        ctx.beginPath();
        ctx.arc(sx * w, sy * h, s.r, 0, TAU);
        ctx.fillStyle = rgba(palette2.ink, 0.6);
        ctx.fill();
      }
    }
  };
  var dust = {
    scale: 1,
    setup(w, h, palette2, rng) {
      const count = Math.max(40, Math.min(120, Math.round(w * h / 12e3)));
      const motes = [];
      for (let i = 0; i < count; i++) {
        const z = 0.15 + rng() * 0.85;
        motes.push({
          x: rng() * w,
          y: rng() * h,
          z,
          r: 0.8 + z * 2.6,
          vy: -(4 + z * 12),
          vx: (rng() - 0.5) * 6,
          phase: rng() * TAU
        });
      }
      return { motes, t: null };
    },
    frame(ctx, state, t2, w, h, palette2) {
      const dt = state.t == null ? 0 : Math.min(Math.max(t2 - state.t, 0), 0.1);
      state.t = t2;
      ctx.clearRect(0, 0, w, h);
      for (const m of state.motes) {
        m.x += (m.vx + Math.sin(t2 * 0.7 + m.phase) * 4) * dt;
        m.y += m.vy * dt;
        if (m.y < -6) {
          m.y = h + 6;
          m.x = (m.x + w * 0.37) % w;
        }
        if (m.x < -6) m.x = w + 6;
        else if (m.x > w + 6) m.x = -6;
        const c = m.z > 0.6 ? palette2.accent : palette2.ink;
        const a = PEAK.dust * (0.35 + m.z * 0.65);
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, TAU);
        ctx.fillStyle = rgba(c, a);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * 2.4, 0, TAU);
        ctx.fillStyle = rgba(c, a * 0.18);
        ctx.fill();
      }
    }
  };
  var grid = {
    scale: 1,
    setup() {
      return { horizon: 0.44, focal: 1.2, period: 1.5, rows: 18, columns: 22 };
    },
    frame(ctx, state, t2, w, h, palette2) {
      ctx.clearRect(0, 0, w, h);
      const hz = h * state.horizon;
      const depth = h - hz;
      const glow = ctx.createLinearGradient(0, hz - depth * 0.35, 0, hz);
      glow.addColorStop(0, rgba(palette2.spectrum2, 0));
      glow.addColorStop(1, rgba(palette2.spectrum2, 0.08));
      ctx.fillStyle = glow;
      ctx.fillRect(0, hz - depth * 0.35, w, depth * 0.35);
      ctx.lineWidth = 1;
      const vx = w / 2;
      const fan = ctx.createLinearGradient(0, hz, 0, h);
      fan.addColorStop(0, rgba(palette2.accent, 0));
      fan.addColorStop(1, rgba(palette2.accent, PEAK.grid * 0.7));
      ctx.strokeStyle = fan;
      for (let i = 0; i <= state.columns; i++) {
        const bx = vx + (i / state.columns - 0.5) * w * 3;
        ctx.beginPath();
        ctx.moveTo(vx, hz);
        ctx.lineTo(bx, h);
        ctx.stroke();
      }
      const frac = t2 / state.period % 1;
      for (let i = 0; i < state.rows; i++) {
        const d = i + 1 - frac;
        const y = hz + depth * state.focal / (d + state.focal);
        const a = PEAK.grid * Math.pow((y - hz) / depth, 1.3);
        ctx.strokeStyle = rgba(palette2.accent, a);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }
  };
  var staticNoise = {
    scale: 1,
    setup(w, h, palette2, rng) {
      const tiles = [];
      const n = 4 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const c = document.createElement("canvas");
        c.width = 128;
        c.height = 128;
        const cx = c.getContext("2d");
        const img = cx.createImageData(128, 128);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = palette2.ink[0];
          d[i + 1] = palette2.ink[1];
          d[i + 2] = palette2.ink[2];
          d[i + 3] = Math.floor(rng() * 255);
        }
        cx.putImageData(img, 0, 0);
        tiles.push(c);
      }
      return { tiles, patterns: null, frame: 0 };
    },
    frame(ctx, state, t2, w, h) {
      if (!state.patterns) {
        state.patterns = state.tiles.map(function(c) {
          return ctx.createPattern(c, "repeat");
        });
      }
      state.frame++;
      const i = state.frame % state.patterns.length;
      const dx = Math.floor((Math.sin(t2 * 37.1) * 0.5 + 0.5) * 128);
      const dy = Math.floor((Math.cos(t2 * 23.7) * 0.5 + 0.5) * 128);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.globalAlpha = PEAK.static;
      ctx.translate(-dx, -dy);
      ctx.fillStyle = state.patterns[i];
      ctx.fillRect(0, 0, w + 128, h + 128);
      ctx.restore();
    }
  };
  var ink = {
    scale: 6,
    setup(w, h, palette2, rng) {
      const blooms = [];
      const n = 5 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        blooms.push({
          x: 0.1 + rng() * 0.8,
          y: 0.1 + rng() * 0.8,
          r: 0.18 + rng() * 0.22,
          period: 20 + rng() * 20,
          phase: rng() * TAU,
          colour: i % 2 ? palette2.spectrum3 : palette2.accent
        });
      }
      return { blooms };
    },
    frame(ctx, state, t2, w, h, palette2) {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = palette2.dark ? "lighter" : "source-over";
      const m = Math.min(w, h);
      for (const b of state.blooms) {
        const breathe = 0.75 + 0.25 * Math.sin(TAU * t2 / b.period + b.phase);
        const r = Math.max(1, m * b.r * breathe);
        const cx = b.x * w;
        const cy = b.y * h;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, rgba(b.colour, 0.9));
        g.addColorStop(0.6, rgba(b.colour, 0.35));
        g.addColorStop(1, rgba(b.colour, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }
  };
  var RENDERERS = { waves, dust, grid, static: staticNoise, ink };

  // src/static/sdk-libs/atelier/ambient-gl.js
  var VERT = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";
  var FRAG = [
    "precision mediump float;",
    "uniform vec2 u_res;",
    "uniform float u_time;",
    "uniform vec3 u_c0;",
    "uniform vec3 u_c1;",
    "uniform vec3 u_c2;",
    "uniform float u_peak;",
    "float ribbon(vec2 uv, float base, float a1, float k1, float w1, float a2, float k2, float w2, float thick) {",
    "  float y = base + a1 * sin(k1 * uv.x + w1 * u_time) + a2 * sin(k2 * uv.x - w2 * u_time);",
    "  float d = abs(uv.y - y);",
    "  float core = 1.0 - smoothstep(0.0, thick, d);",
    "  float glow = exp(-d * 14.0) * 0.45;",
    "  return core * 0.85 + glow;",
    "}",
    "void main() {",
    "  vec2 uv = gl_FragCoord.xy / u_res;",
    "  float r0 = ribbon(uv, 0.60, 0.06, 7.0, 0.30, 0.025, 19.0, 0.50, 0.060);",
    "  float r1 = ribbon(uv, 0.48, 0.08, 5.5, 0.22, 0.030, 15.0, 0.40, 0.070);",
    "  float r2 = ribbon(uv, 0.37, 0.05, 8.5, 0.36, 0.020, 23.0, 0.60, 0.050);",
    "  float sum = r0 + r1 + r2;",
    "  vec3 col = (u_c0 * r0 + u_c1 * r1 + u_c2 * r2) / max(1.0, sum);",
    "  float a = clamp(sum, 0.0, 1.0);",
    "  gl_FragColor = vec4(col * a * u_peak, a * u_peak);",
    "}"
  ].join("\n");
  function compile(gl, kind, src) {
    const sh = gl.createShader(kind);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  function glWaves(canvas, palette2, peak) {
    let gl = null;
    try {
      gl = /** @type {WebGLRenderingContext|null} */
      canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        failIfMajorPerformanceCaveat: true,
        powerPreference: "low-power",
        preserveDrawingBuffer: false
      });
    } catch {
      gl = null;
    }
    if (!gl) return null;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = {
      res: gl.getUniformLocation(program, "u_res"),
      time: gl.getUniformLocation(program, "u_time"),
      c0: gl.getUniformLocation(program, "u_c0"),
      c1: gl.getUniformLocation(program, "u_c1"),
      c2: gl.getUniformLocation(program, "u_c2"),
      peak: gl.getUniformLocation(program, "u_peak")
    };
    gl.uniform1f(u.peak, peak);
    gl.clearColor(0, 0, 0, 0);
    function colour(where, c) {
      gl.uniform3f(where, c[0] / 255, c[1] / 255, c[2] / 255);
    }
    function setPalette(p) {
      colour(u.c0, p.accent);
      colour(u.c1, p.spectrum2);
      colour(u.c2, p.spectrum3);
    }
    setPalette(palette2);
    return {
      /** @param {number} t seconds on the layer's clock */
      frame(t2) {
        if (gl.isContextLost()) return;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(u.res, canvas.width, canvas.height);
        gl.uniform1f(u.time, t2);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      setPalette,
      destroy() {
        try {
          gl.deleteBuffer(buf);
          gl.deleteProgram(program);
          gl.deleteShader(vs);
          gl.deleteShader(fs);
          const lose = gl.getExtension("WEBGL_lose_context");
          if (lose) lose.loseContext();
        } catch {
        }
      }
    };
  }

  // src/static/sdk-libs/atelier/ambient.js
  var NONE = "none";
  var WEATHER_ATTR = "data-ak-weather";
  var WEATHER_KEY = "ak.ambient";
  var LEVELS = ["off", "calm", "full"];
  var MAX_DPR = 1.5;
  var MAX_FPS = 30;
  var BOUNDS = { alpha: [0, 1], speed: [0.25, 2] };
  var STYLE_WAIT_MS = 2e3;
  var HOST_CLASS = "ak-ambient-host";
  var weatherRestored = false;
  function restoreWeather() {
    if (weatherRestored || typeof document === "undefined") return;
    weatherRestored = true;
    let saved = null;
    try {
      saved = localStorage.getItem(WEATHER_KEY);
    } catch {
    }
    if (saved && LEVELS.indexOf(saved) >= 0 && !document.documentElement.hasAttribute(WEATHER_ATTR)) {
      document.documentElement.setAttribute(WEATHER_ATTR, saved);
    }
  }
  function weatherLevel() {
    restoreWeather();
    const v = document.documentElement.getAttribute(WEATHER_ATTR);
    return (
      /** @type {any} */
      LEVELS.indexOf(v) >= 0 ? v : "full"
    );
  }
  function setWeather(level) {
    const next = (
      /** @type {'off'|'calm'|'full'} */
      LEVELS.indexOf(level) >= 0 ? level : "full"
    );
    weatherRestored = true;
    document.documentElement.setAttribute(WEATHER_ATTR, next);
    try {
      localStorage.setItem(WEATHER_KEY, next);
    } catch {
    }
    try {
      window.dispatchEvent(new CustomEvent("ak-ambient", { detail: { level: next } }));
    } catch {
    }
    return next;
  }
  function clamp(v, range) {
    return Math.min(range[1], Math.max(range[0], v));
  }
  function luma(c) {
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function known(id) {
    return id === NONE || !!RENDERERS[id] || !!CSS_PRESETS[id];
  }
  function ambient(spec) {
    const s = spec || {};
    injectStyle();
    restoreWeather();
    const host = resolve(s.target, document.body);
    const opts = {
      preset: s.preset == null ? void 0 : String(s.preset),
      alpha: s.alpha == null ? void 0 : clamp(Number(s.alpha), BOUNDS.alpha),
      speed: s.speed == null ? void 0 : clamp(Number(s.speed), BOUNDS.speed),
      fps: s.fps > 0 ? Math.min(s.fps, MAX_FPS) : 0,
      gl: s.gl !== false
    };
    const seed = s.seed > 0 ? Math.floor(s.seed) : 1234567;
    const layer = el("div", {
      class: "ak-ambient",
      "aria-hidden": "true",
      "data-ak-ambient": NONE,
      "data-ak-ambient-state": "paused"
    });
    host.insertBefore(layer, host.firstChild);
    host.classList.add(HOST_CLASS);
    const state = {
      preset: NONE,
      alpha: 1,
      alphaSource: (
        /** @type {'option'|'token'|'preset'} */
        "token"
      ),
      speed: 1,
      fps: 0,
      /** @type {any} */
      surface: null,
      /** @type {any} */
      palette: null,
      w: 0,
      h: 0,
      dpr: 1,
      clock: 0,
      last: 0,
      raf: 0,
      frames: 0,
      running: false,
      gates: {
        hidden: !!document.hidden,
        offscreen: false,
        less: reducedMotion(),
        off: weatherLevel() === "off",
        paused: false
      },
      destroyed: false,
      warned: false,
      resolveQueued: false,
      styleWait: 0,
      styleWaiting: false
    };
    function readToken(name) {
      return getComputedStyle(host).getPropertyValue(name).trim();
    }
    function wantedPreset() {
      if (opts.preset !== void 0) {
        if (known(opts.preset)) return opts.preset;
        warnOnce(opts.preset);
        return NONE;
      }
      const raw = readToken("--ak-ambient");
      if (!raw) return null;
      if (known(raw)) return raw;
      warnOnce(raw);
      return NONE;
    }
    function warnOnce(id) {
      if (state.warned) return;
      state.warned = true;
      console.warn('aimeat-atelier: "' + id + '" is not an ambient this kit ships (' + PRESET_IDS.join(", ") + ", or none).");
    }
    function wantedAlpha(preset) {
      if (opts.alpha !== void 0) {
        state.alphaSource = "option";
        return opts.alpha;
      }
      if (opts.preset !== void 0) {
        state.alphaSource = "preset";
        return BASE_ALPHA[preset] != null ? BASE_ALPHA[preset] : 1;
      }
      state.alphaSource = "token";
      const raw = parseFloat(readToken("--ak-ambient-alpha"));
      return isFinite(raw) ? clamp(raw, BOUNDS.alpha) : 1;
    }
    function wantedSpeed() {
      if (opts.speed !== void 0) return opts.speed;
      if (opts.preset !== void 0) return 1;
      const raw = parseFloat(readToken("--ak-ambient-speed"));
      return isFinite(raw) ? clamp(raw, BOUNDS.speed) : 1;
    }
    function samplePalette() {
      const bg = tokenRgb(host, "--ak-bg");
      const ink2 = tokenRgb(host, "--ak-ink");
      return {
        dark: luma(bg) < luma(ink2),
        bg,
        ink: ink2,
        accent: tokenRgb(host, "--ak-accent"),
        spectrum2: tokenRgb(host, "--ak-spectrum-2", "--ak-accent"),
        spectrum3: tokenRgb(host, "--ak-spectrum-3", "--ak-accent")
      };
    }
    function markPainted() {
      if (!layer.hasAttribute("data-ak-ambient-painted")) layer.setAttribute("data-ak-ambient-painted", "1");
    }
    function unmountSurface() {
      stopLoop();
      const su = state.surface;
      if (su) {
        if (su.gl) {
          su.gl.destroy();
          su.gl = null;
        }
        if (su.canvas) {
          su.canvas.width = 0;
          su.canvas.height = 0;
        }
        if (su.off) {
          su.off.width = 0;
          su.off.height = 0;
        }
      }
      state.surface = null;
      state.w = 0;
      state.h = 0;
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      layer.removeAttribute("data-ak-ambient-painted");
    }
    function mountSurface(preset) {
      unmountSurface();
      layer.setAttribute("data-ak-ambient", preset);
      if (preset === NONE) return;
      if (CSS_PRESETS[preset]) {
        layer.appendChild(el("div", { class: "ak-ambient__drift" }));
        state.surface = { kind: "css" };
        state.fps = 0;
        markPainted();
        return;
      }
      const canvas = (
        /** @type {HTMLCanvasElement} */
        el("canvas", { class: "ak-ambient__canvas" })
      );
      canvas.addEventListener("webglcontextlost", onContextLost);
      layer.appendChild(canvas);
      state.surface = {
        kind: "canvas",
        renderer: RENDERERS[preset],
        canvas,
        ctx: null,
        off: null,
        offCtx: null,
        rstate: null,
        gl: null,
        glFailed: false
      };
      state.fps = Math.min(opts.fps || FPS[preset] || MAX_FPS, MAX_FPS);
      size(true);
    }
    function onContextLost(ev) {
      ev.preventDefault();
      const su = state.surface;
      if (state.destroyed || !su || su.kind !== "canvas") return;
      const fresh = (
        /** @type {HTMLCanvasElement} */
        el("canvas", { class: "ak-ambient__canvas" })
      );
      layer.replaceChild(fresh, su.canvas);
      su.canvas.removeEventListener("webglcontextlost", onContextLost);
      su.canvas = fresh;
      su.gl = null;
      su.glFailed = true;
      su.ctx = null;
      state.w = 0;
      size(true);
      draw();
    }
    function size(force) {
      const su = state.surface;
      if (!su || su.kind !== "canvas") return;
      const box = layer.getBoundingClientRect();
      const w = Math.round(box.width);
      const h = Math.round(box.height);
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (!force && w === state.w && h === state.h && dpr === state.dpr && su.rstate) return;
      state.w = w;
      state.h = h;
      state.dpr = dpr;
      su.canvas.width = Math.round(w * dpr);
      su.canvas.height = Math.round(h * dpr);
      const r = su.renderer;
      const rng = mulberry32(seed);
      if (r.scale > 1) {
        const ow = Math.max(1, Math.ceil(w / r.scale));
        const oh = Math.max(1, Math.ceil(h / r.scale));
        if (!su.off) {
          su.off = document.createElement("canvas");
          su.offCtx = su.off.getContext("2d");
        }
        su.off.width = ow;
        su.off.height = oh;
        su.rstate = r.setup(ow, oh, state.palette, rng);
      } else {
        su.rstate = r.setup(w, h, state.palette, rng);
      }
      if (su.gl) {
        su.gl.setPalette(state.palette);
        return;
      }
      if (!su.ctx) su.ctx = su.canvas.getContext("2d");
      if (su.ctx) su.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function tryGl() {
      const su = state.surface;
      if (!su || su.kind !== "canvas" || state.preset !== "waves" || !opts.gl || su.gl || su.glFailed) return;
      const fresh = (
        /** @type {HTMLCanvasElement} */
        el("canvas", { class: "ak-ambient__canvas" })
      );
      fresh.width = su.canvas.width;
      fresh.height = su.canvas.height;
      const gl = glWaves(fresh, state.palette, PEAK.waves);
      if (!gl) {
        su.glFailed = true;
        return;
      }
      fresh.addEventListener("webglcontextlost", onContextLost);
      su.canvas.removeEventListener("webglcontextlost", onContextLost);
      layer.replaceChild(fresh, su.canvas);
      su.canvas = fresh;
      su.ctx = null;
      su.gl = gl;
      gl.frame(state.clock);
    }
    function draw() {
      const su = state.surface;
      if (!su || su.kind !== "canvas" || !state.w || !state.h) return;
      const t2 = state.clock;
      if (su.gl) {
        su.gl.frame(t2);
      } else if (su.ctx) {
        const r = su.renderer;
        if (r.scale > 1) {
          r.frame(su.offCtx, su.rstate, t2, su.off.width, su.off.height, state.palette);
          const ctx = su.ctx;
          ctx.clearRect(0, 0, state.w, state.h);
          ctx.save();
          ctx.globalAlpha = PEAK[state.preset];
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(su.off, 0, 0, state.w, state.h);
          ctx.restore();
        } else {
          r.frame(su.ctx, su.rstate, t2, state.w, state.h, state.palette);
        }
      } else {
        return;
      }
      state.frames++;
      markPainted();
    }
    function tick(now2) {
      state.raf = 0;
      if (!state.running || state.destroyed) return;
      const interval = 1e3 / (state.fps || MAX_FPS);
      if (now2 - state.last >= interval - 1) {
        const dt = state.last ? Math.min((now2 - state.last) / 1e3, 0.1) : 0;
        state.last = now2;
        state.clock += dt * state.speed;
        draw();
      }
      state.raf = requestAnimationFrame(tick);
    }
    function stopLoop() {
      state.running = false;
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    function evaluate() {
      const g = state.gates;
      const off = state.preset === NONE;
      const canRun = !off && !g.hidden && !g.offscreen && !g.off && !g.paused && !g.less;
      const next = off || !g.less && !canRun ? "paused" : g.less ? "still" : "running";
      if (layer.getAttribute("data-ak-ambient-state") !== next) layer.setAttribute("data-ak-ambient-state", next);
      const canvasLoop = state.surface && state.surface.kind === "canvas";
      if (canRun && canvasLoop && !state.running) {
        state.running = true;
        state.last = 0;
        state.raf = requestAnimationFrame(tick);
        tryGl();
      } else if (!canRun && state.running) {
        stopLoop();
        if (g.less) draw();
      }
    }
    function queueResolve() {
      if (state.resolveQueued || state.destroyed) return;
      state.resolveQueued = true;
      requestAnimationFrame(function() {
        state.resolveQueued = false;
        resolveNow();
      });
    }
    function waitForStyle() {
      if (state.styleWaiting || state.destroyed) return;
      state.styleWaiting = true;
      const link = (
        /** @type {HTMLLinkElement|null} */
        document.getElementById("ak-style")
      );
      const done = function() {
        if (!state.styleWaiting) return;
        state.styleWaiting = false;
        if (state.styleWait) {
          clearTimeout(state.styleWait);
          state.styleWait = 0;
        }
        queueResolve();
      };
      if (link) link.addEventListener("load", done, { once: true });
      state.styleWait = setTimeout(done, STYLE_WAIT_MS);
    }
    function resolveNow() {
      if (state.destroyed) return;
      const wanted = wantedPreset();
      if (wanted === null) {
        waitForStyle();
        return;
      }
      state.palette = samplePalette();
      const alpha = wantedAlpha(wanted);
      const speed = wantedSpeed();
      if (alpha !== state.alpha) {
        state.alpha = alpha;
        layer.style.setProperty("--ak-ambient-level", String(alpha));
      }
      if (speed !== state.speed) {
        state.speed = speed;
        layer.style.setProperty("--ak-ambient-speed", String(speed));
      }
      if (wanted !== state.preset) {
        state.preset = wanted;
        mountSurface(wanted);
        host.dispatchEvent(new CustomEvent("ak-ambient-preset", { bubbles: true, detail: { preset: wanted } }));
      } else if (state.surface && state.surface.kind === "canvas") {
        size(true);
      }
      evaluate();
      if (!state.running) draw();
    }
    const onVisibility = function() {
      state.gates.hidden = !!document.hidden;
      evaluate();
    };
    const onMotion = function() {
      state.gates.less = reducedMotion();
      evaluate();
    };
    const onWeather = function() {
      state.gates.off = weatherLevel() === "off";
      evaluate();
    };
    const onPalette = function() {
      queueResolve();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("ak-motion", onMotion);
    window.addEventListener("ak-ambient", onWeather);
    window.addEventListener("aimeat-theme-change", onPalette);
    window.addEventListener("aimeat-palette-change", onPalette);
    const media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (media && media.addEventListener) media.addEventListener("change", onMotion);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(function() {
      if (state.destroyed) return;
      size(false);
      if (!state.running) draw();
    }) : null;
    if (ro) ro.observe(layer);
    const io = typeof IntersectionObserver === "function" ? new IntersectionObserver(function(entries) {
      const e = entries[entries.length - 1];
      state.gates.offscreen = !!e && !e.isIntersecting;
      evaluate();
    }) : null;
    if (io) io.observe(layer);
    const moHost = new MutationObserver(onPalette);
    moHost.observe(host, { attributes: true, attributeFilter: ["data-ak-look", "style", "class"] });
    const moRoot = new MutationObserver(onPalette);
    moRoot.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
    resolveNow();
    return {
      el: layer,
      preset() {
        return state.preset;
      },
      /** @param {{ preset?: string|null, alpha?: number|null, speed?: number|null, fps?: number, gl?: boolean }} patch */
      set(patch) {
        if (!patch || state.destroyed) return;
        if ("preset" in patch) opts.preset = patch.preset == null ? void 0 : String(patch.preset);
        if ("alpha" in patch) opts.alpha = patch.alpha == null ? void 0 : clamp(Number(patch.alpha), BOUNDS.alpha);
        if ("speed" in patch) opts.speed = patch.speed == null ? void 0 : clamp(Number(patch.speed), BOUNDS.speed);
        if ("fps" in patch) {
          opts.fps = patch.fps > 0 ? Math.min(patch.fps, MAX_FPS) : 0;
          if (state.preset !== NONE && !CSS_PRESETS[state.preset]) {
            state.fps = Math.min(opts.fps || FPS[state.preset] || MAX_FPS, MAX_FPS);
          }
        }
        if ("gl" in patch) opts.gl = patch.gl !== false;
        resolveNow();
      },
      pause() {
        state.gates.paused = true;
        evaluate();
      },
      resume() {
        state.gates.paused = false;
        evaluate();
      },
      still() {
        draw();
      },
      stats() {
        const su = state.surface;
        return {
          preset: state.preset,
          state: layer.getAttribute("data-ak-ambient-state") || "paused",
          running: state.running,
          frames: state.frames,
          fps: state.fps,
          gl: !!(su && su.gl),
          alpha: state.alpha,
          alphaSource: state.alphaSource,
          speed: state.speed,
          level: weatherLevel()
        };
      },
      destroy() {
        if (state.destroyed) return;
        state.destroyed = true;
        unmountSurface();
        if (ro) ro.disconnect();
        if (io) io.disconnect();
        moHost.disconnect();
        moRoot.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("ak-motion", onMotion);
        window.removeEventListener("ak-ambient", onWeather);
        window.removeEventListener("aimeat-theme-change", onPalette);
        window.removeEventListener("aimeat-palette-change", onPalette);
        if (media && media.removeEventListener) media.removeEventListener("change", onMotion);
        if (state.styleWait) clearTimeout(state.styleWait);
        host.classList.remove(HOST_CLASS);
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      }
    };
  }

  // src/static/sdk-libs/atelier/ambient-parts.js
  var LEVELS2 = ["off", "calm", "full"];
  var WORDS = { off: "ambientOff", calm: "ambientCalm", full: "ambientFull" };
  var SVG_NS = "http://www.w3.org/2000/svg";
  function ambientStage(spec) {
    const s = spec || {};
    injectStyle();
    const body = el("div", { class: "ak-ambient-stage__body" });
    if (s.body != null) append(body, s.body);
    const root = el("section", {
      class: "ak-root ak-ambient-stage",
      "data-ak-look": s.look || null,
      vars: s.minHeight ? { "--ak-ambient-stage-min": s.minHeight } : null
    }, [body]);
    const host = resolve(s.target, document.body);
    host.appendChild(root);
    const sky = ambient({
      target: root,
      preset: s.preset == null ? null : s.preset,
      alpha: s.alpha,
      speed: s.speed,
      gl: s.gl
    });
    enter(body);
    return {
      el: root,
      body,
      ambient: sky,
      /** @param {{ preset?: string|null, alpha?: number|null, speed?: number|null, look?: string }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.look != null) root.setAttribute("data-ak-look", patch.look);
        if ("preset" in patch || "alpha" in patch || "speed" in patch) sky.set(patch);
      },
      destroy() {
        sky.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function waveIcon() {
    const svg6 = document.createElementNS(SVG_NS, "svg");
    svg6.setAttribute("viewBox", "0 0 20 20");
    svg6.setAttribute("class", "ak-weather__icon");
    svg6.setAttribute("aria-hidden", "true");
    for (const y of [5, 10, 15]) {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("class", "ak-weather__wave");
      p.setAttribute("d", "M2 " + y + " c2 -2.4 4 -2.4 6 0 s4 2.4 6 0 s2 -1.6 4 -1.4");
      svg6.appendChild(p);
    }
    return svg6;
  }
  function levelLabel(level) {
    return t("ambient") + ": " + t(WORDS[level] || WORDS.full);
  }
  function weather(spec) {
    const s = spec || {};
    injectStyle();
    const kind = s.kind === "segments" ? "segments" : "cycle";
    let root;
    const segs = [];
    let word = null;
    function paint() {
      const level = weatherLevel();
      root.setAttribute("data-ak-level", level);
      if (kind === "cycle") {
        root.setAttribute("aria-label", levelLabel(level));
        root.setAttribute("title", levelLabel(level));
        if (word) word.textContent = t(WORDS[level]);
      } else {
        root.setAttribute("aria-label", t("ambient"));
        segs.forEach(function(b, i) {
          b.setAttribute("aria-checked", LEVELS2[i] === level ? "true" : "false");
          b.setAttribute("tabindex", LEVELS2[i] === level ? "0" : "-1");
          b.textContent = t(WORDS[LEVELS2[i]]);
        });
      }
    }
    if (kind === "cycle") {
      word = el("span", { class: "ak-weather__word" });
      root = el("button", {
        type: "button",
        class: "ak-weather ak-weather--cycle",
        "data-ak-noguard": true,
        on: {
          click: function() {
            const i = LEVELS2.indexOf(weatherLevel());
            setWeather(
              /** @type {any} */
              LEVELS2[(i + 1) % LEVELS2.length]
            );
          }
        }
      }, [waveIcon(), word]);
    } else {
      root = el("div", { class: "ak-weather ak-weather--segments", role: "radiogroup" });
      for (const level of LEVELS2) {
        const b = el("button", {
          type: "button",
          role: "radio",
          class: "ak-weather__seg",
          "data-ak-noguard": true,
          on: {
            click: function() {
              setWeather(
                /** @type {any} */
                level
              );
            },
            keydown: function(ev) {
              const i = LEVELS2.indexOf(level);
              if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
                setWeather(
                  /** @type {any} */
                  LEVELS2[(i + 1) % 3]
                );
                segs[(i + 1) % 3].focus();
                ev.preventDefault();
              }
              if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
                setWeather(
                  /** @type {any} */
                  LEVELS2[(i + 2) % 3]
                );
                segs[(i + 2) % 3].focus();
                ev.preventDefault();
              }
            }
          }
        });
        segs.push(b);
        root.appendChild(b);
      }
    }
    paint();
    const stopLang = i18n.onChange(paint);
    window.addEventListener("ak-ambient", paint);
    if (s.target) resolve(s.target, document.body).appendChild(root);
    return {
      el: root,
      level: weatherLevel,
      /** @param {string} level */
      set(level) {
        setWeather(
          /** @type {any} */
          level
        );
      },
      destroy() {
        stopLang();
        window.removeEventListener("ak-ambient", paint);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  var INPUTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];
  function attract(spec) {
    const s = spec || /** @type {any} */
    {};
    const app2 = s.app;
    if (!app2 || !app2.el) throw new Error("attract needs the app handle (the frame it dims)");
    const after = s.after > 0 ? s.after : 6e4;
    const dim = s.dim != null ? Math.min(1, Math.max(0, s.dim)) : 0.35;
    const rise = s.rise != null ? Math.min(1, Math.max(0, s.rise)) : 1;
    let timer = 0;
    let on = false;
    let lastInput = 0;
    let saved = null;
    let destroyed = false;
    function engage() {
      timer = 0;
      if (on || destroyed || reducedMotion()) return;
      on = true;
      app2.el.setAttribute("data-ak-attract", "on");
      app2.el.style.setProperty("--ak-attract-dim", String(dim));
      const sky = app2.ambient;
      if (sky && sky.set && sky.stats) {
        const st = sky.stats();
        saved = st.alphaSource === "option" ? st.alpha : null;
        sky.set({ alpha: rise });
      }
    }
    function disengage() {
      if (!on) return;
      on = false;
      app2.el.removeAttribute("data-ak-attract");
      const sky = app2.ambient;
      if (sky && sky.set) sky.set({ alpha: saved });
      saved = null;
    }
    function arm() {
      if (timer) clearTimeout(timer);
      timer = 0;
      if (destroyed || reducedMotion()) return;
      timer = setTimeout(engage, after);
    }
    function onInput() {
      const now2 = Date.now();
      if (!on && now2 - lastInput < 250) return;
      lastInput = now2;
      if (on) disengage();
      arm();
    }
    const onMotion = function() {
      if (reducedMotion()) {
        if (timer) clearTimeout(timer);
        timer = 0;
        disengage();
      } else arm();
    };
    for (const type of INPUTS) window.addEventListener(type, onInput, { capture: true, passive: true });
    const scroller = app2.main || null;
    if (scroller) scroller.addEventListener("scroll", onInput, { passive: true });
    window.addEventListener("ak-motion", onMotion);
    arm();
    return {
      arm,
      disarm() {
        if (timer) clearTimeout(timer);
        timer = 0;
        disengage();
      },
      active() {
        return on;
      },
      destroy() {
        destroyed = true;
        if (timer) clearTimeout(timer);
        timer = 0;
        disengage();
        for (const type of INPUTS) window.removeEventListener(type, onInput, { capture: true });
        if (scroller) scroller.removeEventListener("scroll", onInput);
        window.removeEventListener("ak-motion", onMotion);
      }
    };
  }

  // src/static/sdk-libs/atelier/shell.js
  var BOOT_POLL_MS = 300;
  var SIGNIN_GRACE_MS = 2500;
  var SVG_NS2 = "http://www.w3.org/2000/svg";
  var MOTION_ATTR2 = "data-ak-motion";
  var MODE_BUTTON = "#aimeat-mode-switch button[data-mode]";
  function motionLabel() {
    const said = t("lessMotion");
    return said === "lessMotion" ? "Less motion" : said;
  }
  function motionIcon() {
    const svg6 = document.createElementNS(SVG_NS2, "svg");
    svg6.setAttribute("viewBox", "0 0 24 24");
    svg6.setAttribute("width", "18");
    svg6.setAttribute("height", "18");
    svg6.setAttribute("fill", "none");
    svg6.setAttribute("stroke", "currentColor");
    svg6.setAttribute("stroke-width", "2");
    svg6.setAttribute("stroke-linecap", "round");
    svg6.setAttribute("aria-hidden", "true");
    const lines = document.createElementNS(SVG_NS2, "path");
    lines.setAttribute("class", "ak-app__motion-lines");
    lines.setAttribute("d", "M4 7h15M4 12h11M4 17h7");
    const slash = document.createElementNS(SVG_NS2, "path");
    slash.setAttribute("class", "ak-app__motion-slash");
    slash.setAttribute("d", "M20 4 5 20");
    svg6.appendChild(lines);
    svg6.appendChild(slash);
    return svg6;
  }
  function motionIsLess() {
    return document.documentElement.getAttribute(MOTION_ATTR2) === "less";
  }
  function ambientSpec(want) {
    if (typeof want === "string") return { preset: want };
    if (want && typeof want === "object") {
      return {
        preset: want.preset == null ? null : want.preset,
        alpha: want.alpha,
        speed: want.speed,
        fps: want.fps,
        gl: want.gl
      };
    }
    return { preset: null };
  }
  function app(spec) {
    injectStyle();
    const state = { title: spec.title, look: spec.look || "vivid" };
    const titleId = uid("ak-app-title");
    const heading = el("span", { class: "ak-app__title", id: titleId, text: state.title });
    const pill = el("span", { class: "ak-app__pill", id: "login" });
    const motionBtn = el("button", {
      type: "button",
      class: "ak-app__motion",
      "data-ak-noguard": true,
      "aria-pressed": motionIsLess() ? "true" : "false",
      title: motionLabel(),
      "aria-label": motionLabel(),
      on: {
        click: function() {
          setMotion(motionIsLess() ? "auto" : "less");
        }
      }
    }, motionIcon());
    const syncMotion = function() {
      motionBtn.setAttribute("aria-pressed", motionIsLess() ? "true" : "false");
    };
    window.addEventListener("ak-motion", syncMotion);
    const bar = el("header", { class: "ak-app__bar" }, [heading, motionBtn, pill]);
    let replaying = false;
    const onBarClick = function(ev) {
      if (replaying) return;
      const start = (
        /** @type {Element|null} */
        ev.target
      );
      if (!start || typeof start.closest !== "function") return;
      const btn = (
        /** @type {HTMLElement|null} */
        start.closest(MODE_BUTTON)
      );
      if (!btn || !bar.contains(btn) || btn.getAttribute("aria-pressed") === "true") return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      btn.setAttribute("data-ak-noguard", "");
      const box = btn.getBoundingClientRect();
      screenTransition("iris", function() {
        replaying = true;
        try {
          btn.click();
        } finally {
          replaying = false;
        }
      }, { from: { x: box.left + box.width / 2, y: box.top + box.height / 2 } });
    };
    bar.addEventListener("click", onBarClick, true);
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
    let sky = null;
    let weatherCtl = null;
    function syncWeather() {
      if (weatherCtl) weatherCtl.el.hidden = !sky || sky.preset() === "none";
    }
    function ensureSky(want) {
      if (!sky) {
        sky = ambient(Object.assign({ target: root }, ambientSpec(want)));
        weatherCtl = weather({ kind: "cycle" });
        weatherCtl.el.classList.add("ak-app__weather");
        bar.insertBefore(weatherCtl.el, motionBtn);
      } else {
        sky.set(Object.assign({ preset: null, alpha: null, speed: null }, ambientSpec(want)));
      }
      syncWeather();
    }
    root.addEventListener("ak-ambient-preset", syncWeather);
    if (spec.ambient !== false) ensureSky(spec.ambient);
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
      motionBtn.setAttribute("title", motionLabel());
      motionBtn.setAttribute("aria-label", motionLabel());
    });
    setTimeout(startBoot, 0);
    return {
      el: root,
      main,
      /** @param {{ title?: string, look?: string, density?: 'comfortable'|'compact',
       *    quiet?: boolean, ambient?: AmbientWish }} patch */
      set(patch) {
        if (!patch) return;
        if (patch.title != null) {
          state.title = patch.title;
          heading.textContent = state.title;
        }
        if ("ambient" in patch) {
          if (patch.ambient === false) {
            if (sky) {
              sky.set({ preset: "none" });
              syncWeather();
            }
          } else ensureSky(patch.ambient);
        }
        if (patch.look != null && patch.look !== state.look) {
          state.look = patch.look;
          const dress = function() {
            root.setAttribute("data-ak-look", state.look);
          };
          if (patch.quiet) {
            dress();
          } else {
            const cover = curtain({ kind: "halves", colour: "accent" });
            cover.cover().then(dress).then(function() {
              return cover.uncover();
            }).then(function() {
              cover.destroy();
            }, function(err) {
              cover.destroy();
              throw err;
            });
          }
        }
        if (patch.density != null) root.classList.toggle("ak-app--compact", patch.density === "compact");
      },
      status,
      t,
      i18n,
      get ambient() {
        return sky;
      },
      get weather() {
        return weatherCtl;
      },
      destroy() {
        stopLang();
        window.removeEventListener("ak-motion", syncMotion);
        root.removeEventListener("ak-ambient-preset", syncWeather);
        if (sky) sky.destroy();
        if (weatherCtl) weatherCtl.destroy();
        bar.removeEventListener("click", onBarClick, true);
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
        const handle2 = ns.atelier.mosaic({ target: host, layout: { v: 1, blocks: panel.blocks }, sources: s.sources || {} });
        root.addEventListener("ak-destroy", function() {
          handle2.destroy();
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
  var DETAIL_MARKED = ".ak-listdetail__title";
  var DETAIL_HEADING = "h1, h2, h3";
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
    let held = (
      /** @type {HTMLElement|null} */
      null
    );
    let holdTimer = (
      /** @type {any} */
      null
    );
    function release() {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (held) {
        held.style.viewTransitionName = "";
        held = null;
      }
    }
    function holdFor(node) {
      return (parseFloat(getComputedStyle(node).getPropertyValue("--ak-motion")) || 200) * 6;
    }
    function detailTitle() {
      return (
        /** @type {HTMLElement} */
        detailBody.querySelector(DETAIL_MARKED) || detailBody.querySelector(DETAIL_HEADING) || detail
      );
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
      const moving = (
        /** @type {HTMLElement|null} */
        picked ? picked.querySelector(".ak-list__title") || picked : null
      );
      release();
      if (moving && typeof document.startViewTransition === "function" && !reducedMotion()) {
        morph(moving, function() {
          moving.style.viewTransitionName = "";
          mark();
          held = detailTitle();
          held.style.viewTransitionName = "ak-morph";
        });
        holdTimer = setTimeout(release, holdFor(detail));
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
        release();
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
  var SVG_NS3 = "http://www.w3.org/2000/svg";
  function svg(name, attrs) {
    const node = document.createElementNS(SVG_NS3, name);
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
    const sheen2 = svg("linearGradient", { id: sheenId, x1: 0, y1: 0, x2: 0, y2: 1 });
    const s1 = svg("stop", { offset: "0", "stop-opacity": "0.22" });
    s1.style.stopColor = "var(--ak-chart-sheen)";
    const s2 = svg("stop", { offset: "1", "stop-opacity": "0" });
    s2.style.stopColor = "var(--ak-chart-sheen)";
    sheen2.appendChild(s1);
    sheen2.appendChild(s2);
    defs.appendChild(sheen2);
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
      const ring2 = svg("circle", {
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
        ring2.classList.add("ak-chart__slice--enter");
        ring2.style.animationDelay = `${i * 70}ms`;
      }
      node.appendChild(ring2);
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
    const W7 = 560;
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
    const X = (v) => PAD3.left + (W7 - PAD3.left - PAD3.right) * ((v - xMin) / (xMax - xMin));
    const Y = (v) => PAD3.top + (H4 - PAD3.top - PAD3.bottom) * (1 - (v - yMin) / (yMax - yMin));
    const node = svg("svg", { viewBox: `0 0 ${W7} ${H4}`, class: "ak-chart__svg", "aria-hidden": "true" });
    for (let v = yMin; v <= yMax + yStep / 2; v += yStep) {
      node.appendChild(svg("line", { x1: PAD3.left, x2: W7 - PAD3.right, y1: Y(v), y2: Y(v), class: "ak-chart__grid" }));
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
    const W7 = 460;
    const STEP_H = 44;
    const GAP = 7;
    const BAND = 340;
    const CX = 195;
    const H4 = steps2.length * (STEP_H + GAP) - GAP + 8;
    const first = steps2[0].value;
    const node = svg("svg", { viewBox: `0 0 ${W7} ${H4}`, class: "ak-chart__svg", "aria-hidden": "true" });
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
      const pct = svg("text", { x: W7 - 10, y: y + STEP_H / 2 + 5, class: "ak-chart__funnelpct", "text-anchor": "end" });
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
    const W7 = 560;
    const H4 = 320;
    const node = svg("svg", { viewBox: `0 0 ${W7} ${H4}`, class: "ak-chart__svg", "aria-hidden": "true" });
    const cells = squarify(items.map((s, i) => ({ v: s.value, s, i })), 2, 2, W7 - 4, H4 - 4);
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
    const W7 = 560;
    const H4 = 320;
    const NODE_W = 12;
    const PAD_Y = 10;
    const cols = [];
    for (const m of byId.values()) (cols[m.depth] = cols[m.depth] || []).push(m);
    const scale = (H4 - PAD_Y * 2 - 8 * Math.max(...cols.map((c) => (c || []).length - 1), 0)) / Math.max(...cols.map((c) => (c || []).reduce((a, m) => a + Math.max(m.in, m.out), 0)), 1e-9);
    const colX = (d) => 8 + (maxDepth ? (W7 - NODE_W - 16) * (d / maxDepth) : 0);
    const node = svg("svg", { viewBox: `0 0 ${W7} ${H4}`, class: "ak-chart__svg", "aria-hidden": "true" });
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
    const W7 = 460;
    const H4 = 340;
    const CX = W7 / 2;
    const CY = H4 / 2 + 4;
    const R = 118;
    const angle = (i) => -Math.PI / 2 + 2 * Math.PI * i / axes.length;
    const at = (i, r) => `${(CX + Math.cos(angle(i)) * r).toFixed(1)} ${(CY + Math.sin(angle(i)) * r).toFixed(1)}`;
    const node = svg("svg", { viewBox: `0 0 ${W7} ${H4}`, class: "ak-chart__svg", "aria-hidden": "true" });
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
  var SVG_NS4 = "http://www.w3.org/2000/svg";
  function svg2(name, attrs) {
    const node = document.createElementNS(SVG_NS4, name);
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
  var SVG_NS5 = "http://www.w3.org/2000/svg";
  function svg3(name, attrs) {
    const node = document.createElementNS(SVG_NS5, name);
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
      const luma2 = (c) => c.r + c.g + c.b;
      scene.background = luma2(inkC) < luma2(bgC) ? inkC : bgC;
    }
    let raf = 0;
    let entranceUntil = 0;
    let settleUntil = 0;
    let disposed = false;
    const clock = { start: 0 };
    function frame(now2) {
      raf = 0;
      if (disposed) return;
      const entering = now2 < entranceUntil;
      if (entering) {
        const p = easeOut(Math.min(1, (now2 - clock.start) / (entranceUntil - clock.start)));
        applyEntrance(p);
      }
      controls.update();
      renderer.render(scene, camera);
      if (entering || now2 < settleUntil) raf = requestAnimationFrame(frame);
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
      const ink2 = tokenColor(root, "--ak-ink");
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
          const inkCh = channels(ink2);
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
        const inkC = new THREE.Color(ink2);
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
          new THREE.LineBasicMaterial({ color: new THREE.Color(ink2), transparent: true, opacity: 0.35 })
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
        const fill = new THREE.HemisphereLight(new THREE.Color(surface), new THREE.Color(ink2), 0.7);
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
    const settle3 = function() {
      panel.style.height = opening ? "auto" : "0px";
    };
    anim.onfinish = settle3;
    anim.oncancel = settle3;
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
    const travel3 = side === "bottom" ? "0, 100%" : side === "right" ? "100%, 0" : "-100%, 0";
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
        [{ transform: "translate(" + travel3 + ")" }, { transform: "none" }],
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
        [{ transform: "none" }, { transform: "translate(" + travel3 + ")" }],
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
    if (kind === "chart" || kind === "matrix" || kind === "graph" || kind === "waveform" || kind === "gauge" || kind === "console" || kind === "atlas" || kind === "map" || kind === "scene3d" || kind === "kanban" || kind === "plan" || kind === "schedule" || kind === "steps" || kind === "rating" || kind === "crt" || kind === "ring" || kind === "crew" || kind === "poll" || kind === "thread" || kind === "calendar" || kind === "priceTable" || kind === "facets") {
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
  function projectCanvas(units, morph3) {
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
      morph3(u.el, function() {
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
      morph3(u.el, function() {
        focused = null;
        u.tile.insertBefore(u.el, u.tile.lastChild);
        focusHost.hidden = true;
        viewport.hidden = false;
        zoombar.hidden = false;
      });
    }
    let drag2 = null;
    viewport.addEventListener("pointerdown", function(ev) {
      const at = (
        /** @type {Element|null} */
        ev.target instanceof Element ? ev.target : null
      );
      if (at && at.closest(".ak-mosaic__tilecover")) return;
      drag2 = { x: ev.clientX, y: ev.clientY };
      viewport.setPointerCapture(ev.pointerId);
    });
    viewport.addEventListener("pointermove", function(ev) {
      if (!drag2) return;
      cam.x += ev.clientX - drag2.x;
      cam.y += ev.clientY - drag2.y;
      drag2 = { x: ev.clientX, y: ev.clientY };
      apply();
    });
    viewport.addEventListener("pointerup", function() {
      drag2 = null;
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
  var PINNED = ["position", "box-sizing", "margin", "top", "left", "width", "height"];
  function unitSwapper(box, units, live) {
    let epoch = 0;
    const restore = function() {
      const on = live();
      for (const u of units) {
        for (const name of PINNED) u.el.style.removeProperty(name);
        u.el.hidden = u.el !== on;
        box.appendChild(u.el);
      }
    };
    return function(from, to, settle3) {
      if (from === to) {
        to.hidden = false;
        settle3();
        return;
      }
      if (typeof document.startViewTransition === "function" && !reducedMotion()) {
        transition(function() {
          from.hidden = true;
          to.hidden = false;
          settle3();
        });
        return;
      }
      if (reducedMotion()) {
        from.hidden = true;
        to.hidden = false;
        settle3();
        return;
      }
      to.hidden = false;
      if (to.parentNode) to.parentNode.removeChild(to);
      const mine = ++epoch;
      const move = panelTransition(from, to, "crossfade");
      settle3();
      const tidy = function() {
        if (mine === epoch) restore();
      };
      move.then(tidy, tidy);
    };
  }
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
    const swap = unitSwapper(box, units, function() {
      return units[current2] ? units[current2].el : null;
    });
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
        swap(units[current2].el, units[index].el, function() {
          current2 = index;
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
    const swap = unitSwapper(box, units, function() {
      return units[current2] ? units[current2].el : null;
    });
    function show(index) {
      if (index === current2 && !units[index].el.hidden) return;
      swap(units[current2].el, units[index].el, function() {
        current2 = index;
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
    const swap = unitSwapper(box, units, function() {
      return units[current2] ? units[current2].el : null;
    });
    function show(index) {
      if (index === current2 && !units[index].el.hidden) return;
      swap(units[current2].el, units[index].el, function() {
        current2 = index;
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
    const swap = unitSwapper(box, units, function() {
      return units[current2] ? units[current2].el : null;
    });
    function show(index) {
      const step = Math.max(0, Math.min(units.length - 1, index));
      swap(units[current2].el, units[step].el, function() {
        current2 = step;
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
  var SVG_NS6 = "http://www.w3.org/2000/svg";
  function svg4(name, attrs) {
    const node = document.createElementNS(SVG_NS6, name);
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

  // src/static/sdk-libs/atelier/motion.js
  var STATE = /* @__PURE__ */ new WeakMap();
  var REST = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };
  function stateOf(node) {
    let s = STATE.get(node);
    if (!s) {
      s = Object.assign({}, REST);
      STATE.set(node, s);
    }
    return s;
  }
  function transformOf(s) {
    return "translate(" + s.x + "px, " + s.y + "px) scale(" + s.scale + ") rotate(" + s.rotate + "deg)";
  }
  function springTokens(el2) {
    if (!el2 || typeof getComputedStyle !== "function") return {};
    let cs;
    try {
      cs = getComputedStyle(
        /** @type {Element} */
        el2
      );
    } catch {
      return {};
    }
    if (!cs) return {};
    const num = function(name) {
      const v = parseFloat(cs.getPropertyValue(name));
      return isFinite(v) && v > 0 ? v : void 0;
    };
    return { stiffness: num("--ak-spring-stiffness"), damping: num("--ak-spring-damping"), mass: num("--ak-spring-mass") };
  }
  function springFrames(opts) {
    const o = opts || {};
    const look = o.stiffness && o.damping && o.mass ? {} : springTokens(o.el);
    const k = o.stiffness || look.stiffness || 170;
    const c = o.damping || look.damping || 20;
    const m = o.mass || look.mass || 1;
    const v0 = o.velocity || 0;
    const w0 = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(k * m));
    const step = 1 / 60;
    const samples = [];
    let t2 = 0;
    let x;
    let settled = 0;
    while (t2 < 4) {
      if (zeta < 1) {
        const wd = w0 * Math.sqrt(1 - zeta * zeta);
        const decay = Math.exp(-zeta * w0 * t2);
        x = 1 - decay * (Math.cos(wd * t2) + (zeta * w0 - v0) / wd * Math.sin(wd * t2));
      } else {
        const decay = Math.exp(-w0 * t2);
        x = 1 - decay * (1 + (w0 - v0) * t2);
      }
      samples.push(x);
      settled = Math.abs(1 - x) < 1e-3 ? settled + 1 : 0;
      if (settled > 6) break;
      t2 += step;
    }
    samples.push(1);
    return { samples, duration: Math.round(samples.length * step * 1e3) };
  }
  function spring(target, to, opts) {
    const node = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    const from = Object.assign({}, stateOf(node));
    const dest = Object.assign({}, from, to || {});
    const prior = (
      /** @type {any} */
      node.__akSpring
    );
    if (prior) {
      const p = prior.effect && prior.effect.getComputedTiming ? prior.effect.getComputedTiming().progress : null;
      if (typeof p === "number") {
        const at = prior.__frames[Math.min(prior.__frames.length - 1, Math.round(p * (prior.__frames.length - 1)))];
        Object.keys(from).forEach(function(key) {
          from[key] = prior.__from[key] + (prior.__to[key] - prior.__from[key]) * at;
        });
      }
      prior.cancel();
    }
    STATE.set(node, dest);
    if (reducedMotion() || typeof node.animate !== "function") {
      node.style.transform = transformOf(dest);
      node.style.opacity = String(dest.opacity);
      return { el: node, finished: Promise.resolve(), cancel() {
      } };
    }
    const sf = springFrames(Object.assign({}, opts, { el: node }));
    const frames = sf.samples.map(function(at, i) {
      const s = {};
      Object.keys(from).forEach(function(key) {
        s[key] = from[key] + (dest[key] - from[key]) * at;
      });
      return { offset: i / (sf.samples.length - 1), transform: transformOf(s), opacity: s.opacity };
    });
    const anim = (
      /** @type {any} */
      node.animate(frames, { duration: sf.duration, easing: "linear", fill: "forwards" })
    );
    anim.__frames = sf.samples;
    anim.__from = from;
    anim.__to = dest;
    node.__akSpring = anim;
    const finished = anim.finished.then(function() {
      node.style.transform = transformOf(dest);
      node.style.opacity = String(dest.opacity);
      anim.cancel();
      if (
        /** @type {any} */
        node.__akSpring === anim
      ) node.__akSpring = null;
    }, function() {
    });
    return { el: node, finished, cancel() {
      anim.cancel();
    } };
  }
  function stagger(targets, opts) {
    const o = opts || {};
    const list2 = typeof targets === "string" ? Array.prototype.slice.call(document.querySelectorAll(targets)) : (
      /** @type {any} */
      targets.length !== void 0 ? Array.prototype.slice.call(
        /** @type {any} */
        targets
      ) : [targets]
    );
    const kids = list2.slice(0, o.max || 40);
    if (!kids.length || reducedMotion() || typeof kids[0].animate !== "function") return { finished: Promise.resolve() };
    const cs = getComputedStyle(kids[0]);
    const dist = o.distance !== void 0 ? o.distance : parseFloat(cs.getPropertyValue("--ak-enter-distance")) || 12;
    const each = o.each !== void 0 ? o.each : parseFloat(cs.getPropertyValue("--ak-enter-stagger")) || 40;
    const span = o.duration || (parseFloat(cs.getPropertyValue("--ak-motion")) || 200) * 1.5;
    const ease = (cs.getPropertyValue("--ak-ease") || "").trim() || "cubic-bezier(0.2, 0.7, 0.3, 1)";
    const start = o.from === "down" ? "translateY(-" + dist + "px)" : o.from === "left" ? "translateX(-" + dist + "px)" : o.from === "right" ? "translateX(" + dist + "px)" : o.from === "scale" ? "scale(0.92)" : "translateY(" + dist + "px)";
    const end = o.from === "scale" ? "scale(1)" : "translate(0, 0)";
    let frames = [{ opacity: 0, transform: start }, { opacity: 1, transform: end }];
    let timing = { duration: span, easing: ease, fill: "backwards" };
    if (o.spring) {
      const sf = springFrames({ el: kids[0], stiffness: o.stiffness, damping: o.damping, mass: o.mass });
      frames = sf.samples.map(function(at, i) {
        return {
          offset: i / (sf.samples.length - 1),
          opacity: Math.min(1, at * 1.4),
          transform: o.from === "scale" ? "scale(" + (0.92 + 0.08 * at) + ")" : start.replace(/[-\d.]+px/, function(px) {
            return (parseFloat(px) * (1 - at)).toFixed(2) + "px";
          })
        };
      });
      timing = { duration: sf.duration, easing: "linear", fill: "backwards" };
    }
    const runs = kids.map(function(kid, i) {
      return kid.animate(frames, Object.assign({}, timing, { delay: i * each })).finished;
    });
    return { finished: Promise.all(runs).then(function() {
    }, function() {
    }) };
  }
  function inView(target, fn, opts) {
    const node = resolve(target);
    const o = opts || {};
    if (typeof IntersectionObserver !== "function") {
      fn(
        node,
        /** @type {any} */
        { isIntersecting: true, target: node }
      );
      return { el: node, destroy() {
      } };
    }
    const io = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          fn(node, entry);
          if (o.once !== false) io.disconnect();
        } else if (o.onLeave) {
          o.onLeave(node);
        }
      });
    }, { rootMargin: o.margin || "0px 0px -10% 0px", threshold: o.threshold || 0.15 });
    io.observe(node);
    return { el: node, destroy() {
      io.disconnect();
    } };
  }
  function nearestScroller(node) {
    let p = node.parentElement;
    while (p && p !== document.body) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
      p = p.parentElement;
    }
    return window;
  }
  function scrollLink(target, frames, opts) {
    const node = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    const o = opts || {};
    const subject = o.subject || node;
    const scroller = o.scroller || nearestScroller(subject);
    const lo = o.range ? o.range[0] : 0;
    const hi = o.range ? o.range[1] : 1;
    let last = 0;
    if (reducedMotion() || typeof node.animate !== "function") {
      return { el: node, progress() {
        return 0;
      }, destroy() {
      } };
    }
    const anim = node.animate(frames, { duration: 1e3, easing: "linear", fill: "both" });
    anim.pause();
    const viewportH = function() {
      return scroller === window ? window.innerHeight : (
        /** @type {Element} */
        scroller.clientHeight
      );
    };
    const viewportTop = function() {
      return scroller === window ? 0 : (
        /** @type {Element} */
        scroller.getBoundingClientRect().top
      );
    };
    const tick = function() {
      const r = subject.getBoundingClientRect();
      const h = viewportH();
      const raw = (viewportTop() + h - r.top) / Math.max(h + r.height, 1);
      let p = (raw - lo) / Math.max(hi - lo, 1e-4);
      p = Math.max(0, Math.min(1, p));
      if (p !== last) {
        last = p;
        anim.currentTime = p * 1e3;
      }
    };
    let rafId = 0;
    const onScroll = function() {
      if (!rafId) rafId = requestAnimationFrame(function() {
        rafId = 0;
        tick();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    tick();
    return {
      el: node,
      progress() {
        return last;
      },
      destroy() {
        scroller.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        if (rafId) cancelAnimationFrame(rafId);
        anim.cancel();
      }
    };
  }
  function drag(target, handlers, opts) {
    const node = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    const h = handlers || {};
    const o = opts || {};
    const axis = o.axis || "both";
    const threshold = o.threshold !== void 0 ? o.threshold : 4;
    node.classList.add("ak-drag");
    let active = null;
    const clamp2 = function(v, range) {
      return range ? Math.max(range[0], Math.min(range[1], v)) : v;
    };
    const down = function(e) {
      if (e.button !== void 0 && e.button !== 0) return;
      const s = stateOf(node);
      active = { id: e.pointerId, x0: e.clientX, y0: e.clientY, bx: s.x, by: s.y, moved: false, t: performance.now(), lx: e.clientX, ly: e.clientY, vx: 0, vy: 0 };
      if (
        /** @type {any} */
        node.__akSpring
      ) node.__akSpring.cancel();
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
      }
    };
    const move = function(e) {
      if (!active || e.pointerId !== active.id) return;
      let dx = e.clientX - active.x0;
      let dy = e.clientY - active.y0;
      if (!active.moved) {
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
        active.moved = true;
        node.classList.add("ak-dragging");
        if (h.onStart) h.onStart(node);
      }
      if (axis === "x") dy = 0;
      if (axis === "y") dx = 0;
      const now2 = performance.now();
      const dt = Math.max(now2 - active.t, 1);
      active.vx = (e.clientX - active.lx) / dt * 1e3;
      active.vy = (e.clientY - active.ly) / dt * 1e3;
      active.t = now2;
      active.lx = e.clientX;
      active.ly = e.clientY;
      const s = stateOf(node);
      s.x = clamp2(active.bx + dx, o.bounds && o.bounds.x);
      s.y = clamp2(active.by + dy, o.bounds && o.bounds.y);
      node.style.transform = transformOf(s);
      if (h.onMove) h.onMove(s.x - active.bx, s.y - active.by, node);
      e.preventDefault();
    };
    const up = function(e) {
      if (!active || e.pointerId !== active.id) return;
      const was = active;
      active = null;
      node.classList.remove("ak-dragging");
      try {
        node.releasePointerCapture(e.pointerId);
      } catch {
      }
      if (!was.moved) return;
      const s = stateOf(node);
      const dx = s.x - was.bx;
      const dy = s.y - was.by;
      if (h.onEnd) h.onEnd(dx, dy, { x: was.vx, y: was.vy }, node);
      if (o.back !== false) spring(node, { x: was.bx, y: was.by }, { stiffness: o.stiffness, damping: o.damping, mass: o.mass });
    };
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
    return {
      el: node,
      destroy() {
        node.removeEventListener("pointerdown", down);
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerup", up);
        node.removeEventListener("pointercancel", up);
        node.classList.remove("ak-drag", "ak-dragging");
      }
    };
  }

  // src/static/sdk-libs/atelier/materials.js
  function handle(node, off) {
    return { el: node, destroy() {
      off();
    } };
  }
  function spotlight(target) {
    const node = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    node.classList.add("ak-mat--spot");
    const move = (e) => {
      const r = node.getBoundingClientRect();
      node.style.setProperty("--ak-spot-x", Math.round((e.clientX - r.left) / Math.max(r.width, 1) * 100) + "%");
      node.style.setProperty("--ak-spot-y", Math.round((e.clientY - r.top) / Math.max(r.height, 1) * 100) + "%");
    };
    const leave = () => {
      node.style.removeProperty("--ak-spot-x");
      node.style.removeProperty("--ak-spot-y");
    };
    if (!reducedMotion()) {
      node.addEventListener("pointermove", move);
      node.addEventListener("pointerleave", leave);
    }
    return handle(node, () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", leave);
      leave();
    });
  }
  function tilt(target, opts) {
    const node = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    const max = opts && opts.max || 10;
    const lift = opts && opts.lift || 5;
    node.classList.add("ak-move--tilt");
    const move = (e) => {
      const r = node.getBoundingClientRect();
      const px = (e.clientX - r.left) / Math.max(r.width, 1) - 0.5;
      const py = (e.clientY - r.top) / Math.max(r.height, 1) - 0.5;
      node.style.transform = "perspective(650px) rotateX(" + (-py * max * 2).toFixed(2) + "deg) rotateY(" + (px * max * 2).toFixed(2) + "deg) translateY(-" + lift + "px)";
    };
    const leave = () => {
      node.style.transform = "";
    };
    if (!reducedMotion()) {
      node.addEventListener("pointermove", move);
      node.addEventListener("pointerleave", leave);
    }
    return handle(node, () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", leave);
      leave();
    });
  }
  function sheen(target) {
    const node = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    if (reducedMotion()) return false;
    node.classList.add("ak-move--sheen");
    node.classList.remove("is-sheening");
    void node.offsetWidth;
    node.classList.add("is-sheening");
    const done = () => {
      node.classList.remove("is-sheening");
      node.removeEventListener("animationend", done);
    };
    node.addEventListener("animationend", done);
    return true;
  }
  function odometer(target, value) {
    const node = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    const next = String(value);
    const prev = node.getAttribute("data-odo") != null ? String(node.getAttribute("data-odo")) : node.textContent.trim();
    node.setAttribute("data-odo", next);
    if (prev === next || reducedMotion() || typeof node.animate !== "function") {
      node.textContent = next;
      return false;
    }
    node.classList.add("ak-odo");
    const reel = el("span", { class: "ak-odo__reel" }, [el("span", {}, prev), el("span", {}, next)]);
    node.textContent = "";
    node.appendChild(reel);
    const h = reel.firstChild ? (
      /** @type {HTMLElement} */
      reel.firstChild.offsetHeight
    ) : 0;
    const cs = getComputedStyle(node);
    const span = (parseFloat(cs.getPropertyValue("--ak-motion")) || 200) * 3.5;
    const anim = reel.animate([{ transform: "translateY(0)" }, { transform: "translateY(-" + h + "px)" }], {
      duration: span,
      easing: "cubic-bezier(0.2, 0.7, 0.3, 1)",
      fill: "forwards"
    });
    const settle3 = () => {
      node.textContent = next;
    };
    anim.addEventListener("finish", settle3);
    anim.addEventListener("cancel", settle3);
    return true;
  }
  function thumb(target) {
    const node = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    node.classList.add("ak-thumb");
    const pill = el("span", { class: "ak-thumb__pill", "aria-hidden": "true" });
    node.insertBefore(pill, node.firstChild);
    const update = () => {
      const on = node.querySelector('[aria-selected="true"], [aria-pressed="true"], [aria-current], .is-on');
      if (!on) {
        node.style.setProperty("--ak-thumb-w", "0px");
        return;
      }
      const r = (
        /** @type {HTMLElement} */
        on
      );
      node.style.setProperty("--ak-thumb-left", r.offsetLeft + "px");
      node.style.setProperty("--ak-thumb-top", r.offsetTop + "px");
      node.style.setProperty("--ak-thumb-w", r.offsetWidth + "px");
      node.style.setProperty("--ak-thumb-h", r.offsetHeight + "px");
    };
    const mo = typeof MutationObserver === "function" ? new MutationObserver(update) : null;
    if (mo) mo.observe(node, { attributes: true, subtree: true, attributeFilter: ["aria-selected", "aria-pressed", "aria-current", "class"] });
    update();
    return { el: node, update, destroy() {
      if (mo) mo.disconnect();
      if (pill.parentNode) pill.parentNode.removeChild(pill);
      node.classList.remove("ak-thumb");
    } };
  }
  function deal(targets) {
    let list2;
    if (typeof targets === "string") list2 = Array.prototype.slice.call(document.querySelectorAll(targets));
    else if (targets instanceof Element) list2 = [
      /** @type {HTMLElement} */
      targets
    ];
    else list2 = Array.prototype.slice.call(targets || []);
    if (reducedMotion()) return 0;
    list2.forEach((node, i) => {
      node.style.setProperty("--ak-deal-i", String(i));
      node.classList.remove("ak-move--deal");
      void node.offsetWidth;
      node.classList.add("ak-move--deal");
      const done = () => {
        node.classList.remove("ak-move--deal");
        node.style.removeProperty("--ak-deal-i");
        node.removeEventListener("animationend", done);
      };
      node.addEventListener("animationend", done);
    });
    return list2.length;
  }

  // src/static/sdk-libs/atelier/flow-parts.js
  var CARRY = { stiffness: 320, damping: 28 };
  var TONES4 = ["ok", "warn", "err", "accent"];
  var KINDS = ["info", "ok", "warn", "err"];
  function rowsOf(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  }
  function pace(node, multiple) {
    return (parseFloat(getComputedStyle(node).getPropertyValue("--ak-motion")) || 200) * multiple;
  }
  function flipFrom(node, dx, dy, opts) {
    spring(node, { x: dx, y: dy }, opts).cancel();
    return spring(node, { x: 0, y: 0 }, opts || CARRY);
  }
  function sortable(spec) {
    const s = spec || {};
    const root = el("div", { class: "ak-root ak-sortable" });
    if (s.target) resolve(s.target).appendChild(root);
    const body = el("div", { class: "ak-sortable__rows" });
    let hands = [];
    const held = /* @__PURE__ */ new Map();
    let emptyCard = null;
    function rows() {
      return (
        /** @type {HTMLElement[]} */
        Array.prototype.slice.call(body.children)
      );
    }
    function gap() {
      return parseFloat(getComputedStyle(body).rowGap) || 0;
    }
    function tell() {
      if (s.onReorder) s.onReorder(rows().map(function(r) {
        return r.getAttribute("data-id");
      }));
    }
    function place2(row, index) {
      const all = rows();
      const before = all.map(function(r) {
        return r.offsetTop;
      });
      const others = all.filter(function(r) {
        return r !== row;
      });
      body.insertBefore(row, others[index] || null);
      all.forEach(function(r, i) {
        const stood = held.get(r) || 0;
        const travel3 = before[i] - r.offsetTop + stood;
        if (travel3 || stood) flipFrom(r, 0, travel3, CARRY);
      });
      held.clear();
    }
    function wanted(row, dy) {
      const middle = row.offsetTop + dy + row.offsetHeight / 2;
      let index = 0;
      rows().forEach(function(r) {
        if (r !== row && middle > r.offsetTop + r.offsetHeight / 2) index += 1;
      });
      return index;
    }
    function carry(row) {
      return drag(row, {
        onStart: function() {
          row.classList.add("is-carried");
        },
        onMove: function(dx, dy) {
          const all = rows();
          const at = all.indexOf(row);
          const others = all.filter(function(r) {
            return r !== row;
          });
          const want = Math.max(0, Math.min(wanted(row, dy), others.length));
          const step = row.offsetHeight + gap();
          others.forEach(function(r, i) {
            let to = 0;
            if (want > at && i >= at && i < want) to = -step;
            else if (want < at && i >= want && i < at) to = step;
            if ((held.get(r) || 0) === to) return;
            held.set(r, to);
            spring(r, { y: to }, CARRY);
          });
        },
        onEnd: function(dx, dy) {
          row.classList.remove("is-carried");
          const all = rows();
          const at = all.indexOf(row);
          const want = Math.max(0, Math.min(wanted(row, dy), all.length - 1));
          held.set(row, dy);
          place2(row, want);
          if (want !== at) tell();
        }
      }, { axis: "y", back: false });
    }
    function nudge(row, dir) {
      const all = rows();
      const to = all.indexOf(row) + dir;
      if (to < 0 || to >= all.length) return;
      place2(row, to);
      tell();
    }
    function onGripKey(ev) {
      if (!ev.altKey) return;
      const dir = ev.key === "ArrowUp" ? -1 : ev.key === "ArrowDown" ? 1 : 0;
      if (!dir) return;
      const grip = (
        /** @type {HTMLElement} */
        ev.currentTarget
      );
      const row = (
        /** @type {HTMLElement} */
        grip.closest(".ak-sortable__row")
      );
      if (!row) return;
      ev.preventDefault();
      nudge(row, dir);
      grip.focus();
    }
    function buildRow(item) {
      const kids = [];
      if (s.handle !== false) {
        kids.push(el("button", {
          type: "button",
          class: "ak-sortable__grip",
          "data-ak-noguard": true,
          "aria-label": "Move " + String(item.label || item.id),
          on: { keydown: onGripKey }
        }, [el("span", { class: "ak-sortable__gripmark", "aria-hidden": "true" })]));
      }
      kids.push(el("span", { class: "ak-sortable__text" }, [
        el("span", { class: "ak-sortable__label", text: String(item.label || item.id) }),
        item.sub != null ? el("span", { class: "ak-sortable__sub", text: String(item.sub) }) : null
      ].filter(Boolean)));
      return el("div", {
        class: "ak-sortable__row" + (TONES4.indexOf(item.tone) >= 0 ? " ak-sortable__row--" + item.tone : ""),
        "data-id": String(item.id)
      }, kids);
    }
    function render(data) {
      hands.forEach(function(h) {
        h.destroy();
      });
      hands = [];
      held.clear();
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      clear(body);
      const items = rowsOf(data).filter(function(it) {
        return it && it.id != null;
      });
      if (!items.length) {
        const e = s.empty || {};
        emptyCard = emptyState({
          target: root,
          tone: "quiet",
          title: e.title || s.title || "Nothing to put in order",
          hint: e.hint
        });
        return;
      }
      if (s.title) root.appendChild(el("div", { class: "ak-sortable__title", text: s.title }));
      root.appendChild(body);
      items.forEach(function(item) {
        body.appendChild(buildRow(item));
      });
      rows().forEach(function(r) {
        hands.push(carry(r));
      });
      enter(body);
    }
    render(s.data);
    return {
      el: root,
      set(patch) {
        if (patch && "data" in patch) render(patch.data);
      },
      destroy() {
        hands.forEach(function(h) {
          h.destroy();
        });
        if (emptyCard) emptyCard.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function pictureOf(url) {
    if (!url) return null;
    const v = String(url);
    if (/^data:/i.test(v)) {
      console.warn("aimeat-atelier: cart line image data: URIs are refused. Upload the image and pass its URL.");
      return null;
    }
    return 'url("' + v.replace(/"/g, "%22") + '")';
  }
  function money(amount2, currency) {
    const unit = currency || "€";
    const n = Number(amount2) || 0;
    const hasIntl = typeof Intl === "object" && Intl && typeof Intl.NumberFormat === "function";
    if (hasIntl && /^[A-Za-z]{3}$/.test(unit)) {
      return new Intl.NumberFormat(void 0, { style: "currency", currency: unit.toUpperCase() }).format(n);
    }
    if (hasIntl) {
      return new Intl.NumberFormat(void 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " " + unit;
    }
    return n.toFixed(2) + " " + unit;
  }
  function cart(spec) {
    const s = spec || /** @type {any} */
    {};
    const root = el("div", { class: "ak-root ak-cart" });
    if (s.target) resolve(s.target).appendChild(root);
    const lines = el("div", { class: "ak-cart__lines" });
    const totalValue = el("span", { class: "ak-cart__totalvalue" });
    const note = el("div", { class: "ak-cart__note" });
    const foot = el("div", { class: "ak-cart__foot" }, [
      el("div", { class: "ak-cart__total" }, [
        el("span", { class: "ak-cart__totallabel", text: "Total" }),
        totalValue
      ]),
      el("button", {
        type: "button",
        class: "ak-btn ak-btn--primary ak-cart__checkout",
        text: "Checkout",
        on: { click: function() {
          if (s.onCheckout) s.onCheckout(current2.slice());
        } }
      }, null)
    ]);
    const shown = /* @__PURE__ */ new Map();
    let current2 = [];
    let unit = "€";
    let emptyCard = null;
    function totalOf() {
      return current2.reduce(function(n, l) {
        return n + (Number(l.price) || 0) * (Number(l.qty) || 0);
      }, 0);
    }
    function rollTotal() {
      odometer(totalValue, money(totalOf(), unit));
    }
    function setQty(line, next) {
      const q = Math.max(1, Math.round(Number(next) || 1));
      if (q === Number(line.qty)) return;
      line.qty = q;
      const rec = shown.get(String(line.id));
      if (rec) {
        rec.count.textContent = String(q);
        rec.price.textContent = money((Number(line.price) || 0) * q, unit);
      }
      rollTotal();
      if (s.onChange) s.onChange(line.id, q);
    }
    function collapse(node, after) {
      const done = function() {
        if (node.parentNode) node.parentNode.removeChild(node);
        if (after) after();
      };
      if (reducedMotion() || typeof node.animate !== "function") {
        done();
        return;
      }
      const box = node.getBoundingClientRect();
      const seen = getComputedStyle(node);
      const anim = node.animate([
        { height: box.height + "px", opacity: 1, paddingTop: seen.paddingTop, paddingBottom: seen.paddingBottom },
        { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px" }
      ], { duration: pace(node, 1.4), easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "forwards" });
      anim.addEventListener("finish", done);
      anim.addEventListener("cancel", done);
    }
    function remove(line) {
      const id = String(line.id);
      const rec = shown.get(id);
      current2 = current2.filter(function(l) {
        return String(l.id) !== id;
      });
      shown.delete(id);
      if (rec) collapse(rec.node, current2.length ? null : function() {
        render({ lines: [], currency: unit, note: "" });
      });
      rollTotal();
      if (s.onRemove) s.onRemove(line.id);
    }
    function buildLine(line) {
      const picture = pictureOf(line.image);
      const rec = (
        /** @type {any} */
        {
          node: null,
          line,
          art: el("span", {
            class: "ak-cart__art" + (picture ? " ak-cart__art--image" : ""),
            "aria-hidden": "true",
            vars: picture ? { "--ak-cart-image": picture } : null
          }, picture ? null : el("span", { class: "ak-cart__monogram" })),
          title: el("span", { class: "ak-cart__linetitle" }),
          sub: el("span", { class: "ak-cart__linesub" }),
          count: el("span", { class: "ak-cart__count", "aria-live": "polite" }),
          price: el("span", { class: "ak-cart__price" })
        }
      );
      const step = function(by) {
        return function() {
          setQty(rec.line, (Number(rec.line.qty) || 1) + by);
        };
      };
      rec.node = el("div", { class: "ak-cart__line", "data-id": String(line.id) }, [
        rec.art,
        el("span", { class: "ak-cart__body" }, [rec.title, rec.sub]),
        el("span", { class: "ak-cart__qty" }, [
          el("button", { type: "button", class: "ak-cart__step", "aria-label": "One fewer", on: { click: step(-1) } }, "-"),
          rec.count,
          el("button", { type: "button", class: "ak-cart__step", "aria-label": "One more", on: { click: step(1) } }, "+")
        ]),
        rec.price,
        el("button", {
          type: "button",
          class: "ak-btn ak-cart__remove",
          text: "Remove",
          on: { click: function() {
            remove(rec.line);
          } }
        }, null)
      ]);
      fillLine(rec, line);
      return rec;
    }
    function fillLine(rec, line) {
      rec.line = line;
      const qty = Math.max(1, Math.round(Number(line.qty) || 1));
      rec.title.textContent = String(line.title || line.id);
      rec.sub.textContent = line.sub != null ? String(line.sub) : "";
      rec.sub.hidden = line.sub == null || line.sub === "";
      rec.count.textContent = String(qty);
      rec.price.textContent = money((Number(line.price) || 0) * qty, unit);
      const mono = rec.art.querySelector(".ak-cart__monogram");
      if (mono) mono.textContent = (Array.from(String(line.title || "?"))[0] || "?").toUpperCase();
    }
    function render(data) {
      const list2 = (data && Array.isArray(data.lines) ? data.lines : []).filter(function(l) {
        return l && l.id != null;
      });
      unit = data && data.currency || "€";
      current2 = list2;
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      if (!list2.length) {
        clear(root);
        clear(lines);
        shown.clear();
        emptyCard = emptyState({
          target: root,
          tone: "quiet",
          title: "Your cart is empty",
          hint: "Anything you add shows up here."
        });
        return;
      }
      clear(root);
      if (s.title) root.appendChild(el("div", { class: "ak-cart__title", text: s.title }));
      root.appendChild(lines);
      note.textContent = data && data.note ? String(data.note) : "";
      note.hidden = !note.textContent;
      root.appendChild(foot);
      root.appendChild(note);
      const live = {};
      list2.forEach(function(l) {
        live[String(l.id)] = 1;
      });
      Array.from(shown.keys()).forEach(function(id) {
        if (live[id]) return;
        const rec = shown.get(id);
        shown.delete(id);
        if (rec.node.parentNode) rec.node.parentNode.removeChild(rec.node);
      });
      list2.forEach(function(line) {
        const id = String(line.id);
        let rec = shown.get(id);
        if (!rec) {
          rec = buildLine(line);
          shown.set(id, rec);
        } else {
          fillLine(rec, line);
        }
        lines.appendChild(rec.node);
      });
      rollTotal();
    }
    render(s.data);
    return {
      el: root,
      set(patch) {
        if (patch && "data" in patch) render(patch.data);
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function dayLabel(when) {
    if (!when) return "Earlier";
    const days = Math.round((startOfDay(/* @__PURE__ */ new Date()) - startOfDay(when)) / 864e5);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (typeof when.toLocaleDateString !== "function") return when.toISOString().slice(0, 10);
    const sameYear = when.getFullYear() === (/* @__PURE__ */ new Date()).getFullYear();
    return when.toLocaleDateString(void 0, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  }
  function clockOf(when) {
    if (!when) return "";
    if (typeof when.toLocaleTimeString !== "function") return when.toISOString().slice(11, 16);
    return when.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit" });
  }
  function notices(spec) {
    const s = spec || {};
    const root = el("div", { class: "ak-root ak-notices" });
    if (s.target) resolve(s.target).appendChild(root);
    const head = el("div", { class: "ak-notices__head" });
    const body = el("div", { class: "ak-notices__body" });
    const markAll = el("button", {
      type: "button",
      class: "ak-btn ak-notices__markall",
      text: "Mark all read",
      on: { click: function() {
        markRead();
      } }
    }, null);
    const shown = /* @__PURE__ */ new Map();
    let dated = [];
    let mounted = false;
    let emptyCard = null;
    function kindOf(kind) {
      return KINDS.indexOf(kind) >= 0 ? kind : "info";
    }
    function settle3(dot) {
      if (!dot || dot.hidden) return;
      const done = function() {
        dot.hidden = true;
      };
      if (reducedMotion() || typeof dot.animate !== "function") {
        done();
        return;
      }
      const anim = dot.animate([
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(0.4)" }
      ], { duration: pace(dot, 1.2), easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "forwards" });
      anim.addEventListener("finish", done);
      anim.addEventListener("cancel", done);
    }
    function markRead() {
      const ids = dated.filter(function(u) {
        return !u.item.read;
      }).map(function(u) {
        return u.item.id;
      });
      if (!ids.length) return;
      ids.forEach(function(id) {
        const rec = shown.get(String(id));
        if (!rec) return;
        rec.item.read = true;
        rec.node.classList.remove("is-unread");
        settle3(rec.dot);
      });
      if (markAll.parentNode) markAll.parentNode.removeChild(markAll);
      if (s.onRead) s.onRead(ids);
    }
    function fillItem(rec, u) {
      rec.item = u.item;
      rec.title.textContent = String(u.item.title || u.item.id);
      rec.text.textContent = u.item.text != null ? String(u.item.text) : "";
      rec.text.hidden = u.item.text == null || u.item.text === "";
      rec.time.textContent = clockOf(u.when);
      rec.node.className = "ak-notices__item ak-notices__item--" + kindOf(u.item.kind) + (u.item.read ? "" : " is-unread");
      rec.dot.hidden = !!u.item.read;
    }
    function buildItem(u) {
      const rec = (
        /** @type {any} */
        {
          node: null,
          item: u.item,
          dot: el("span", { class: "ak-notices__dot", "aria-hidden": "true" }),
          title: el("span", { class: "ak-notices__itemtitle" }),
          text: el("span", { class: "ak-notices__text" }),
          time: el("span", { class: "ak-notices__time" })
        }
      );
      rec.node = el(u.item.href ? "a" : "button", {
        class: "ak-notices__item",
        type: u.item.href ? null : "button",
        href: u.item.href || null,
        "data-ak-noguard": true,
        on: { click: function() {
          if (s.onOpen) s.onOpen(rec.item);
        } }
      }, [
        el("span", { class: "ak-notices__mark", "aria-hidden": "true" }),
        el("span", { class: "ak-notices__words" }, [rec.title, rec.text]),
        el("span", { class: "ak-notices__side" }, [rec.time, rec.dot])
      ]);
      fillItem(rec, u);
      return rec;
    }
    function render(data) {
      dated = rowsOf(data).filter(function(it) {
        return it && it.id != null;
      }).map(function(it) {
        const when = new Date(it.at);
        return { item: it, when: isNaN(when.getTime()) ? null : when };
      }).sort(function(a, b) {
        return (b.when ? b.when.getTime() : 0) - (a.when ? a.when.getTime() : 0);
      });
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      clear(head);
      clear(body);
      if (!dated.length) {
        shown.clear();
        const e = s.empty || {};
        emptyCard = emptyState({
          target: root,
          tone: "quiet",
          title: e.title || "Nothing new",
          hint: e.hint || "Notices land here as they arrive."
        });
        return;
      }
      if (s.title) head.appendChild(el("div", { class: "ak-notices__title", text: s.title }));
      if (dated.some(function(u) {
        return !u.item.read;
      })) head.appendChild(markAll);
      root.appendChild(head);
      root.appendChild(body);
      const live = {};
      dated.forEach(function(u) {
        live[String(u.item.id)] = 1;
      });
      Array.from(shown.keys()).forEach(function(id) {
        if (!live[id]) shown.delete(id);
      });
      const fresh = [];
      let heading = null;
      dated.forEach(function(u) {
        const label = dayLabel(u.when);
        if (label !== heading) {
          body.appendChild(el("div", { class: "ak-notices__day", text: label }));
          heading = label;
        }
        const id = String(u.item.id);
        let rec = shown.get(id);
        if (!rec) {
          rec = buildItem(u);
          shown.set(id, rec);
          fresh.push(rec.node);
        } else {
          fillItem(rec, u);
        }
        body.appendChild(rec.node);
      });
      if (!mounted) enter(body);
      else if (fresh.length) stagger(fresh, { from: "up" });
      mounted = true;
    }
    render(s.data);
    return {
      el: root,
      set(patch) {
        if (patch && "data" in patch) render(patch.data);
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function facets(spec) {
    const s = spec || {};
    const root = el("div", { class: "ak-root ak-facets" });
    if (s.target) resolve(s.target).appendChild(root);
    const groups = el("div", { class: "ak-facets__groups" });
    const summary = el("div", { class: "ak-facets__summary" });
    const tally = el("span", { class: "ak-facets__tally" });
    const clearAll = el("button", {
      type: "button",
      class: "ak-btn ak-facets__clear",
      text: "Clear",
      on: { click: function() {
        reset();
      } }
    }, null);
    const chips = /* @__PURE__ */ new Map();
    let picked = {};
    let mounted = false;
    let emptyCard = null;
    function adopt(source) {
      picked = {};
      Object.keys(source || {}).forEach(function(key) {
        const list2 = source[key];
        if (Array.isArray(list2) && list2.length) picked[key] = list2.slice();
      });
    }
    adopt(s.selected);
    function selection() {
      const out = {};
      Object.keys(picked).forEach(function(key) {
        out[key] = picked[key].slice();
      });
      return out;
    }
    function paint() {
      chips.forEach(function(rec) {
        const on = (picked[rec.facet.id] || []).indexOf(rec.option.id) >= 0;
        rec.chip.setAttribute("aria-pressed", on ? "true" : "false");
      });
      const n = Object.keys(picked).reduce(function(sum, key) {
        return sum + picked[key].length;
      }, 0);
      clear(summary);
      tally.textContent = n === 0 ? "No filters" : n === 1 ? "1 filter" : n + " filters";
      summary.appendChild(tally);
      if (n) {
        summary.appendChild(el("span", { class: "ak-facets__sep", "aria-hidden": "true" }, "·"));
        summary.appendChild(clearAll);
      }
    }
    function toggle(rec) {
      const facet = rec.facet;
      const list2 = picked[facet.id] ? picked[facet.id].slice() : [];
      const at = list2.indexOf(rec.option.id);
      if (facet.multi) {
        if (at >= 0) list2.splice(at, 1);
        else list2.push(rec.option.id);
      } else if (at >= 0) {
        list2.length = 0;
      } else {
        list2.length = 0;
        list2.push(rec.option.id);
      }
      if (list2.length) picked[facet.id] = list2;
      else delete picked[facet.id];
      paint();
      if (s.onChange) s.onChange(selection());
    }
    function reset() {
      picked = {};
      paint();
      if (s.onClear) s.onClear();
      if (s.onChange) s.onChange(selection());
    }
    function buildChip(facet, option) {
      const rec = (
        /** @type {any} */
        {
          chip: null,
          facet,
          option,
          label: el("span", { class: "ak-facets__chiplabel" }),
          count: el("span", { class: "ak-facets__chipcount" })
        }
      );
      rec.chip = el("button", {
        type: "button",
        class: "ak-facets__chip",
        "aria-pressed": "false",
        "data-ak-noguard": true,
        on: { click: function() {
          toggle(rec);
        } }
      }, [rec.label, rec.count]);
      return rec;
    }
    function render(data) {
      const defs = (data && Array.isArray(data.facets) ? data.facets : []).filter(function(f) {
        return f && f.id;
      });
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      clear(groups);
      if (!defs.length) {
        chips.clear();
        const e = s.empty || {};
        emptyCard = emptyState({
          target: root,
          tone: "quiet",
          title: e.title || "Nothing to filter by",
          hint: e.hint
        });
        return;
      }
      if (s.title) root.appendChild(el("div", { class: "ak-facets__title", text: s.title }));
      root.appendChild(groups);
      const live = {};
      defs.forEach(function(facet) {
        const row = el("div", { class: "ak-facets__chips", role: "group", "aria-label": String(facet.label || facet.id) });
        (Array.isArray(facet.options) ? facet.options : []).filter(function(o) {
          return o && o.id;
        }).forEach(function(option) {
          const key = facet.id + "\0" + option.id;
          live[key] = 1;
          let rec = chips.get(key);
          if (!rec) {
            chips.set(key, rec = buildChip(facet, option));
          } else {
            rec.facet = facet;
            rec.option = option;
          }
          rec.label.textContent = String(option.label || option.id);
          if (typeof option.count === "number") {
            rec.count.hidden = false;
            odometer(rec.count, option.count);
          } else {
            rec.count.hidden = true;
            rec.count.removeAttribute("data-odo");
            rec.count.textContent = "";
          }
          row.appendChild(rec.chip);
        });
        groups.appendChild(el("div", { class: "ak-facets__group" }, [
          el("div", { class: "ak-facets__label", text: String(facet.label || facet.id) }),
          row
        ]));
      });
      Array.from(chips.keys()).forEach(function(key) {
        if (!live[key]) chips.delete(key);
      });
      root.appendChild(summary);
      paint();
      if (!mounted) enter(groups);
      mounted = true;
    }
    render(s.data);
    return {
      el: root,
      set(patch) {
        if (!patch) return;
        if ("selected" in patch) adopt(patch.selected);
        if ("data" in patch) render(patch.data);
        else if ("selected" in patch) paint();
      },
      destroy() {
        if (emptyCard) emptyCard.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/atelier/planner.js
  var TONES5 = ["ok", "warn", "err", "accent"];
  var CARD_SPRING = { stiffness: 300, damping: 26 };
  function toneOf2(value, fallback) {
    return TONES5.indexOf(value) >= 0 ? value : fallback || "accent";
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
      const was = root.querySelector(`[data-card="${cardId}"]`);
      const from = was ? was.getBoundingClientRect() : null;
      card.column = toColumn;
      render(current2);
      const again = (
        /** @type {HTMLElement} */
        root.querySelector(`[data-card="${cardId}"]`)
      );
      if (again) {
        if (from) {
          again.classList.remove("ak-kanban__card--enter");
          again.style.animationDelay = "";
          const to = again.getBoundingClientRect();
          flipFrom(again, from.left - to.left, from.top - to.top, CARD_SPRING);
        }
        again.focus();
      }
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
            class: "ak-kanban__card" + (TONES5.indexOf(card.tone) >= 0 ? " ak-kanban__card--" + card.tone : ""),
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
      const grid2 = el("div", { class: "ak-schedule__grid" });
      const hours = el("div", { class: "ak-schedule__hours" });
      for (let m = Math.ceil(open / 60) * 60; m <= close; m += 60) {
        const line = el("span", { class: "ak-schedule__hour", text: `${String(Math.floor(m / 60)).padStart(2, "0")}:00` });
        line.style.top = Y(m) + "%";
        hours.appendChild(line);
      }
      grid2.appendChild(hours);
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
        grid2.appendChild(col);
      });
      root.appendChild(grid2);
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
  var TONES6 = ["ok", "warn", "err", "plain"];
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
      const tone = TONES6.indexOf(line.tone) >= 0 ? line.tone : "plain";
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
  var KINDS2 = ["terms", "privacy", "imprint", "refunds", "accessibility", "cookies", "support"];
  function isPlaceholder(v) {
    return /^\s*</.test(String(v == null ? "" : v));
  }
  function wantsSample(spec, keys2) {
    if (spec && spec.sample === true) return true;
    for (const k of keys2 || []) if (spec && isPlaceholder(spec[k])) return true;
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
      recommended: KINDS2.slice(),
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
      for (const kind of KINDS2) {
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
  function rowsOf2(data) {
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
    const rows = rowsOf2(s.data);
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
    const items = rowsOf2(s.data).map(function(x) {
      return typeof x === "string" ? x : String(x && x.text || "");
    }).filter(Boolean);
    root.textContent = items.length ? "★ " + items.join("  ★  ") : "★";
    enter(root);
    return { el: root, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }

  // src/static/sdk-libs/atelier/parts.js
  function rowsOf3(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  }
  function ring(spec) {
    const s = spec || {};
    const root = el("div", { class: "ak-root ak-ring" });
    if (s.target) resolve(s.target).appendChild(root);
    const size = s.size || 96;
    const r = (size - 12) / 2;
    const circ = 2 * Math.PI * r;
    function render(d) {
      clear(root);
      if (!d || typeof d.value !== "number" || !(d.total > 0)) {
        const e = s.empty || {};
        emptyState({ target: root, tone: "quiet", title: e.title || s.title || "—", hint: e.hint });
        return;
      }
      const share = Math.max(0, Math.min(d.value / d.total, 1));
      const node = svg("svg", {
        class: "ak-ring__svg",
        width: size,
        height: size,
        viewBox: "0 0 " + size + " " + size,
        role: "img",
        "aria-label": (d.label ? d.label + ": " : "") + d.value + " / " + d.total
      });
      node.appendChild(svg("circle", { class: "ak-ring__track", cx: size / 2, cy: size / 2, r, "stroke-width": 10 }));
      node.appendChild(svg("circle", {
        class: "ak-ring__fill",
        cx: size / 2,
        cy: size / 2,
        r,
        "stroke-width": 10,
        "stroke-dasharray": circ.toFixed(1),
        "stroke-dashoffset": (circ * (1 - share)).toFixed(1),
        transform: "rotate(-90 " + size / 2 + " " + size / 2 + ")"
      }));
      const t2 = svg("text", { class: "ak-ring__value", x: size / 2, y: size / 2 + 6, "text-anchor": "middle", "font-size": Math.round(size / 5) });
      t2.textContent = d.value + "/" + d.total;
      node.appendChild(t2);
      root.appendChild(node);
      root.appendChild(el("div", {}, [
        d.label ? el("div", { class: "ak-ring__label" }, String(d.label)) : null,
        d.sub ? el("div", { class: "ak-ring__sub" }, String(d.sub)) : null
      ].filter(Boolean)));
      enter(root);
    }
    render(s.data);
    return { el: root, set(patch) {
      if (patch && "data" in patch) render(patch.data);
    }, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }
  function crew(spec) {
    const s = spec || {};
    const root = el("div", { class: "ak-root ak-crew" });
    if (s.target) resolve(s.target).appendChild(root);
    function render(d) {
      clear(root);
      const people = d && Array.isArray(d.people) ? d.people : rowsOf3(d);
      if (!people.length) {
        const e = s.empty || {};
        emptyState({ target: root, tone: "quiet", title: e.title || s.title || "—", hint: e.hint });
        return;
      }
      const max = d && d.max || 4;
      const stack = el("div", { class: "ak-crew__stack" });
      people.slice(0, max).forEach(function(p, i) {
        const initials = String(p.label || p.id || "?").trim().split(/\s+/).map(function(w) {
          return w[0];
        }).join("").slice(0, 2).toUpperCase();
        stack.appendChild(el("span", {
          class: "ak-crew__face ak-crew__face--" + (i % 3 + 1) + (p.agent ? " ak-crew__face--agent" : ""),
          title: String(p.label || p.id || "")
        }, initials));
      });
      if (people.length > max) stack.appendChild(el("span", { class: "ak-crew__face ak-crew__more" }, "+" + (people.length - max)));
      root.appendChild(stack);
      if (d && typeof d.live === "number" && d.live > 0) {
        root.appendChild(el("span", { class: "ak-crew__live" }, [el("span", { class: "ak-crew__dot" }), String(d.live) + " " + (d.liveLabel || "here now")]));
      }
      enter(root);
    }
    render(s.data);
    return { el: root, set(patch) {
      if (patch && "data" in patch) render(patch.data);
    }, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }
  function poll(spec) {
    const s = spec || {};
    const root = el("div", { class: "ak-root ak-poll" });
    if (s.target) resolve(s.target).appendChild(root);
    function render(d) {
      clear(root);
      const opts = d && Array.isArray(d.options) ? d.options : rowsOf3(d);
      if (!opts.length) {
        const e = s.empty || {};
        emptyState({ target: root, tone: "quiet", title: e.title || "—", hint: e.hint });
        return;
      }
      if (d && d.question) root.appendChild(el("div", { class: "ak-poll__q" }, String(d.question)));
      const total = opts.reduce(function(n, o) {
        return n + (typeof o.count === "number" ? o.count : 0);
      }, 0);
      opts.forEach(function(o) {
        const share = typeof o.share === "number" ? o.share : total > 0 ? (o.count || 0) / total : 0;
        const pct = Math.round(Math.max(0, Math.min(share, 1)) * 100);
        root.appendChild(el("button", {
          type: "button",
          class: "ak-poll__opt",
          "aria-pressed": d && d.picked === o.id ? "true" : "false",
          on: s.onPick ? { click: function() {
            s.onPick(o);
          } } : void 0
        }, [
          el("span", { class: "ak-poll__fill", style: "--ak-share:" + pct + "%" }),
          el("span", { class: "ak-poll__row" }, [el("span", {}, String(o.label || o.id)), el("span", { class: "ak-poll__share" }, pct + "%")])
        ]));
      });
      enter(root);
    }
    render(s.data);
    return { el: root, set(patch) {
      if (patch && "data" in patch) render(patch.data);
    }, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }
  function keys(spec) {
    const s = spec || {};
    const root = el("ul", { class: "ak-root ak-keys" });
    if (s.target) resolve(s.target).appendChild(root);
    function render(d) {
      clear(root);
      rowsOf3(d).forEach(function(row) {
        const ks = Array.isArray(row.keys) ? row.keys : [String(row.keys || "")];
        root.appendChild(el("li", { class: "ak-keys__row" }, ks.map(function(k) {
          return el("kbd", { class: "ak-kbd" }, k);
        }).concat([el("span", {}, String(row.label || ""))])));
      });
    }
    render(s.data);
    return { el: root, set(patch) {
      if (patch && "data" in patch) render(patch.data);
    }, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }
  function dropzone(spec) {
    const s = spec || /** @type {any} */
    {};
    const accept = (s.accept || []).map(function(a) {
      return String(a).toLowerCase();
    });
    const input = (
      /** @type {HTMLInputElement} */
      el("input", { type: "file", multiple: s.multiple ? true : null, accept: accept.length ? accept.join(",") : null })
    );
    const err = el("div", { class: "ak-dropzone__err", hidden: true });
    const root = el("div", { class: "ak-root ak-dropzone", role: "button", tabindex: "0" }, [
      el("div", { class: "ak-dropzone__label" }, s.label || "Drop the file, or press to pick"),
      s.hint ? el("div", { class: "ak-dropzone__hint" }, s.hint) : null,
      err,
      input
    ].filter(Boolean));
    if (s.target) resolve(s.target).appendChild(root);
    function take(list2) {
      const files = Array.prototype.slice.call(list2 || []);
      const bad = files.find(function(f) {
        const ext = "." + String(f.name).split(".").pop().toLowerCase();
        if (accept.length && accept.indexOf(ext) < 0 && accept.indexOf(f.type) < 0) return true;
        return s.maxBytes ? f.size > s.maxBytes : false;
      });
      if (bad) {
        err.textContent = s.maxBytes && bad.size > s.maxBytes ? bad.name + " is over " + Math.round(s.maxBytes / 1e6) + " MB." : bad.name + " is not a kind this takes.";
        err.hidden = false;
        return;
      }
      err.hidden = true;
      if (files.length && s.onFiles) s.onFiles(s.multiple ? files : files.slice(0, 1));
    }
    root.addEventListener("click", function(e) {
      if (e.target !== input) input.click();
    });
    root.addEventListener("keydown", function(e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", function() {
      take(input.files);
      input.value = "";
    });
    root.addEventListener("dragover", function(e) {
      e.preventDefault();
      root.classList.add("is-over");
    });
    root.addEventListener("dragleave", function() {
      root.classList.remove("is-over");
    });
    root.addEventListener("drop", function(e) {
      e.preventDefault();
      root.classList.remove("is-over");
      take(e.dataTransfer ? e.dataTransfer.files : null);
    });
    enter(root);
    return { el: root, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }

  // src/static/sdk-libs/atelier/lenis-parts.js
  var lenisPromise = null;
  function ensureLenis() {
    const w = (
      /** @type {any} */
      window
    );
    if (w.Lenis) return Promise.resolve(w.Lenis);
    if (lenisPromise) return lenisPromise;
    lenisPromise = new Promise(function(ok, fail) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = NODE_URL + "/lib/lenis@1.css";
      document.head.appendChild(css);
      const s = document.createElement("script");
      s.src = NODE_URL + "/lib/lenis@1.min.js";
      s.onload = function() {
        ok(w.Lenis);
      };
      s.onerror = function() {
        lenisPromise = null;
        fail(new Error("lenis failed to load"));
      };
      document.head.appendChild(s);
    });
    return lenisPromise;
  }
  function wellScroller(well, content) {
    let engine = null;
    let dead = false;
    if (!reducedMotion()) {
      ensureLenis().then(function(Lenis) {
        if (dead) return;
        engine = new Lenis({ wrapper: well, content, autoRaf: true });
      }, function(err) {
        console.warn("aimeat-atelier: lenis did not load, the browser scrolls this well", err);
      });
    }
    function plain(top) {
      const to = Math.max(0, top);
      if (typeof well.scrollTo === "function") {
        well.scrollTo({ top: to, behavior: reducedMotion() ? "auto" : "smooth" });
      } else {
        well.scrollTop = to;
      }
    }
    function topOf(node) {
      return well.scrollTop + (node.getBoundingClientRect().top - well.getBoundingClientRect().top);
    }
    return {
      to(node, offset) {
        if (!node) return;
        const pad = offset || 0;
        if (engine) {
          engine.scrollTo(node, { offset: pad, duration: 0.7 });
          return;
        }
        plain(topOf(node) + pad);
      },
      toBottom(node) {
        if (engine && node) {
          engine.scrollTo(node, { offset: -Math.max(0, well.clientHeight - node.offsetHeight - 12), duration: 0.7 });
          return;
        }
        plain(well.scrollHeight);
      },
      destroy() {
        dead = true;
        if (engine) {
          engine.destroy();
          engine = null;
        }
      }
    };
  }
  var STATUS_WORDS = { sent: "Sent", read: "Read", failed: "Not sent" };
  function dateOf(at) {
    if (!at) return null;
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function dayKeyOf(at) {
    const d = dateOf(at);
    if (!d) return "unknown";
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function dayLabelOf(at) {
    const d = dateOf(at);
    if (!d) return "Earlier";
    const now2 = /* @__PURE__ */ new Date();
    const key = dayKeyOf(at);
    if (key === dayKeyOf(now2)) return "Today";
    const back = new Date(now2.getTime() - 864e5);
    if (key === dayKeyOf(back)) return "Yesterday";
    if (typeof Intl === "object" && Intl.DateTimeFormat) {
      return new Intl.DateTimeFormat(void 0, { weekday: "short", day: "numeric", month: "short" }).format(d);
    }
    return d.toDateString();
  }
  function timeLabelOf(at) {
    const d = dateOf(at);
    if (!d) return "";
    if (typeof Intl === "object" && Intl.DateTimeFormat) {
      return new Intl.DateTimeFormat(void 0, { hour: "2-digit", minute: "2-digit" }).format(d);
    }
    return d.toTimeString().slice(0, 5);
  }
  function initialsOf(who) {
    return String(who || "?").trim().split(/\s+/).map(function(w) {
      return w[0];
    }).join("").slice(0, 2).toUpperCase();
  }
  function messagesOf(d) {
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.messages)) return d.messages;
    return [];
  }
  function thread(spec) {
    const s = spec || {};
    const stream = el("div", { class: "ak-thread__stream" });
    const well = el("div", {
      class: "ak-thread__well",
      role: "log",
      "aria-live": "polite",
      tabindex: "0",
      "aria-label": s.title || "Discussion"
    }, [stream]);
    const root = el("section", { class: "ak-root ak-thread" }, [
      s.title ? el("h2", { class: "ak-section__title ak-thread__title" }, String(s.title)) : null,
      well
    ].filter(Boolean));
    if (s.target) resolve(s.target).appendChild(root);
    const view = wellScroller(well, stream);
    const shown = /* @__PURE__ */ new Map();
    const dayRows = /* @__PURE__ */ new Map();
    let blank = null;
    function bubbleFor(m) {
      const who = String(m.label || m.who || "");
      const word = STATUS_WORDS[m.status];
      const meta = el("div", { class: "ak-thread__meta" }, [
        el("time", { class: "ak-thread__time", datetime: m.at || null }, timeLabelOf(m.at)),
        word ? el("span", { class: "ak-thread__status ak-thread__status--" + m.status }, word) : null
      ].filter(Boolean));
      const bubble = el("div", { class: "ak-thread__bubble" }, [
        m.mine ? null : el("div", { class: "ak-thread__who" }, who),
        el("p", { class: "ak-thread__text" }, String(m.text == null ? "" : m.text)),
        meta
      ].filter(Boolean));
      return el("article", {
        class: "ak-thread__msg" + (m.mine ? " ak-thread__msg--mine" : "") + (m.agent ? " ak-thread__msg--agent" : ""),
        "data-ak-msg": String(m.id)
      }, [
        el("span", { class: "ak-thread__avatar", "aria-hidden": "true", title: who }, initialsOf(who)),
        bubble
      ]);
    }
    function render(list2) {
      const msgs = Array.isArray(list2) ? list2 : [];
      if (!msgs.length) {
        shown.clear();
        dayRows.clear();
        clear(stream);
        const e = s.empty || {};
        blank = emptyState({
          target: stream,
          tone: "quiet",
          title: e.title || "No messages yet",
          hint: e.hint || (s.onSend ? "Write the first one." : void 0)
        });
        return;
      }
      if (blank) {
        blank.destroy();
        blank = null;
      }
      const seen = /* @__PURE__ */ new Set();
      const liveDays = /* @__PURE__ */ new Set();
      const fresh = [];
      msgs.forEach(function(m) {
        const id = String(m.id);
        const key = dayKeyOf(m.at);
        seen.add(id);
        liveDays.add(key);
        if (!dayRows.has(key)) {
          const row = el("div", { class: "ak-thread__day" }, [el("span", {}, dayLabelOf(m.at))]);
          dayRows.set(key, row);
          stream.appendChild(row);
        }
        if (shown.has(id)) return;
        const node = bubbleFor(m);
        shown.set(id, node);
        stream.appendChild(node);
        fresh.push(node);
      });
      Array.from(shown.keys()).forEach(function(id) {
        if (seen.has(id)) return;
        const node = shown.get(id);
        if (node && node.parentNode) node.parentNode.removeChild(node);
        shown.delete(id);
      });
      Array.from(dayRows.keys()).forEach(function(key) {
        if (liveDays.has(key)) return;
        const row = dayRows.get(key);
        if (row && row.parentNode) row.parentNode.removeChild(row);
        dayRows.delete(key);
      });
      if (!fresh.length) return;
      stagger(fresh, { from: "up" });
      const last = fresh[fresh.length - 1];
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(function() {
        view.toBottom(last);
      });
      else view.toBottom(last);
    }
    if (s.onSend) {
      const hint = s.placeholder || "Write a message…";
      const input = (
        /** @type {HTMLTextAreaElement} */
        el("textarea", {
          class: "ak-input ak-input--area ak-thread__input",
          rows: 2,
          placeholder: hint,
          "aria-label": hint
        })
      );
      const send = function() {
        const text = input.value.trim();
        if (!text) {
          attention(input, "shake");
          return;
        }
        input.value = "";
        s.onSend(text);
      };
      input.addEventListener("keydown", function(ev) {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          send();
        }
      });
      root.appendChild(el("div", { class: "ak-thread__composer" }, [
        input,
        el("button", { type: "button", class: "ak-btn ak-btn--primary", on: { click: send } }, "Send")
      ]));
    }
    render(messagesOf(s.data));
    return {
      el: root,
      set(patch) {
        if (!patch || !("data" in patch)) return;
        render(messagesOf(patch.data));
      },
      destroy() {
        view.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  var STEP_NAMES = ["Your order", "Details", "Delivery", "Review"];
  var DETAIL_FIELDS = [
    { name: "name", label: "Full name", type: "text", required: true },
    { name: "email", label: "Email", type: "text", required: true, hint: "Where the receipt goes." },
    { name: "address", label: "Street address", type: "text", required: true },
    { name: "postcode", label: "Postcode", type: "text", required: true },
    { name: "city", label: "City", type: "text", required: true },
    { name: "country", label: "Country", type: "text" }
  ];
  function money2(value, currency) {
    const v = Math.round((Number(value) || 0) * 100) / 100;
    const cur = currency || "€";
    if (typeof Intl === "object" && Intl.NumberFormat) {
      if (/^[A-Za-z]{3}$/.test(cur)) {
        try {
          return new Intl.NumberFormat(void 0, { style: "currency", currency: cur.toUpperCase() }).format(v);
        } catch {
        }
      }
      return new Intl.NumberFormat(void 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " " + cur;
    }
    return v.toFixed(2) + " " + cur;
  }
  function checkout(spec) {
    const s = spec || /** @type {any} */
    {};
    let data = s.data || { lines: [] };
    let shipId = null;
    let placed = false;
    const names = data.steps && data.steps.length === 4 ? data.steps : STEP_NAMES;
    const ids = names.map(function() {
      return uid("ak-co");
    });
    const lineList = el("ol", { class: "ak-checkout__lines" });
    const itemsSum = el("div", { class: "ak-checkout__sum" });
    const shipList = el("div", { class: "ak-checkout__ships" });
    const totals = el("div", { class: "ak-checkout__totals" });
    const noteInput = (
      /** @type {HTMLTextAreaElement} */
      el("textarea", {
        id: uid("ak-note"),
        class: "ak-input ak-input--area",
        rows: 2,
        placeholder: "Anything we should know?",
        "aria-label": "A note with the order"
      })
    );
    const refusal = el("p", { class: "ak-checkout__refusal", role: "alert", hidden: true });
    const settled = el(
      "p",
      { class: "ak-checkout__settled", role: "status", hidden: true },
      "✓ Order placed. The receipt is on its way to your email."
    );
    const placeBtn = el("button", { type: "button", class: "ak-btn ak-btn--primary ak-checkout__place" }, "Place order");
    const details = form({
      fields: DETAIL_FIELDS,
      submitLabel: "Continue to delivery",
      onSubmit() {
        goTo(2);
      }
    });
    function section2(i, kids) {
      return el("section", { class: "ak-checkout__section", "aria-labelledby": ids[i] }, [
        el("h3", { class: "ak-checkout__heading", id: ids[i] }, names[i])
      ].concat(kids));
    }
    const sections = [
      section2(0, [lineList, itemsSum]),
      section2(1, [details.el]),
      section2(2, [shipList]),
      section2(3, [
        totals,
        el("label", { class: "ak-form__label", for: noteInput.id }, "A note with the order"),
        noteInput,
        refusal,
        placeBtn,
        settled
      ])
    ];
    const page = el("div", { class: "ak-checkout__page" }, sections);
    const well = el("div", { class: "ak-checkout__well" }, [page]);
    const railBtns = names.map(function(name, i) {
      return el("button", {
        type: "button",
        class: "ak-checkout__step",
        on: { click: function() {
          goTo(i);
        } }
      }, [el("span", { class: "ak-checkout__step-n" }, String(i + 1)), el("span", {}, name)]);
    });
    const rail = el("nav", { class: "ak-checkout__rail", "aria-label": "Order steps" }, [
      s.onBack ? el("button", {
        type: "button",
        class: "ak-btn ak-btn--ghost ak-checkout__back",
        on: { click: function() {
          if (s.onBack) s.onBack();
        } }
      }, "↩ Back") : null
    ].filter(Boolean).concat(railBtns));
    const root = el("section", { class: "ak-root ak-checkout" }, [rail, well]);
    if (s.target) resolve(s.target).appendChild(root);
    const view = wellScroller(well, page);
    function goTo(i) {
      view.to(sections[i], -12);
      markCurrent(i);
    }
    function markCurrent(i) {
      railBtns.forEach(function(b, n) {
        if (n === i) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
        b.classList.toggle("is-current", n === i);
      });
    }
    let io = null;
    if (typeof IntersectionObserver === "function") {
      const visible = /* @__PURE__ */ new Set();
      io = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          const i = sections.indexOf(
            /** @type {HTMLElement} */
            entry.target
          );
          if (i < 0) return;
          if (entry.isIntersecting) visible.add(i);
          else visible.delete(i);
        });
        const open = Array.from(visible).sort(function(a, b) {
          return a - b;
        });
        if (open.length) markCurrent(open[0]);
      }, { root: well, threshold: 0.2 });
      sections.forEach(function(sec) {
        io.observe(sec);
      });
    }
    markCurrent(0);
    function chosenShip() {
      const options = Array.isArray(data.shipping) ? data.shipping : [];
      return options.find(function(o) {
        return o.id === shipId;
      }) || null;
    }
    function itemsTotal() {
      return (Array.isArray(data.lines) ? data.lines : []).reduce(function(n, l) {
        return n + (Number(l.price) || 0) * (Number(l.qty) || 0);
      }, 0);
    }
    function renderTotals() {
      const cur = data.currency;
      const ship = chosenShip();
      const items = itemsTotal();
      const carriage = ship ? Number(ship.price) || 0 : 0;
      clear(itemsSum);
      itemsSum.appendChild(el("span", {}, "Items"));
      itemsSum.appendChild(el("span", { class: "ak-checkout__figure" }, money2(items, cur)));
      clear(totals);
      [
        ["Items", money2(items, cur), ""],
        ["Delivery", ship ? money2(carriage, cur) : "Chosen after the order", ""],
        ["Total", money2(items + carriage, cur), " ak-checkout__total--grand"]
      ].forEach(function(row) {
        totals.appendChild(el("div", { class: "ak-checkout__total" + row[2] }, [
          el("span", {}, row[0]),
          el("span", { class: "ak-checkout__figure" }, row[1])
        ]));
      });
    }
    function renderLines() {
      const cur = data.currency;
      const lines = Array.isArray(data.lines) ? data.lines : [];
      clear(lineList);
      if (!lines.length) {
        emptyState({ target: lineList, tone: "quiet", title: "Nothing in the order", hint: "Add something and it appears here." });
        return;
      }
      lines.forEach(function(l) {
        lineList.appendChild(el("li", { class: "ak-checkout__line" }, [
          el("div", { class: "ak-checkout__line-main" }, [
            el("span", { class: "ak-checkout__line-title" }, String(l.title || l.id)),
            l.sub ? el("span", { class: "ak-checkout__line-sub" }, String(l.sub)) : null
          ].filter(Boolean)),
          el("span", { class: "ak-checkout__qty" }, String(Number(l.qty) || 0) + " ×"),
          el("span", { class: "ak-checkout__figure" }, money2((Number(l.price) || 0) * (Number(l.qty) || 0), cur))
        ]));
      });
      stagger(Array.prototype.slice.call(lineList.children), { from: "up" });
    }
    function renderShipping() {
      const cur = data.currency;
      const options = Array.isArray(data.shipping) ? data.shipping : [];
      const group = uid("ak-ship");
      clear(shipList);
      if (!options.length) {
        shipId = null;
        shipList.appendChild(el("p", { class: "ak-checkout__quiet" }, "Delivery is agreed after the order is in."));
        return;
      }
      if (!options.some(function(o) {
        return o.id === shipId;
      })) shipId = options[0].id;
      options.forEach(function(o) {
        const radio = (
          /** @type {HTMLInputElement} */
          el("input", {
            type: "radio",
            name: group,
            value: String(o.id),
            class: "ak-checkout__radio",
            checked: o.id === shipId ? true : null,
            on: { change: function() {
              shipId = o.id;
              renderTotals();
            } }
          })
        );
        shipList.appendChild(el("label", { class: "ak-checkout__ship" }, [
          radio,
          el("span", { class: "ak-checkout__ship-label" }, String(o.label || o.id)),
          el("span", { class: "ak-checkout__figure" }, money2(o.price, cur))
        ]));
      });
    }
    function place2() {
      if (placed) return;
      const contact = details.values();
      details.clearErrors();
      const missing = DETAIL_FIELDS.filter(function(f) {
        return f.required && !String(contact[f.name] == null ? "" : contact[f.name]).trim();
      });
      if (missing.length) {
        missing.forEach(function(f) {
          details.setError(f.name, f.label + " is needed before the order can go.");
        });
        goTo(1);
        return;
      }
      if (String(contact.email).indexOf("@") < 0) {
        details.setError("email", "An email address has an @ in it.");
        goTo(1);
        return;
      }
      refusal.hidden = true;
      const order = {
        lines: Array.isArray(data.lines) ? data.lines.slice() : [],
        shipping: chosenShip(),
        contact,
        note: noteInput.value.trim()
      };
      if (s.onSubmit) {
        try {
          s.onSubmit(order);
        } catch (err) {
          refusal.textContent = err && err.message || "The order did not go through. Try once more.";
          refusal.hidden = false;
          attention(refusal, "shake");
          return;
        }
      }
      placed = true;
      placeBtn.hidden = true;
      settled.hidden = false;
      attention(settled, "rise");
    }
    placeBtn.addEventListener("click", place2);
    renderLines();
    renderShipping();
    renderTotals();
    stagger(sections, { from: "up" });
    return {
      el: root,
      set(patch) {
        if (!patch || !("data" in patch) || !patch.data) return;
        data = patch.data;
        renderLines();
        renderShipping();
        renderTotals();
      },
      destroy() {
        if (io) {
          io.disconnect();
          io = null;
        }
        view.destroy();
        details.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/atelier/anime-parts.js
  var W4 = (
    /** @type {any} */
    window
  );
  var animePromise = null;
  var animeOff = false;
  function ensureAnime() {
    if (W4.anime && W4.anime.animate) return Promise.resolve(W4.anime);
    if (animePromise) return animePromise;
    animePromise = new Promise(function(ok, fail) {
      const s = document.createElement("script");
      s.src = NODE_URL + "/lib/anime@4.min.js";
      s.onload = function() {
        ok(W4.anime);
      };
      s.onerror = function() {
        animePromise = null;
        fail(new Error("anime failed to load"));
      };
      document.head.appendChild(s);
    });
    return animePromise;
  }
  function withAnime(run) {
    if (animeOff || reducedMotion()) return;
    ensureAnime().then(run, function() {
      animeOff = true;
    });
  }
  function warmAnime() {
    if (animeOff || reducedMotion()) return;
    ensureAnime().then(null, function() {
      animeOff = true;
    });
  }
  var TONES7 = ["ok", "warn", "err", "accent"];
  function toneOf3(value) {
    return TONES7.indexOf(value) >= 0 ? value : "accent";
  }
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function isoDay(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function isoMonth(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }
  function monthStart(value) {
    const m = /^(\d{4})-(\d{1,2})/.exec(String(value == null ? "" : value));
    const now2 = /* @__PURE__ */ new Date();
    if (!m) return new Date(now2.getFullYear(), now2.getMonth(), 1);
    return new Date(Number(m[1]), Number(m[2]) - 1, 1);
  }
  function chevron(dir) {
    const node = svg("svg", { class: "ak-calendar__chev", viewBox: "0 0 14 14", width: 14, height: 14, "aria-hidden": "true" });
    node.appendChild(svg("path", {
      d: dir < 0 ? "M9 2 L4 7 L9 12" : "M5 2 L10 7 L5 12",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    }));
    return node;
  }
  function calendar(spec) {
    const s = spec || {};
    const root = el("div", { class: "ak-root ak-calendar" });
    if (s.target) resolve(s.target).appendChild(root);
    const weekStart = s.weekStart === 0 ? 0 : 1;
    let data = s.data === void 0 ? null : s.data;
    let shown = monthStart(data && data.month);
    let emptyCard = null;
    const title = el("div", { class: "ak-calendar__title" });
    const grid2 = el("div", { class: "ak-calendar__grid", role: "grid" });
    const head = el("div", { class: "ak-calendar__head" }, [
      el("button", {
        type: "button",
        class: "ak-calendar__nav",
        "aria-label": t("previous"),
        on: { click: function() {
          turn(-1);
        } }
      }, chevron(-1)),
      title,
      el("button", {
        type: "button",
        class: "ak-calendar__nav",
        "aria-label": t("next"),
        on: { click: function() {
          turn(1);
        } }
      }, chevron(1))
    ]);
    function eventsByDay() {
      const byDay = {};
      const list2 = data && Array.isArray(data.events) ? data.events : [];
      for (const e of list2) {
        if (!e || typeof e.date !== "string") continue;
        const key = e.date.slice(0, 10);
        if (!byDay[key]) byDay[key] = [];
        byDay[key].push(e);
      }
      return byDay;
    }
    function pips(events) {
      if (!events.length) return null;
      const wrap = el("span", { class: "ak-calendar__pips", "aria-hidden": "true" });
      events.slice(0, 3).forEach(function(e) {
        wrap.appendChild(el("span", { class: "ak-calendar__pip ak-calendar__pip--" + toneOf3(e.tone) }));
      });
      if (events.length > 3) wrap.appendChild(el("span", { class: "ak-calendar__more" }, "+" + (events.length - 3)));
      return wrap;
    }
    function travel3(cells) {
      if (!cells.length) return;
      const asked = Date.now();
      withAnime(function(a) {
        if (Date.now() - asked > 400) return;
        a.animate(cells, { y: [10, 0], opacity: [0, 1], duration: 260, delay: a.stagger(9), ease: "outQuad" });
      });
    }
    function paint() {
      const year = shown.getFullYear();
      const mon = shown.getMonth();
      const label = t("m" + (mon + 1)) + " " + year;
      title.textContent = label;
      grid2.setAttribute("aria-label", label);
      clear(grid2);
      const byDay = eventsByDay();
      const today = isoDay(/* @__PURE__ */ new Date());
      const names = el("div", { class: "ak-calendar__row ak-calendar__row--head", role: "row" });
      for (let i = 0; i < 7; i++) {
        names.appendChild(el("span", { class: "ak-calendar__wd", role: "columnheader" }, WEEKDAYS[(weekStart + i) % 7]));
      }
      grid2.appendChild(names);
      const lead = (new Date(year, mon, 1).getDay() - weekStart + 7) % 7;
      const length = new Date(year, mon + 1, 0).getDate();
      const weeks = Math.ceil((lead + length) / 7);
      const cursor = new Date(year, mon, 1 - lead);
      const cells = [];
      for (let w = 0; w < weeks; w++) {
        const row = el("div", { class: "ak-calendar__row", role: "row" });
        for (let i = 0; i < 7; i++) {
          const day2 = isoDay(cursor);
          const events = byDay[day2] || [];
          const outside = cursor.getMonth() !== mon;
          const hover = events.map(function(e) {
            return String(e.title || "");
          }).filter(Boolean).join(" · ");
          const button = el("button", {
            type: "button",
            class: "ak-calendar__day" + (outside ? " ak-calendar__day--out" : "") + (day2 === today ? " ak-calendar__day--today" : ""),
            "aria-label": day2 + (events.length ? " · " + events.length : ""),
            "aria-current": day2 === today ? "date" : null,
            title: hover || null,
            on: s.onPick ? { click: function() {
              s.onPick(day2, events);
            } } : void 0
          }, [
            el("span", { class: "ak-calendar__num" }, String(cursor.getDate())),
            pips(events)
          ]);
          row.appendChild(el("div", { class: "ak-calendar__cell", role: "gridcell" }, button));
          cells.push(button);
          cursor.setDate(cursor.getDate() + 1);
        }
        grid2.appendChild(row);
      }
      travel3(cells);
    }
    function turn(step) {
      shown = new Date(shown.getFullYear(), shown.getMonth() + step, 1);
      paint();
      if (s.onMonth) s.onMonth(isoMonth(shown));
    }
    function render() {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      if (!data) {
        const e = s.empty || {};
        emptyCard = emptyState({
          target: root,
          tone: "quiet",
          title: e.title || s.title || t("empty"),
          hint: e.hint || t("emptyHint")
        });
        return;
      }
      if (s.title) root.appendChild(el("div", { class: "ak-calendar__name" }, String(s.title)));
      root.appendChild(head);
      root.appendChild(grid2);
      paint();
      enter(root);
    }
    render();
    return {
      el: root,
      set: function(patch) {
        if (!patch || !("data" in patch)) return;
        data = patch.data || null;
        shown = monthStart(data && data.month);
        render();
      },
      destroy: function() {
        if (emptyCard) {
          emptyCard.destroy();
          emptyCard = null;
        }
        root.remove();
      }
    };
  }
  var PERIODS = ["month", "year"];
  function currencyCode(value) {
    return /^[A-Z]{3}$/.test(String(value == null ? "" : value)) ? String(value) : null;
  }
  function money3(value, currency) {
    const whole = Math.round(Number(value) || 0);
    const code = currencyCode(currency);
    if (typeof Intl !== "undefined" && typeof Intl.NumberFormat === "function") {
      if (code) {
        return new Intl.NumberFormat(void 0, { style: "currency", currency: code, maximumFractionDigits: 0 }).format(whole);
      }
      return String(currency) + new Intl.NumberFormat(void 0, { maximumFractionDigits: 0 }).format(whole);
    }
    return String(currency) + whole;
  }
  function priceFor(plan2, period) {
    const base = Number(plan2.price) || 0;
    const own = plan2.period === "year" ? "year" : "month";
    if (period === "year") {
      if (typeof plan2.priceYearly === "number") return plan2.priceYearly;
      return own === "year" ? base : base * 12;
    }
    return own === "year" ? base / 12 : base;
  }
  function priceTable(spec) {
    const s = spec || {};
    const root = el("div", { class: "ak-root ak-price" });
    if (s.target) resolve(s.target).appendChild(root);
    let data = s.data === void 0 ? null : s.data;
    let period = "month";
    let currency = "€";
    let emptyCard = null;
    let figures = [];
    let periodButtons = [];
    function periodsOf(plans) {
      const declared = data && Array.isArray(data.periods) ? data.periods.filter(function(p) {
        return PERIODS.indexOf(p) >= 0;
      }) : [];
      if (declared.length) return declared;
      const yearly = plans.some(function(p) {
        return typeof p.priceYearly === "number";
      });
      return yearly ? ["month", "year"] : ["month"];
    }
    function roll() {
      const engine = !reducedMotion() && W4.anime && W4.anime.animate ? W4.anime : null;
      figures.forEach(function(f) {
        f.per.textContent = "/" + period;
        const to = Math.round(priceFor(f.plan, period));
        const from = f.shown;
        f.shown = to;
        if (!engine || from === to) {
          f.amount.textContent = money3(to, currency);
          return;
        }
        const box = { v: from };
        engine.animate(box, {
          v: to,
          duration: 520,
          ease: "outQuad",
          onUpdate: function() {
            f.amount.textContent = money3(box.v, currency);
          },
          onComplete: function() {
            f.amount.textContent = money3(to, currency);
          }
        });
      });
      warmAnime();
    }
    function pick(next) {
      if (next === period) return;
      period = next;
      periodButtons.forEach(function(b) {
        b.node.setAttribute("aria-pressed", b.id === next ? "true" : "false");
      });
      roll();
    }
    function segments(periods) {
      periodButtons = [];
      const bar = el("div", { class: "ak-price__periods", role: "group", "aria-label": "Billing period" });
      periods.forEach(function(p) {
        const node = el("button", {
          type: "button",
          class: "ak-price__period",
          "aria-pressed": p === period ? "true" : "false",
          on: { click: function() {
            pick(p);
          } }
        }, p === "year" ? "Year" : "Month");
        periodButtons.push({ id: p, node });
        bar.appendChild(node);
      });
      return bar;
    }
    function card(plan2) {
      const value = Math.round(priceFor(plan2, period));
      const amount2 = el("span", { class: "ak-price__amount" }, money3(value, currency));
      const per = el("span", { class: "ak-price__per" }, "/" + period);
      figures.push({ plan: plan2, amount: amount2, per, shown: value });
      const features = el("ul", { class: "ak-price__features" });
      (Array.isArray(plan2.features) ? plan2.features : []).forEach(function(f) {
        features.appendChild(el("li", { class: "ak-price__feature" }, [
          el("span", { class: "ak-price__check", "aria-hidden": "true" }, "✓"),
          el("span", {}, String(f))
        ]));
      });
      return el("article", {
        class: "ak-price__card" + (plan2.highlight ? " ak-price__card--lift" : "")
      }, [
        plan2.highlight ? el("span", { class: "ak-price__chip" }, "Most chosen") : null,
        el("h3", { class: "ak-price__name" }, String(plan2.name || plan2.id)),
        el("div", { class: "ak-price__figure" }, [amount2, per]),
        features,
        plan2.note ? el("p", { class: "ak-price__note" }, String(plan2.note)) : null,
        el("button", {
          type: "button",
          class: "ak-btn ak-btn--primary ak-price__cta",
          on: s.onPick ? { click: function() {
            s.onPick(plan2, period);
          } } : void 0
        }, String(plan2.cta || "Choose"))
      ].filter(Boolean));
    }
    function render() {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      figures = [];
      periodButtons = [];
      const plans = data && Array.isArray(data.plans) ? data.plans.filter(function(p) {
        return p && p.id;
      }) : [];
      if (!plans.length) {
        const e = s.empty || {};
        emptyCard = emptyState({
          target: root,
          tone: "quiet",
          title: e.title || s.title || t("empty"),
          hint: e.hint || t("emptyHint")
        });
        return;
      }
      currency = data && data.currency || "€";
      const periods = periodsOf(plans);
      if (periods.indexOf(period) < 0) period = periods[0];
      if (s.title) root.appendChild(el("div", { class: "ak-price__title" }, String(s.title)));
      if (periods.length > 1) {
        root.appendChild(segments(periods));
        warmAnime();
      }
      const cards = el("div", { class: "ak-price__cards" });
      plans.forEach(function(plan2) {
        cards.appendChild(card(plan2));
      });
      root.appendChild(cards);
      enter(root);
    }
    render();
    return {
      el: root,
      set: function(patch) {
        if (!patch || !("data" in patch)) return;
        data = patch.data || null;
        render();
      },
      destroy: function() {
        if (emptyCard) {
          emptyCard.destroy();
          emptyCard = null;
        }
        root.remove();
      }
    };
  }

  // src/static/sdk-libs/atelier/motion-parts.js
  function loaded() {
    return (
      /** @type {any} */
      window.Motion
    );
  }
  var motionPromise = null;
  function ensureMotion() {
    if (loaded() && loaded().animate) return Promise.resolve(loaded());
    if (motionPromise) return motionPromise;
    motionPromise = new Promise(function(ok, fail) {
      const s = document.createElement("script");
      s.src = NODE_URL + "/lib/motion@13.min.js";
      s.onload = function() {
        ok(loaded());
      };
      s.onerror = function() {
        motionPromise = null;
        fail(new Error("motion failed to load"));
      };
      document.head.appendChild(s);
    });
    return motionPromise;
  }
  function travel() {
    if (reducedMotion()) return null;
    const M = loaded();
    return M && typeof M.animate === "function" ? M : null;
  }
  var FEEL = { type: "spring", stiffness: 220, damping: 24 };
  var LIFT = 1.05;
  var PULL = 0.28;
  var FLICK = 420;
  var TONES8 = ["ok", "warn", "err"];
  function rowsOf4(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  }
  function safeImage(url) {
    if (!url) return null;
    const v = String(url);
    if (/^data:/i.test(v)) {
      console.warn("aimeat-atelier: card image data: URIs are refused — upload the image to storage and pass its URL.");
      return null;
    }
    return v;
  }
  function layerOf(url) {
    const v = safeImage(url);
    return v ? 'url("' + v.replace(/"/g, "%22") + '")' : null;
  }
  function washOf2(id) {
    let h = 0;
    const s = String(id);
    for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) | 0;
    return Math.abs(h) % 3 + 1;
  }
  function icon(kind) {
    const node = svg("svg", {
      class: "ak-icon",
      viewBox: "0 0 24 24",
      width: 20,
      height: 20,
      "aria-hidden": "true",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    });
    const d = kind === "prev" ? "M15 5 L8 12 L15 19" : kind === "next" ? "M9 5 L16 12 L9 19" : "M6 6 L18 18 M18 6 L6 18";
    node.appendChild(svg("path", { d }));
    return node;
  }
  function rectDelta(from, to) {
    if (!to.width || !to.height) return { x: 0, y: 0, scale: 1 };
    return {
      x: from.left + from.width / 2 - (to.left + to.width / 2),
      y: from.top + from.height / 2 - (to.top + to.height / 2),
      scale: Math.max(from.width / to.width, 0.05)
    };
  }
  function carousel(spec) {
    const s = spec || {};
    const titleId = uid("ak-carousel");
    const root = el("section", {
      class: "ak-root ak-carousel",
      role: "region",
      "aria-roledescription": "carousel",
      "aria-labelledby": s.title ? titleId : null,
      "aria-label": s.title ? null : "Media"
    });
    if (s.target) resolve(s.target).appendChild(root);
    if (s.title) root.appendChild(el("h3", { class: "ak-carousel__title", id: titleId }, String(s.title)));
    const track = el("div", { class: "ak-carousel__track" });
    const viewport = el("div", { class: "ak-carousel__viewport", tabindex: "0" }, [track]);
    const prev = navButton("prev", t("previous"), function() {
      step(-1);
    });
    const next = navButton("next", t("next"), function() {
      step(1);
    });
    const stage = el("div", { class: "ak-carousel__stage" }, [prev, viewport, next]);
    const dots = el("div", { class: "ak-carousel__dots" });
    root.appendChild(stage);
    root.appendChild(dots);
    let items = [];
    let cards = [];
    let dotEls = [];
    let index = 0;
    let flight = null;
    let driving = false;
    let settle3 = 0;
    let swiped = false;
    let emptyCard = null;
    let dead = false;
    function navButton(kind, label, run) {
      const b = (
        /** @type {HTMLButtonElement} */
        el("button", {
          type: "button",
          class: "ak-btn ak-btn--ghost ak-carousel__nav ak-carousel__nav--" + kind,
          "aria-label": label,
          "data-ak-noguard": true,
          on: { click: run }
        })
      );
      b.appendChild(icon(kind));
      return b;
    }
    function buildCard2(item, i, n) {
      const layer = layerOf(item.image);
      const art = el("span", {
        class: "ak-carousel__art ak-carousel__art--w" + washOf2(item.id) + (layer ? " ak-carousel__art--image" : ""),
        "aria-hidden": "true",
        vars: layer ? { "--ak-card-image": layer } : null
      }, layer ? null : el(
        "span",
        { class: "ak-carousel__monogram" },
        (Array.from(String(item.title || item.id || "?"))[0] || "?").toUpperCase()
      ));
      const caption = el("span", { class: "ak-carousel__caption" }, [
        el("span", { class: "ak-carousel__label" }, String(item.title || item.id || "")),
        item.sub != null ? el("span", { class: "ak-carousel__sub" }, String(item.sub)) : null
      ].filter(Boolean));
      const tone = TONES8.indexOf(item.tone) >= 0 ? " ak-carousel__card--" + item.tone : "";
      const card = (
        /** @type {HTMLElement} */
        el(s.onPick ? "button" : "div", {
          class: "ak-carousel__card" + tone,
          type: s.onPick ? "button" : null,
          role: "group",
          "aria-roledescription": "slide",
          "aria-label": i + 1 + " / " + n + (item.title ? ": " + item.title : ""),
          "data-ak-noguard": true,
          "data-ak-id": item.id,
          on: s.onPick ? { click: function() {
            if (!swiped) s.onPick(item);
          } } : null
        }, [art, caption])
      );
      return card;
    }
    function render(data) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      items = rowsOf4(data);
      clear(track);
      clear(dots);
      cards = [];
      dotEls = [];
      index = 0;
      if (!items.length) {
        stage.hidden = true;
        dots.hidden = true;
        const e = s.empty || {};
        emptyCard = emptyState({ target: root, tone: "quiet", title: e.title || t("empty"), hint: e.hint || t("emptyHint") });
        return;
      }
      stage.hidden = false;
      dots.hidden = items.length < 2;
      items.forEach(function(item, i) {
        const card = buildCard2(item, i, items.length);
        cards.push(card);
        track.appendChild(card);
        const dot = (
          /** @type {HTMLElement} */
          el("button", {
            type: "button",
            class: "ak-carousel__dot",
            "data-ak-noguard": true,
            "aria-label": String(i + 1) + " / " + items.length,
            on: { click: function() {
              goTo(i);
            } }
          })
        );
        dotEls.push(dot);
        dots.appendChild(dot);
      });
      mark();
    }
    function cardLeft(i) {
      const card = cards[i];
      if (!card) return 0;
      return card.offsetLeft - (viewport.clientWidth - card.offsetWidth) / 2;
    }
    function lift(card, on) {
      const to = on ? LIFT : 1;
      const M = travel();
      if (!M) {
        card.style.setProperty("--ak-lift", String(to));
        return;
      }
      M.animate(card, { scale: to }, FEEL);
    }
    function mark() {
      cards.forEach(function(card, i) {
        const on = i === index;
        card.classList.toggle("is-current", on);
        card.setAttribute("aria-current", on ? "true" : "false");
        lift(card, on);
      });
      dotEls.forEach(function(dot, i) {
        dot.classList.toggle("is-on", i === index);
        dot.setAttribute("aria-current", i === index ? "true" : "false");
      });
      prev.disabled = index <= 0;
      next.disabled = index >= items.length - 1;
    }
    function release(ms) {
      if (settle3) clearTimeout(settle3);
      settle3 = window.setTimeout(function() {
        settle3 = 0;
        driving = false;
        syncFromScroll();
      }, ms);
    }
    function travelTo(left, instant) {
      const span = Math.max(0, track.scrollWidth - viewport.clientWidth);
      const target = Math.max(0, Math.min(left, span));
      if (flight && typeof flight.stop === "function") flight.stop();
      flight = null;
      driving = true;
      release(900);
      const M = travel();
      if (instant || !M) {
        viewport.scrollTo({ left: target, behavior: instant || reducedMotion() ? "auto" : "smooth" });
        return;
      }
      flight = M.animate(viewport.scrollLeft, target, Object.assign({}, FEEL, {
        onUpdate: function(v) {
          viewport.scrollLeft = v;
        }
      }));
    }
    function goTo(i, instant) {
      if (!items.length) return;
      index = Math.max(0, Math.min(i, items.length - 1));
      mark();
      travelTo(cardLeft(index), instant);
    }
    function step(by) {
      goTo(index + by);
    }
    function syncFromScroll() {
      if (!cards.length) return;
      const mid = viewport.scrollLeft + viewport.clientWidth / 2;
      let best = 0;
      let bestGap = Infinity;
      for (let i = 0; i < cards.length; i++) {
        const gap = Math.abs(cards[i].offsetLeft + cards[i].offsetWidth / 2 - mid);
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      }
      if (best !== index) {
        index = best;
        mark();
      }
    }
    const onScroll = function() {
      release(120);
      if (!driving) syncFromScroll();
    };
    const onKey = function(ev) {
      const k = (
        /** @type {KeyboardEvent} */
        ev.key
      );
      if (k === "ArrowLeft") {
        ev.preventDefault();
        step(-1);
      } else if (k === "ArrowRight") {
        ev.preventDefault();
        step(1);
      } else if (k === "Home") {
        ev.preventDefault();
        goTo(0);
      } else if (k === "End") {
        ev.preventDefault();
        goTo(items.length - 1);
      }
    };
    const onDown = function() {
      swiped = false;
    };
    const onClick = function(ev) {
      if (!swiped) return;
      swiped = false;
      ev.preventDefault();
      ev.stopPropagation();
    };
    let resizing = 0;
    const onResize = function() {
      if (resizing) return;
      resizing = requestAnimationFrame(function() {
        resizing = 0;
        goTo(index, true);
      });
    };
    const swipe = drag(track, {
      onEnd: function(dx, _dy, velocity) {
        if (Math.abs(dx) < 6) return;
        swiped = true;
        const width = cards[index] ? cards[index].offsetWidth : viewport.clientWidth;
        const far = Math.abs(dx) > width * PULL || Math.abs(velocity.x) > FLICK;
        if (far) step(dx < 0 ? 1 : -1);
        else goTo(index);
      }
    }, { axis: "x", back: true, stiffness: 260, damping: 24 });
    viewport.addEventListener("scroll", onScroll, { passive: true });
    root.addEventListener("keydown", onKey);
    track.addEventListener("pointerdown", onDown);
    track.addEventListener("click", onClick, true);
    window.addEventListener("resize", onResize);
    render(s.data);
    ensureMotion().then(function() {
      if (!dead) mark();
    }, function() {
      root.classList.add("ak-carousel--floor");
    });
    return {
      el: root,
      set: function(patch) {
        if (patch && "data" in patch) render(patch.data);
      },
      destroy: function() {
        dead = true;
        if (flight && typeof flight.stop === "function") flight.stop();
        if (settle3) clearTimeout(settle3);
        if (resizing) cancelAnimationFrame(resizing);
        swipe.destroy();
        viewport.removeEventListener("scroll", onScroll);
        root.removeEventListener("keydown", onKey);
        track.removeEventListener("pointerdown", onDown);
        track.removeEventListener("click", onClick, true);
        window.removeEventListener("resize", onResize);
        if (emptyCard) emptyCard.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function lightbox(spec) {
    const s = spec || /** @type {any} */
    {};
    const items = (Array.isArray(s.items) ? s.items : []).filter(function(it) {
      return it && safeImage(it.image);
    });
    let index = Math.max(0, Math.min(s.index || 0, Math.max(items.length - 1, 0)));
    const node = (
      /** @type {HTMLDialogElement} */
      el("dialog", {
        class: "ak-root ak-lightbox",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "Picture"
      })
    );
    const image = (
      /** @type {HTMLImageElement} */
      el("img", { class: "ak-lightbox__image", alt: "" })
    );
    const label = el("span", { class: "ak-lightbox__label" });
    const sub = el("span", { class: "ak-lightbox__sub" });
    const count = el("span", { class: "ak-lightbox__count" });
    const figure2 = el("figure", { class: "ak-lightbox__figure" }, [
      image,
      el("figcaption", { class: "ak-lightbox__caption" }, [label, sub, count])
    ]);
    const shut = navButton("close", t("close"), function() {
      close();
    });
    const prev = navButton("prev", t("previous"), function() {
      step(-1);
    });
    const next = navButton("next", t("next"), function() {
      step(1);
    });
    const panel = el("div", { class: "ak-lightbox__panel" }, [shut, prev, figure2, next]);
    node.appendChild(panel);
    let closed = false;
    let entered = false;
    function navButton(kind, aria, run) {
      const b = (
        /** @type {HTMLButtonElement} */
        el("button", {
          type: "button",
          class: "ak-btn ak-lightbox__" + (kind === "close" ? "x" : "nav ak-lightbox__nav--" + kind),
          "aria-label": aria,
          "data-ak-noguard": true,
          on: { click: run }
        })
      );
      b.appendChild(icon(kind));
      return b;
    }
    function show(reportChange) {
      const item = items[index];
      if (!item) return;
      image.src = /** @type {string} */
      safeImage(item.image);
      image.alt = String(item.title || "");
      label.textContent = String(item.title || "");
      label.hidden = !item.title;
      sub.textContent = String(item.sub || "");
      sub.hidden = !item.sub;
      count.textContent = index + 1 + " / " + items.length;
      count.hidden = items.length < 2;
      prev.disabled = index <= 0;
      next.disabled = index >= items.length - 1;
      if (reportChange && s.onChange) s.onChange(index);
    }
    function goTo(i) {
      if (!items.length) return;
      const to = Math.max(0, Math.min(i, items.length - 1));
      if (to === index) return;
      const forward = to > index;
      index = to;
      show(true);
      const M = travel();
      if (M) M.animate(image, { x: [forward ? 24 : -24, 0], opacity: [0, 1] }, FEEL);
    }
    function step(by) {
      goTo(index + by);
    }
    function flip(box, out) {
      const M = travel();
      if (!M || !box || !box.isConnected) return null;
      const d = rectDelta(box.getBoundingClientRect(), image.getBoundingClientRect());
      const frames = out ? { x: [0, d.x], y: [0, d.y], scale: [1, d.scale], opacity: [1, 0] } : { x: [d.x, 0], y: [d.y, 0], scale: [d.scale, 1], opacity: [0.4, 1] };
      return M.animate(image, frames, FEEL);
    }
    function open() {
      if (entered || !image.getBoundingClientRect().width) return;
      entered = true;
      flip(s.from, false);
    }
    function close() {
      if (closed) return;
      closed = true;
      const done = function() {
        document.body.classList.remove("ak-lightbox-open");
        if (node.open) node.close();
        if (node.parentNode) node.parentNode.removeChild(node);
        if (s.onClose) s.onClose();
      };
      const out = flip(s.from, true);
      if (!out || !out.finished) return done();
      out.finished.then(done, done);
    }
    const onKey = function(ev) {
      const k = (
        /** @type {KeyboardEvent} */
        ev.key
      );
      if (k === "ArrowLeft") {
        ev.preventDefault();
        step(-1);
      } else if (k === "ArrowRight") {
        ev.preventDefault();
        step(1);
      }
    };
    const onCancel = function(ev) {
      ev.preventDefault();
      close();
    };
    const onBackdrop = function(ev) {
      if (ev.target === node) close();
    };
    const swipe = drag(figure2, {
      onEnd: function(dx, _dy, velocity) {
        const far = Math.abs(dx) > figure2.clientWidth * PULL || Math.abs(velocity.x) > FLICK;
        if (far) step(dx < 0 ? 1 : -1);
      }
    }, { axis: "x", back: true, stiffness: 260, damping: 24 });
    node.addEventListener("keydown", onKey);
    node.addEventListener("cancel", onCancel);
    node.addEventListener("click", onBackdrop);
    document.body.appendChild(node);
    document.body.classList.add("ak-lightbox-open");
    if (!items.length) {
      clear(panel);
      panel.appendChild(shut);
      emptyState({ target: panel, tone: "quiet", title: t("empty"), hint: t("emptyHint") });
    } else {
      show(false);
    }
    node.showModal();
    shut.focus();
    if (items.length) {
      if (image.complete && image.naturalWidth) open();
      else image.addEventListener("load", open, { once: true });
      ensureMotion().then(open, function() {
        node.classList.add("ak-lightbox--floor");
      });
    }
    return {
      el: node,
      close,
      destroy: function() {
        swipe.destroy();
        node.removeEventListener("keydown", onKey);
        node.removeEventListener("cancel", onCancel);
        node.removeEventListener("click", onBackdrop);
        close();
      }
    };
  }

  // src/static/sdk-libs/atelier/atlas.js
  var SVG_NS7 = "http://www.w3.org/2000/svg";
  function svg5(name, attrs) {
    const node = document.createElementNS(SVG_NS7, name);
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
    return node;
  }
  var TONES9 = ["ok", "warn", "err"];
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
    ensureGeometry().then(function(loaded3) {
      if (destroyed) return;
      wait.destroy();
      geo = loaded3;
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
        const tone = TONES9.indexOf(m.row.tone) >= 0 ? m.row.tone : null;
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
        const tone = TONES9.indexOf(m.tone) >= 0 ? m.tone : null;
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
  var TONES10 = ["ok", "warn", "err"];
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
      const cls = TONES10.indexOf(tone) >= 0 ? " ak-map__pin--" + tone : "";
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
        const pin2 = L.marker([m.lat, m.lon], { icon: pinIcon(L, m.tone) });
        if (m.label) pin2.bindPopup(String(m.label));
        if (spec.onPick) pin2.on("click", function() {
          spec.onPick(m);
        });
        pin2.addTo(world.layer);
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
    let ambientFromLayout = false;
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
          const handle2 = create(data == null ? [] : data);
          alive.handles.push(handle2);
          alive.bound.push({ name: p.source, kind, handle: handle2 });
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
        // ── The data-shaped four of the nine new parts: ring, crew and poll bind their record
        //    whole, keys its rows. The behaviour-shaped rest (toast, palette, compare, tour) are
        //    component-only, like the dialog family.
        case "ring":
          return bound("ring", function(data) {
            return ring({ target: into, data: patchFor("ring", data).data, title: p.title, empty });
          });
        case "crew":
          return bound("crew", function(data) {
            return crew({ target: into, data: patchFor("crew", data).data, title: p.title, empty });
          });
        case "poll":
          return bound("poll", function(data) {
            return poll({ target: into, data: patchFor("poll", data).data, empty, onPick: pick });
          });
        case "keys":
          return bound("keys", function(data) {
            return keys({ target: into, data: patchFor("keys", data).items });
          });
        case "thread":
          return bound("thread", function(data) {
            return thread({
              target: into,
              data: patchFor("thread", data).data,
              title: p.title,
              placeholder: p.placeholder,
              empty,
              onSend: spec.onSend ? function(text) {
                spec.onSend(block.id, text);
              } : void 0
            });
          });
        case "calendar":
          return bound("calendar", function(data) {
            return calendar({
              target: into,
              data: patchFor("calendar", data).data,
              title: p.title,
              weekStart: p.weekStart,
              empty,
              onPick: spec.onPick ? function(day2, events) {
                spec.onPick(block.id, { day: day2, events });
              } : void 0,
              onMonth: spec.onPick ? function(month) {
                spec.onPick(block.id, { month });
              } : void 0
            });
          });
        case "sortable":
          return bound("sortable", function(data) {
            return sortable({
              target: into,
              data: patchFor("sortable", data).items,
              title: p.title,
              empty,
              onReorder: spec.onReorder ? function(ids) {
                spec.onReorder(block.id, ids);
              } : void 0
            });
          });
        case "notices":
          return bound("notices", function(data) {
            return notices({
              target: into,
              data: patchFor("notices", data).items,
              title: p.title,
              empty,
              onOpen: pick,
              onRead: spec.onRead ? function(ids) {
                spec.onRead(block.id, ids);
              } : void 0
            });
          });
        case "facets":
          return bound("facets", function(data) {
            return facets({
              target: into,
              data: patchFor("facets", data).data,
              title: p.title,
              empty,
              onChange: spec.onFilter ? function(selection) {
                spec.onFilter(block.id, selection);
              } : void 0
            });
          });
        case "carousel":
          return bound("carousel", function(data) {
            return carousel({ target: into, data: patchFor("carousel", data).items, title: p.title, empty, onPick: pick });
          });
        case "priceTable":
          return bound("priceTable", function(data) {
            return priceTable({
              target: into,
              data: patchFor("priceTable", data).data,
              title: p.title,
              empty,
              onPick: spec.onPick ? function(plan2, period) {
                spec.onPick(block.id, { plan: plan2, period });
              } : void 0
            });
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
      const out = { v: layout.v, look: layout.look, nav: o.nav || layout.nav, tokens: layout.tokens, ambient: layout.ambient, meta: layout.meta, blocks: layout.blocks.slice() };
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
      const wish = layout.ambient && typeof layout.ambient === "object" && layout.ambient.preset ? layout.ambient : null;
      if (spec.app && spec.app.set) {
        if (wish) {
          spec.app.set({ ambient: wish });
          ambientFromLayout = true;
        } else if (ambientFromLayout) {
          spec.app.set({ ambient: null });
          ambientFromLayout = false;
        }
      } else if (wish) {
        alive.handles.push(ambient({ target: root, preset: wish.preset, alpha: wish.alpha, speed: wish.speed }));
      }
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
  var TONES11 = ["plain", "danger", "celebrate", "ai"];
  var SIZES = ["compact", "roomy", "wide"];
  function dialog(spec) {
    const from = spec.from === "bottom" ? "bottom" : "center";
    const tone = TONES11.indexOf(spec.tone || "") >= 0 ? spec.tone : "plain";
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
      const handle2 = dialog({
        title: spec.title,
        text: spec.text,
        from: "center",
        tone: spec.tone === "danger" ? "danger" : "plain",
        actions: [
          { id: "cancel", label: spec.cancelLabel || t("cancel"), tone: "ghost", run: function() {
            handle2.close("cancel");
          } },
          {
            id: "confirm",
            label: spec.confirmLabel || t("confirm"),
            tone: spec.tone === "danger" ? "danger" : "primary",
            run: function() {
              answer = true;
              handle2.close("confirm");
            }
          }
        ],
        onClose: function() {
          resolve2(answer);
        }
      });
      const go = handle2.el.querySelector('[data-ak-action="confirm"]');
      if (go) go.focus();
    });
  }
  function prompt(spec) {
    return new Promise(function(resolve2) {
      let answer = null;
      let field = null;
      const handle2 = dialog({
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
            handle2.close("cancel");
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
        handle2.close("submit");
      }
      if (field) field.focus();
    });
  }
  function sheet(spec) {
    return dialog({ ...spec, from: "bottom" });
  }

  // src/static/sdk-libs/atelier/parts-ui.js
  var toastHost = null;
  function toast(spec) {
    if (!toastHost || !toastHost.isConnected) {
      toastHost = el("div", { class: "ak-root ak-toasts", role: "status", "aria-live": "polite" });
      document.body.appendChild(toastHost);
    }
    let timer = null;
    const node = el("div", { class: "ak-toast" + (spec.tone ? " ak-toast--" + spec.tone : "") }, [
      el("div", { class: "ak-toast__body" }, [
        el("div", { class: "ak-toast__title" }, spec.title),
        spec.sub ? el("div", { class: "ak-toast__sub" }, spec.sub) : null
      ].filter(Boolean)),
      spec.action ? el("button", { type: "button", class: "ak-btn ak-btn--ghost", on: {
        click: function() {
          spec.action.onPick();
          close();
        }
      } }, spec.action.label) : null
    ].filter(Boolean));
    function close() {
      if (timer) clearTimeout(timer);
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    toastHost.appendChild(node);
    enter(node);
    const ttl = spec.ttl == null ? 6e3 : spec.ttl;
    if (ttl > 0) timer = setTimeout(close, ttl);
    return { el: node, close };
  }
  function palette(spec) {
    const s = spec || { items: [] };
    let root = null;
    let cursor = 0;
    let shown = [];
    function close() {
      if (root && root.parentNode) root.parentNode.removeChild(root);
      root = null;
    }
    function paintList(list2) {
      clear(list2);
      if (!shown.length) {
        list2.appendChild(el("li", { class: "ak-palette__empty" }, s.empty || "Nothing matches."));
        return;
      }
      shown.forEach(function(it, i) {
        list2.appendChild(el("li", { class: "ak-palette__item", role: "option", "aria-selected": i === cursor ? "true" : "false", on: {
          click: function() {
            close();
            it.run();
          },
          mousemove: function() {
            if (cursor !== i) {
              cursor = i;
              paintList(list2);
            }
          }
        } }, [el("span", {}, it.label), it.hint ? el("span", { class: "ak-palette__hint" }, it.hint) : null].filter(Boolean)));
      });
    }
    function open() {
      if (root) return;
      cursor = 0;
      shown = s.items.slice();
      const list2 = el("ul", { class: "ak-palette__list", role: "listbox" });
      const input = el("input", { class: "ak-palette__input", type: "text", placeholder: s.placeholder || "go to, run, adopt…", autocomplete: "off", on: {
        input: function() {
          const q = (
            /** @type {HTMLInputElement} */
            input.value.trim().toLowerCase()
          );
          shown = s.items.filter(function(it) {
            return !q || (it.label + " " + (it.hint || "")).toLowerCase().indexOf(q) >= 0;
          });
          cursor = 0;
          paintList(list2);
        },
        keydown: function(e) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            cursor = Math.min(cursor + 1, shown.length - 1);
            paintList(list2);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            cursor = Math.max(cursor - 1, 0);
            paintList(list2);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const it = shown[cursor];
            if (it) {
              close();
              it.run();
            }
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }
      } });
      root = el("div", { class: "ak-root ak-palette", on: { click: function(e) {
        if (e.target === root) close();
      } } }, [
        el("div", { class: "ak-palette__box", role: "dialog", "aria-modal": "true", "aria-label": s.placeholder || "Commands" }, [input, list2])
      ]);
      paintList(list2);
      document.body.appendChild(root);
      input.focus();
    }
    const key = s.hotkey === void 0 ? "k" : s.hotkey;
    const onKey = function(e) {
      if (!key) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === key) {
        e.preventDefault();
        if (root) close();
        else open();
      }
    };
    window.addEventListener("keydown", onKey);
    return { open, close, destroy() {
      close();
      window.removeEventListener("keydown", onKey);
    } };
  }
  function compare(spec) {
    const s = spec || { before: {}, after: {} };
    function layer(side, cls) {
      const body = side.el ? side.el : side.image ? el("img", { src: side.image, alt: side.label || "" }) : el("span", {}, side.label || "");
      return el("div", { class: "ak-compare__layer " + cls }, [body]);
    }
    const handle2 = el("button", { type: "button", class: "ak-compare__handle", "aria-label": "Compare", role: "slider", "aria-valuemin": "0", "aria-valuemax": "100" }, "⇄");
    const root = el("div", { class: "ak-root ak-compare" }, [
      layer(s.before || {}, "ak-compare__before"),
      layer(s.after || {}, "ak-compare__after"),
      s.before && s.before.label ? el("span", { class: "ak-compare__label ak-compare__label--before" }, s.before.label) : null,
      s.after && s.after.label ? el("span", { class: "ak-compare__label ak-compare__label--after" }, s.after.label) : null,
      el("div", { class: "ak-compare__bar" }),
      handle2
    ].filter(Boolean));
    if (s.target) resolve(s.target).appendChild(root);
    let pct = typeof s.value === "number" ? s.value : 50;
    function set(v) {
      pct = Math.max(0, Math.min(Number(v) || 0, 100));
      root.style.setProperty("--ak-compare", pct + "%");
      handle2.setAttribute("aria-valuenow", String(Math.round(pct)));
      if (s.onChange) s.onChange(pct);
    }
    let dragging = false;
    function at(e) {
      const r = root.getBoundingClientRect();
      set((e.clientX - r.left) / Math.max(r.width, 1) * 100);
    }
    root.addEventListener("pointerdown", function(e) {
      dragging = true;
      root.setPointerCapture(e.pointerId);
      at(e);
    });
    root.addEventListener("pointermove", function(e) {
      if (dragging) at(e);
    });
    root.addEventListener("pointerup", function() {
      dragging = false;
    });
    root.addEventListener("pointercancel", function() {
      dragging = false;
    });
    handle2.addEventListener("keydown", function(e) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        set(pct - 5);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        set(pct + 5);
      }
    });
    set(pct);
    return { el: root, set, destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    } };
  }
  function tour(spec) {
    const s = spec || { steps: [] };
    const L = Object.assign({ next: "Next", done: "Done", skip: "Skip" }, s.labels || {});
    let i = -1;
    let note = null;
    let marked = null;
    function place2() {
      if (!note || !marked) return;
      const r = marked.getBoundingClientRect();
      const w = note.offsetWidth || 260;
      const top = r.bottom + 12;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      note.style.top = (top + (note.offsetHeight || 0) > window.innerHeight ? Math.max(8, r.top - (note.offsetHeight || 0) - 12) : top) + "px";
      note.style.left = left + "px";
    }
    function show(n) {
      clearStep();
      const step = s.steps[n];
      if (!step) {
        end();
        return;
      }
      i = n;
      const target = typeof step.target === "string" ? document.querySelector(step.target) : step.target;
      if (!target) {
        show(n + 1);
        return;
      }
      marked = /** @type {HTMLElement} */
      target;
      marked.classList.add("ak-tour__mark");
      if (!reducedMotion()) marked.scrollIntoView({ block: "center", behavior: "smooth" });
      const last = n === s.steps.length - 1;
      note = el("div", { class: "ak-root ak-tour__note", role: "dialog", "aria-live": "polite" }, [
        el("div", {}, [el("span", { class: "ak-tour__step" }, n + 1 + "/" + s.steps.length), el("span", {}, step.text)]),
        el("div", { class: "ak-tour__nav" }, [
          el("button", { type: "button", class: "ak-btn ak-btn--ghost", on: { click: function() {
            if (last) end();
            else show(n + 1);
          } } }, last ? L.done : L.next),
          last ? null : el("button", { type: "button", class: "ak-btn ak-btn--ghost", on: { click: end } }, L.skip)
        ].filter(Boolean))
      ]);
      document.body.appendChild(note);
      place2();
    }
    function clearStep() {
      if (marked) marked.classList.remove("ak-tour__mark");
      if (note && note.parentNode) note.parentNode.removeChild(note);
      marked = null;
      note = null;
    }
    function onKey(e) {
      if (e.key === "Escape") end();
    }
    function end() {
      clearStep();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place2);
      if (i >= 0 && s.onDone) s.onDone();
      i = -1;
    }
    function start() {
      window.addEventListener("keydown", onKey);
      window.addEventListener("resize", place2);
      show(0);
    }
    return { start, end };
  }

  // src/static/sdk-libs/atelier/lenis-director.js
  var lenisPromise2 = null;
  function ensureLenis2() {
    const w = (
      /** @type {any} */
      window
    );
    if (w.Lenis) return Promise.resolve(w.Lenis);
    if (lenisPromise2) return lenisPromise2;
    lenisPromise2 = new Promise(function(ok, fail) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = NODE_URL + "/lib/lenis@1.css";
      document.head.appendChild(css);
      const s = document.createElement("script");
      s.src = NODE_URL + "/lib/lenis@1.min.js";
      s.onload = function() {
        ok(w.Lenis);
      };
      s.onerror = function() {
        lenisPromise2 = null;
        fail(new Error("lenis failed to load"));
      };
      document.head.appendChild(s);
    });
    return lenisPromise2;
  }
  var JUMP = 0.9;
  var LERP = 0.09;
  var SNAP_DELAY = 120;
  var SNAP_TOLERANCE = 0.1;
  var SNAP_REST = 0.05;
  var SNAP_TRIES = 3;
  function pin(node, holds) {
    const outer = el("div", { class: "ak-act__hold", vars: { "--ak-hold": String(1 + holds) } });
    const stick = el("div", { class: "ak-act__stick" });
    const parent = node.parentNode;
    if (parent) parent.insertBefore(outer, node);
    stick.appendChild(node);
    outer.appendChild(stick);
    return outer;
  }
  function unpin(sc) {
    const outer = sc.outer;
    if (!outer || !outer.parentNode) return;
    outer.parentNode.insertBefore(sc.el, outer);
    outer.parentNode.removeChild(outer);
  }
  function chapterise(node) {
    const panels = (
      /** @type {HTMLElement[]} */
      Array.prototype.slice.call(node.children)
    );
    if (!panels.length) return null;
    const track = el("div", { class: "ak-chapter__track" });
    const box = el("div", { class: "ak-chapter" }, [track]);
    panels.forEach(function(p) {
      p.classList.add("ak-chapter__panel");
      track.appendChild(p);
    });
    node.appendChild(box);
    node.classList.add("ak-act--x");
    return { box, track, panels };
  }
  function unchapterise(sc) {
    const ch = sc.chapter;
    if (!ch) return;
    ch.panels.forEach(function(p) {
      p.classList.remove("ak-chapter__panel");
      sc.el.appendChild(p);
    });
    if (ch.box.parentNode) ch.box.parentNode.removeChild(ch.box);
    sc.el.classList.remove("ak-act--x");
  }
  function playEnter(node, kind) {
    if (typeof kind === "function") {
      kind(node);
      return;
    }
    if (kind === "stagger") {
      stagger(node.children, { from: "up" });
      return;
    }
    if (reducedMotion() || typeof node.animate !== "function") return;
    const cs = getComputedStyle(node);
    const dist = (parseFloat(cs.getPropertyValue("--ak-enter-distance")) || 14) * 2.5;
    const span = (parseFloat(cs.getPropertyValue("--ak-motion")) || 200) * 3;
    const ease = (cs.getPropertyValue("--ak-ease") || "").trim() || "cubic-bezier(0.2, 0.7, 0.3, 1)";
    const frames = kind === "fade" ? [{ opacity: 0 }, { opacity: 1 }] : kind === "wipe" ? [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }] : kind === "scale" ? [{ opacity: 0, transform: "scale(0.94)" }, { opacity: 1, transform: "scale(1)" }] : [{ opacity: 0, transform: "translateY(" + dist + "px)" }, { opacity: 1, transform: "translateY(0)" }];
    node.animate(frames, { duration: span, easing: ease, fill: "backwards" });
  }
  function railOf(items, onPick, inset) {
    const dots = items.map(function(it, i) {
      return el("button", {
        type: "button",
        class: "ak-rail__dot",
        "aria-label": it.label,
        on: { click: function() {
          onPick(it.id, i);
        } }
      }, [
        el("span", { class: "ak-rail__label", "aria-hidden": "true" }, it.label),
        el("span", { class: "ak-rail__mark", "aria-hidden": "true" })
      ]);
    });
    const nav = el("nav", {
      class: "ak-rail" + (inset ? " ak-rail--inset" : ""),
      "aria-label": "Story"
    }, dots);
    return {
      nav,
      dots,
      mark(index) {
        dots.forEach(function(d, n) {
          if (n === index) d.setAttribute("aria-current", "true");
          else d.removeAttribute("aria-current");
          d.classList.toggle("is-current", n === index);
        });
      }
    };
  }
  function editing() {
    const a = (
      /** @type {any} */
      document.activeElement
    );
    if (!a) return false;
    const tag = String(a.tagName || "");
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || a.isContentEditable === true;
  }
  function clamp01(n) {
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }
  function now() {
    return typeof performance === "object" && performance && typeof performance.now === "function" ? performance.now() : Date.now();
  }
  function director(spec) {
    const s = spec || /** @type {any} */
    {};
    const scroller = (
      /** @type {any} */
      s.scroller || window
    );
    const isPage = scroller === window;
    const scenes = [];
    (s.scenes || []).forEach(function(raw) {
      if (!raw) return;
      const node = (
        /** @type {HTMLElement|null} */
        typeof raw.el === "string" ? document.querySelector(raw.el) : raw.el || null
      );
      if (!node) {
        console.warn('aimeat-atelier: story scene "' + raw.id + '" has no element on the page, skipped');
        return;
      }
      node.classList.add("ak-act");
      node.setAttribute("data-ak-act", String(raw.id));
      const chapter = raw.axis === "x" ? chapterise(node) : null;
      const holds = Math.max(
        Math.max(0, Number(raw.hold) || 0),
        chapter ? chapter.panels.length : 0
      );
      scenes.push({
        id: String(raw.id),
        el: node,
        outer: holds > 0 ? pin(node, holds) : null,
        hold: holds,
        label: String(raw.label || raw.id),
        spec: raw,
        entered: false,
        inside: false,
        chapter
      });
    });
    function sizeHolds() {
      if (isPage) return;
      const h = scroller.clientHeight;
      scenes.forEach(function(sc) {
        if (sc.outer) sc.outer.style.setProperty("--ak-story-vh", h + "px");
      });
    }
    sizeHolds();
    let lenis = null;
    let dead = false;
    if (!reducedMotion()) {
      ensureLenis2().then(function(Lenis) {
        if (dead) return;
        const opts = (
          /** @type {any} */
          { autoRaf: true }
        );
        if (s.duration !== void 0) opts.duration = s.duration;
        else opts.lerp = s.lerp !== void 0 ? s.lerp : LERP;
        if (!isPage) {
          opts.wrapper = scroller;
          opts.content = scroller.firstElementChild || scroller;
        }
        lenis = new Lenis(opts);
        if (isPage) window.__akLenis = lenis;
      }, function(err) {
        console.warn("aimeat-atelier: lenis did not load, the browser scrolls this story", err);
      });
    }
    const rail = s.rail === false || !scenes.length ? null : railOf(scenes, function(id) {
      go(id);
    }, !isPage);
    let host = null;
    let hostMarked = false;
    if (rail) {
      if (isPage) {
        document.body.appendChild(rail.nav);
      } else {
        host = scroller.parentElement || document.body;
        if (!host.classList.contains("ak-story")) {
          host.classList.add("ak-story");
          hostMarked = true;
        }
        host.appendChild(rail.nav);
      }
    }
    let curIdx = -1;
    let storyP = 0;
    function progressOf(sc, r, vTop, vH) {
      if (sc.hold > 0) return clamp01((vTop - r.top) / Math.max(1, r.height - vH));
      return clamp01((vTop + vH - r.top) / Math.max(1, vH + r.height));
    }
    function tick() {
      if (!scenes.length) return;
      const vH = isPage ? window.innerHeight : scroller.clientHeight;
      const vTop = isPage ? 0 : scroller.getBoundingClientRect().top;
      const mid = vTop + vH / 2;
      let best = -1;
      let bestGap = Infinity;
      let first = null;
      let last = null;
      scenes.forEach(function(sc, i) {
        const r = (sc.outer || sc.el).getBoundingClientRect();
        if (i === 0) first = r;
        last = r;
        const p = progressOf(sc, r, vTop, vH);
        if (sc.chapter) {
          const across = Math.max(0, sc.chapter.panels.length - 1);
          sc.chapter.track.style.setProperty("--ak-chapter-x", -across * 100 * p + "%");
        }
        if (sc.spec.onProgress) sc.spec.onProgress(p, sc.el);
        const gap = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      });
      if (first && last) {
        const span = last.bottom - first.top - vH;
        storyP = span > 0 ? clamp01((vTop - first.top) / span) : 1;
      }
      if (best !== curIdx) {
        curIdx = best;
        if (rail) rail.mark(best);
        if (s.onScene && scenes[best]) s.onScene(scenes[best].id);
      }
    }
    let rafId = 0;
    const onScroll = function() {
      settleTries = 0;
      armSnap();
      if (rafId) return;
      rafId = requestAnimationFrame(function() {
        rafId = 0;
        tick();
      });
    };
    const onResize = function() {
      sizeHolds();
      onScroll();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    let io = null;
    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          const sc = scenes.find(function(c) {
            return c.el === entry.target;
          });
          if (!sc) return;
          if (entry.isIntersecting) {
            if (!sc.entered) {
              sc.entered = true;
              playEnter(sc.el, sc.spec.enter || "rise");
            }
            if (!sc.inside) {
              sc.inside = true;
              if (sc.spec.onEnter) sc.spec.onEnter(sc.el);
            }
          } else if (sc.inside) {
            sc.inside = false;
            if (sc.spec.onLeave) sc.spec.onLeave(sc.el);
          }
        });
      }, { root: isPage ? null : scroller, threshold: 0.25 });
      scenes.forEach(function(sc) {
        io.observe(sc.el);
      });
    } else {
      scenes.forEach(function(sc) {
        sc.entered = true;
        if (sc.spec.onEnter) sc.spec.onEnter(sc.el);
      });
    }
    function go(id, opts) {
      const i = scenes.findIndex(function(sc) {
        return sc.id === id;
      });
      if (i < 0) return;
      const target = scenes[i].outer || scenes[i].el;
      const o = opts || {};
      jumpUntil = now() + (o.duration || JUMP) * 1e3;
      if (lenis) {
        lenis.scrollTo(target, { offset: o.offset || 0, duration: o.duration || JUMP });
      } else {
        target.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
      }
      curIdx = i;
      if (rail) rail.mark(i);
      if (s.onScene) s.onScene(scenes[i].id);
    }
    function step(by) {
      if (!scenes.length) return;
      const from = curIdx < 0 ? 0 : curIdx;
      const to = Math.max(0, Math.min(scenes.length - 1, from + by));
      if (to !== from || curIdx < 0) go(scenes[to].id);
    }
    function goPanel(sc, index) {
      const outer = sc.outer;
      const ch = sc.chapter;
      if (!outer || !ch) return;
      const vH = isPage ? window.innerHeight : scroller.clientHeight;
      const across = Math.max(1, ch.panels.length - 1);
      const travel3 = Math.max(0, outer.offsetHeight - vH);
      const want = Math.min(Math.max(index, 0), across) / across * travel3;
      jumpUntil = now() + JUMP * 1e3;
      if (lenis) {
        lenis.scrollTo(outer, { offset: want, duration: JUMP });
        return;
      }
      const vTop = isPage ? 0 : scroller.getBoundingClientRect().top;
      const how = (
        /** @type {ScrollToOptions} */
        {
          top: outer.getBoundingClientRect().top - vTop + want,
          behavior: reducedMotion() ? "auto" : "smooth"
        }
      );
      if (isPage) window.scrollBy(how);
      else scroller.scrollBy(how);
    }
    const chapterDoors = [];
    scenes.forEach(function(sc) {
      if (!sc.chapter || !sc.outer) return;
      const ch = sc.chapter;
      const fn = function(ev) {
        const t2 = (
          /** @type {Element|null} */
          /** @type {any} */
          ev.target
        );
        if (!t2) return;
        let i = -1;
        ch.panels.forEach(function(p, n) {
          if (p === t2 || p.contains(t2)) i = n;
        });
        if (i < 0) return;
        ch.box.scrollLeft = 0;
        goPanel(sc, i);
      };
      ch.box.addEventListener("focusin", fn);
      chapterDoors.push({ box: ch.box, fn });
    });
    const snapCfg = s.snap && typeof s.snap === "object" ? s.snap : {};
    const snapOn = !!s.snap;
    const snapDelay = snapCfg.delay !== void 0 ? Number(snapCfg.delay) : SNAP_DELAY;
    const snapTol = snapCfg.tolerance !== void 0 ? clamp01(Number(snapCfg.tolerance)) : SNAP_TOLERANCE;
    let settleTimer = 0;
    let settleTries = 0;
    let jumpUntil = 0;
    function armSnap() {
      if (!snapOn || !scenes.length) return;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(settle3, snapDelay);
    }
    function settle3() {
      settleTimer = 0;
      if (dead || !snapOn || !scenes.length) return;
      if (now() < jumpUntil) return;
      if (lenis && Math.abs(Number(lenis.velocity) || 0) > SNAP_REST) {
        settleTries += 1;
        if (settleTries <= SNAP_TRIES) armSnap();
        return;
      }
      const vH = isPage ? window.innerHeight : scroller.clientHeight;
      const vTop = isPage ? 0 : scroller.getBoundingClientRect().top;
      let held = false;
      scenes.forEach(function(sc) {
        if (held || !sc.outer) return;
        const r = sc.outer.getBoundingClientRect();
        const top = r.top - vTop;
        const room2 = r.bottom - vTop - vH;
        if (top < -1 && room2 > 1) held = true;
      });
      if (held) return;
      let near = -1;
      let gap = Infinity;
      scenes.forEach(function(sc, i) {
        const d = (sc.outer || sc.el).getBoundingClientRect().top - vTop;
        if (Math.abs(d) < Math.abs(gap)) {
          gap = d;
          near = i;
        }
      });
      if (near < 0) return;
      const room = Math.abs(gap);
      if (room <= snapTol * vH || room > vH) return;
      go(scenes[near].id);
    }
    const onKey = function(ev) {
      if (editing() || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k = ev.key;
      if (k === "ArrowDown" || k === "PageDown") {
        ev.preventDefault();
        step(1);
        return;
      }
      if (k === "ArrowUp" || k === "PageUp") {
        ev.preventDefault();
        step(-1);
        return;
      }
      if (k === "Home" && scenes.length) {
        ev.preventDefault();
        go(scenes[0].id);
        return;
      }
      if (k === "End" && scenes.length) {
        ev.preventDefault();
        go(scenes[scenes.length - 1].id);
      }
    };
    const wantKeys = s.keys !== false;
    if (wantKeys) window.addEventListener("keydown", onKey);
    tick();
    return {
      el: rail ? rail.nav : null,
      get lenis() {
        return lenis;
      },
      go,
      next() {
        step(1);
      },
      prev() {
        step(-1);
      },
      current() {
        return curIdx >= 0 && scenes[curIdx] ? scenes[curIdx].id : null;
      },
      progress() {
        return storyP;
      },
      destroy() {
        dead = true;
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = 0;
        }
        if (io) {
          io.disconnect();
          io = null;
        }
        scroller.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
        if (wantKeys) window.removeEventListener("keydown", onKey);
        chapterDoors.forEach(function(d) {
          d.box.removeEventListener("focusin", d.fn);
        });
        chapterDoors.length = 0;
        if (lenis) {
          const w = (
            /** @type {any} */
            window
          );
          if (w.__akLenis === lenis) w.__akLenis = null;
          lenis.destroy();
          lenis = null;
        }
        if (rail && rail.nav.parentNode) rail.nav.parentNode.removeChild(rail.nav);
        if (host && hostMarked) host.classList.remove("ak-story");
        scenes.forEach(function(sc) {
          unchapterise(sc);
          unpin(sc);
          sc.el.classList.remove("ak-act");
          sc.el.removeAttribute("data-ak-act");
        });
      }
    };
  }
  function storyRail(spec) {
    const s = spec || /** @type {any} */
    {};
    const items = (s.scenes || []).map(function(sc) {
      return { id: String(sc.id), label: String(sc.label || sc.id) };
    });
    const built = railOf(items, function(id) {
      if (s.onPick) s.onPick(id);
    }, !!s.target);
    const parent = s.target ? resolve(s.target) : document.body;
    let marked = false;
    if (s.target && !parent.classList.contains("ak-story")) {
      parent.classList.add("ak-story");
      marked = true;
    }
    parent.appendChild(built.nav);
    return {
      el: built.nav,
      set(patch) {
        if (!patch || patch.current == null) return;
        const i = typeof patch.current === "number" ? patch.current : items.findIndex(function(it) {
          return it.id === String(patch.current);
        });
        built.mark(i);
      },
      destroy() {
        if (built.nav.parentNode) built.nav.parentNode.removeChild(built.nav);
        if (marked) parent.classList.remove("ak-story");
      }
    };
  }

  // src/static/sdk-libs/atelier/lenis-more.js
  var JUMP2 = 0.9;
  var READ_LINE = 3;
  function nearestScroller2(node) {
    let p = node.parentElement;
    while (p && p !== document.body) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
      p = p.parentElement;
    }
    return window;
  }
  function viewOf(scroller) {
    if (scroller === window) return { h: window.innerHeight, top: 0 };
    const box = (
      /** @type {Element} */
      scroller
    );
    return { h: box.clientHeight, top: box.getBoundingClientRect().top };
  }
  function clamp012(n) {
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }
  function layersOf(node, named) {
    if (named && named.length) {
      const out = [];
      named.forEach(function(raw) {
        if (!raw) return;
        const found = (
          /** @type {HTMLElement|null} */
          typeof raw.el === "string" ? node.querySelector(raw.el) || document.querySelector(raw.el) : raw.el || null
        );
        if (!found) {
          console.warn('aimeat-atelier: parallax layer "' + String(raw.el) + '" is not on the page, skipped');
          return;
        }
        out.push({ el: found, speed: Number(raw.speed) || 0, axis: raw.axis === "x" ? "x" : "y" });
      });
      return out;
    }
    return (
      /** @type {HTMLElement[]} */
      Array.prototype.slice.call(node.children).filter(function(kid) {
        return kid.hasAttribute("data-speed");
      }).map(function(kid) {
        return {
          el: kid,
          speed: parseFloat(kid.getAttribute("data-speed") || "0") || 0,
          axis: (
            /** @type {'y'|'x'} */
            kid.getAttribute("data-axis") === "x" ? "x" : "y"
          )
        };
      })
    );
  }
  function parallax(target, opts) {
    const node = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    const o = opts || {};
    const subject = o.subject ? (
      /** @type {HTMLElement} */
      resolve(o.subject)
    ) : node;
    const layers = layersOf(node, o.layers);
    const limit = o.clamp !== void 0 ? Math.abs(Number(o.clamp)) : Infinity;
    node.classList.add("ak-parallax");
    layers.forEach(function(L) {
      L.el.classList.add("ak-parallax__layer");
    });
    const undress = function() {
      layers.forEach(function(L) {
        L.el.classList.remove("ak-parallax__layer");
        L.el.style.removeProperty("--ak-plx-x");
        L.el.style.removeProperty("--ak-plx-y");
      });
      node.classList.remove("ak-parallax");
    };
    if (reducedMotion() || !layers.length) {
      return { el: node, progress() {
        return 0;
      }, destroy() {
        undress();
      } };
    }
    const scroller = (
      /** @type {any} */
      o.scroller || nearestScroller2(node)
    );
    let last = 0;
    const tick = function() {
      const r = node.getBoundingClientRect();
      const s = subject === node ? r : subject.getBoundingClientRect();
      const v = viewOf(scroller);
      last = clamp012((v.top + v.h - s.top) / Math.max(v.h + s.height, 1));
      layers.forEach(function(L) {
        const raw = (last - 0.5) * L.speed * r.height;
        const d = raw < -limit ? -limit : raw > limit ? limit : raw;
        L.el.style.setProperty(L.axis === "x" ? "--ak-plx-x" : "--ak-plx-y", d.toFixed(2) + "px");
      });
    };
    let rafId = 0;
    const onScroll = function() {
      if (rafId) return;
      rafId = requestAnimationFrame(function() {
        rafId = 0;
        tick();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    tick();
    return {
      el: node,
      progress() {
        return last;
      },
      destroy() {
        scroller.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        undress();
      }
    };
  }
  function slugOf(text) {
    return String(text || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }
  function freeId(text) {
    const base = slugOf(text);
    if (!base) return uid("ak-heading");
    if (!document.getElementById(base)) return base;
    let n = 2;
    while (document.getElementById(base + "-" + n)) n += 1;
    return base + "-" + n;
  }
  function readingRail(spec) {
    const s = spec || /** @type {any} */
    {};
    const article = (
      /** @type {HTMLElement} */
      resolve(s.article)
    );
    const heads = (
      /** @type {HTMLElement[]} */
      Array.prototype.slice.call(article.querySelectorAll(s.headings || "h2"))
    );
    const named = [];
    const items = heads.map(function(h) {
      if (!h.id) {
        h.id = freeId(h.textContent);
        named.push(h);
      }
      return {
        id: h.id,
        head: h,
        text: (h.textContent || "").trim() || h.id,
        deep: String(h.tagName).toUpperCase() !== "H2"
      };
    });
    const fill = el("span", { class: "ak-reading__fill", "aria-hidden": "true" });
    const line = el("div", { class: "ak-reading__line", "aria-hidden": "true" }, [fill]);
    const links = items.map(function(it) {
      return el("a", {
        class: "ak-reading__link",
        href: "#" + it.id,
        on: {
          click: function(ev) {
            ev.preventDefault();
            jump(it);
          }
        }
      }, it.text);
    });
    const list2 = el("ol", { class: "ak-reading__list" }, links.map(function(a, i) {
      return el("li", { class: "ak-reading__item" + (items[i].deep ? " ak-reading__item--deep" : "") }, [a]);
    }));
    const nav = el("nav", {
      class: "ak-reading" + (s.target ? " ak-reading--inset" : ""),
      "aria-label": "Contents"
    }, [line, list2]);
    const parent = (
      /** @type {HTMLElement} */
      s.target ? resolve(s.target) : document.body
    );
    let marked = false;
    if (s.target && !parent.classList.contains("ak-reading-host")) {
      parent.classList.add("ak-reading-host");
      marked = true;
    }
    parent.appendChild(nav);
    let curIdx = -1;
    function mark(i) {
      if (i === curIdx) return;
      curIdx = i;
      links.forEach(function(a, n) {
        if (n === i) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
        a.classList.toggle("is-current", n === i);
      });
    }
    function jump(it) {
      const glide = (
        /** @type {any} */
        window.__akLenis
      );
      if (glide && typeof glide.scrollTo === "function") {
        glide.scrollTo(it.head, { duration: JUMP2 });
      } else {
        it.head.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
      }
      mark(items.indexOf(it));
      if (s.onPick) s.onPick(it.id);
    }
    const scroller = (
      /** @type {any} */
      s.scroller || nearestScroller2(article)
    );
    const tick = function() {
      const v = viewOf(scroller);
      const r = article.getBoundingClientRect();
      const through = clamp012((v.top - r.top) / Math.max(1, r.height - v.h));
      fill.style.setProperty("--ak-fill", (through * 100).toFixed(2) + "%");
      const edge = v.top + v.h / READ_LINE;
      let at = 0;
      items.forEach(function(it, i) {
        if (it.head.getBoundingClientRect().top <= edge) at = i;
      });
      mark(items.length ? at : -1);
    };
    let rafId = 0;
    const onScroll = function() {
      if (rafId) return;
      rafId = requestAnimationFrame(function() {
        rafId = 0;
        tick();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    tick();
    return {
      el: nav,
      set(patch) {
        if (!patch || patch.current == null) return;
        const i = typeof patch.current === "number" ? patch.current : items.findIndex(function(it) {
          return it.id === String(patch.current);
        });
        mark(i);
      },
      destroy() {
        scroller.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        if (nav.parentNode) nav.parentNode.removeChild(nav);
        if (marked) parent.classList.remove("ak-reading-host");
        named.forEach(function(h) {
          h.removeAttribute("id");
        });
      }
    };
  }

  // src/static/sdk-libs/atelier/anime-show.js
  var W5 = (
    /** @type {any} */
    window
  );
  var animePromise2 = null;
  var animeOff2 = false;
  var LATE = 400;
  var SVG_NS8 = "http://www.w3.org/2000/svg";
  function ensureAnime2() {
    if (W5.anime && W5.anime.animate) return Promise.resolve(W5.anime);
    if (animePromise2) return animePromise2;
    animePromise2 = new Promise(function(ok, fail) {
      const s = document.createElement("script");
      s.src = NODE_URL + "/lib/anime@4.min.js";
      s.onload = function() {
        ok(W5.anime);
      };
      s.onerror = function() {
        animePromise2 = null;
        fail(new Error("anime failed to load"));
      };
      document.head.appendChild(s);
    });
    return animePromise2;
  }
  function withAnime2(run) {
    if (animeOff2 || reducedMotion()) return;
    ensureAnime2().then(run, function() {
      animeOff2 = true;
    });
  }
  function warmAnime2() {
    if (animeOff2 || reducedMotion()) return;
    ensureAnime2().then(null, function() {
      animeOff2 = true;
    });
  }
  function onCue(run) {
    const asked = Date.now();
    withAnime2(function(a) {
      if (Date.now() - asked > LATE) return;
      run(a);
    });
  }
  function cue(node, when, play, once) {
    if (when === "now") {
      play();
      return null;
    }
    warmAnime2();
    return inView(node, play, { once: once !== false });
  }
  function toElements(targets) {
    if (!targets) return [];
    if (typeof targets === "string") return Array.prototype.slice.call(document.querySelectorAll(targets));
    if (targets instanceof Element) return [
      /** @type {HTMLElement} */
      targets
    ];
    if (typeof targets.length === "number") return Array.prototype.slice.call(targets);
    return [];
  }
  function kidsOf(node) {
    return Array.prototype.slice.call(node.children);
  }
  var REVEAL_EACH = { words: 34, chars: 16, lines: 70 };
  var REVEAL_FROM = {
    rise: { opacity: [0, 1], y: [18, 0] },
    blur: { opacity: [0, 1], filter: ["blur(9px)", "blur(0px)"] },
    flip: { opacity: [0, 1], perspective: ["720px", "720px"], rotateX: [-86, 0], y: [10, 0] },
    drop: { opacity: [0, 1], y: [-24, 0], scale: [0.86, 1] }
  };
  function textReveal(target, opts) {
    const o = opts || {};
    const node = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    const by = o.by === "chars" || o.by === "lines" ? o.by : "words";
    const from = REVEAL_FROM[o.from] ? o.from : "rise";
    const each = typeof o.each === "number" ? o.each : REVEAL_EACH[by];
    const duration = o.duration || (by === "chars" ? 560 : 700);
    const html = node.innerHTML;
    const hasText = !!(node.textContent || "").trim();
    node.classList.add("ak-textreveal", "ak-textreveal--" + from);
    let splitter = null;
    let ownSplit = false;
    let watcher = null;
    function fallback() {
      const text = node.textContent || "";
      node.setAttribute("aria-label", text.trim());
      node.textContent = "";
      const made = [];
      text.split(/(\s+)/).forEach(function(part) {
        if (!part) return;
        const piece = el("span", { class: "ak-textreveal__piece", "aria-hidden": "true" }, part);
        node.appendChild(piece);
        if (part.trim()) made.push(piece);
      });
      ownSplit = true;
      return made;
    }
    function piecesOf(sp) {
      if (by === "chars") return sp.chars;
      if (by === "lines") return sp.lines;
      return sp.words;
    }
    function travel3(a, list2) {
      if (!list2 || !list2.length) return;
      a.animate(list2, Object.assign({}, REVEAL_FROM[from], {
        duration,
        delay: a.stagger(each),
        ease: from === "flip" ? "outBack" : "outExpo"
      }));
    }
    function reset() {
      if (splitter) {
        try {
          splitter.revert();
        } catch {
        }
        splitter = null;
      }
      if (ownSplit) {
        node.innerHTML = html;
        node.removeAttribute("aria-label");
        ownSplit = false;
      }
    }
    function play() {
      if (!hasText || reducedMotion()) return;
      onCue(function(a) {
        reset();
        const api = a.text || {};
        const make = typeof api.splitText === "function" ? api.splitText : typeof api.split === "function" ? api.split : null;
        if (!make) {
          travel3(a, fallback());
          return;
        }
        const cfg2 = (
          /** @type {any} */
          { accessible: true, lines: false, words: { class: "ak-textreveal__piece" } }
        );
        if (by === "chars") cfg2.chars = { class: "ak-textreveal__piece" };
        if (by === "lines") cfg2.lines = { class: "ak-textreveal__piece" };
        let played = false;
        splitter = make(node, cfg2);
        splitter.addEffect(function(sp) {
          if (!played) {
            played = true;
            travel3(a, piecesOf(sp));
          }
          return function() {
          };
        });
      });
    }
    watcher = cue(node, o.when === "now" ? "now" : "inView", play, o.once);
    return {
      el: node,
      play,
      reset,
      /** Unwire and hand the element back as plain text. The element itself stays on the page. */
      destroy: function() {
        if (watcher) {
          watcher.destroy();
          watcher = null;
        }
        reset();
        node.classList.remove("ak-textreveal", "ak-textreveal--" + from);
      }
    };
  }
  var DRAWABLE = "path, line, polyline, circle, rect";
  function nearestScroller3(node) {
    let p = node.parentElement;
    while (p && p !== document.body) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
      p = p.parentElement;
    }
    return window;
  }
  function drawPath(target, opts) {
    const o = opts || {};
    const node = resolve(target);
    const when = o.when === "now" || o.when === "scroll" ? o.when : "inView";
    const duration = o.duration || 1100;
    const each = typeof o.each === "number" ? o.each : 140;
    node.classList.add("ak-draw");
    const shapes = node.tagName && node.tagName.toLowerCase() === "svg" ? Array.prototype.slice.call(node.querySelectorAll(DRAWABLE)) : [node];
    shapes.forEach(function(s) {
      s.classList.add("ak-draw__shape");
    });
    let drawables = null;
    let watcher = null;
    let bound = null;
    function drawablesOf(a) {
      if (!drawables) drawables = a.svg.createDrawable(shapes, 0, 0);
      return drawables;
    }
    function setDraw(value) {
      if (!drawables) return;
      drawables.forEach(function(d) {
        d.setAttribute("draw", value);
      });
    }
    function play() {
      if (reducedMotion() || !shapes.length) return;
      onCue(function(a) {
        a.animate(drawablesOf(a), {
          draw: ["0 0", "0 1"],
          duration,
          delay: a.stagger(each),
          ease: o.ease || "inOutQuad"
        });
      });
    }
    function progress(p) {
      const at = Math.max(0, Math.min(1, Number(p) || 0));
      setDraw("0 " + at);
    }
    function reset() {
      setDraw("0 0");
    }
    function bindScroll() {
      if (reducedMotion()) return;
      withAnime2(function(a) {
        drawablesOf(a);
        reset();
        const scroller = o.scroller || nearestScroller3(node);
        let rafId = 0;
        const tick = function() {
          const r = node.getBoundingClientRect();
          const h = scroller === window ? window.innerHeight : (
            /** @type {Element} */
            scroller.clientHeight
          );
          const top = scroller === window ? 0 : (
            /** @type {Element} */
            scroller.getBoundingClientRect().top
          );
          progress((top + h - r.top) / Math.max(h + r.height, 1));
        };
        const onScroll = function() {
          if (!rafId) rafId = requestAnimationFrame(function() {
            rafId = 0;
            tick();
          });
        };
        scroller.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        tick();
        bound = function() {
          scroller.removeEventListener("scroll", onScroll);
          window.removeEventListener("resize", onScroll);
          if (rafId) cancelAnimationFrame(rafId);
        };
      });
    }
    if (when === "scroll") bindScroll();
    else watcher = cue(node, when, play, o.once);
    return {
      el: node,
      play,
      reset,
      progress,
      destroy: function() {
        if (watcher) {
          watcher.destroy();
          watcher = null;
        }
        if (bound) {
          bound();
          bound = null;
        }
        progress(1);
        drawables = null;
        shapes.forEach(function(s) {
          s.classList.remove("ak-draw__shape");
        });
        node.classList.remove("ak-draw");
      }
    };
  }
  var WAVE_BEATS = {
    scale: [{ scale: 1.22 }, { scale: 1 }],
    rise: [{ y: -16 }, { y: 0 }],
    flip: [{ rotateY: 180 }, { rotateY: 360 }],
    tint: [{ "--ak-wave-t": 1 }, { "--ak-wave-t": 0 }]
  };
  function gridWave(target, opts) {
    const o = opts || {};
    const root = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    const cols = Math.max(1, Math.round(o.cols || 8));
    const rows = Math.max(1, Math.round(o.rows || 4));
    const kind = WAVE_BEATS[o.kind] ? o.kind : "scale";
    const each = typeof o.each === "number" ? o.each : 34;
    const duration = o.duration || 640;
    root.classList.add("ak-wave", "ak-wave--" + kind);
    root.style.setProperty("--ak-wave-cols", String(cols));
    let tiles = kidsOf(root);
    const built = !tiles.length;
    if (built) {
      const count = Math.max(1, Math.round(o.cells || cols * rows));
      for (let i = 0; i < count; i++) {
        root.appendChild(el("div", { class: "ak-wave__tile", "aria-hidden": "true" }));
      }
      tiles = kidsOf(root);
    } else {
      tiles.forEach(function(tile) {
        tile.classList.add("ak-wave__tile");
      });
    }
    function pointOf(value) {
      if (Array.isArray(value) && value.length >= 2) {
        const x = Math.max(0, Math.min(cols - 1, Math.round(Number(value[0]) || 0)));
        const y = Math.max(0, Math.min(rows - 1, Math.round(Number(value[1]) || 0)));
        return y * cols + x;
      }
      if (typeof value === "number") return Math.max(0, Math.round(value));
      if (value === "first" || value === "last" || value === "random" || value === "center") return value;
      return "center";
    }
    function play(fromAt) {
      if (reducedMotion() || !tiles.length) return;
      onCue(function(a) {
        a.animate(tiles, {
          keyframes: WAVE_BEATS[kind],
          duration,
          delay: a.stagger(each, { grid: [cols, rows], from: pointOf(fromAt === void 0 ? o.from : fromAt) }),
          ease: "inOutQuad"
        });
      });
    }
    const onClick = function(ev) {
      const start = (
        /** @type {Element|null} */
        ev.target
      );
      if (!start || !start.closest) return;
      const tile = start.closest(".ak-wave__tile");
      if (!tile || tile.parentElement !== root) return;
      play(tiles.indexOf(
        /** @type {any} */
        tile
      ));
    };
    root.addEventListener("click", onClick);
    const watcher = cue(root, o.when === "now" ? "now" : "inView", function() {
      play();
    }, o.once);
    return {
      el: root,
      play,
      destroy: function() {
        if (watcher) watcher.destroy();
        root.removeEventListener("click", onClick);
        if (built) tiles.forEach(function(tile) {
          tile.remove();
        });
        else tiles.forEach(function(tile) {
          tile.classList.remove("ak-wave__tile");
        });
        root.classList.remove("ak-wave", "ak-wave--" + kind);
        root.style.removeProperty("--ak-wave-cols");
      }
    };
  }
  var END_KEYS = ["x", "y", "scale", "rotate", "opacity"];
  function endOf(value) {
    if (Array.isArray(value)) return value.length ? value[value.length - 1] : null;
    if (value && typeof value === "object" && "to" in value) return (
      /** @type {any} */
      value.to
    );
    return value;
  }
  function settle(node, props) {
    let moved = false;
    const at = { x: 0, y: 0, scale: 1, rotate: 0 };
    END_KEYS.forEach(function(key) {
      const end = endOf(props[key]);
      if (end == null) return;
      moved = true;
      if (key === "opacity") node.style.opacity = String(end);
      else at[key] = parseFloat(String(end)) || 0;
    });
    if (!moved) return;
    if (props.x !== void 0 || props.y !== void 0 || props.scale !== void 0 || props.rotate !== void 0) {
      node.style.transform = "translate(" + at.x + "px, " + at.y + "px) scale(" + (props.scale === void 0 ? 1 : at.scale) + ") rotate(" + at.rotate + "deg)";
    }
  }
  function sequence(steps2, opts) {
    const o = opts || {};
    const list2 = (Array.isArray(steps2) ? steps2 : []).filter(function(s) {
      return s && s.targets && s.props;
    });
    let tl = null;
    const queued = [];
    const asked = Date.now();
    function drive(name, arg) {
      if (tl) {
        tl[name](arg);
        return;
      }
      queued.push([name, arg]);
    }
    if (reducedMotion()) {
      list2.forEach(function(step) {
        toElements(step.targets).forEach(function(node) {
          settle(node, step.props);
        });
      });
    } else {
      withAnime2(function(a) {
        tl = a.createTimeline({ autoplay: false, loop: o.loop || false });
        list2.forEach(function(step) {
          tl.add(step.targets, step.props, step.at);
        });
        queued.forEach(function(want) {
          tl[want[0]](want[1]);
        });
        if (o.autoplay !== false && !queued.length && Date.now() - asked <= LATE) tl.play();
      });
    }
    return {
      /** The anime timeline itself, once the library has landed. Null until then. */
      get timeline() {
        return tl;
      },
      play: function() {
        drive("play");
      },
      pause: function() {
        drive("pause");
      },
      restart: function() {
        drive("restart");
      },
      seek: function(ms) {
        drive("seek", Number(ms) || 0);
      },
      reverse: function() {
        drive("reverse");
      },
      /** How long the whole piece runs, in milliseconds. 0 until the timeline exists. */
      duration: function() {
        return tl ? tl.duration : 0;
      },
      destroy: function() {
        queued.length = 0;
        if (tl) {
          tl.revert();
          tl = null;
        }
      }
    };
  }
  function orbit(target, opts) {
    const o = opts || /** @type {any} */
    {};
    const root = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    const duration = o.duration || 6e3;
    const spread = typeof o.spread === "number" ? Math.max(0, Math.min(1, o.spread)) : 1;
    root.classList.add("ak-orbit");
    let stage = null;
    let path = null;
    if (o.path && typeof o.path !== "string") {
      path = o.path;
    } else if (typeof o.path === "string" && o.path.trim()) {
      stage = document.createElementNS(SVG_NS8, "svg");
      stage.setAttribute("class", "ak-orbit__stage");
      stage.setAttribute("viewBox", o.viewBox || "0 0 100 100");
      stage.setAttribute("aria-hidden", "true");
      path = document.createElementNS(SVG_NS8, "path");
      path.setAttribute("class", "ak-orbit__path");
      path.setAttribute("d", o.path);
      path.setAttribute("fill", "none");
      stage.appendChild(path);
      root.insertBefore(stage, root.firstChild);
    }
    const madeItems = typeof o.items === "number";
    let items;
    if (madeItems) {
      items = [];
      for (let i = 0; i < Math.max(1, Math.round(o.items)); i++) {
        const dot = el("span", { class: "ak-orbit__dot", "aria-hidden": "true" });
        root.appendChild(dot);
        items.push(dot);
      }
    } else {
      items = toElements(o.items);
    }
    items.forEach(function(item) {
      item.classList.add("ak-orbit__item");
    });
    function offsetOf(i) {
      return items.length ? spread * i / items.length : 0;
    }
    let runs = [];
    let watcher = null;
    function place2() {
      if (!path || typeof path.getTotalLength !== "function") return false;
      const len = path.getTotalLength();
      if (!len) return false;
      const m = path.getCTM();
      items.forEach(function(item, i) {
        const p = path.getPointAtLength(offsetOf(i) * len % len);
        const x = m ? p.x * m.a + p.y * m.c + m.e : p.x;
        const y = m ? p.x * m.b + p.y * m.d + m.f : p.y;
        item.style.transform = "translate(" + x + "px, " + y + "px)";
      });
      return true;
    }
    function stop() {
      runs.forEach(function(run) {
        run.pause();
      });
      runs = [];
    }
    function play() {
      if (reducedMotion()) {
        place2();
        return;
      }
      onCue(function(a) {
        stop();
        items.forEach(function(item, i) {
          const along = a.svg.createMotionPath(path, offsetOf(i));
          if (!along) return;
          runs.push(a.animate(item, Object.assign({}, along, {
            duration,
            ease: o.ease || "linear",
            loop: o.loop === true
          })));
        });
      });
    }
    if (!place2()) requestAnimationFrame(function() {
      place2();
    });
    watcher = cue(root, o.when === "now" ? "now" : "inView", play, o.once);
    return {
      el: root,
      play,
      pause: function() {
        runs.forEach(function(run) {
          run.pause();
        });
      },
      /**
       * Move the whole ride to a fraction of one lap, 0 to 1. A no-op until the ride has been built.
       * @param {number} p
       */
      seek: function(p) {
        const at = Math.max(0, Math.min(1, Number(p) || 0));
        runs.forEach(function(run) {
          run.seek(at * duration);
        });
      },
      destroy: function() {
        if (watcher) {
          watcher.destroy();
          watcher = null;
        }
        runs.forEach(function(run) {
          run.revert();
        });
        runs = [];
        if (madeItems) items.forEach(function(item) {
          item.remove();
        });
        else items.forEach(function(item) {
          item.classList.remove("ak-orbit__item");
          item.style.transform = "";
        });
        if (stage) stage.remove();
        root.classList.remove("ak-orbit");
      }
    };
  }

  // src/static/sdk-libs/atelier/anime-more.js
  var W6 = (
    /** @type {any} */
    window
  );
  var animePromise3 = null;
  var animeOff3 = false;
  var LATE2 = 400;
  function ensureAnime3() {
    if (W6.anime && W6.anime.animate) return Promise.resolve(W6.anime);
    if (animePromise3) return animePromise3;
    animePromise3 = new Promise(function(ok, fail) {
      const s = document.createElement("script");
      s.src = NODE_URL + "/lib/anime@4.min.js";
      s.onload = function() {
        ok(W6.anime);
      };
      s.onerror = function() {
        animePromise3 = null;
        fail(new Error("anime failed to load"));
      };
      document.head.appendChild(s);
    });
    return animePromise3;
  }
  function withAnime3(run, without) {
    if (animeOff3 || reducedMotion()) {
      if (without) without();
      return;
    }
    ensureAnime3().then(run, function() {
      animeOff3 = true;
      if (without) without();
    });
  }
  function warmAnime3() {
    if (animeOff3 || reducedMotion()) return;
    ensureAnime3().then(null, function() {
      animeOff3 = true;
    });
  }
  function onCue2(run, without) {
    const asked = Date.now();
    withAnime3(function(a) {
      if (Date.now() - asked > LATE2) {
        if (without) without();
        return;
      }
      run(a);
    }, without);
  }
  function nearestScroller4(node) {
    let p = node.parentElement;
    while (p && p !== document.body) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
      p = p.parentElement;
    }
    return window;
  }
  function toElements2(targets) {
    if (!targets) return [];
    if (typeof targets === "string") return Array.prototype.slice.call(document.querySelectorAll(targets));
    if (targets instanceof Element) return [
      /** @type {HTMLElement} */
      targets
    ];
    if (typeof targets.length === "number") return Array.prototype.slice.call(targets);
    return [];
  }
  var END_KEYS2 = ["x", "y", "scale", "rotate", "opacity"];
  function endOf2(value) {
    if (Array.isArray(value)) return value.length ? endOf2(value[value.length - 1]) : null;
    if (value && typeof value === "object" && "to" in value) return (
      /** @type {any} */
      value.to
    );
    return value;
  }
  function settle2(node, props) {
    let moved = false;
    const at = { x: 0, y: 0, scale: 1, rotate: 0 };
    END_KEYS2.forEach(function(key) {
      const end = endOf2(props[key]);
      if (end == null) return;
      moved = true;
      if (key === "opacity") node.style.opacity = String(end);
      else at[key] = parseFloat(String(end)) || 0;
    });
    if (!moved) return;
    if (props.x !== void 0 || props.y !== void 0 || props.scale !== void 0 || props.rotate !== void 0) {
      node.style.transform = "translate(" + at.x + "px, " + at.y + "px) scale(" + (props.scale === void 0 ? 1 : at.scale) + ") rotate(" + at.rotate + "deg)";
    }
  }
  var MORPHABLE = "path, polygon, polyline";
  function geometryProp(shape) {
    return (shape.tagName || "").toLowerCase() === "path" ? "d" : "points";
  }
  function morph2(target, opts) {
    const o = opts || {};
    const root = resolve(target);
    const duration = o.duration || 720;
    const isSvg = (root.tagName || "").toLowerCase() === "svg";
    root.classList.add("ak-morph");
    const shown = (
      /** @type {any} */
      isSvg ? root.querySelector(MORPHABLE + ":not([data-shape])") || root.querySelector(MORPHABLE) : root
    );
    if (shown) shown.classList.add("ak-morph__shape");
    const spares = {};
    const made = [];
    if (isSvg) {
      Array.prototype.slice.call(root.querySelectorAll(MORPHABLE + "[data-shape]")).forEach(function(s) {
        s.classList.add("ak-morph__spare");
        spares[s.getAttribute("data-shape")] = s;
      });
    }
    if (o.shapes && isSvg) {
      Object.keys(o.shapes).forEach(function(name) {
        if (spares[name]) return;
        const spare = document.createElementNS("http://www.w3.org/2000/svg", "path");
        spare.setAttribute("class", "ak-morph__spare");
        spare.setAttribute("data-shape", name);
        spare.setAttribute("d", String(o.shapes[name]));
        root.appendChild(spare);
        spares[name] = spare;
        made.push(spare);
      });
    }
    const names = Object.keys(spares);
    let at = shown && shown.getAttribute ? shown.getAttribute("data-shape") : null;
    warmAnime3();
    function to(name) {
      const spare = spares[name];
      if (!shown || !spare) return Promise.resolve();
      const prop = geometryProp(shown);
      at = name;
      return new Promise(function(done) {
        const swap = function() {
          shown.setAttribute(prop, spare.getAttribute(prop) || "");
          done();
        };
        onCue2(function(a) {
          const props = (
            /** @type {any} */
            { duration, ease: o.ease || "inOutQuad" }
          );
          props[prop] = a.svg.morphTo(spare, o.precision);
          props.onComplete = function() {
            done();
          };
          try {
            a.animate(shown, props);
          } catch {
            swap();
          }
        }, swap);
      });
    }
    function cycle() {
      if (!names.length) return Promise.resolve();
      const i = at === null ? 0 : (names.indexOf(at) + 1) % names.length;
      return to(names[i]);
    }
    return {
      el: root,
      to,
      cycle,
      /** The name of the shape on the screen, or null while the author's own shape is showing. */
      current: function() {
        return at;
      },
      /** Every name this call can reach, in the order `cycle` walks them. */
      names: function() {
        return names.slice();
      },
      destroy: function() {
        made.forEach(function(spare) {
          spare.remove();
        });
        made.length = 0;
        Object.keys(spares).forEach(function(name) {
          if (spares[name].parentNode) spares[name].classList.remove("ak-morph__spare");
        });
        if (shown) shown.classList.remove("ak-morph__shape");
        root.classList.remove("ak-morph");
      }
    };
  }
  var HOME_MS = 420;
  function draggable(target, opts) {
    const o = opts || {};
    const node = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    const axis = o.axis === "x" || o.axis === "y" ? o.axis : "both";
    const home = o.release === "spring";
    const quiet = reducedMotion();
    node.classList.add("ak-tug");
    let dg = null;
    let floor = null;
    const seat = { x: 0, y: 0 };
    const base = { x: 0, y: 0 };
    let held = false;
    let gone = false;
    const say = function(fn) {
      if (fn) fn(x(), y());
    };
    function x() {
      return dg ? dg.x : seat.x;
    }
    function y() {
      return dg ? dg.y : seat.y;
    }
    floor = drag(node, {
      onStart: function() {
        held = true;
        base.x = seat.x;
        base.y = seat.y;
        node.classList.add("ak-tug--held");
        if (o.onGrab) o.onGrab();
      },
      onMove: function(dx, dy) {
        seat.x = axis === "y" ? 0 : base.x + dx;
        seat.y = axis === "x" ? 0 : base.y + dy;
        say(o.onDrag);
      },
      onEnd: function() {
        held = false;
        node.classList.remove("ak-tug--held");
        say(o.onRelease);
        if (home) {
          seat.x = 0;
          seat.y = 0;
        }
        handover();
      }
    }, { axis, back: home, stiffness: o.stiffness });
    function axisParam(which) {
      if (axis === "x" && which === "y" || axis === "y" && which === "x") return false;
      const s = o.snap;
      if (s && typeof s === "object" && !Array.isArray(s)) {
        const own = (
          /** @type {any} */
          s[which]
        );
        if (own !== void 0) return { snap: own };
      }
      return true;
    }
    function build(a) {
      if (gone || dg || held) return;
      const at = { x: seat.x, y: seat.y };
      if (floor) {
        floor.destroy();
        floor = null;
      }
      node.style.transform = "";
      const params = (
        /** @type {any} */
        {
          x: axisParam("x"),
          y: axisParam("y"),
          onGrab: function() {
            held = true;
            node.classList.add("ak-tug--held");
            if (o.onGrab) o.onGrab();
          },
          onDrag: function() {
            say(o.onDrag);
          },
          onRelease: function() {
            held = false;
            node.classList.remove("ak-tug--held");
            say(o.onRelease);
            if (home) set(0, 0);
          },
          onSnap: function() {
            say(o.onSnap);
          }
        }
      );
      if (o.container) params.container = o.container;
      if (typeof o.stiffness === "number") params.releaseStiffness = o.stiffness;
      if (typeof o.snap === "number" || Array.isArray(o.snap)) params.snap = o.snap;
      if (quiet) {
        params.velocityMultiplier = 0;
        params.maxVelocity = 0;
        params.minVelocity = 0;
      }
      dg = a.createDraggable(node, params);
      if (at.x || at.y) {
        dg.setX(at.x, true);
        dg.setY(at.y, true);
      }
    }
    function handover() {
      if (gone || dg || held) return;
      withAnime3(build);
    }
    function set(nx, ny) {
      const tx = axis === "y" ? 0 : Number(nx) || 0;
      const ty = axis === "x" ? 0 : Number(ny) || 0;
      seat.x = tx;
      seat.y = ty;
      if (!dg) {
        node.style.transform = "translate(" + tx + "px, " + ty + "px)";
        return;
      }
      if (quiet) {
        dg.setX(tx);
        dg.setY(ty);
        return;
      }
      dg.animate.translateX(tx, HOME_MS);
      dg.animate.translateY(ty, HOME_MS);
    }
    handover();
    return {
      el: node,
      /** How far right of its origin the element stands, in pixels. */
      x,
      /** How far below its origin the element stands, in pixels. */
      y,
      set,
      /** Back to where it started. */
      reset: function() {
        set(0, 0);
      },
      destroy: function() {
        gone = true;
        if (floor) {
          floor.destroy();
          floor = null;
        }
        if (dg) {
          dg.revert();
          dg = null;
        }
        node.style.transform = "";
        node.classList.remove("ak-tug", "ak-tug--held");
      }
    };
  }
  var BURST_KINDS = ["dot", "confetti", "spark"];
  var BURST_TONES = ["accent", "ok", "warn", "err", "ch1", "ch2", "ch3", "ch4"];
  var RING_MS = 440;
  function burst(target, opts) {
    const o = opts || {};
    const host = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    const count = Math.max(1, Math.min(200, Math.round(o.count || 24)));
    const kinds = (o.kinds || BURST_KINDS).filter(function(k) {
      return BURST_KINDS.indexOf(k) >= 0;
    });
    const tones = (o.tones || ["accent", "ch1", "ch2", "ch3"]).filter(function(t2) {
      return BURST_TONES.indexOf(t2) >= 0;
    });
    const spread = typeof o.spread === "number" ? Math.max(1, Math.min(360, o.spread)) : 360;
    const distance = o.distance || 140;
    const duration = o.duration || 1100;
    const box = host.getBoundingClientRect();
    const at = o.from || { x: box.width / 2, y: box.height / 2 };
    const lend = getComputedStyle(host).position === "static";
    if (lend) host.classList.add("ak-burst-host");
    const layer = el("div", { class: "ak-burst", "aria-hidden": "true" });
    layer.style.setProperty("--ak-burst-x", (Number(at.x) || 0) + "px");
    layer.style.setProperty("--ak-burst-y", (Number(at.y) || 0) + "px");
    host.appendChild(layer);
    const clean = function() {
      layer.remove();
      if (lend) host.classList.remove("ak-burst-host");
    };
    if (reducedMotion() || animeOff3) {
      const ring2 = el("span", { class: "ak-burst__ring" });
      layer.appendChild(ring2);
      if (typeof ring2.animate !== "function") {
        clean();
        return Promise.resolve();
      }
      const pulse = ring2.animate(
        [{ transform: "scale(0.25)", opacity: 0.85 }, { transform: "scale(1)", opacity: 0 }],
        { duration: RING_MS, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "forwards" }
      );
      return pulse.finished.then(clean, clean);
    }
    return new Promise(function(done) {
      const finish = function() {
        clean();
        done();
      };
      onCue2(function(a) {
        const rand = a.utils.random;
        const bits = [];
        for (let i = 0; i < count; i++) {
          const kind = kinds.length ? kinds[i % kinds.length] : "dot";
          const tone = tones.length ? tones[i % tones.length] : "accent";
          bits.push(el("span", { class: "ak-burst__bit ak-burst__bit--" + kind + " ak-burst__bit--" + tone }));
        }
        bits.forEach(function(bit) {
          layer.appendChild(bit);
        });
        const tl = a.createTimeline({ defaults: { ease: "outQuad" } });
        bits.forEach(function(bit) {
          const deg = spread >= 360 ? rand(0, 359) : -90 + rand(-spread / 2, spread / 2);
          const rad = deg * Math.PI / 180;
          const reach = rand(distance * 0.45, distance);
          const rise = Math.round(duration * 0.42);
          const dx = Math.cos(rad) * reach;
          const dy = Math.sin(rad) * reach;
          tl.add(bit, {
            x: [0, dx],
            // Out, then down: the second beat is gravity, and it always ends below the first.
            y: [
              { to: dy, duration: rise, ease: "outCubic" },
              { to: dy + reach * 1.35, duration: duration - rise, ease: "inCubic" }
            ],
            rotate: [0, rand(-540, 540)],
            scale: [
              { to: rand(80, 115) / 100, duration: Math.round(duration * 0.16), ease: "outBack" },
              { to: 0.2, duration: duration - Math.round(duration * 0.16), ease: "inQuad" }
            ],
            opacity: [
              { to: 1, duration: 60 },
              { to: 0, duration: duration - 60, ease: "inQuad" }
            ],
            duration
          }, 0);
        });
        tl.then(finish);
      }, finish);
    });
  }
  function scrub(target, steps2, opts) {
    const o = opts || {};
    const node = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    const list2 = (Array.isArray(steps2) ? steps2 : []).filter(function(s) {
      return s && s.targets && s.props;
    });
    let tl = null;
    let watcher = null;
    let bound = null;
    let last = 0;
    let gone = false;
    if (reducedMotion()) {
      list2.forEach(function(step) {
        toElements2(step.targets).forEach(function(n) {
          settle2(n, step.props);
        });
      });
      return {
        el: node,
        get timeline() {
          return null;
        },
        progress: function() {
          return 1;
        },
        destroy: function() {
        }
      };
    }
    function bindByHand() {
      const scroller = o.container || nearestScroller4(node);
      let rafId = 0;
      const tick = function() {
        const r = node.getBoundingClientRect();
        const h = scroller === window ? window.innerHeight : (
          /** @type {Element} */
          scroller.clientHeight
        );
        const top = scroller === window ? 0 : (
          /** @type {Element} */
          scroller.getBoundingClientRect().top
        );
        last = Math.max(0, Math.min(1, (top + h - r.top) / Math.max(h + r.height, 1)));
        if (tl) tl.seek(tl.duration * last);
      };
      const onScrolled = function() {
        if (!rafId) rafId = requestAnimationFrame(function() {
          rafId = 0;
          tick();
        });
      };
      scroller.addEventListener("scroll", onScrolled, { passive: true });
      window.addEventListener("resize", onScrolled);
      tick();
      bound = function() {
        scroller.removeEventListener("scroll", onScrolled);
        window.removeEventListener("resize", onScrolled);
        if (rafId) cancelAnimationFrame(rafId);
      };
    }
    withAnime3(function(a) {
      if (gone) return;
      if (typeof a.onScroll === "function") {
        watcher = a.onScroll(
          /** @type {any} */
          {
            target: node,
            container: o.container,
            axis: o.axis === "x" ? "x" : "y",
            enter: o.enter,
            leave: o.leave,
            // The observer's progress IS the timeline's clock, 1:1, rather than a play/pause cue.
            sync: true,
            onUpdate: function(w) {
              last = w.progress;
            }
          }
        );
        tl = a.createTimeline({ autoplay: watcher });
      } else {
        tl = a.createTimeline({ autoplay: false });
      }
      list2.forEach(function(step) {
        tl.add(step.targets, step.props, step.at);
      });
      if (!watcher) bindByHand();
    }, function() {
      list2.forEach(function(step) {
        toElements2(step.targets).forEach(function(n) {
          settle2(n, step.props);
        });
      });
      last = 1;
    });
    return {
      el: node,
      /** The anime timeline itself, once the library has landed. Null until then. */
      get timeline() {
        return tl;
      },
      /** How far the reader has carried the choreography, 0 to 1. */
      progress: function() {
        return last;
      },
      destroy: function() {
        gone = true;
        if (bound) {
          bound();
          bound = null;
        }
        if (watcher) {
          watcher.revert();
          watcher = null;
        }
        if (tl) {
          tl.revert();
          tl = null;
        }
      }
    };
  }

  // src/static/sdk-libs/atelier/motion-show.js
  function loaded2() {
    return (
      /** @type {any} */
      window.Motion
    );
  }
  var motionPromise2 = null;
  function ensureMotion2() {
    if (loaded2() && loaded2().animate) return Promise.resolve(loaded2());
    if (motionPromise2) return motionPromise2;
    motionPromise2 = new Promise(function(ok, fail) {
      const s = document.createElement("script");
      s.src = NODE_URL + "/lib/motion@13.min.js";
      s.onload = function() {
        ok(loaded2());
      };
      s.onerror = function() {
        motionPromise2 = null;
        fail(new Error("motion failed to load"));
      };
      document.head.appendChild(s);
    });
    return motionPromise2;
  }
  function travel2() {
    if (reducedMotion()) return null;
    const M = loaded2();
    return M && typeof M.animate === "function" ? M : null;
  }
  var FEEL2 = { stiffness: 260, damping: 26 };
  var TOSS = { stiffness: 170, damping: 22 };
  var BACK = { stiffness: 320, damping: 28 };
  var DEPTH = 3;
  var TILT = 0.06;
  var SPIN = 18;
  var LOB = 60;
  var FLICK2 = 480;
  var TONES12 = ["ok", "warn", "err"];
  function rowsOf5(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  }
  function safeImage2(url) {
    if (!url) return null;
    const v = String(url);
    if (/^data:/i.test(v)) {
      console.warn("aimeat-atelier: card image data: URIs are refused — upload the image to storage and pass its URL.");
      return null;
    }
    return v;
  }
  function layerOf2(url) {
    const v = safeImage2(url);
    return v ? 'url("' + v.replace(/"/g, "%22") + '")' : null;
  }
  function washOf3(id) {
    let h = 0;
    const s = String(id);
    for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) | 0;
    return Math.abs(h) % 3 + 1;
  }
  function icon2(kind) {
    const node = svg("svg", {
      class: "ak-icon",
      viewBox: "0 0 24 24",
      width: 20,
      height: 20,
      "aria-hidden": "true",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    });
    node.appendChild(svg("path", { d: kind === "left" ? "M15 5 L8 12 L15 19" : "M9 5 L16 12 L9 19" }));
    return node;
  }
  function springFrom(node, from, to, feel) {
    spring(node, from, feel).cancel();
    return spring(node, to, feel);
  }
  function whileMoving(node, run) {
    node.classList.add("is-moving");
    const free = function() {
      node.classList.remove("is-moving");
    };
    const anim = run();
    if (anim && anim.finished && typeof anim.finished.then === "function") anim.finished.then(free, free);
    else free();
    return anim;
  }
  function paceOf(node) {
    const cs = getComputedStyle(node);
    const ms = parseFloat(cs.getPropertyValue("--ak-motion")) || 200;
    const raw = (cs.getPropertyValue("--ak-ease") || "").trim();
    const nums = raw.match(/-?\d*\.?\d+/g);
    const ease = nums && nums.length >= 4 ? nums.slice(0, 4).map(Number) : [0.2, 0.7, 0.3, 1];
    return { duration: ms / 1e3, ease };
  }
  function layoutMove(container, opts) {
    const node = (
      /** @type {HTMLElement} */
      resolve(container)
    );
    const o = opts || {};
    const keyed = o.keyed || "data-id";
    const feel = { stiffness: o.stiffness || FEEL2.stiffness, damping: o.damping || FEEL2.damping };
    const wantEnter = o.enter !== false;
    const wantExit = o.exit !== false;
    let ghosts = [];
    let dead = false;
    let running = false;
    node.classList.add("ak-layout");
    ensureMotion2().then(function() {
    }, function() {
      if (!dead) node.classList.add("ak-layout--floor");
    });
    function kids() {
      return (
        /** @type {HTMLElement[]} */
        Array.prototype.slice.call(node.children).filter(function(k) {
          return !k.classList.contains("ak-layout__ghost");
        })
      );
    }
    function keyOf(kid) {
      const k = kid.getAttribute(keyed);
      return k == null ? kid : k;
    }
    function drop(ghost) {
      const at = ghosts.indexOf(ghost);
      if (at >= 0) ghosts.splice(at, 1);
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
    }
    function ghostOf(kid, box) {
      const ghost = (
        /** @type {HTMLElement} */
        kid.cloneNode(true)
      );
      ghost.className = kid.className + " ak-layout__ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.removeAttribute("id");
      ghost.style.setProperty("--ak-ghost-x", box.left + "px");
      ghost.style.setProperty("--ak-ghost-y", box.top + "px");
      ghost.style.setProperty("--ak-ghost-w", box.width + "px");
      ghost.style.setProperty("--ak-ghost-h", box.height + "px");
      document.body.appendChild(ghost);
      ghosts.push(ghost);
      const M = travel2();
      const done = function() {
        drop(ghost);
      };
      if (!M) {
        spring(ghost, { opacity: 0, scale: 0.94 }, feel).finished.then(done);
        return;
      }
      M.animate(ghost, { opacity: [1, 0], scale: [1, 0.94] }, Object.assign({ type: "spring" }, feel)).finished.then(done, done);
    }
    function glide(kid, dx, dy, M) {
      whileMoving(kid, function() {
        return M ? M.animate(kid, { x: [dx, 0], y: [dy, 0] }, Object.assign({ type: "spring" }, feel)) : flipFrom(kid, dx, dy, feel);
      });
    }
    function grow(kid, M) {
      whileMoving(kid, function() {
        return M ? M.animate(kid, { scale: [0.88, 1], opacity: [0, 1] }, Object.assign({ type: "spring" }, feel)) : springFrom(kid, { scale: 0.88, opacity: 0 }, { scale: 1, opacity: 1 }, feel);
      });
    }
    function update(run) {
      if (typeof run !== "function") return;
      if (dead || reducedMotion() || running) {
        run();
        return;
      }
      running = true;
      try {
        const before = /* @__PURE__ */ new Map();
        kids().forEach(function(kid) {
          before.set(keyOf(kid), { el: kid, box: kid.getBoundingClientRect() });
        });
        run();
        const M = travel2();
        const seen = /* @__PURE__ */ new Set();
        kids().forEach(function(kid) {
          const key = keyOf(kid);
          seen.add(key);
          const was = before.get(key);
          if (!was) {
            if (wantEnter) grow(kid, M);
            return;
          }
          const now2 = kid.getBoundingClientRect();
          const dx = was.box.left - now2.left;
          const dy = was.box.top - now2.top;
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
          glide(kid, dx, dy, M);
        });
        if (!wantExit) return;
        before.forEach(function(was, key) {
          if (seen.has(key)) return;
          if (was.el.parentNode === node) return;
          ghostOf(was.el, was.box);
        });
      } finally {
        running = false;
      }
    }
    return {
      el: node,
      update,
      destroy: function() {
        dead = true;
        ghosts.slice().forEach(drop);
        node.classList.remove("ak-layout", "ak-layout--floor");
      }
    };
  }
  function swipeStack(spec) {
    const s = spec || {};
    const threshold = typeof s.threshold === "number" && s.threshold > 0 ? s.threshold : 90;
    const root = el("section", { class: "ak-root ak-swipe", "aria-roledescription": "card stack" });
    if (s.target) resolve(s.target).appendChild(root);
    const deck = el("div", { class: "ak-swipe__deck", tabindex: "0", role: "group", "aria-label": "Cards" });
    const left = deckButton("left", "Swipe left");
    const right = deckButton("right", "Swipe right");
    const controls = el("div", { class: "ak-swipe__controls" }, [left, right]);
    root.appendChild(deck);
    root.appendChild(controls);
    let items = [];
    let index = 0;
    const history = [];
    let live = [];
    let emptyCard = null;
    let flying = false;
    let dead = false;
    function deckButton(kind, label) {
      const b = (
        /** @type {HTMLButtonElement} */
        el("button", {
          type: "button",
          class: "ak-btn ak-swipe__go ak-swipe__go--" + kind,
          "aria-label": label,
          "data-ak-noguard": true,
          on: { click: function() {
            swipe(kind);
          } }
        })
      );
      b.appendChild(icon2(kind));
      return b;
    }
    function buildCard2(item) {
      const layer = layerOf2(item.image);
      const art = el("span", {
        class: "ak-swipe__art ak-swipe__art--w" + washOf3(item.id) + (layer ? " ak-swipe__art--image" : ""),
        "aria-hidden": "true",
        vars: layer ? { "--ak-card-image": layer } : null
      }, layer ? null : el(
        "span",
        { class: "ak-swipe__monogram" },
        (Array.from(String(item.title || item.id || "?"))[0] || "?").toUpperCase()
      ));
      const caption = el("span", { class: "ak-swipe__caption" }, [
        el("span", { class: "ak-swipe__label" }, String(item.title || item.id || "")),
        item.sub != null ? el("span", { class: "ak-swipe__sub" }, String(item.sub)) : null
      ].filter(Boolean));
      const face = el("span", { class: "ak-swipe__face" }, [
        art,
        caption,
        el("span", { class: "ak-swipe__mark ak-swipe__mark--right", "aria-hidden": "true" }),
        el("span", { class: "ak-swipe__mark ak-swipe__mark--left", "aria-hidden": "true" })
      ]);
      const tone = TONES12.indexOf(item.tone) >= 0 ? " ak-swipe__card--" + item.tone : "";
      const card = (
        /** @type {HTMLElement} */
        el("article", {
          class: "ak-swipe__card" + tone,
          "data-ak-id": item.id,
          "aria-label": String(item.title || item.id || "")
        }, [face])
      );
      return { card, face };
    }
    function setDepth(card, d) {
      card.style.setProperty("--ak-swipe-depth", String(d));
    }
    function pull(face, dx) {
      const share = Math.max(-1, Math.min(1, dx / threshold));
      face.style.setProperty("--ak-swipe-tilt", (dx * TILT).toFixed(2) + "deg");
      face.style.setProperty("--ak-swipe-yes", String(Math.max(0, share)));
      face.style.setProperty("--ak-swipe-no", String(Math.max(0, -share)));
    }
    function settle3(card, face) {
      pull(face, 0);
      whileMoving(card, function() {
        return spring(card, { x: 0, y: 0 }, BACK);
      });
    }
    function arm() {
      const top = live[0];
      if (!top || top.hand) return;
      top.hand = drag(top.el, {
        onMove: function(dx) {
          pull(top.face, dx);
        },
        onEnd: function(dx, dy, velocity) {
          if (Math.abs(dx) > threshold || Math.abs(velocity.x) > FLICK2) toss(dx < 0 ? "left" : "right", dx, dy);
          else settle3(top.el, top.face);
        }
      }, { axis: "both", back: false });
    }
    function render() {
      live.forEach(function(c) {
        if (c.hand) c.hand.destroy();
      });
      live = [];
      clear(deck);
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      const rest = items.length - index;
      left.disabled = rest <= 0;
      right.disabled = rest <= 0;
      if (rest <= 0) {
        deck.hidden = true;
        const e = s.empty || {};
        emptyCard = emptyState({ target: root, tone: "quiet", title: e.title || t("empty"), hint: e.hint || t("emptyHint") });
        return;
      }
      deck.hidden = false;
      const shown = Math.min(DEPTH, rest);
      live = new Array(shown);
      for (let d = shown - 1; d >= 0; d--) {
        const item = items[index + d];
        const built = buildCard2(item);
        setDepth(built.card, d);
        built.card.setAttribute("aria-hidden", d === 0 ? "false" : "true");
        deck.appendChild(built.card);
        live[d] = { el: built.card, face: built.face, item, hand: null };
      }
      arm();
    }
    function toss(direction, dx, dy) {
      const top = live[0];
      if (!top || flying) return;
      flying = true;
      if (top.hand) {
        top.hand.destroy();
        top.hand = null;
      }
      const card = top.el;
      const item = top.item;
      const dir = direction === "left" ? -1 : 1;
      const off = dir * (window.innerWidth + card.offsetWidth);
      const done = function() {
        flying = false;
        if (card.parentNode) card.parentNode.removeChild(card);
        history.push({ index, direction });
        index += 1;
        render();
        if (s.onSwipe) s.onSwipe(item, direction);
        if (index >= items.length && s.onEmpty) s.onEmpty();
      };
      const M = travel2();
      whileMoving(card, function() {
        return M ? M.animate(
          card,
          { x: [dx, off], y: [dy, dy + LOB], rotate: [0, dir * SPIN], opacity: [1, 0] },
          Object.assign({ type: "spring" }, TOSS)
        ) : spring(card, { x: off, y: dy, opacity: 0 }, TOSS);
      }).finished.then(done, done);
    }
    function swipe(direction) {
      if (!live[0] || flying) return;
      toss(direction === "left" ? "left" : "right", 0, 0);
    }
    function undo() {
      const back = history.pop();
      if (!back || flying) return;
      index = back.index;
      render();
      const top = live[0];
      if (!top) return;
      const dir = back.direction === "left" ? -1 : 1;
      const from = dir * (window.innerWidth + top.el.offsetWidth);
      const M = travel2();
      whileMoving(top.el, function() {
        return M ? M.animate(
          top.el,
          { x: [from, 0], rotate: [dir * SPIN, 0], opacity: [0, 1] },
          Object.assign({ type: "spring" }, TOSS)
        ) : springFrom(top.el, { x: from, opacity: 0 }, { x: 0, opacity: 1 }, TOSS);
      });
    }
    const onKey = function(ev) {
      const k = (
        /** @type {KeyboardEvent} */
        ev.key
      );
      if (k === "ArrowLeft") {
        ev.preventDefault();
        swipe("left");
      } else if (k === "ArrowRight") {
        ev.preventDefault();
        swipe("right");
      }
    };
    deck.addEventListener("keydown", onKey);
    function load(data) {
      items = rowsOf5(data);
      index = 0;
      history.length = 0;
      render();
    }
    load(s.data);
    ensureMotion2().then(function() {
    }, function() {
      if (!dead) root.classList.add("ak-swipe--floor");
    });
    return {
      el: root,
      set: function(patch) {
        if (patch && "data" in patch) load(patch.data);
      },
      swipe,
      undo,
      destroy: function() {
        dead = true;
        live.forEach(function(c) {
          if (c.hand) c.hand.destroy();
        });
        live = [];
        deck.removeEventListener("keydown", onKey);
        if (emptyCard) emptyCard.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  var MOVES = {
    lift: { on: { y: -3, scale: 1.02 }, off: { y: 0, scale: 1 } },
    tilt: { on: { rotate: -1.5, scale: 1.015 }, off: { rotate: 0, scale: 1 } },
    squash: { on: { scale: 0.96 }, off: { scale: 1 } },
    dip: { on: { y: 2, scale: 0.99 }, off: { y: 0, scale: 1 } }
  };
  function amount(move, k) {
    if (k === 1) return move;
    const out = {};
    Object.keys(move).forEach(function(key) {
      out[key] = key === "scale" ? 1 + (move[key] - 1) * k : move[key] * k;
    });
    return out;
  }
  function micro(target, opts) {
    const node = (
      /** @type {HTMLElement} */
      resolve(target)
    );
    const o = opts || {};
    const hoverKind = o.hover === void 0 ? "lift" : o.hover;
    const pressKind = o.press === void 0 ? "squash" : o.press;
    const k = typeof o.scale === "number" && o.scale > 0 ? o.scale : 1;
    const nodes = o.selector ? (
      /** @type {HTMLElement[]} */
      Array.prototype.slice.call(node.querySelectorAll(o.selector))
    ) : [node];
    const handles = [];
    const classes = ["ak-micro"];
    let dead = false;
    if (hoverKind === "glow") classes.push("ak-micro--glow");
    else if (hoverKind && MOVES[hoverKind]) classes.push("ak-micro--" + hoverKind);
    if (pressKind && MOVES[pressKind]) classes.push("ak-micro--" + pressKind);
    if (reducedMotion() || classes.length === 1 || !nodes.length) {
      return { el: node, destroy: function() {
      } };
    }
    nodes.forEach(function(n) {
      n.classList.add.apply(n.classList, classes);
    });
    const owned = classes.filter(function(c) {
      return c !== "ak-micro" && c !== "ak-micro--glow";
    });
    function bind(M) {
      const feel = paceOf(node);
      const hoverMove = hoverKind && hoverKind !== "glow" ? MOVES[hoverKind] : null;
      const pressMove = pressKind ? MOVES[pressKind] : null;
      nodes.forEach(function(n) {
        owned.forEach(function(c) {
          n.classList.remove(c);
        });
        if (hoverMove) {
          handles.push(M.hover(n, function() {
            M.animate(n, amount(hoverMove.on, k), feel);
            return function() {
              M.animate(n, amount(hoverMove.off, k), feel);
            };
          }));
        }
        if (pressMove) {
          handles.push(M.press(n, function() {
            M.animate(n, amount(pressMove.on, k), feel);
            return function() {
              M.animate(n, amount(pressMove.off, k), feel);
            };
          }));
        }
      });
    }
    if (owned.length) {
      ensureMotion2().then(function(M) {
        if (dead || reducedMotion() || !M || typeof M.hover !== "function") return;
        bind(M);
      }, function() {
      });
    }
    return {
      el: node,
      destroy: function() {
        dead = true;
        handles.forEach(function(stop) {
          if (typeof stop === "function") stop();
        });
        handles.length = 0;
        nodes.forEach(function(n) {
          n.classList.remove.apply(n.classList, classes);
        });
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
    version: "0.47.0",
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
    // ── Materials and motion recipes that need a hand on the wheel (materials.css has the rest) ──
    spotlight,
    tilt,
    sheen,
    odometer,
    thumb,
    deal,
    // ── The nine parts the canvas found missing (ring, crew, poll, keys also mosaic blocks) ──
    ring,
    crew,
    poll,
    keys,
    dropzone,
    toast,
    palette,
    compare,
    tour,
    // ── The kit's own motion primitives (Web Animations API, no dependency, finite, reduced-motion safe) ──
    springFrames,
    spring,
    stagger,
    inView,
    scrollLink,
    drag,
    flipFrom,
    // ── The parts that ride the motion libraries: Motion (carousel, lightbox), anime.js (calendar,
    //    priceTable), Lenis (thread, checkout) — each lazy-loads its pack from this node ──
    carousel,
    lightbox,
    calendar,
    priceTable,
    thread,
    checkout,
    // ── The parts on the kit's own primitives (sortable, notices, facets also mosaic blocks) ──
    sortable,
    cart,
    notices,
    facets,
    // ── The show: the Lenis director (scenes in order, each with its motion), the anime.js show
    //    pieces, and the transitions between screens and between panels ──
    director,
    storyRail,
    parallax,
    readingRail,
    textReveal,
    drawPath,
    gridWave,
    sequence,
    orbit,
    morph: morph2,
    draggable,
    burst,
    scrub,
    layoutMove,
    swipeStack,
    micro,
    screenTransition,
    panelTransition,
    curtain,
    intro,
    setMotion,
    // ── The ambient: the one layer allowed to move at idle, its stage, the weather switch and
    //    attract mode (the look decides; the viewer's weather and Less motion always win) ──
    ambient,
    ambientStage,
    weather,
    attract,
    setWeather,
    weatherLevel,
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
