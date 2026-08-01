/**
 * @file ai/disclose.js
 * @description The AI transparency primitives an app builder gets for free (TARGET-058 Phase 5):
 *   `AIMEAT.ai.disclose()` renders the visible label, `AIMEAT.ai.chatNotice()` renders the Article
 *   50(1) "you are talking to a model" notice, and `AIMEAT.ai.declare()` attaches a provenance
 *   record to something the app is about to store. A builder calls one function and gets a label
 *   that is correct under EU law without ever reading Article 50 — which is the entire deliverable
 *   of this phase, because there are over a hundred published apps and their authors are not going
 *   to become lawyers.
 *
 *   NOT A SECOND BADGE IMPLEMENTATION. Two things decide what the label looks like, and this file
 *   imports BOTH from the platform rather than restating them:
 *     - WHICH icon: `euIconFor()` from public/components/ai-label-icons.js — the same pure table the
 *       apex SPA uses, held against the normative server adapter by a unit test.
 *     - HOW it looks: public/css/components/ai-label.css, inlined as text at bundle time. Same class
 *       names, same theme variables, same `[data-theme="dark"]` icon switch. One stylesheet, two
 *       consumers; there is no SDK copy to drift.
 *   The only thing done to that CSS at runtime is rewriting the icon URLs to absolute apex URLs,
 *   because an app runs on its own origin and `/assets/…` there is a 404.
 *
 *   IT RENDERS, IT DOES NOT DECIDE. Whether a label is owed was decided by disclosureFor() on the
 *   server and travels in `record.disclosure.required`. An app that writes `if (looksAiGenerated)`
 *   has put the legal test in the wrong place: pass the record, and this returns null when nothing
 *   is owed.
 * @structure
 *   - ensureStyles()        — inject the platform stylesheet once, with apex-absolute icon URLs
 *   - buildLabel(record, recordUrl, opts) — the label element, or null when no label is owed
 *   - disclose(provenance, opts)  — build + mount; returns the element (or null)
 *   - chatNotice(opts)      — the Art. 50(1) notice; never gated on a record
 *   - declare(item, provenance)   — attach the record to a value the app stores
 * @usage
 *   const r = await AIMEAT.ai.complete({ app_id: 'my-app', prompt });
 *   AIMEAT.ai.disclose(r.provenance, { target: '#answer-label' });
 *   await AIMEAT.data.set(key, AIMEAT.ai.declare({ text: r.content }, r.provenance));
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 5.
 */
import { APEX_URL } from '../_core/config.js';
import { euIconFor } from '../../../../public/components/ai-label-icons.js';
import LABEL_CSS from '../../../../public/css/components/ai-label.css';
import { pick } from './strings.js';

const STYLE_ID = 'aimeat-ai-label-css';

/**
 * The theme tokens the platform stylesheet reads, mapped for an APP context and scoped to the label.
 *
 * WHY THIS IS NOT A SECOND STYLESHEET. The AIMEAT SPA defines `--text`, `--border`, `--bg-dim` and
 * friends in theme.css, so the shared CSS just works there. An app on its own origin has whatever it
 * has — commonly daisyUI, where `--border` means a border WIDTH, so `1px solid var(--border)` would
 * come out as `1px solid 1px` and the chip would lose its edge. This is the same fix, and the same
 * mapping, that /lib/aimeat-daisyui-bridge.css already makes for the `aui-*` components: read
 * daisyUI's own palette tokens where they exist, fall back to the AIMEAT theme's literal values
 * where they do not, and scope the whole thing to `.ai-label` so nothing else in the app moves.
 * The result follows the app's palette AND its light/dark mode without the app doing anything.
 */
const APP_TOKENS = `
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

/**
 * The dark ICON variants for an app that follows the OS instead of setting `data-theme` — the
 * shared stylesheet switches on `[data-theme="dark"]`, which is what the SPA and the templates use,
 * and this covers the app that never sets it. An explicit `data-theme="light"` still wins.
 */
function osDarkIcons(base) {
  const url = (stem) => `${base}/assets/eu-ai-icons/svg/${stem}_white.svg`;
  return `@media (prefers-color-scheme: dark){`
    + ['ai-basic', 'ai-generated', 'ai-modified']
      .map((s) => `:root:not([data-theme="light"]) .ai-label__icon--${s}{background-image:url('${url(s)}')}`)
      .join('')
    + '}';
}

/** The reader's language, resolved the way every AIMEAT app resolves it. */
function locale() {
  const stored = (() => {
    try { return localStorage.getItem('aimeat-lang'); } catch { return null; }
  })();
  const lang = stored || document.documentElement.lang || 'en';
  return lang.slice(0, 2) === 'fi' ? 'fi' : 'en';
}

/** A platform string by its full dotted key, in the reader's language. See ./strings.js. */
function t(key) {
  return pick(key, locale());
}

/** The record's own pre-rendered wording (it travels translated), else the local bundle. */
function localized(block, field, fallbackKey) {
  const text = block && block[field];
  if (text && typeof text === 'object') {
    const loc = locale();
    if (typeof text[loc] === 'string') return text[loc];
    if (typeof text.en === 'string') return text.en;
  }
  return t(fallbackKey);
}

/**
 * Put the platform stylesheet in the page once.
 *
 * The icon URLs are made absolute against the apex: an app is served from its own origin, where
 * `/assets/eu-ai-icons/…` does not exist. The app CSP already allows the image (`img-src *`), which
 * is the same reasoning the node's own serve-time label uses.
 */
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const base = (APEX_URL || '').replace(/\/+$/, '');
  const css = base
    ? LABEL_CSS.replace(/url\((['"]?)\/assets\//g, (m, q) => `url(${q}${base}/assets/`)
    : LABEL_CSS;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  // Tokens FIRST so the stylesheet's own rules read them, then the OS-dark icon fallback LAST so it
  // wins over the `[data-theme="dark"]` rules it stands in for.
  st.textContent = APP_TOKENS + css + (base ? osDarkIcons(base) : '');
  (document.head || document.documentElement).appendChild(st);
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

/** Resolve a selector-or-element into an element, or null. */
function targetOf(target) {
  if (!target) return null;
  return typeof target === 'string' ? document.querySelector(target) : target;
}

/**
 * The visible AI label as a detached element, or `null` when no label is owed.
 *
 * @param {any} record the `aimeat.provenance/v1` document
 * @param {string} [recordUrl] absolute URL of the addressable record — the "How this was made" link
 * @param {{ variant?: 'inline'|'block', class?: string }} [opts]
 * @returns {HTMLElement|null}
 */
export function buildLabel(record, recordUrl, opts = {}) {
  const disclosure = record && record.disclosure;
  if (!disclosure || !disclosure.required) return null;
  const icon = euIconFor(record);
  if (!icon) return null;

  ensureStyles();
  const variant = opts.variant === 'block' ? 'block' : 'inline';
  // `strength` is optional on a record minted before Phase 3. Absent means "show it": the obligation
  // lives in `required`, and defaulting to the quieter form would under-state rather than over-state.
  const strength = disclosure.strength === 'full' ? 'full' : 'light';
  const alt = t(icon.alt);

  const root = el('div', `ai-label ai-label--${variant} ai-label--${strength} ${opts.class || ''}`.trim());
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', t('aiLabel.regionLabel'));

  const glyph = el('span', `ai-label__icon ai-label__icon--${icon.file}`);
  glyph.setAttribute('role', 'img');
  glyph.setAttribute('aria-label', alt);
  glyph.setAttribute('title', alt);
  root.appendChild(glyph);

  const textWrap = el('span', 'ai-label__text');
  textWrap.appendChild(el('span', 'ai-label__short', localized(disclosure, 'short', 'aiLabel.short')));
  // The long statement belongs to the BLOCK form only: a list row carrying a full sentence per item
  // is the wall of metadata that makes a label stop being read.
  const long = localized(disclosure, 'long', 'aiLabel.publicText');
  if (variant === 'block' && strength === 'full' && long) {
    textWrap.appendChild(el('span', 'ai-label__long', long));
  }
  root.appendChild(textWrap);

  const url = recordUrl || (record.attestation && record.attestation.recordUrl);
  if (url) {
    const a = el('a', 'ai-label__link', t('aiLabel.detailsLink'));
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    root.appendChild(a);
  }
  return root;
}

/**
 * Render the visible AI label for something a model produced.
 *
 * Pass the whole `provenance` object `AIMEAT.ai.complete()` returned — `{ id, record, recordUrl }` —
 * or a bare record. With `target`, the label is placed there (replacing what was there before, so
 * calling it again on the same node updates rather than stacks); without one, the element is
 * returned for the app to place itself.
 *
 * @param {any} provenance `{ record, recordUrl }` from a completion, or the record itself
 * @param {{ target?: string|Element, variant?: 'inline'|'block', class?: string }} [opts]
 * @returns {HTMLElement|null} the label, or null when the content owes none
 */
export function disclose(provenance, opts = {}) {
  if (!provenance) return null;
  const record = provenance.record || provenance;
  const recordUrl = provenance.recordUrl || (record.attestation && record.attestation.recordUrl);
  const node = buildLabel(record, recordUrl, opts);
  const mount = targetOf(opts.target);
  if (mount) {
    mount.textContent = '';
    if (node) mount.appendChild(node);
  }
  return node;
}

/**
 * The Article 50(1) notice: a standing statement that a model is on the other end.
 *
 * Deliberately NOT gated on a provenance record. It answers a different question from the label —
 * that one is about published CONTENT and renders only when a label is owed, this one is about a
 * person conversing with a machine and is owed the moment the conversation opens. It carries no EU
 * icon either: the official icon set is for content labelling.
 *
 * @param {{ target?: string|Element, title?: string, body?: string, recordUrl?: string, class?: string }} [opts]
 * @returns {HTMLElement}
 */
export function chatNotice(opts = {}) {
  ensureStyles();
  const root = el('div', `ai-label ai-label--interaction ${opts.class || ''}`.trim());
  root.setAttribute('role', 'note');
  const textWrap = el('span', 'ai-label__text');
  textWrap.appendChild(el('span', 'ai-label__short', opts.title || t('aiLabel.interactionTitle')));
  textWrap.appendChild(el('span', 'ai-label__long', opts.body || t('aiLabel.interactionBody')));
  root.appendChild(textWrap);
  if (opts.recordUrl) {
    const a = el('a', 'ai-label__link', t('aiLabel.detailsLink'));
    a.href = opts.recordUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    root.appendChild(a);
  }
  const mount = targetOf(opts.target);
  if (mount) { mount.textContent = ''; mount.appendChild(root); }
  return root;
}

/**
 * Attach a provenance record to a value the app is about to store or publish, so the record follows
 * the content instead of being lost the moment it leaves the screen.
 *
 * The field is `aiProvenance`, camelCase, because the record is a self-describing document that keeps
 * ONE spelling on every carrier it travels on. Returns a NEW object — the input is not mutated, so
 * this is safe to call inline inside a `set()`.
 *
 * @template T
 * @param {T} item the value being stored
 * @param {any} provenance `{ record, recordUrl }` from a completion, or the record itself
 * @returns {T} the same value with `aiProvenance` (and `aiProvenanceUrl`, when known) attached
 */
export function declare(item, provenance) {
  if (!provenance || !item || typeof item !== 'object') return item;
  const record = provenance.record || provenance;
  const recordUrl = provenance.recordUrl || (record.attestation && record.attestation.recordUrl);
  return Object.assign({}, item, {
    aiProvenance: record,
    ...(recordUrl ? { aiProvenanceUrl: recordUrl } : {}),
  });
}
