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
      entry.spark.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "polyline"));
      entry.tile.appendChild(entry.spark);
    }
    entry.spark.firstChild.setAttribute("points", points);
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

  // src/static/sdk-libs/atelier/chart.js
  var W = 720;
  var H = 300;
  var PAD = { top: 14, right: 12, bottom: 34, left: 46 };
  var SERIES_VARS = ["var(--ak-accent)", "var(--ak-spectrum-2)", "var(--ak-spectrum-3)", "var(--ak-accent-2)"];
  var SVG_NS = "http://www.w3.org/2000/svg";
  function svg(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
    return node;
  }
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
  function chart(spec) {
    const kind = spec.kind === "donut" || spec.kind === "calendar" ? spec.kind : "axes";
    const root = el("figure", {
      class: "ak-root ak-chart" + (spec.presentation === "mural" ? " ak-chart--mural" : ""),
      role: "img"
    });
    if (spec.target) resolve(spec.target).appendChild(root);
    let emptyCard = null;
    function showEmpty() {
      const e = spec.empty || {};
      emptyCard = emptyState({ target: root, tone: "quiet", title: e.title || t("empty"), hint: e.hint || t("emptyHint") });
    }
    function render(data) {
      if (emptyCard) {
        emptyCard.destroy();
        emptyCard = null;
      }
      clear(root);
      if (kind === "donut") return renderDonut(data);
      if (kind === "calendar") return renderCalendar(data);
      const labels = data && Array.isArray(data.labels) ? data.labels : [];
      const series = (data && Array.isArray(data.series) ? data.series : []).filter((s) => s && Array.isArray(s.values) && s.values.length > 0);
      if (!labels.length || !series.length) {
        const e = spec.empty || {};
        emptyCard = emptyState({ target: root, tone: "quiet", title: e.title || t("empty"), hint: e.hint || t("emptyHint") });
        return;
      }
      root.setAttribute("aria-label", (spec.title ? spec.title + " — " : "") + series.map((s) => s.label).join(", "));
      let min = 0;
      let max = 0;
      for (const s of series) for (const v of s.values) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (max === min) max = min + 1;
      const step = tickStep(max - min);
      min = Math.floor(min / step) * step;
      max = Math.ceil(max / step) * step;
      const innerW = W - PAD.left - PAD.right;
      const innerH = H - PAD.top - PAD.bottom;
      const x = (i) => PAD.left + innerW * i / labels.length;
      const slotW = innerW / labels.length;
      const y = (v) => PAD.top + innerH * (1 - (v - min) / (max - min));
      const node = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "ak-chart__svg", "aria-hidden": "true" });
      for (let v = min; v <= max + step / 2; v += step) {
        const gy = y(v);
        node.appendChild(svg("line", { x1: PAD.left, x2: W - PAD.right, y1: gy, y2: gy, class: v === 0 ? "ak-chart__zero" : "ak-chart__grid" }));
        const tick = svg("text", { x: PAD.left - 6, y: gy + 4, class: "ak-chart__tick", "text-anchor": "end" });
        tick.textContent = fmtTick(v);
        node.appendChild(tick);
      }
      labels.forEach((label, i) => {
        const tx = svg("text", { x: x(i) + slotW / 2, y: H - PAD.bottom + 18, class: "ak-chart__tick", "text-anchor": "middle" });
        tx.textContent = String(label);
        node.appendChild(tx);
      });
      const still = reducedMotion();
      const bars = series.filter((s) => (s.kind || "bar") === "bar");
      const lines = series.filter((s) => s.kind === "line" || s.kind === "area");
      for (const s of series) {
        if (s.kind !== "area") continue;
        const colour = SERIES_VARS[series.indexOf(s) % SERIES_VARS.length];
        const pts = s.values.slice(0, labels.length).map((v, i) => `${x(i) + slotW / 2},${y(v)}`);
        const first = x(0) + slotW / 2;
        const last = x(Math.min(s.values.length, labels.length) - 1) + slotW / 2;
        const poly = svg("polygon", {
          points: `${first},${y(0)} ` + pts.join(" ") + ` ${last},${y(0)}`,
          class: "ak-chart__area",
          style: `fill:${colour}`
        });
        node.appendChild(poly);
      }
      const groupPad = slotW * 0.18;
      const barW = bars.length ? (slotW - groupPad * 2) / bars.length : 0;
      bars.forEach((s, si) => {
        const colour = SERIES_VARS[series.indexOf(s) % SERIES_VARS.length];
        s.values.slice(0, labels.length).forEach((v, i) => {
          const top = Math.min(y(v), y(0));
          const height = Math.abs(y(v) - y(0));
          const rect = svg("rect", {
            x: x(i) + groupPad + si * barW + 1,
            y: top,
            width: Math.max(barW - 2, 1),
            height: Math.max(height, 0.5),
            class: "ak-chart__bar",
            style: `fill:${colour}`
          });
          if (!still) {
            rect.setAttribute("style", `fill:${colour}; transform-origin: center ${y(0)}px; animation-delay: ${i * 40}ms`);
            rect.classList.add("ak-chart__bar--enter");
          }
          node.appendChild(rect);
        });
      });
      lines.forEach((s) => {
        const colour = SERIES_VARS[series.indexOf(s) % SERIES_VARS.length];
        const points = s.values.slice(0, labels.length).map((v, i) => `${x(i) + slotW / 2},${y(v)}`).join(" ");
        const line = svg("polyline", { points, class: "ak-chart__line", style: `stroke:${colour}` });
        if (!still) line.classList.add("ak-chart__line--enter");
        node.appendChild(line);
      });
      root.appendChild(node);
      const legend = el(
        "figcaption",
        { class: "ak-chart__legend" },
        series.map((s) => el("span", { class: "ak-chart__key" }, [
          el("span", { class: "ak-chart__swatch" + (s.kind === "line" ? " ak-chart__swatch--line" : "") }),
          el("span", { text: s.label })
        ]))
      );
      series.forEach((s, i) => {
        const sw = legend.children[i] && legend.children[i].firstChild;
        if (sw) sw.style.background = SERIES_VARS[i % SERIES_VARS.length];
      });
      root.appendChild(legend);
      if (!still) {
        for (const line of node.querySelectorAll(".ak-chart__line--enter")) {
          const len = (
            /** @type {SVGPolylineElement} */
            line.getTotalLength()
          );
          line.setAttribute("stroke-dasharray", String(len));
          line.setAttribute("stroke-dashoffset", String(len));
          requestAnimationFrame(() => line.classList.add("ak-chart__line--drawn"));
        }
      }
    }
    function renderDonut(data) {
      const slices = (data && Array.isArray(data.slices) ? data.slices : []).filter((s) => s && typeof s.value === "number" && s.value > 0);
      if (!slices.length) return showEmpty();
      const total = slices.reduce((sum, s) => sum + s.value, 0);
      root.setAttribute("aria-label", (spec.title ? spec.title + " — " : "") + slices.map((s) => s.label + " " + s.value).join(", "));
      const R2 = 84;
      const STROKE = 30;
      const C = 2 * Math.PI * R2;
      const node = svg("svg", { viewBox: "0 0 240 240", class: "ak-chart__svg ak-chart__svg--donut", "aria-hidden": "true" });
      let offset = 0;
      slices.forEach((s, i) => {
        const frac = s.value / total;
        const ring = svg("circle", {
          cx: 120,
          cy: 120,
          r: R2,
          class: "ak-chart__slice",
          style: `stroke:${SERIES_VARS[i % SERIES_VARS.length]}`,
          "stroke-width": STROKE,
          "stroke-dasharray": `${Math.max(frac * C - 3, 0.5)} ${C}`,
          "stroke-dashoffset": String(-offset * C),
          transform: "rotate(-90 120 120)"
        });
        if (!reducedMotion()) {
          ring.classList.add("ak-chart__slice--enter");
          ring.style.animationDelay = i * 70 + "ms";
        }
        node.appendChild(ring);
        offset += frac;
      });
      const totalText = svg("text", { x: 120, y: 126, class: "ak-chart__total", "text-anchor": "middle" });
      totalText.textContent = fmtTick(total);
      node.appendChild(totalText);
      root.appendChild(node);
      const legend = el(
        "figcaption",
        { class: "ak-chart__legend" },
        slices.map((s) => el("span", { class: "ak-chart__key" }, [
          el("span", { class: "ak-chart__swatch" }),
          el("span", { text: s.label + " · " + fmtTick(s.value) })
        ]))
      );
      slices.forEach((s, i) => {
        const sw = legend.children[i] && legend.children[i].firstChild;
        if (sw) sw.style.background = SERIES_VARS[i % SERIES_VARS.length];
      });
      root.appendChild(legend);
    }
    function renderCalendar(data) {
      const days = (data && Array.isArray(data.days) ? data.days : []).map((d) => ({ date: new Date(d.date), value: Number(d.value) || 0 })).filter((d) => !isNaN(d.date.getTime())).sort((a, b) => a.date.getTime() - b.date.getTime());
      if (!days.length) return showEmpty();
      const max = days.reduce((m, d) => Math.max(m, d.value), 0) || 1;
      const first = days[0].date;
      const start = new Date(first);
      start.setDate(start.getDate() - (start.getDay() + 6) % 7);
      const spanDays = Math.round((days[days.length - 1].date.getTime() - start.getTime()) / 864e5) + 1;
      const weeks = Math.min(Math.ceil(spanDays / 7), 53);
      const CELL = 13;
      const GAP = 3;
      const width = weeks * (CELL + GAP) + GAP;
      const height = 7 * (CELL + GAP) + GAP;
      root.setAttribute("aria-label", (spec.title ? spec.title + " — " : "") + days.length + " d");
      const byKey = /* @__PURE__ */ new Map();
      for (const d of days) byKey.set(d.date.toISOString().slice(0, 10), d.value);
      const node = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "ak-chart__svg ak-chart__svg--calendar", "aria-hidden": "true" });
      const cursor = new Date(start);
      for (let w = 0; w < weeks; w++) {
        for (let dow = 0; dow < 7; dow++) {
          const key = cursor.toISOString().slice(0, 10);
          const value = byKey.get(key);
          const cell = svg("rect", {
            x: GAP + w * (CELL + GAP),
            y: GAP + dow * (CELL + GAP),
            width: CELL,
            height: CELL,
            rx: 3,
            class: "ak-chart__day" + (value === void 0 ? " ak-chart__day--blank" : "")
          });
          if (value !== void 0) {
            cell.setAttribute("style", "fill: var(--ak-accent); fill-opacity: " + (0.15 + 0.85 * (value / max)).toFixed(3));
          }
          node.appendChild(cell);
          cursor.setDate(cursor.getDate() + 1);
        }
      }
      root.appendChild(node);
    }
    render(spec.data);
    return {
      el: root,
      /** @param {{ data: ChartData|null }} patch */
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
  var TONES = ["ok", "warn", "err", "accent", "plain"];
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
          const tone = cell && TONES.includes(cell.tone || "") ? cell.tone : cell ? "plain" : null;
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
    const kind = spec.kind === "sky" || spec.kind === "bars" ? spec.kind : "orb";
    const root = el("figure", { class: "ak-root ak-scene", "data-ak-scene": kind });
    if (spec.target) resolve(spec.target).appendChild(root);
    if (spec.title) root.appendChild(el("figcaption", { class: "ak-scene__title" }, spec.title));
    const stage = el("div", { class: "ak-scene__stage" });
    root.appendChild(stage);
    const wait = skeleton({ target: stage, rows: 2 });
    let destroyed = false;
    let world = null;
    ensureThree().then(function(THREE) {
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
    controls.enableZoom = kind === "bars";
    if (kind === "sky") {
      controls.enableZoom = false;
      controls.rotateSpeed = -0.35;
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
      if (kind === "sky") {
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
      if (kind === "sky") {
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
    if (kind === "chart" || kind === "matrix" || kind === "graph" || kind === "waveform" || kind === "gauge" || kind === "console" || kind === "atlas" || kind === "map" || kind === "scene3d") {
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

  // src/static/sdk-libs/atelier/ops.js
  var SVG_NS4 = "http://www.w3.org/2000/svg";
  function svg4(name, attrs) {
    const node = document.createElementNS(SVG_NS4, name);
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
    return node;
  }
  var TONES2 = ["ok", "warn", "err", "plain"];
  function toneOf(value) {
    return TONES2.indexOf(value) >= 0 ? value : "plain";
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
    const R = 84;
    const CX = 100;
    const CY = 104;
    const SWEEP = 240;
    function angleAt(frac) {
      return -SWEEP / 2 - 90 + SWEEP * frac;
    }
    function pointAt(deg, radius) {
      const rad = deg * Math.PI / 180;
      return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
    }
    function arcPath(fromFrac, toFrac, radius) {
      const [x1, y1] = pointAt(angleAt(fromFrac), radius);
      const [x2, y2] = pointAt(angleAt(toFrac), radius);
      const large = (toFrac - fromFrac) * SWEEP > 180 ? 1 : 0;
      return "M " + x1 + " " + y1 + " A " + radius + " " + radius + " 0 " + large + " 1 " + x2 + " " + y2;
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
      const bands = Array.isArray(data.bands) && data.bands.length ? data.bands : [{ upTo: max, tone: "plain" }];
      let tone = "plain";
      for (const band of bands) {
        if (data.value <= band.upTo) {
          tone = toneOf(band.tone);
          break;
        }
      }
      if (data.value > bands[bands.length - 1].upTo) tone = toneOf(bands[bands.length - 1].tone);
      root.setAttribute("aria-label", (data.label ? data.label + ": " : "") + data.value + (data.unit || ""));
      const node = svg4("svg", { viewBox: "0 0 200 160", class: "ak-gauge__svg", "aria-hidden": "true" });
      node.appendChild(svg4("path", { d: arcPath(0, 1, R), class: "ak-gauge__track" }));
      let from = min;
      for (const band of bands) {
        const f0 = Math.max(0, Math.min(1, (from - min) / (max - min)));
        const f1 = Math.max(0, Math.min(1, (band.upTo - min) / (max - min)));
        if (f1 > f0) node.appendChild(svg4("path", { d: arcPath(f0, f1, R), class: "ak-gauge__band ak-gauge__band--" + toneOf(band.tone) }));
        from = band.upTo;
      }
      const value = svg4("path", { d: arcPath(0, Math.max(frac, 4e-3), R - 14), class: "ak-gauge__value ak-gauge__value--" + tone });
      node.appendChild(value);
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
        data.label ? el("span", { class: "ak-gauge__label", text: data.label }) : null
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

  // src/static/sdk-libs/atelier/konsole.js
  var CAP_DEFAULT = 400;
  var TONES3 = ["ok", "warn", "err", "plain"];
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
      const tone = TONES3.indexOf(line.tone) >= 0 ? line.tone : "plain";
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

  // src/static/sdk-libs/atelier/atlas.js
  var SVG_NS5 = "http://www.w3.org/2000/svg";
  function svg5(name, attrs) {
    const node = document.createElementNS(SVG_NS5, name);
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
    return node;
  }
  var TONES4 = ["ok", "warn", "err"];
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
        const tone = TONES4.indexOf(m.row.tone) >= 0 ? m.row.tone : null;
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
        const tone = TONES4.indexOf(m.tone) >= 0 ? m.tone : null;
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
  var TONES5 = ["ok", "warn", "err"];
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
      const cls = TONES5.indexOf(tone) >= 0 ? " ak-map__pin--" + tone : "";
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
        case "scene3d": {
          if (p.source) {
            return bound("scene3d", function(data) {
              return scene3d({ target: into, kind: p.kind, data: { items: patchFor("scene3d", data).items }, title: p.title, empty });
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
        default:
          console.warn('aimeat-atelier: this kit build has no renderer for "' + block.component + '" — skipping block "' + block.id + '".');
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
      if (nav === "tabs" || nav === "bottom-bar") root.appendChild(projectPicker(units, nav));
      else if (nav === "deck") root.appendChild(projectDeck(units));
      else if (nav === "flow") root.appendChild(projectFlow(units));
      else if (nav === "canvas") root.appendChild(projectCanvas(units, morph));
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
  var TONES6 = ["plain", "danger", "celebrate", "ai"];
  var SIZES = ["compact", "roomy", "wide"];
  function dialog(spec) {
    const from = spec.from === "bottom" ? "bottom" : "center";
    const tone = TONES6.indexOf(spec.tone || "") >= 0 ? spec.tone : "plain";
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
    version: "0.34.0",
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
    // ── The things that open ──
    reveal,
    drawer,
    dialog,
    confirm,
    prompt,
    sheet,
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
