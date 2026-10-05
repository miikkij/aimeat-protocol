// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/ai/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-ai.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/session.js
  function getSession(libLabel) {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    if (!auth) {
      throw new Error("AIMEAT.auth is required. Include aimeat-auth.js before " + (libLabel || "this library"));
    }
    const s = auth.getSession();
    if (!s) throw new Error("Not logged in. Call AIMEAT.auth.login() first.");
    return s;
  }
  function authFetch(path, opts, libLabel) {
    return getSession(libLabel).fetch(path, opts);
  }
  function makeSession(libLabel) {
    return {
      getSession: () => getSession(libLabel),
      authFetch: (path, opts) => authFetch(path, opts, libLabel)
    };
  }

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

  // src/static/sdk-libs/_core/spend.js
  var ARM_MS = 400;
  function state() {
    const ns = namespace();
    if (!ns.__spend) {
      ns.__spend = { inflight: /* @__PURE__ */ new Map(), settled: /* @__PURE__ */ new Map(), remembered: {}, budget: null };
    }
    return ns.__spend;
  }
  function keyOf(parts) {
    const s = parts.map((p) => p == null ? "" : String(p)).join("\0");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return (parts[0] == null ? "k" : String(parts[0])) + ":" + h.toString(36);
  }
  function once(key, fn, opts) {
    const s = state();
    const ttl = opts && opts.ttlMs || 0;
    const running = s.inflight.get(key);
    if (running) return running;
    if (ttl > 0) {
      const done = s.settled.get(key);
      if (done && Date.now() - done.t < ttl) return Promise.resolve(done.v);
      if (done) s.settled.delete(key);
    }
    const p = Promise.resolve().then(fn).then(
      (v) => {
        s.inflight.delete(key);
        if (ttl > 0) s.settled.set(key, { v, t: Date.now() });
        return v;
      },
      (e) => {
        s.inflight.delete(key);
        throw e;
      }
    );
    s.inflight.set(key, p);
    return p;
  }
  function isBusy(key) {
    return state().inflight.has(key);
  }
  function forget(key) {
    state().settled.delete(key);
  }
  function noteBudget(b) {
    if (b) state().budget = b;
  }
  function lastBudget() {
    return state().budget;
  }
  function cancelledError(what) {
    const e = (
      /** @type {Error & { code?: string }} */
      new Error((what || "The action") + " was cancelled")
    );
    e.code = "SPEND_CANCELLED";
    return e;
  }
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }
  function lang() {
    try {
      const a = window.AIMEAT && window.AIMEAT.auth;
      const l = a && a.getLang && a.getLang();
      if (l === "fi" || l === "en") return l;
    } catch {
    }
    try {
      return (navigator.language || "").toLowerCase().startsWith("fi") ? "fi" : "en";
    } catch {
      return "en";
    }
  }
  var STRINGS = {
    en: {
      title: "Confirm",
      cost: "This spends from your own account.",
      ok: "Continue",
      cancel: "Cancel",
      remember: "Don't ask again in this session",
      budget: "AI budget today",
      left: "left"
    },
    fi: {
      title: "Vahvista",
      cost: "Tämä kuluttaa omalta tililtäsi.",
      ok: "Jatka",
      cancel: "Peruuta",
      remember: "Älä kysy uudelleen tässä istunnossa",
      budget: "AI-budjetti tänään",
      left: "jäljellä"
    }
  };
  function ensureStyles() {
    if (document.getElementById("aimeat-spend-css")) return;
    const st = document.createElement("style");
    st.id = "aimeat-spend-css";
    st.textContent = [
      ".aim-spend::backdrop{background:rgba(9,11,16,.62)}",
      ".aim-spend{border:0;padding:0;background:transparent;max-width:min(440px,calc(100vw - 24px));",
      "max-height:calc(100dvh - 24px);overflow:visible}",
      ".aim-spend-box{box-sizing:border-box;max-height:calc(100dvh - 24px);overflow:auto;",
      "padding:20px 20px 16px;border-radius:14px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;",
      "background:#fff;color:#12151c;border:1px solid #e2e5ea;box-shadow:0 18px 48px rgba(9,11,16,.28)}",
      ".aim-spend-box h3{margin:0 0 6px;font-size:17px;font-weight:700;letter-spacing:-.01em}",
      ".aim-spend-what{margin:0 0 10px;font-size:14.5px;line-height:1.45}",
      ".aim-spend-detail{margin:0 0 10px;font-size:13px;line-height:1.5;opacity:.78;white-space:pre-wrap}",
      ".aim-spend-meta{margin:0 0 14px;font-size:12.5px;line-height:1.6;opacity:.72}",
      ".aim-spend-meta b{font-weight:650;opacity:.95}",
      ".aim-spend-remember{display:flex;align-items:center;gap:7px;margin:0 0 14px;font-size:12.5px;opacity:.8;cursor:pointer}",
      // Sticky footer: on a short viewport the detail text scrolls inside the box, and both actions
      // stay reachable without scrolling to find them.
      ".aim-spend-btns{position:sticky;bottom:-16px;margin-bottom:-16px;padding:12px 0 16px;background:inherit;",
      "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}",
      ".aim-spend-btns button{font:inherit;font-size:14px;font-weight:600;padding:9px 16px;border-radius:9px;cursor:pointer;border:1px solid transparent}",
      ".aim-spend-cancel{background:transparent;color:inherit;border-color:#d3d7de}",
      ".aim-spend-cancel:hover{background:rgba(9,11,16,.05)}",
      ".aim-spend-ok{background:#E8564A;color:#fff}",
      ".aim-spend-ok:hover{background:#d54539}",
      ".aim-spend-ok[disabled]{opacity:.5;cursor:progress}",
      "@media (prefers-color-scheme:dark){",
      ".aim-spend-box{background:#161a21;color:#e8eaee;border-color:#2b313b;box-shadow:0 18px 48px rgba(0,0,0,.6)}",
      ".aim-spend-cancel{border-color:#39414d}",
      ".aim-spend-cancel:hover{background:rgba(255,255,255,.06)}",
      "}",
      ':root[data-theme="dark"] .aim-spend-box{background:#161a21;color:#e8eaee;border-color:#2b313b}',
      ':root[data-theme="dark"] .aim-spend-cancel{border-color:#39414d}',
      ':root[data-theme="light"] .aim-spend-box{background:#fff;color:#12151c;border-color:#e2e5ea}',
      ':root[data-theme="light"] .aim-spend-cancel{border-color:#d3d7de}',
      "@media (max-width:420px){.aim-spend-btns{flex-direction:column-reverse}.aim-spend-btns button{width:100%}}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }
  function confirmSpend(opts) {
    const o = opts || {};
    const s = state();
    if (o.remember && s.remembered[o.remember]) return Promise.resolve(true);
    if (typeof document === "undefined" || !document.body) return Promise.resolve(true);
    const t2 = STRINGS[lang()] || STRINGS.en;
    ensureStyles();
    let remaining = o.remaining;
    if (!remaining) {
      const b = s.budget;
      if (b && typeof b.remaining_usd === "number" && typeof b.daily_budget_usd === "number") {
        remaining = "$" + b.remaining_usd.toFixed(2) + " / $" + b.daily_budget_usd.toFixed(2) + " " + t2.left;
      }
    }
    const dlg = document.createElement("dialog");
    dlg.className = "aim-spend";
    dlg.innerHTML = '<div class="aim-spend-box" role="document"><h3>' + esc(t2.title) + '</h3><p class="aim-spend-what">' + esc(o.what || t2.cost) + "</p>" + (o.detail ? '<p class="aim-spend-detail">' + esc(o.detail) + "</p>" : "") + (o.estimate || remaining ? '<p class="aim-spend-meta">' + (o.estimate ? esc(t2.cost) + " <b>" + esc(o.estimate) + "</b>" : esc(t2.cost)) + (remaining ? "<br>" + esc(t2.budget) + ": <b>" + esc(remaining) + "</b>" : "") + "</p>" : "") + (o.remember ? '<label class="aim-spend-remember"><input type="checkbox" class="aim-spend-rem"><span>' + esc(t2.remember) + "</span></label>" : "") + '<div class="aim-spend-btns"><button type="button" class="aim-spend-cancel">' + esc(o.cancelLabel || t2.cancel) + '</button><button type="button" class="aim-spend-ok" disabled>' + esc(o.okLabel || t2.ok) + "</button></div></div>";
    document.body.appendChild(dlg);
    return new Promise((resolve) => {
      let settled = false;
      const rem = (
        /** @type {HTMLInputElement|null} */
        dlg.querySelector(".aim-spend-rem")
      );
      const ok = (
        /** @type {HTMLButtonElement} */
        dlg.querySelector(".aim-spend-ok")
      );
      const cancel = (
        /** @type {HTMLButtonElement} */
        dlg.querySelector(".aim-spend-cancel")
      );
      function finish(answer) {
        if (settled) return;
        settled = true;
        if (answer && o.remember && rem && rem.checked) s.remembered[o.remember] = true;
        try {
          dlg.close();
        } catch {
        }
        dlg.remove();
        resolve(answer);
      }
      cancel.addEventListener("click", () => finish(false));
      ok.addEventListener("click", () => finish(true));
      dlg.addEventListener("cancel", (e) => {
        e.preventDefault();
        finish(false);
      });
      dlg.addEventListener("click", (e) => {
        if (e.target === dlg) finish(false);
      });
      try {
        dlg.showModal();
      } catch {
        dlg.setAttribute("open", "");
      }
      try {
        cancel.focus({ preventScroll: true });
      } catch {
        cancel.focus();
      }
      const boxEl = dlg.querySelector(".aim-spend-box");
      if (boxEl) boxEl.scrollTop = 0;
      setTimeout(() => {
        ok.disabled = false;
      }, ARM_MS);
    });
  }
  var spend = {
    confirm: confirmSpend,
    once,
    key: keyOf,
    isBusy,
    forget,
    budget: lastBudget,
    /** Clear every "don't ask again" answer — e.g. when the user signs out. */
    resetRemembered() {
      state().remembered = {};
    }
  };
  function attachSpend() {
    attach("spend", spend);
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

  // src/static/sdk-libs/_core/lang.js
  var LANG_KEY = "aimeat-lang";
  function storedLang() {
    try {
      return localStorage.getItem(LANG_KEY) || null;
    } catch {
      return null;
    }
  }

  // public/components/ai-label-icons.js
  var AI_PROVENANCE_SPEC_V1 = "aimeat.provenance/v1";
  var EU_ICONS = {
    "ai-basic": { ratio: 1 },
    "ai-generated": { ratio: 1789.84 / 566.93 },
    "ai-modified": { ratio: 1700.79 / 566.93 }
  };
  function reviewed(record) {
    return record.humanInvolvement === "editorial-control" || record.humanInvolvement === "full-human";
  }
  function euIconFor(record) {
    if (!record || typeof record !== "object" || Array.isArray(record) || record.spec !== AI_PROVENANCE_SPEC_V1) {
      return { file: "ai-basic", alt: "aiLabel.iconAlt.unstated" };
    }
    switch (record.level) {
      case "original":
        return null;
      case "assisted":
        return { file: "ai-modified", alt: "aiLabel.iconAlt.aiModified" };
      case "synthesized":
      case "ai-generated":
        return reviewed(record) ? { file: "ai-basic", alt: "aiLabel.iconAlt.aiBasic" } : { file: "ai-generated", alt: "aiLabel.iconAlt.aiGenerated" };
      default:
        return { file: "ai-basic", alt: "aiLabel.iconAlt.unstated" };
    }
  }

  // public/css/components/ai-label.css
  var ai_label_default = `/**
 * @file public/css/components/ai-label.css
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Styling for the ONE visible AI label (TARGET-058 Phase 3, components/ai-label.js).
 *   Every colour, radius and space is a theme.css token, so the badge flips with the theme and
 *   carries no hardcoded brand hex. Nothing here is \`rgba(255,255,255,…)\`, which reads correctly
 *   only on a dark background.
 *
 *   THE ICONS ARE LOCKUPS. \`aspect-ratio\` per icon, sized by HEIGHT with \`width: auto\`, because two
 *   of the three are wide badges containing the word "AI" and a square box would squash them. The
 *   ratios are the SVGs' own viewBoxes (1:1, 1789.84:566.93, 1700.79:566.93) and are duplicated in
 *   components/ai-label.js \`EU_ICONS\`, where a test compares the two.
 *
 *   MINIMUM SIZE IS A COMPLIANCE PROPERTY, NOT TASTE. The Code says "clearly visible size" without a
 *   number, so we pick one and enforce it: --ai-label-icon-h never drops below 18px, which keeps the
 *   letters legible at 390px width. It does not shrink on small screens; the chip wraps instead.
 *
 *   NOTHING MAY SIT ON TOP OF IT. The Code requires placement "where no intervening overlay elements
 *   exist". The label participates in normal flow inside the content it describes rather than
 *   floating, so it cannot be covered by app chrome or a toast; \`isolation: isolate\` keeps a
 *   descendant's z-index from escaping and a parent's stacking context from burying it.
 * @structure
 *   - .ai-label (+ --inline / --block / --interaction) — the wrapper
 *   - .ai-label__icon (+ per-icon aspect ratios) — the official EU glyph, theme-variant switched
 *   - .ai-label__text / __short / __long / __link
 * @usage preloaded from spa.html; classes emitted by /components/ai-label.js
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 3.
 */

.ai-label {
  --ai-label-icon-h: 20px;
  display: flex;
  align-items: center;
  gap: var(--sp-2, 8px);
  flex-wrap: wrap;
  isolation: isolate;
  min-width: 0;
  max-width: 100%;
  font-size: var(--text-sm);
  line-height: 1.35;
  color: var(--text-dim);
}

/* Inline chip: beside a title, in a record header, on a message. */
.ai-label--inline {
  padding: var(--sp-1, 4px) var(--sp-2, 8px);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--bg-dim);
}

/* Block banner: above a body of text, which is where Measure 1.2.2(f) puts it for published text
   ("above or at the top of the text, near the headline"). */
.ai-label--block,
.ai-label--interaction {
  --ai-label-icon-h: 24px;
  align-items: flex-start;
  padding: var(--sp-3, 12px);
  border: 1px solid var(--border);
  border-left: 3px solid var(--border-focus);
  border-radius: var(--radius-sm);
  background: var(--bg-dim);
  margin-bottom: var(--sp-3, 12px);
}

/* The Art. 50(1) notice has no icon, so its text starts at the border. */
.ai-label--interaction { align-items: center; }

.ai-label__icon {
  flex: 0 0 auto;
  height: var(--ai-label-icon-h);
  min-height: 18px;
  width: auto;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
}

/* Sized by height with the SVG's own ratio — a square box distorts two of the three lockups. */
.ai-label__icon--ai-basic {
  aspect-ratio: 566.93 / 566.93;
  background-image: url('/assets/eu-ai-icons/svg/ai-basic_black.svg');
}
.ai-label__icon--ai-generated {
  aspect-ratio: 1789.84 / 566.93;
  background-image: url('/assets/eu-ai-icons/svg/ai-generated_black.svg');
}
.ai-label__icon--ai-modified {
  aspect-ratio: 1700.79 / 566.93;
  background-image: url('/assets/eu-ai-icons/svg/ai-modified_black.svg');
}

/* Dark theme takes the white variants. The glyph is not localised and not restyled — our freedom is
   in the chip around it, never in the mark itself. */
[data-theme="dark"] .ai-label__icon--ai-basic {
  background-image: url('/assets/eu-ai-icons/svg/ai-basic_white.svg');
}
[data-theme="dark"] .ai-label__icon--ai-generated {
  background-image: url('/assets/eu-ai-icons/svg/ai-generated_white.svg');
}
[data-theme="dark"] .ai-label__icon--ai-modified {
  background-image: url('/assets/eu-ai-icons/svg/ai-modified_white.svg');
}

.ai-label__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  /* Long compliance sentences must wrap, never widen the page: an overflowing label is the classic
     way a badge turns into a horizontal scrollbar on a 390px viewport. */
  overflow-wrap: anywhere;
}

.ai-label__short {
  color: var(--text);
  /* The SDK bundle carries this sheet to app origins without theme.css: the fallback is the weight there. */
  font-weight: var(--weight-semibold, 600);
}

.ai-label__long { color: var(--text-dim); }

/* The interactive second layer the Code encourages. Underlined, not colour-only. */
.ai-label__link {
  flex: 0 0 auto;
  color: var(--text-dim);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.ai-label__link:hover,
.ai-label__link:focus-visible { color: var(--text); }

/* An inline chip on one line reads better with the text side by side. */
.ai-label--inline .ai-label__text { flex-direction: row; gap: var(--sp-2, 8px); align-items: baseline; }

@media (max-width: 640px) {
  /* Stack rather than shrink: the minimum icon size is a compliance property. */
  .ai-label--inline .ai-label__text { flex-direction: column; gap: 2px; }
}

@media (prefers-reduced-motion: no-preference) {
  .ai-label__link { transition: color 120ms ease; }
}
`;

  // locales/en.json
  var aiLabel = {
    short: "AI-generated",
    assisted: "AI-assisted",
    original: "Written by a person",
    unstated: "Origin unstated",
    chat: "You are talking to an AI assistant.",
    publicText: "This text was written by AI without human editorial review.",
    assistedLong: "A person wrote this. AI helped edit or refine it.",
    reviewedGeneric: "AI drafted this, and a person reviewed the substance.",
    originalLong: "A person wrote this. No AI was involved.",
    unstatedLong: "We do not know whether AI was involved in making this.",
    reviewed: "AI-drafted, reviewed by {{name}}.",
    reviewedShort: "AI-drafted, reviewed by a person.",
    detailsLink: "How this was made",
    policyLong: "A model was involved in making this. It is labelled here even where the law does not require it.",
    interactionTitle: "You are talking to an AI assistant",
    interactionBody: "It can be wrong, so check anything that matters. Your messages go to a language model on your own API key.",
    draftTitle: "This draft was written by AI",
    draftBody: "Read it before you send it. You are responsible for what goes out under your name.",
    regionLabel: "AI transparency",
    expand: "Show AI disclosure",
    iconAlt: {
      aiGenerated: "Content generated by AI",
      aiModified: "Content partially modified by AI",
      aiBasic: "AI was involved in making this content",
      unstated: "AI involvement unstated"
    }
  };

  // locales/fi.json
  var aiLabel2 = {
    short: "Tekoälyn tuottama",
    assisted: "Tekoälyavusteinen",
    original: "Ihmisen kirjoittama",
    unstated: "Alkuperää ei ole kerrottu",
    chat: "Keskustelet tekoälyavustajan kanssa.",
    publicText: "Tämän tekstin on kirjoittanut tekoäly ilman ihmisen toimituksellista tarkistusta.",
    assistedLong: "Tekstin on kirjoittanut ihminen. Tekoäly on ollut mukana sen muokkaamisessa.",
    reviewedGeneric: "Tekoäly on luonnostellut tämän, ja ihminen on tarkistanut sisällön.",
    originalLong: "Tämän on kirjoittanut ihminen. Tekoäly ei ole ollut mukana.",
    unstatedLong: "Emme tiedä, onko tekoäly ollut mukana tämän tekemisessä.",
    reviewed: "Tekoälyn luonnostelema, tarkistanut {{name}}.",
    reviewedShort: "Tekoälyn luonnostelema, ihmisen tarkistama.",
    detailsLink: "Miten tämä on tehty",
    policyLong: "Tämän tekemisessä on ollut mukana tekoälymalli. Se merkitään täällä silloinkin, kun laki ei sitä vaadi.",
    interactionTitle: "Keskustelet tekoälyavustajan kanssa",
    interactionBody: "Se voi erehtyä, joten tarkista tärkeät asiat. Viestisi menevät kielimallille omalla API-avaimellasi.",
    draftTitle: "Tämän luonnoksen on kirjoittanut tekoäly",
    draftBody: "Lue se ennen lähettämistä. Vastaat itse siitä, mitä nimissäsi lähtee.",
    regionLabel: "Tekoälyn läpinäkyvyystiedot",
    expand: "Näytä tekoälymerkintä",
    iconAlt: {
      aiGenerated: "Tekoälyn tuottamaa sisältöä",
      aiModified: "Sisältöä on osittain muokattu tekoälyllä",
      aiBasic: "Tekoäly on ollut mukana tämän sisällön tekemisessä",
      unstated: "Tekoälyn osuutta ei ole kerrottu"
    }
  };

  // locales/es.json
  var aiLabel3 = {
    short: "Generado por IA",
    assisted: "Con ayuda de IA",
    original: "Escrito por una persona",
    unstated: "Origen sin declarar",
    chat: "Estás hablando con un asistente de IA.",
    publicText: "Este texto lo escribió una IA sin que ninguna persona lo revisara.",
    assistedLong: "Lo escribió una persona. La IA ayudó a editarlo o a pulirlo.",
    reviewedGeneric: "La IA escribió el borrador y una persona revisó el contenido.",
    originalLong: "Lo escribió una persona. No intervino ninguna IA.",
    unstatedLong: "No sabemos si intervino una IA en esto.",
    reviewed: "Borrador de IA, revisado por {{name}}.",
    reviewedShort: "Borrador de IA, revisado por una persona.",
    detailsLink: "Cómo se hizo esto",
    policyLong: "Un modelo intervino en esto. Aquí se declara incluso donde la ley no lo exige.",
    interactionTitle: "Estás hablando con un asistente de IA",
    interactionBody: "Puede equivocarse, así que comprueba todo lo que te importe. Tus mensajes van a un modelo de lenguaje con tu propia clave de API.",
    draftTitle: "Este borrador lo escribió una IA",
    draftBody: "Léelo antes de enviarlo. Lo que salga con tu nombre es responsabilidad tuya.",
    regionLabel: "Transparencia sobre la IA",
    expand: "Ver la declaración sobre la IA",
    iconAlt: {
      aiGenerated: "Contenido generado por IA",
      aiModified: "Contenido modificado en parte por IA",
      aiBasic: "Una IA intervino en la creación de este contenido",
      unstated: "Intervención de la IA sin declarar"
    }
  };

  // src/static/sdk-libs/ai/strings.js
  var STRINGS2 = { en: aiLabel, fi: aiLabel2, es: aiLabel3 };
  function pick(key, loc) {
    const path = (key.startsWith("aiLabel.") ? key.slice("aiLabel.".length) : key).split(".");
    for (const bundle of [STRINGS2[loc], STRINGS2.en]) {
      const v = path.reduce((o, k) => o && typeof o === "object" ? o[k] : void 0, bundle);
      if (typeof v === "string") return v;
    }
    return key;
  }

  // src/static/sdk-libs/ai/disclose.js
  var STYLE_ID = "aimeat-ai-label-css";
  var APP_TOKENS = `
.ai-label{
  --text: var(--color-base-content, #1A1A2E);
  --text-dim: color-mix(in oklab, var(--color-base-content, #6B7280) 70%, transparent);
  --bg-dim: var(--color-base-200, #F3F4F6);
  --border: var(--color-base-300, #E5E7EB);
  --border-focus: var(--color-primary, #E8564A);
  --radius-sm: 10px; --radius-full: 9999px; --text-sm: 0.82rem;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]) .ai-label{
    --text: var(--color-base-content, #EDEEF2);
    --bg-dim: var(--color-base-200, #22242B);
    --border: var(--color-base-300, #33363F);
    --border-focus: var(--color-primary, #FF6F62);
  }
}`;
  function osDarkIcons(base) {
    const url = (stem) => `${base}/assets/eu-ai-icons/svg/${stem}_white.svg`;
    return `@media (prefers-color-scheme: dark){` + ["ai-basic", "ai-generated", "ai-modified"].map((s) => `:root:not([data-theme="light"]) .ai-label__icon--${s}{background-image:url('${url(s)}')}`).join("") + "}";
  }
  function locale() {
    const lang2 = storedLang() || document.documentElement.lang || "en";
    return lang2.slice(0, 2) === "fi" ? "fi" : "en";
  }
  function t(key) {
    return pick(key, locale());
  }
  function localized(block, field, fallbackKey) {
    const text = block && block[field];
    if (text && typeof text === "object") {
      const loc = locale();
      if (typeof text[loc] === "string") return text[loc];
      if (typeof text.en === "string") return text.en;
    }
    return t(fallbackKey);
  }
  function ensureStyles2() {
    if (document.getElementById(STYLE_ID)) return;
    const base = (APEX_URL || "").replace(/\/+$/, "");
    const css = base ? ai_label_default.replace(/url\((['"]?)\/assets\//g, (m, q) => `url(${q}${base}/assets/`) : ai_label_default;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = APP_TOKENS + css + (base ? osDarkIcons(base) : "");
    (document.head || document.documentElement).appendChild(st);
  }
  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  function targetOf(target) {
    if (!target) return null;
    return typeof target === "string" ? document.querySelector(target) : target;
  }
  function buildLabel(record, recordUrl, opts = {}) {
    const disclosure = record && record.disclosure;
    if (!disclosure || !disclosure.required) return null;
    const icon = euIconFor(record);
    if (!icon) return null;
    ensureStyles2();
    const variant = opts.variant === "block" ? "block" : "inline";
    const strength = disclosure.strength === "full" ? "full" : "light";
    const alt = t(icon.alt);
    const root = el("div", `ai-label ai-label--${variant} ai-label--${strength} ${opts.class || ""}`.trim());
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", t("aiLabel.regionLabel"));
    const glyph = el("span", `ai-label__icon ai-label__icon--${icon.file}`);
    glyph.setAttribute("role", "img");
    glyph.setAttribute("aria-label", alt);
    glyph.setAttribute("title", alt);
    root.appendChild(glyph);
    const textWrap = el("span", "ai-label__text");
    textWrap.appendChild(el("span", "ai-label__short", localized(disclosure, "short", "aiLabel.short")));
    const long = localized(disclosure, "long", "aiLabel.publicText");
    if (variant === "block" && strength === "full" && long) {
      textWrap.appendChild(el("span", "ai-label__long", long));
    }
    root.appendChild(textWrap);
    const url = recordUrl || record.attestation && record.attestation.recordUrl;
    if (url) {
      const a = el("a", "ai-label__link", t("aiLabel.detailsLink"));
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      root.appendChild(a);
    }
    return root;
  }
  function disclose(provenance, opts = {}) {
    if (!provenance) return null;
    const record = provenance.record || provenance;
    const recordUrl = provenance.recordUrl || record.attestation && record.attestation.recordUrl;
    const node = buildLabel(record, recordUrl, opts);
    const mount = targetOf(opts.target);
    if (mount) {
      mount.textContent = "";
      if (node) mount.appendChild(node);
    }
    return node;
  }
  function chatNotice(opts = {}) {
    ensureStyles2();
    const root = el("div", `ai-label ai-label--interaction ${opts.class || ""}`.trim());
    root.setAttribute("role", "note");
    const textWrap = el("span", "ai-label__text");
    textWrap.appendChild(el("span", "ai-label__short", opts.title || t("aiLabel.interactionTitle")));
    textWrap.appendChild(el("span", "ai-label__long", opts.body || t("aiLabel.interactionBody")));
    root.appendChild(textWrap);
    if (opts.recordUrl) {
      const a = el("a", "ai-label__link", t("aiLabel.detailsLink"));
      a.href = opts.recordUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      root.appendChild(a);
    }
    const mount = targetOf(opts.target);
    if (mount) {
      mount.textContent = "";
      mount.appendChild(root);
    }
    return root;
  }
  function declare(item, provenance) {
    if (!provenance || !item || typeof item !== "object") return item;
    const record = provenance.record || provenance;
    const recordUrl = provenance.recordUrl || record.attestation && record.attestation.recordUrl;
    return Object.assign({}, item, {
      aiProvenance: record,
      ...recordUrl ? { aiProvenanceUrl: recordUrl } : {}
    });
  }

  // src/static/sdk-libs/ai/job.js
  var { authFetch: authFetch2 } = makeSession("aimeat-ai.js");
  function jobError(r) {
    const code = r && r.error && r.error.code || "UNKNOWN";
    const said = r && r.error && r.error.message;
    const human = {
      AI_JOB_QUEUE_FULL: "The node is busy right now. Try again in a moment.",
      AI_JOB_LIMIT_REACHED: "You already have a lot of AI jobs waiting. Something may be looping — check the list before starting more.",
      AI_JOB_CHAIN_TOO_DEEP: "A chain of jobs kept calling itself and was stopped.",
      AI_JOB_PROMPT_TOO_LARGE: "The prompt and the records it reads are too big to send. Read fewer records, or smaller ones.",
      AI_JOB_CALLBACK_FORBIDDEN: "The on_done action does not belong to this account.",
      AI_JOB_ALREADY_TERMINAL: "That job has already finished; there is nothing left to stop.",
      NOT_FOUND: "No such job."
    }[code];
    const err = (
      /** @type {Error & { code?: string, retryAfterSeconds?: number }} */
      new Error(said || human || "The AI job call failed")
    );
    err.code = code;
    if (r && r.error && typeof r.error.retry_after_s === "number") err.retryAfterSeconds = r.error.retry_after_s;
    return err;
  }
  var TERMINAL = ["done", "failed", "cancelled"];
  var job = {
    /**
     * Start one. Returns `{ job_id, state, queue_position }` — a position, never an ETA, because
     * nobody knows how long a model will take.
     *
     * `result_key` is required and is where the answer lands, in the signed-in person's own
     * namespace. `input_keys` names records that are READ AND PASTED INTO the prompt: the model has no
     * tools and cannot fetch anything itself, and a record that does not exist is stated as missing so
     * it cannot be invented.
     *
     * Error codes on `.code`: AI_JOB_QUEUE_FULL (with `.retryAfterSeconds`), AI_JOB_LIMIT_REACHED,
     * AI_JOB_CHAIN_TOO_DEEP, AI_JOB_PROMPT_TOO_LARGE, AI_JOB_CALLBACK_FORBIDDEN, plus everything
     * AIMEAT.ai.complete() can raise about keys and budgets.
     */
    async start(opts) {
      if (!opts || typeof opts !== "object") throw new Error("opts object required");
      if (!opts.result_key) throw new Error("opts.result_key required");
      if (opts.op !== "transcribe" && !opts.prompt && !opts.prompt_key) throw new Error("opts.prompt or opts.prompt_key required");
      if (opts.op === "transcribe" && !opts.audio_key) throw new Error("opts.audio_key required for op transcribe");
      const body = {
        op: opts.op,
        provider: opts.provider,
        // The AI role the job's call runs as (GET /v1/ai/roles); a named model or provider wins over it.
        role: opts.role,
        audio_key: opts.audio_key,
        language: opts.language,
        size: opts.size,
        prompt: opts.prompt,
        prompt_key: opts.prompt_key,
        input_keys: opts.input_keys,
        result_key: opts.result_key,
        result_visibility: opts.result_visibility,
        model: opts.model,
        system_prompt: opts.system_prompt,
        json: opts.json,
        app_id: opts.app_id,
        on_done: opts.on_done
      };
      const r = await authFetch2("/v1/ai/jobs", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw jobError(r);
      return r.data;
    },
    /** One job's record: state, cost, where the answer went, and why it failed if it did. */
    async get(jobId) {
      if (!jobId) throw new Error("jobId required");
      const r = await authFetch2("/v1/ai/jobs/" + encodeURIComponent(jobId));
      if (!r || !r.ok) throw jobError(r);
      return r.data;
    },
    /** The jobs. `state` defaults to the live ones (queued + running). */
    async list(opts) {
      const q = new URLSearchParams();
      if (opts && opts.state) q.set("state", opts.state);
      if (opts && opts.limit) q.set("limit", String(opts.limit));
      const qs = q.toString();
      const r = await authFetch2("/v1/ai/jobs" + (qs ? "?" + qs : ""));
      if (!r || !r.ok) throw jobError(r);
      return r.data && r.data.jobs || [];
    },
    /** Stop one, queued or running. A finished job raises AI_JOB_ALREADY_TERMINAL. */
    async cancel(jobId) {
      if (!jobId) throw new Error("jobId required");
      const r = await authFetch2("/v1/ai/jobs/" + encodeURIComponent(jobId) + "/cancel", { method: "POST", body: "{}" });
      if (!r || !r.ok) throw jobError(r);
      return r.data;
    },
    /**
     * Poll until the job is done, failed or cancelled, and hand back its record.
     *
     * A convenience over `get`, not a different mechanism: the tab may still close, and the job
     * carries on regardless. `onState` is called each time the state changes, which is what a progress
     * line in the UI wants. `timeoutMs` gives up WAITING; it never cancels the job, because a caller
     * that stopped watching has not decided to throw the answer away — call `cancel()` for that.
     */
    async waitFor(jobId, opts) {
      const intervalMs = opts && opts.intervalMs || 3e3;
      const timeoutMs = opts && opts.timeoutMs || 30 * 6e4;
      const onState = opts && opts.onState;
      const startedAt = Date.now();
      let last = null;
      for (; ; ) {
        const rec = await job.get(jobId);
        if (rec && rec.state !== last) {
          last = rec.state;
          if (onState) onState(rec.state, rec);
        }
        if (rec && TERMINAL.indexOf(rec.state) >= 0) return rec;
        if (Date.now() - startedAt > timeoutMs) {
          const err = (
            /** @type {Error & { code?: string }} */
            new Error("Stopped waiting for the AI job; it is still running. Read it later with AIMEAT.ai.job.get().")
          );
          err.code = "AI_JOB_WAIT_TIMEOUT";
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  };

  // src/static/sdk-libs/ai/call.js
  var { authFetch: authFetch3 } = makeSession("aimeat-ai.js");
  function aiError(r, fallback) {
    const e = r && r.error;
    const err = (
      /** @type {Error & { code?: string, details?: any, fix?: string, settingsUrl?: string, reason?: string }} */
      new Error(e && e.message || fallback)
    );
    err.code = e && e.code || "UNKNOWN";
    if (e && e.details !== void 0 && e.details !== null) {
      err.details = e.details;
      if (typeof e.details.fix === "string") err.fix = e.details.fix;
      if (typeof e.details.settingsUrl === "string") err.settingsUrl = e.details.settingsUrl;
      if (typeof e.details.reason === "string") err.reason = e.details.reason;
    }
    return err;
  }
  function withProvenance(r) {
    return r.meta && r.meta.provenance ? { ...r.data, provenance: r.meta.provenance } : r.data;
  }
  async function postJson(path, body, fallback) {
    const r = await authFetch3(path, { method: "POST", body: JSON.stringify(body) });
    if (!r || !r.ok) throw aiError(r, fallback);
    if (r.data) noteBudget(r.data.budget);
    return withProvenance(r);
  }
  function paid(opts, how, call) {
    const run = async () => {
      if (opts.confirm) {
        const c = typeof opts.confirm === "object" ? opts.confirm : {};
        let estimate = c.estimate;
        if (!estimate && how.estimate) {
          try {
            estimate = await how.estimate();
          } catch {
            estimate = void 0;
          }
        }
        const okToSpend = await confirmSpend({
          what: c.what || how.what,
          detail: c.detail,
          estimate,
          remaining: c.remaining,
          okLabel: c.okLabel,
          cancelLabel: c.cancelLabel,
          remember: c.remember || how.remember || "ai:" + (opts.app_id || "app")
        });
        if (!okToSpend) throw cancelledError(how.label || "The AI request");
      }
      return call();
    };
    if (opts.allowDuplicate) return run();
    return once(keyOf(how.key), run, { ttlMs: opts.dedupeMs || 0 });
  }
  function isBlob(v) {
    return typeof Blob !== "undefined" && v instanceof Blob;
  }
  async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }
  async function blobToDataUrl(blob) {
    return "data:" + (blob.type || "application/octet-stream") + ";base64," + await blobToBase64(blob);
  }

  // src/static/sdk-libs/ai/capabilities.js
  var { authFetch: authFetch4 } = makeSession("aimeat-ai.js");
  var _capsCache = /* @__PURE__ */ new Map();
  var _modelsCache = /* @__PURE__ */ new Map();
  async function capabilities(opts) {
    const o = typeof opts === "string" ? { app_id: opts } : opts || {};
    const appId = o.app_id || "";
    const now = Date.now();
    const hit = _capsCache.get(appId);
    if (!o.fresh && hit && now - hit.t < 6e4) return hit.v;
    const r = await authFetch4("/v1/ai/capabilities" + (appId ? "?app_id=" + encodeURIComponent(appId) : ""));
    if (!r || !r.ok) throw aiError(r, "Could not read what the AI can do");
    _capsCache.set(appId, { v: r.data, t: now });
    return r.data;
  }
  function priceEstimate(state2, units) {
    const p = state2 && state2.price;
    if (!p) return void 0;
    const n = typeof p.perImage === "number" ? p.perImage * (units || 1) : typeof p.speechPerChar === "number" && units ? p.speechPerChar * units : typeof p.transcriptionPerSecond === "number" && units ? p.transcriptionPerSecond * units : void 0;
    if (typeof n !== "number" || !isFinite(n)) return void 0;
    return "~$" + (n < 0.01 ? n.toFixed(4) : n.toFixed(2));
  }
  function compatRow(m) {
    const price = m.price || {};
    const perToken = (v) => typeof v === "number" ? String(v / 1e6) : void 0;
    const pricing = typeof price.inPerMtok === "number" || typeof price.outPerMtok === "number" ? { prompt: perToken(price.inPerMtok), completion: perToken(price.outPerMtok) } : void 0;
    return { ...m, context_length: m.limits ? m.limits.context : void 0, ...pricing ? { pricing } : {} };
  }
  async function models(opts) {
    const o = opts || {};
    const q = new URLSearchParams();
    q.set("capability", o.capability || "text");
    if (o.type) q.set("type", o.type);
    if (o.status) q.set("status", o.status);
    if (o.allowed !== false) q.set("allowed", "true");
    const qs = q.toString();
    const now = Date.now();
    const hit = _modelsCache.get(qs);
    if (hit && now - hit.t < 36e5) return hit.v;
    const r = await authFetch4("/v1/ai/models?" + qs);
    if (!r || !r.ok) throw aiError(r, "Failed to list models");
    const v = (r.data && Array.isArray(r.data.models) ? r.data.models : []).map(compatRow);
    _modelsCache.set(qs, { v, t: now });
    return v;
  }
  async function roles() {
    const r = await authFetch4("/v1/ai/roles");
    if (!r || !r.ok) throw aiError(r, "Could not read the AI roles");
    return r.data;
  }
  function clearCaches() {
    _capsCache.clear();
    _modelsCache.clear();
  }

  // src/static/sdk-libs/ai/stream.js
  async function postStream(path, body, signal) {
    const session = (
      /** @type {any} */
      getSession("aimeat-ai.js")
    );
    const send = () => fetch(NODE_URL + path, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.jwt },
      body: JSON.stringify(body)
    });
    let response = await send();
    if (response.status === 401 && typeof session.refresh === "function") {
      await session.refresh();
      if (signal) signal.throwIfAborted();
      response = await send();
    }
    if (!response.ok) {
      const envelope = await response.json().catch(() => null);
      throw aiError(envelope, "The AI stream failed (HTTP " + response.status + ")");
    }
    if (!response.body) throw aiError(null, "The AI stream returned no body");
    return response;
  }
  async function* ndjson(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let done = false;
    try {
      for (; ; ) {
        const chunk = await reader.read();
        pending += decoder.decode(chunk.value, { stream: !chunk.done });
        if (pending.length > 2e6) throw aiError({ error: { code: "STREAM_FRAME_TOO_LARGE" } }, "An AI stream line exceeds 2 MB");
        let end;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "error") throw aiError({ error: { code: event.code, message: event.message } }, "The AI stream failed");
          if (event.type === "done") {
            done = true;
            if (event.budget) noteBudget(event.budget);
          }
          yield event;
        }
        if (chunk.done) break;
      }
      if (!done || pending.trim()) throw aiError({ error: { code: "STREAM_INCOMPLETE" } }, "The AI stream ended before it finished");
    } finally {
      try {
        await reader.cancel();
      } catch {
      }
      reader.releaseLock();
    }
  }
  function withoutType(event) {
    const out = { ...event };
    delete out.type;
    return out;
  }
  async function stream(opts) {
    if (!opts || typeof opts !== "object") throw new Error("opts object required");
    const messages = Array.isArray(opts.messages) ? opts.messages : opts.prompt ? [...opts.systemPrompt ? [{ role: "system", content: String(opts.systemPrompt) }] : [], { role: "user", content: String(opts.prompt) }] : null;
    if (!messages || !messages.length) throw new Error("opts.messages or opts.prompt required");
    const body = {
      app_id: opts.app_id,
      messages,
      model: opts.model,
      temperature: opts.temperature,
      top_p: opts.top_p,
      max_tokens: opts.max_tokens,
      reasoning: opts.reasoning,
      role: typeof opts.role === "string" && opts.role ? opts.role : void 0
    };
    return paid(opts, {
      key: ["ai-stream", opts.app_id, opts.model, opts.role, JSON.stringify(messages)],
      what: "Run an AI request on your own AI provider."
    }, async () => {
      const response = await postStream("/v1/ai/stream", body, opts.signal);
      let content = "";
      let start = null;
      let done = null;
      for await (const event of ndjson(response)) {
        if (event.type === "start") start = event;
        else if (event.type === "text" && typeof event.text === "string") {
          content += event.text;
          if (opts.onText) opts.onText(event.text, content);
        } else if (event.type === "done") done = event;
      }
      const rest = withoutType(done);
      return { ...rest, content, model: rest.model || start && start.model };
    });
  }
  var SPEECH_MIME = { mp3: "audio/mpeg", pcm: "audio/pcm" };
  async function speak(opts) {
    if (!opts || typeof opts !== "object") throw new Error("opts object required");
    const input = opts.input != null ? opts.input : opts.text;
    if (!input) throw new Error("opts.input required");
    const format = opts.format || opts.response_format || "mp3";
    const body = {
      app_id: opts.app_id,
      input: String(input),
      model: opts.model,
      voice: opts.voice,
      response_format: format,
      speed: opts.speed,
      instructions: opts.instructions,
      role: typeof opts.role === "string" && opts.role ? opts.role : void 0
    };
    return paid(opts, {
      key: ["ai-speak", opts.app_id, opts.model, opts.voice, format, opts.role, opts.store ? "store" : "", String(input)],
      what: "Read text aloud on your own AI provider.",
      remember: "ai-speak:" + (opts.app_id || "app"),
      estimate: async () => {
        const caps = await capabilities({ app_id: opts.app_id });
        return priceEstimate(caps && caps.capabilities && caps.capabilities.speech, Array.from(String(input)).length);
      }
    }, async () => {
      if (opts.store) return postJson("/v1/ai/speak?json=1", body, "Speech failed");
      const response = await postStream("/v1/ai/speak", body, opts.signal);
      const chunks = [];
      let bytes = 0;
      let done = null;
      for await (const event of ndjson(response)) {
        if (event.type === "audio" && typeof event.data === "string") {
          const chunk = Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0));
          chunks.push(chunk);
          bytes += chunk.length;
          if (opts.onAudio) opts.onAudio(chunk);
        } else if (event.type === "done") done = event;
      }
      const mime = SPEECH_MIME[format] || "application/octet-stream";
      const rest = withoutType(done);
      return { ...rest, blob: new Blob(chunks, { type: mime }), mime_type: mime, format, bytes };
    });
  }

  // src/static/sdk-libs/ai/media.js
  function routing(opts) {
    return {
      ...typeof opts.provider === "string" && opts.provider ? { provider: opts.provider } : {},
      ...typeof opts.fallback === "boolean" ? { fallback: opts.fallback } : {},
      ...typeof opts.role === "string" && opts.role ? { role: opts.role } : {}
    };
  }
  async function image(opts) {
    if (!opts || typeof opts !== "object") throw new Error("opts object required");
    if (!opts.prompt) throw new Error("opts.prompt required");
    const body = {
      prompt: opts.prompt,
      model: opts.model,
      size: opts.size,
      storage_key: opts.storage_key,
      public: opts.public === true ? true : void 0,
      app_id: opts.app_id,
      ...routing(opts)
    };
    return paid(opts, {
      key: ["ai-image", opts.app_id, opts.model, opts.size, opts.storage_key, opts.provider, opts.role, opts.prompt],
      what: "Make a picture on your own AI provider.",
      label: "The picture",
      remember: "ai-image:" + (opts.app_id || "app"),
      estimate: async () => {
        const caps = await capabilities({ app_id: opts.app_id });
        return priceEstimate(caps && caps.capabilities && caps.capabilities.image, 1);
      }
    }, async () => {
      const data = await postJson("/v1/ai/image", body, "The picture could not be made");
      return data && typeof data === "object" ? { ...data, src: data.download_url || data.url } : data;
    });
  }
  async function transcribe(opts) {
    if (!opts || typeof opts !== "object") throw new Error("opts object required");
    if (!opts.storage_key && !opts.audio) throw new Error("opts.storage_key or opts.audio required");
    const blob = isBlob(opts.audio) ? (
      /** @type {Blob} */
      opts.audio
    ) : null;
    const audio = blob ? await blobToBase64(blob) : typeof opts.audio === "string" ? opts.audio : void 0;
    const body = {
      ...opts.storage_key ? { storage_key: opts.storage_key } : { audio_base64: audio },
      mime: opts.mime || blob && blob.type || void 0,
      filename: opts.filename || blob && /** @type {any} */
      blob.name || void 0,
      model: opts.model,
      language: opts.language,
      temperature: opts.temperature,
      verbose: opts.verbose,
      app_id: opts.app_id,
      ...routing(opts)
    };
    return paid(opts, {
      key: ["ai-transcribe", opts.app_id, opts.model, opts.language, opts.role, opts.storage_key || audio || ""],
      what: "Turn a recording into text on your own AI provider.",
      label: "The transcription",
      remember: "ai-transcribe:" + (opts.app_id || "app")
    }, () => postJson("/v1/ai/transcribe", body, "Transcription failed"));
  }
  async function embed(opts) {
    if (!opts || typeof opts !== "object") throw new Error("opts object required");
    if (opts.input == null || Array.isArray(opts.input) && !opts.input.length) throw new Error("opts.input required");
    const body = { input: opts.input, model: opts.model, app_id: opts.app_id, ...routing(opts) };
    return paid(opts, {
      key: ["ai-embed", opts.app_id, opts.model, opts.provider, opts.role, JSON.stringify(opts.input)],
      what: "Make embeddings on your own AI provider.",
      label: "The embedding",
      remember: "ai-embed:" + (opts.app_id || "app")
    }, () => postJson("/v1/ai/embed", body, "Embedding failed"));
  }

  // src/static/sdk-libs/ai/index.js
  var { authFetch: authFetch5 } = makeSession("aimeat-ai.js");
  var _availCache = null;
  async function callFiles(files) {
    if (files === void 0 || files === null) return void 0;
    const list = Array.isArray(files) ? files : [files];
    if (!list.length) return void 0;
    return Promise.all(list.map(async (f) => {
      if (isBlob(f)) return { data_url: await blobToDataUrl(f), .../** @type {any} */
      f.name ? { filename: (
        /** @type {any} */
        f.name
      ) } : {} };
      if (typeof f === "string") return f.startsWith("data:") ? { data_url: f } : { storage_key: f };
      return f;
    }));
  }
  function requiredKeysOf(schema) {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
    if (schema.properties && typeof schema.properties === "object") {
      const declared = Object.keys(schema.properties);
      const required = Array.isArray(schema.required) ? schema.required.filter((k) => typeof k === "string") : null;
      return required && required.length ? required : declared;
    }
    return Object.keys(schema);
  }
  function conform(parsed, want) {
    if (!want.length) return parsed;
    const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
    const has = (v) => isObj(v) && want.every((k) => k in v);
    if (has(parsed)) return parsed;
    if (isObj(parsed)) {
      const keys = Object.keys(parsed);
      if (keys.length === 1 && has(parsed[keys[0]])) return parsed[keys[0]];
    }
    const missing = want.filter((k) => !(isObj(parsed) && k in parsed));
    const present = isObj(parsed) ? Object.keys(parsed).join(", ") || "(none)" : typeof parsed;
    const err = (
      /** @type {Error & { code?: string }} */
      new Error("missing " + missing.join(", ") + "; got " + present)
    );
    err.code = "JSON_SCHEMA_MISMATCH";
    throw err;
  }
  var ai = {
    /**
     * What the person's AI can do for this app, per capability (text, vision, files, image, speech,
     * transcription, embed): { on, model, price, ... } when on, { on: false, reason, fix, settingsUrl }
     * when off. Ask this before showing a button that needs a capability; when it is off, show `fix`
     * (the person's sentence, in their language) and a link to `settingsUrl` (their AI settings, opened
     * where the fix is). A refused call's error carries the same as err.fix and err.settingsUrl.
     * Cached 60 seconds per app_id.
     *
     *   const caps = await AIMEAT.ai.capabilities({ app_id: 'my-app' });
     *   const img = caps.capabilities.image;
     *   if (!img.on) { notice.textContent = img.fix; link.href = img.settingsUrl; }
     */
    capabilities,
    /**
     * Returns true if the user has AI configured (an OpenRouter key, or a keyless
     * self-hosted provider). Cached 60 seconds. Apps should call this before showing
     * "Use AI" buttons. Uses GET /v1/ai/available, which an app-grant token (a sandboxed
     * app on the isolated app origin) can call with the ai:use scope — unlike the
     * owner-only /v1/openrouter/settings. Falls back to that settings probe on older nodes.
     */
    async isAvailable() {
      const now = Date.now();
      if (_availCache && now - _availCache.t < 6e4) return _availCache.v;
      try {
        const r = await authFetch5("/v1/ai/available");
        if (r && r.ok && r.data && typeof r.data.available === "boolean") {
          _availCache = { v: r.data.available, t: now };
          return r.data.available;
        }
        const s = await authFetch5("/v1/openrouter/settings");
        const v = !!(s && s.ok && s.data && (s.data.hasApiKey || s.data.has_api_key));
        _availCache = { v, t: now };
        return v;
      } catch {
        return false;
      }
    },
    /**
     * Run a single completion. Returns { content, model, usage, budget, finish_reason, truncated,
     * route, policy_chose_model? }.
     * `truncated` is true when the provider cut the answer at a token limit (finish_reason 'length'):
     * show it as unfinished or ask again, never as the whole answer.
     * `route` says who answered: { capability, chosenBy, answeredBy: { provider, model }, attempts,
     * fellBack }; `fellBack` is true when the first provider failed and another one answered.
     * `policy_chose_model` is true when the owner's model policy replaced the model the call asked for.
     * Throws an Error with .code set on quota/permission/auth failures, and `.details` when the node
     * says more (a policy refusal lists the models it would allow).
     *
     * `images`: an array of data: or https: URLs (at most 8; downscale first) turns the call into a
     * vision request, answered by the owner's vision model.
     *
     * `files`: documents the model reads itself (a PDF, a spreadsheet), at most 5 and 20 MB in all.
     * Each is a storage key of the person's own file, a data: URL, a Blob or File, or an object
     * { storage_key } | { data_url, filename }. Needs the files capability (see capabilities()).
     *
     * `provider` names one of the owner's providers (its id, or a type such as 'anthropic') and
     * `fallback: false` keeps the call on that one provider. Neither can add a provider or loosen
     * the owner's rules.
     *
     * `role` names the AI role the call runs as: for an app, a role it declares in its aimeat-ai meta
     * (role.<name>=text), which runs once the owner bound it to one of theirs; a named model or
     * provider wins over it. See roles().
     *
     * This spends the signed-in user's own money on their own AI provider, so two guards ride along:
     *   • repeats collapse — while an identical call (same app_id + model + prompts) is in flight,
     *     every further call gets the SAME promise. Five clicks on "Summarise" = one paid call.
     *     `allowDuplicate: true` opts out; `dedupeMs: N` also returns the result to a click made
     *     within N ms of the first one finishing.
     *   • `confirm: true` (or an object passed straight to AIMEAT.spend.confirm) asks the user
     *     first — use it for batches and anything the user did not directly click for. A cancel
     *     rejects with `.code === 'SPEND_CANCELLED'`.
     *
     * Recognized error codes (see routes/ai.ts):
     *   NO_API_KEY            — user hasn't set up a key yet
     *   QUOTA_EXHAUSTED       — daily user budget hit
     *   APP_QUOTA_EXHAUSTED   — per-app daily quota hit
     *   APP_NOT_ALLOWED       — app_id not in user's allowlist
     *   APP_ID_REQUIRED       — user has an allowlist; app must pass app_id
     *   INVALID_API_KEY       — provider rejected the key
     *   RATE_LIMITED          — provider rate limit
     *   PROVIDER_ERROR        — upstream provider failed
     *   SPEND_CANCELLED       — the user declined the confirm dialog
     *   AI_ROLE_NOT_BOUND     — the owner has not bound this app's role yet (.details.binding)
     *   AI_ROLE_NOT_DECLARED  — the app's meta does not declare that role
     *   AI_ROLE_UNKNOWN       — the owner has no role of that id
     *   AI_ROLE_LACKS_CAPABILITY — the role has no provider for what the call needs
     */
    async complete(opts) {
      if (!opts || typeof opts !== "object") throw new Error("opts object required");
      if (!opts.prompt) throw new Error("opts.prompt required");
      const files = await callFiles(opts.files);
      const body = {
        prompt: opts.prompt,
        systemPrompt: opts.systemPrompt,
        model: opts.model,
        modelRole: opts.modelRole,
        temperature: opts.temperature,
        top_p: opts.top_p,
        max_tokens: opts.max_tokens,
        app_id: opts.app_id,
        // Pictures for a vision request: data: or https: URLs, at most 8 (the route refuses more).
        // POST /v1/ai/complete has read this since 2026-06-24 and this body never carried it, so a
        // question about a picture went out as text alone and the model answered it anyway.
        images: Array.isArray(opts.images) ? opts.images : void 0,
        // Documents the model reads itself (the files capability), and the caller's word on which
        // provider answers. Absent keys are dropped by JSON.stringify, so a call without them sends
        // the same body as before.
        files,
        ...routing(opts)
      };
      return paid(opts, {
        key: [
          "ai",
          opts.app_id,
          opts.model || opts.modelRole,
          opts.systemPrompt,
          opts.prompt,
          Array.isArray(opts.images) ? opts.images.join("\n") : "",
          files ? JSON.stringify(files) : "",
          opts.provider || "",
          opts.role || ""
        ],
        what: "Run an AI request on your own AI provider."
      }, () => postJson("/v1/ai/complete", body, "AI call failed"));
    },
    /**
     * Convenience: complete + JSON.parse. Adds a "return ONLY valid JSON"
     * suffix to systemPrompt. On parse failure, retries ONCE with a stronger
     * instruction. Further failures throw — the user can retry by clicking.
     *
     * `schema` states the shape you need back: either a JSON-Schema object
     * (`{ type: 'object', properties: { … }, required: [ … ] }`) or a plain
     * example object whose keys are the keys you want. Three build specs have
     * advertised this parameter since July while no code path read it, because
     * complete() builds its body from a fixed field list — so it was dropped on
     * the way in and the caller got an unvalidated 200 under the model's own key
     * names. That reads as a bug in the app, since nothing points at the library.
     * The shape now reaches the model, the answer is checked against it, and a
     * miss is retried once the way a parse failure is. Two misses throw
     * JSON_SCHEMA_MISMATCH naming the keys that never arrived.
     *
     * A model that wraps the answer in one extra key is unwrapped rather than
     * refused: it is the commonest way a model complies in spirit, and it is what
     * every app here hand-rolls today.
     */
    async completeJson(opts) {
      const want = requiredKeysOf(opts && opts.schema);
      const shape = opts && opts.schema ? "\nReturn an object with exactly this shape, using these key names: " + JSON.stringify(opts.schema) : "";
      const suffix = "\nReturn ONLY valid JSON, no prose, no markdown fences." + shape;
      const read = (r) => ({ ...r, parsed: conform(JSON.parse(r.content), want) });
      const first = await ai.complete({
        ...opts,
        systemPrompt: (opts.systemPrompt || "") + suffix
      });
      try {
        return read(first);
      } catch {
        const insist = want.length ? "\nIMPORTANT: your previous attempt did not match the requested shape. Output ONLY the JSON object, starting with { and ending with }, with exactly these top-level keys: " + want.join(", ") + "." : "\nIMPORTANT: your previous attempt was not valid JSON. Output ONLY the JSON object, starting with { and ending with }. No other text.";
        const retry = await ai.complete({
          ...opts,
          systemPrompt: (opts.systemPrompt || "") + suffix + insist,
          temperature: typeof opts.temperature === "number" ? Math.max(0, opts.temperature - 0.3) : 0.2
        });
        try {
          return read(retry);
        } catch (e) {
          const mismatch = !!e && /** @type {any} */
          e.code === "JSON_SCHEMA_MISMATCH";
          const err = (
            /** @type {Error & { code?: string }} */
            new Error(mismatch ? "AI returned JSON without the requested keys twice (" + /** @type {any} */
            e.message + "). Original response: " + retry.content.slice(0, 200) : "AI returned invalid JSON twice. Original response: " + retry.content.slice(0, 200))
          );
          err.code = mismatch ? "JSON_SCHEMA_MISMATCH" : "JSON_PARSE_FAILED";
          throw err;
        }
      }
    },
    /**
     * A text reply piece by piece: onText(delta, soFar) per piece, and the promise resolves with
     * { content, model, finish_reason, truncated, usage, budget, provenance }.
     *
     *   await AIMEAT.ai.stream({ app_id, prompt, onText: (d, all) => { out.textContent = all; } });
     */
    stream,
    /**
     * A picture from a prompt, stored in the person's storage: { storage_key, url, model, route, ... }.
     * Pass confirm: true; the dialog shows the price per picture when the catalogue knows it.
     */
    image,
    /**
     * Speech from text: { blob, mime_type, format, bytes, model, ... } (mp3 by default).
     * onAudio(bytes) per chunk for early playback; store: true keeps it as a private file instead.
     */
    speak,
    /** Text from a recording: { text, language, seconds, model, route, ... }. */
    transcribe,
    /** Vectors for texts, for search by meaning: { embeddings, model, dimensions, route, ... }. */
    embed,
    /**
     * The models a capability can use: models({ capability: 'image' }). Default: the text models
     * this caller can use now. Rows are { ref, type, id, name, caps, limits, price, status } plus
     * context_length and pricing in the old OpenRouter listing's form. Cached 1 hour per query.
     */
    models,
    /**
     * The person's AI roles and the roles apps declare, with the owner's bindings (GET /v1/ai/roles):
     * { roles, apps: [{ app, roles: [{ name, binding, boundTo, requestedAt? }] }] }. An app's role runs
     * once boundTo is set; until then a call with that `role` is refused AI_ROLE_NOT_BOUND.
     */
    roles,
    /**
     * Today's spend snapshot (owner-only). Useful for "AI used: $0.04 / $1.00".
     */
    async usage() {
      const r = await authFetch5("/v1/ai/usage");
      if (!r || !r.ok) throw new Error(r && r.error && r.error.message || "Failed to read usage");
      return r.data;
    },
    /**
     * Clear browser-side caches. Call after the user toggles their key/budget.
     */
    invalidateCache() {
      _availCache = null;
      clearCaches();
    },
    /**
     * Show the user that a model made this. ONE call, no styling decisions.
     *
     *   const r = await AIMEAT.ai.complete({ app_id: 'my-app', prompt });
     *   render(r.content);
     *   AIMEAT.ai.disclose(r.provenance, { target: '#answer-label' });
     *
     * Renders the same badge the platform renders — same official EU icon, same stylesheet, same theme
     * variables — so it follows your app's light/dark mode for free. It returns null and draws nothing
     * when the content owes no label; the legal test already happened on the server, so pass the
     * record and let this decide. `variant: 'block'` gives the banner form for a body of text; the
     * default inline chip suits a title row or a card.
     */
    disclose,
    /**
     * The first-message notice for a chat surface: "you are talking to an AI assistant."
     *
     *   AIMEAT.ai.chatNotice({ target: '#chat-top' });
     *
     * Owed the moment a conversation opens, so it takes no record and is never suppressed.
     */
    chatNotice,
    /**
     * Keep the record with the content when you store or publish it.
     *
     *   await AIMEAT.data.set(key, AIMEAT.ai.declare({ text: r.content }, r.provenance));
     *
     * Returns a new object carrying `aiProvenance`, so anything that reads the record later — your own
     * app, another app, an agent — can still say how it was made.
     */
    declare,
    /**
     * Background jobs: a model call with a handle, for anything that may take minutes.
     *
     *   const { job_id } = await AIMEAT.ai.job.start({ prompt, result_key: 'report.latest' });
     *   const done = await AIMEAT.ai.job.waitFor(job_id);
     *
     * complete() above is right when the answer arrives in seconds and wrong when it does not: a tab
     * that navigates away, a laptop that sleeps or a proxy that gives up takes the answer with it, and
     * the money is spent either way. A job survives all three, and its answer is waiting at
     * `result_key` whenever the app comes back.
     */
    job
  };
  attach("ai", ai);
  attachSpend();
})();
