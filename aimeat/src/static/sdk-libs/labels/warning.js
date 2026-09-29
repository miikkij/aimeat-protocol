/**
 * @file labels/warning.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The warning part of aimeat-labels (TARGET-082 V5). An item with a warning
 *   classification carries a warning object from the node: classificationWarning on a REST item,
 *   classification_warning on a memory read relayed from MCP. warningOf() finds it, renderWarning()
 *   shows it as one short line before the content.
 *
 *   COLOURS COME FROM THE PAGE. The line reads the house tokens (--warn-bg, --warn-fg, --warn-border
 *   from the node's theme.css) and falls back to the palette tokens an app origin loads from
 *   /lib/aimeat-theme.css (--color-warning, --color-warning-content). With neither on the page it
 *   has no ground and takes the text colour around it; it never writes a colour of its own.
 * @structure warningOf(item) · renderWarning(item, container?) · WARNING_CLASS
 * @usage
 *   import { warningOf, renderWarning } from './warning.js';
 *   renderWarning(record, cardEl);   // puts the line first in cardEl, or removes it when none applies
 * @version-history
 *   v1.0.0 - 2026-09-29 - Initial (TARGET-082 V5).
 */

/** The class on the rendered line; also how a second render finds the first one. */
export const WARNING_CLASS = 'aimeat-label-warning';

/**
 * @typedef {{ label: string, name: string, says: string }} ClassificationWarning
 */

/**
 * The warning an item carries, or null. Reads both spellings the node uses.
 * @param {any} item  a record, a list entry or a search hit
 * @returns {ClassificationWarning|null}
 */
export function warningOf(item) {
  if (!item || typeof item !== 'object') return null;
  const w = item.classificationWarning || item.classification_warning;
  if (!w || typeof w !== 'object' || typeof w.label !== 'string') return null;
  return { label: w.label, name: String(w.name || w.label), says: String(w.says || '') };
}

const STYLE = [
  'display:block',
  'margin:0 0 .5em',
  'padding:.35em .6em',
  'font:inherit',
  'font-family:var(--font-body, inherit)',
  'font-size:var(--text-sm, var(--text-fine, .875em))',
  'line-height:1.4',
  'background:var(--warn-bg, var(--color-warning, transparent))',
  'color:var(--warn-fg, var(--color-warning-content, currentColor))',
  'border:1px solid var(--warn-border, var(--color-warning, currentColor))',
  'border-radius:var(--radius-sm, var(--radius-field, 4px))',
].join(';');

/**
 * Show an item's warning as one line. With a container, the line goes first in it, a line from an
 * earlier call is replaced, and an item with no warning removes it. Without a container, the line
 * is returned for the caller to place. Returns null when the item carries no warning.
 * @param {any} item
 * @param {HTMLElement} [container]
 * @returns {HTMLElement|null}
 */
export function renderWarning(item, container) {
  if (typeof document === 'undefined') return null;
  const old = container ? container.querySelector(':scope > .' + WARNING_CLASS) : null;
  const w = warningOf(item);
  if (!w) {
    if (old) old.remove();
    return null;
  }
  const el = document.createElement('p');
  el.className = WARNING_CLASS;
  el.setAttribute('role', 'note');
  el.dataset.label = w.label;
  el.setAttribute('style', STYLE);
  const name = document.createElement('strong');
  name.textContent = w.name;
  el.appendChild(name);
  if (w.says) el.appendChild(document.createTextNode(': ' + w.says));
  if (container) {
    if (old) old.replaceWith(el);
    else container.insertBefore(el, container.firstChild);
  }
  return el;
}
