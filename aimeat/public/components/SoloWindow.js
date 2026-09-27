/**
 * @file public/components/SoloWindow.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One thing popped out into a window of its own (an agent's card, a document), so a
 *   person can set several side by side: the thing in a centred column as wide as the window gives
 *   it, or, while there is nothing to show, the one quiet sentence that says why (sign in, loading,
 *   not found) in the middle of the window. A page passes the thing or the sentence; it never writes
 *   a class. Its look is css/components/solo-window.css and the quiet sentence of Note.js.
 * @structure SoloWindow({ message, children })
 * @usage html`<${SoloWindow} message=${loading ? t('profile.loading') : null}>${card}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the pop-out agent window (views/agent-solo.js, .pf-agd-solo) and
 *     the pop-out document window (views/doc-solo.js, .pj-doc-solo) as one component; the column is
 *     the document window's, 920px (page group G9, a unification).
 */
import { h } from 'preact';
import htm from 'htm';
import { Note } from '/components/Note.js';

const html = htm.bind(h);

/** `message`: the sentence shown in the thing's place, while there is no thing to show. */
export function SoloWindow({ message, children }) {
  return html`<div class="solo-window">
    ${message ? html`<div class="solo-window-message"><${Note} kind="quiet">${message}<//></div>` : children}
  </div>`;
}

export default SoloWindow;
