/**
 * @file public/components/ArchiveSection.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The older part of a record, under a 3px rule of its own so opening it is a
 *   decision rather than a scroll: a title, a note saying how much is there, what has been opened
 *   (children), and the button that brings more (ArchiveMore). ArchiveError is the line under the
 *   page when reading failed. Its look is css/components/archive.css; the catalogue entry is
 *   `archive`.
 * @structure ArchiveSection({ title, note, children }) · ArchiveMore({ disabled, onClick, children }) · ArchiveError({ children })
 * @usage html`<${ArchiveSection} title=${…} note=${…}>…<${ArchiveMore} onClick=${load}>…<//><//>`
 * @version-history
 *   v1.1.0 — 2026-09-24 — "Show older" is the action link's more tone (Jouni's decision "Small link").
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/history.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ title: any, note: any, children?: any }} props */
export function ArchiveSection({ title, note, children }) {
  return html`
    <section class="poster-archive">
      <h2 class="poster-archive-title">${title}</h2>
      <p class="poster-archive-note">
        ${note}
      </p>
      ${children}
    </section>`;
}

/** @param {{ disabled?: boolean, onClick?: () => void, children?: any }} props */
export function ArchiveMore({ disabled = false, onClick, children }) {
  return html`
    <button type="button" class="poster-action poster-action--more poster-archive-more"
            disabled=${disabled} onClick=${onClick}>
      ${children}
    </button>`;
}

export function ArchiveError({ children }) {
  return html`<p class="poster-archive-error" role="alert">${children}</p>`;
}

export default ArchiveSection;
