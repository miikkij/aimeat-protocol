/**
 * @file discovery-tab.shared.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three small things every section of the admin Discovery page reads: a metric
 *   row, a machine-readable stamp, and the base address the status was read from. Kept apart from
 *   the shell so the sections import a leaf rather than each other.
 * @structure Row · when · baseOf
 * @usage import { Row, when, baseOf } from './discovery-tab.shared.js';
 * @version-history
 *   v1.0.0 — 2026-09-11 — Initial (the Discovery page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/** "2026-09-08 16:51" from an ISO stamp, as a machine reading; '' for none. */
export function when(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 16).replace('T', ' ');
}

/** The base this node is served from, without a trailing slash, from the status itself. */
export function baseOf(status) {
  return status.sitemap.url.replace(/\/sitemap\.xml$/, '');
}

/**
 * One metric row: the name and why it matters, the chip, the value.
 * @param {{ title: any, why: any, chip?: any, value: any, last?: boolean }} props
 */
export function Row({ title, why, chip, value, last }) {
  return html`
    <div class="adm-mrow ${last ? 'adm-mrow--last' : ''}">
      <span><b>${title}</b><span class="adm-why">${why}</span></span>
      <span>${chip}</span>
      <span class="adm-mval">${value}</span>
    </div>`;
}
