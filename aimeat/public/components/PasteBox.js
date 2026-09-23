/**
 * @file public/components/PasteBox.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The box a person pastes their AI's answer into, and its label: a mono field in an
 *   ink frame that grows downward, with a sun outline on focus. PasteLabel is the label alone (a
 *   name field uses it too). Its look is css/components/paste-box.css; the catalogue entry is
 *   `paste-box`.
 * @structure PasteBox({ id, label, boxRef, rows, placeholder, value, onInput }) · PasteLabel({ htmlFor, children })
 * @usage html`<${PasteBox} id="koti-paste" label=${t('…')} boxRef=${ref} value=${v} onInput=${set} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/step-mat.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ htmlFor: string, children?: any }} props */
export function PasteLabel({ htmlFor, children }) {
  return html`
      <label class="poster-paste-label" for=${htmlFor}>
        ${children}
      </label>`;
}

/**
 * @param {{ id: string, label: any, boxRef?: any, rows?: string, placeholder?: string, value: string,
 *   onInput: (e: Event) => void }} props
 */
export function PasteBox({ id, label, boxRef, rows = '8', placeholder, value, onInput }) {
  return html`
      <${PasteLabel} htmlFor=${id}>${label}<//>
      <textarea
        id=${id}
        ref=${boxRef}
        class="poster-paste"
        rows=${rows}
        spellcheck="false"
        placeholder=${placeholder}
        value=${value}
        onInput=${onInput}></textarea>`;
}

export default PasteBox;
