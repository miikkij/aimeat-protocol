/**
 * @file poster-parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The small parts the organism pages share in the poster face: a section with a shared
 *   B1 numbered headline and doors on the right, a folded row that opens in place, the
 *   translate-with-fallback helper and the in-page scroll. Lifted out of home.js so the workspace
 *   cover is built from the same pieces and the two pages cannot drift apart.
 * @structure tr(key, fallback) · scrollTo(id) · Section · Fold
 * @usage import { Section, Fold, tr, scrollTo } from '/views/profile/organisms/poster-parts.js';
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Section and Fold are the shared set's (components/poster-parts.js):
 *     the 49 views that import them from here draw the one section and the one fold every page
 *     uses. The props keep their old names (num, doors, first) so no caller changes; `first` is
 *     no longer needed, because a first section takes no top margin in the set.
 *   v1.2.0 -- 2026-09-13 -- Compose the section headline from the shared poster-section-title class.
 *   v1.1.0 — 2026-08-29 — scrollTo scrolls the content region itself instead of calling scrollIntoView,
 *     which also moved the window and hid the top bar on aimeat.io.
 *   v1.0.0 — 2026-08-29 — Extracted from home.js v3.0.0 for the workspace cover; no behaviour change.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section as SharedSection, Fold as SharedFold } from '/components/poster-parts.js';

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

/** A B1 section: the numbered headline (the count, or the number when there is none), the doors on the right, the body. */
export function Section({ id, num, title, count, doors, children }) {
  return html`<${SharedSection} id=${id} title=${title} count=${count ?? num} actions=${doors} density="compact">${children}<//>`;
}

/** A folded row that opens into its body: the map, the README, the AI instruction. */
export function Fold({ id, num, title, sub, open, onToggle, children }) {
  return html`<${SharedFold} id=${id} number=${num} title=${title} sub=${sub} open=${open} onToggle=${onToggle}>${children}<//>`;
}
