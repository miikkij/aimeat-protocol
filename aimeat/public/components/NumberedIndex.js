/**
 * @file public/components/NumberedIndex.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A numbered index: a lead line, then a named row whose items are numbered rows with
 *   an arrow (IndexItem, passed as children), an optional tour link,
 *   and under it the one open item's panel. IndexPanel is that panel: what it is, its steps, where
 *   it already runs, and its actions, in an opened record (poster.css .poster-record). Its look is
 *   css/components/numbered-index.css; the catalogue entry is `numbered-index`.
 * @structure NumberedIndex({ lead, label, tour, children, panel }) · IndexItem({ on, expanded, onClick, first, line, end, children }) ·
 *   IndexList({ steps, className, children }) · IndexStep({ line, end, children }) · IndexPanel({ what, steps, proof, children })
 * @usage
 *   html`<${NumberedIndex} lead=${…} label=${…} tour=${{ href, label }} panel=${open && html`<${IndexPanel} …/>`}>
 *     ${items.map((i) => html`<${IndexItem} on=${…} expanded=${…} onClick=${…}>…<//>`)}
 *   <//>`
 * @version-history
 *   v1.2.0 — 2026-09-26 — Two more tones and a cut (Jouni's decision "Numbered list"): `line`, a line
 *     under the name that says what it gives you; `first`, the one to do first, on the sun with every
 *     mark dark; IndexList, the rows under a page's own heading, and IndexStep, a row of a list of
 *     steps, which opens nothing. `end` is a word that stands before the arrow.
 *   v1.1.0 — 2026-09-23 — IndexItem: the rows are the index's own, no longer fold buttons restyled,
 *     with the same values (a move; the fold button became a tab, Jouni's decision "Tabs and filters").
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/status-parts.js (the playbooks) with its markup
 *     unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';
import { NamedRow } from '/components/NamedRow.js';

const html = htm.bind(h);

/**
 * @param {{ lead: any, label: any, tour?: { href: string, label: any } | null, children?: any, panel?: any }} props
 */
export function NumberedIndex({ lead, label, tour, children, panel }) {
  return html`
    <div class="poster-index">
      <p class="poster-index-lead">${lead}</p>
      <${NamedRow} label=${label}>
        ${children}
        ${tour && html`<a class="poster-index-tour" href=${tour.href} target="_blank" rel="noopener">
          ${tour.label}</a>`}
      <//>
      ${panel}
    </div>`;
}

/**
 * A row's words: the name alone, or the name with its line under it and a word before the arrow.
 * `wrap` keeps words and links in one box even without a line (a step's words can hold a link, and
 * the row lays out its children side by side).
 */
function rowBody(children, line, end, wrap = false) {
  if (!line && !end && !wrap) return children;
  return html`<span class="poster-index-body"><span class="poster-index-name">${children}</span>${line ? html`<span class="poster-index-line">${line}</span>` : null}</span>${end || null}`;
}

/**
 * One numbered row of the index; the open one is on the sun with its arrow turned down. `first` is
 * the one to do first (the sun, every mark dark); `line` says under the name what it gives you;
 * `end` is a word that stands before the arrow.
 * @param {{ on?: boolean, expanded?: boolean, onClick: () => void, first?: boolean, line?: any, end?: any, children?: any }} props
 */
export function IndexItem({ on, expanded, onClick, first, line, end, children }) {
  return html`
    <button type="button" class=${'poster-index-item' + (on ? ' poster-index-item--on' : '') + (first ? ' poster-index-item--first' : '')}
      aria-expanded=${expanded} onClick=${onClick}>${rowBody(children, line, end)}</button>`;
}

/**
 * The numbered rows alone, under a page's own heading: `steps` for a list of steps to read (an ol of
 * IndexStep), otherwise rows to press (IndexItem). `className` places the list in its page.
 * @param {{ steps?: boolean, className?: string, children?: any }} props
 */
export function IndexList({ steps = false, className = '', children }) {
  const cls = 'poster-index poster-index-list' + (className ? ' ' + className : '');
  return steps
    ? html`<ol class=${cls}>${children}</ol>`
    : html`<div class=${cls}>${children}</div>`;
}

/**
 * One step of a list of steps: a numbered row that opens nothing.
 * @param {{ line?: any, end?: any, children?: any }} props
 */
export function IndexStep({ line, end, children }) {
  return html`<li class="poster-index-item poster-index-item--step">${rowBody(children, line, end, true)}</li>`;
}

/**
 * @param {{ what: any, steps: any[], proof?: any, children?: any }} props
 */
export function IndexPanel({ what, steps, proof, children }) {
  return html`
    <div class="poster-record poster-index-open">
      <p class="poster-index-what">${what}</p>
      <ol class="poster-index-steps">
        ${steps.map((step, i) => html`<li key=${i}>${step}</li>`)}
      </ol>
      ${proof && html`
        <p class="poster-index-proof">
          ${proof}
        </p>`}
      <div class="poster-index-actions">
        ${children}
      </div>
    </div>`;
}

export default NumberedIndex;
