/**
 * @file public/views/profile/offers/data-licence.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The licence of a data package as a reader sees it: the licence's name as a link to its
 *   deed, one sentence of what it lets a reader do and what it asks of them, and who to credit in the
 *   maker's own words. The public dataset page's Licence section and the recipient page's first step
 *   show it. Made of the component kit.
 * @structure LicenceNote
 * @usage html`<${LicenceNote} licence=${licenceOf(descriptor)} attribution=${wordsOf(descriptor).attribution} />`
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP10e A3).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { d } from './data-model.js';

/** `licence` is licenceOf()'s answer, or null; `attribution` the maker's words, or ''. */
export function LicenceNote({ licence, attribution }) {
  if (!licence) return html`<${Note} kind="quiet">${d('dataset.noLicenceText')}<//>`;
  return html`
    <${Note} kind="lead">${licence.url ? html`<${Action} tone="link" href=${licence.url} newTab>${licence.name}<//>` : licence.name}<//>
    ${licence.rule ? html`<${Note}>${licence.rule}<//>` : null}
    ${attribution ? html`<${Box} name=${d('dataset.attribution')}><${Note}>${attribution}<//><//>` : null}`;
}
