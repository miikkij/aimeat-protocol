/**
 * @file poster-parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The small parts the organism pages share in the poster face: a section under an ink
 *   rule with a numbered headline and doors on the right, a folded row that opens in place, the
 *   translate-with-fallback helper and the in-page scroll. Lifted out of home.js so the workspace
 *   cover is built from the same pieces and the two pages cannot drift apart.
 * @structure tr(key, fallback) · scrollTo(id) · Section · Fold
 * @usage import { Section, Fold, tr, scrollTo } from '/views/profile/organisms/poster-parts.js';
 * @version-history
 *   v1.1.0 — 2026-08-29 — scrollTo scrolls the content region itself instead of calling scrollIntoView,
 *     which also moved the window and hid the top bar on aimeat.io.
 *   v1.0.0 — 2026-08-29 — Extracted from home.js v3.0.0 for the workspace cover; no behaviour change.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

export const tr = (key, fb) => t(key) || fb;

/**
 * Bring a section to the top of the content area, and move NOTHING else. scrollIntoView() walks
 * every scrollable ancestor, and on this shell that included the window: the static agent-footer
 * below #app gave the document 70 px of slack, and each rail click slid the whole page up by the
 * height of the top bar, which then sat above the viewport (aimeat.io, 2026-08-29, seen twice).
 * Scrolling the content region by hand touches one element and cannot reach the bar.
 * @param {string} id
 */
export const scrollTo = (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  const box = el.closest('.page-content') || el.closest('.pf-content') || null;
  if (!box) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const top = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 16;
  box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
};

/** A section under an ink rule: the numbered headline, the doors on the right, the body. */
export function Section({ id, num, title, count, doors, first, children }) {
  return html`
    <section class=${`og-sec ${first ? 'og-sec--first' : ''}`} id=${id}>
      <div class="og-sec-h">
        <h2>${title}${count !== null && count !== undefined ? html`<small>${count}</small>` : html`<small>${num}</small>`}</h2>
        ${doors ? html`<div class="og-doors">${doors}</div>` : null}
      </div>
      ${children}
    </section>`;
}

/** A folded row that opens into its body: the map, the README, the AI instruction. */
export function Fold({ id, num, title, sub, open, onToggle, children }) {
  return html`
    <section class=${`og-sec og-fold-sec ${open ? 'is-open' : ''}`} id=${id}>
      <button type="button" class="og-fold og-fold--toggle" aria-expanded=${open ? 'true' : 'false'} onClick=${onToggle}>
        <i>${num}</i><span>${title}</span>${sub ? html`<span class="og-fold-r">${sub}</span>` : null}<span class="og-fold-arrow">${open ? '↓' : '→'}</span>
      </button>
      ${open ? html`<div class="og-fold-body">${children}</div>` : null}
    </section>`;
}
