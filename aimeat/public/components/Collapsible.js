import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * @file Collapsible.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Canonical expand/collapse (chevron) section — a clickable header
 *   (title + a chevron that rotates 180° when open) with its body rendered only
 *   while open. CONTROLLED component: the parent owns the `open` state and is
 *   notified via `onToggle`. Backed by `.collapsible*` in theme.css, whose colors
 *   are all theme tokens so it flips correctly in dark mode. Establishes the
 *   canonical shape for the hand-rolled toggles scattered across views
 *   (.expand-btn + .pf-chevron, .scope-advanced-toggle, .pkv-entry-arrow); those
 *   bespoke toggles are left in place where their expanded markup is wired into
 *   view state — this is the target for new collapsible sections.
 * @structure Collapsible({ title, open, onToggle, children }) — renders
 *   `<div class="collapsible">` containing a `.collapsible-header` button
 *   (title + `.collapsible-chevron` with an `.open` modifier) and, when open, a
 *   `.collapsible-body` wrapping the children.
 * @usage
 *   import { Collapsible } from '/components/index.js';
 *   const [open, setOpen] = useState(false);
 *   html`<${Collapsible} title=${t('...')} open=${open} onToggle=${() => setOpen(!open)}>
 *     ${body}
 *   <//>`
 * @version-history
 *   v1.0.0 — 2026-06-02 — Component unification (#23): created canonical
 *     expand/collapse section, consolidating the .expand-btn + .pf-chevron,
 *     .scope-advanced-toggle and .pkv-entry-arrow toggle patterns.
 */
export function Collapsible({ title, open, onToggle, children }) {
  return html`<div class="collapsible">
    <button type="button" class="collapsible-header" aria-expanded=${!!open} onClick=${onToggle}>
      <span class="collapsible-title">${title}</span>
      <span class="collapsible-chevron ${open ? 'open' : ''}">▼</span>
    </button>
    ${open && html`<div class="collapsible-body">${children}</div>`}
  </div>`;
}
