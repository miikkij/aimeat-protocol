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
    return cfg().baseUrl;
  }
  var NODE_URL = resolveNodeUrl();
  var APEX_URL = cfg().baseUrl;
  var NODE_ID = cfg().nodeId;
  var HEARTBEAT_MS = cfg().heartbeatMs || 3e4;

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
  font-weight: 600;
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
    const stored = (() => {
      try {
        return localStorage.getItem("aimeat-lang");
      } catch {
        return null;
      }
    })();
    const lang2 = stored || document.documentElement.lang || "en";
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

  // src/static/sdk-libs/ai/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-ai.js");
  var _availCache = null;
  var _modelsCache = null;
  var ai = {
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
        const r = await authFetch2("/v1/ai/available");
        if (r && r.ok && r.data && typeof r.data.available === "boolean") {
          _availCache = { v: r.data.available, t: now };
          return r.data.available;
        }
        const s = await authFetch2("/v1/openrouter/settings");
        const v = !!(s && s.ok && s.data && (s.data.hasApiKey || s.data.has_api_key));
        _availCache = { v, t: now };
        return v;
      } catch {
        return false;
      }
    },
    /**
     * Run a single completion. Returns { content, model, usage, budget }.
     * Throws an Error with .code set on quota/permission/auth failures.
     *
     * This spends the signed-in user's own OpenRouter money, so two guards ride along:
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
     */
    async complete(opts) {
      if (!opts || typeof opts !== "object") throw new Error("opts object required");
      if (!opts.prompt) throw new Error("opts.prompt required");
      const body = {
        prompt: opts.prompt,
        systemPrompt: opts.systemPrompt,
        model: opts.model,
        modelRole: opts.modelRole,
        temperature: opts.temperature,
        top_p: opts.top_p,
        max_tokens: opts.max_tokens,
        app_id: opts.app_id
      };
      const call = async () => {
        if (opts.confirm) {
          const c = typeof opts.confirm === "object" ? opts.confirm : {};
          const okToSpend = await confirmSpend({
            what: c.what || "Run an AI request on your own OpenRouter key.",
            detail: c.detail,
            estimate: c.estimate,
            remaining: c.remaining,
            okLabel: c.okLabel,
            cancelLabel: c.cancelLabel,
            remember: c.remember || "ai:" + (opts.app_id || "app")
          });
          if (!okToSpend) throw cancelledError("The AI request");
        }
        const r = await authFetch2("/v1/ai/complete", {
          method: "POST",
          body: JSON.stringify(body)
        });
        if (!r || !r.ok) {
          const code = r && r.error && r.error.code || "UNKNOWN";
          const msg = r && r.error && r.error.message || "AI call failed";
          const err = (
            /** @type {Error & { code?: string }} */
            new Error(msg)
          );
          err.code = code;
          throw err;
        }
        if (r.data) noteBudget(r.data.budget);
        return r.meta && r.meta.provenance ? { ...r.data, provenance: r.meta.provenance } : r.data;
      };
      if (opts.allowDuplicate) return call();
      const key = keyOf(["ai", opts.app_id, opts.model || opts.modelRole, opts.systemPrompt, opts.prompt]);
      return once(key, call, { ttlMs: opts.dedupeMs || 0 });
    },
    /**
     * Convenience: complete + JSON.parse. Adds a "return ONLY valid JSON"
     * suffix to systemPrompt. On parse failure, retries ONCE with a stronger
     * instruction. Further failures throw — the user can retry by clicking.
     */
    async completeJson(opts) {
      const suffix = "\nReturn ONLY valid JSON, no prose, no markdown fences.";
      const first = await ai.complete({
        ...opts,
        systemPrompt: (opts.systemPrompt || "") + suffix
      });
      try {
        return { ...first, parsed: JSON.parse(first.content) };
      } catch {
        const retry = await ai.complete({
          ...opts,
          systemPrompt: (opts.systemPrompt || "") + suffix + "\nIMPORTANT: your previous attempt was not valid JSON. Output ONLY the JSON object, starting with { and ending with }. No other text.",
          temperature: typeof opts.temperature === "number" ? Math.max(0, opts.temperature - 0.3) : 0.2
        });
        try {
          return { ...retry, parsed: JSON.parse(retry.content) };
        } catch {
          const err = (
            /** @type {Error & { code?: string }} */
            new Error("AI returned invalid JSON twice. Original response: " + retry.content.slice(0, 200))
          );
          err.code = "JSON_PARSE_FAILED";
          throw err;
        }
      }
    },
    /**
     * List the models the user's account can hit. Cached 1 hour.
     */
    async models() {
      const now = Date.now();
      if (_modelsCache && now - _modelsCache.t < 36e5) return _modelsCache.v;
      const r = await authFetch2("/v1/openrouter/models");
      if (!r || !r.ok) throw new Error(r && r.error && r.error.message || "Failed to list models");
      const v = r.data && r.data.models ? r.data.models : [];
      _modelsCache = { v, t: now };
      return v;
    },
    /**
     * Today's spend snapshot (owner-only). Useful for "AI used: $0.04 / $1.00".
     */
    async usage() {
      const r = await authFetch2("/v1/ai/usage");
      if (!r || !r.ok) throw new Error(r && r.error && r.error.message || "Failed to read usage");
      return r.data;
    },
    /**
     * Clear browser-side caches. Call after the user toggles their key/budget.
     */
    invalidateCache() {
      _availCache = null;
      _modelsCache = null;
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
    declare
  };
  attach("ai", ai);
  attachSpend();
})();
