/**
 * @file public/components/ErrorNote.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What went wrong, in a danger frame: the sentence, an optional hint, and an optional
 *   way forward (children). Its look is css/components/error-note.css; the catalogue entry is
 *   `error-note`. ErrorNoteFallback is the quiet button that offers another way.
 * @structure ErrorNote({ text, hint, children }) · ErrorNoteFallback({ onClick, children })
 * @usage html`<${ErrorNote} text=${err} hint=${t('…')} />`
 * @version-history
 *   v1.0.0 — 2026-09-23 — Moved out of views/home (index.js, history.js, step-mat.js) with its
 *     markup unchanged (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ text: any, hint?: any, children?: any }} props */
export function ErrorNote({ text, hint, children }) {
  return html`
    <div class="poster-error" role="alert">
      <p class="poster-error-text">${text}</p>
      ${hint ? html`<p class="poster-error-hint">${hint}</p>` : ''}
      ${children}
    </div>`;
}

/** The quiet button inside an error that offers another way. */
export function ErrorNoteFallback({ onClick, children }) {
  return html`<button type="button" class="btn-ghost poster-error-fallback" onClick=${onClick}>${children}</button>`;
}

export default ErrorNote;
