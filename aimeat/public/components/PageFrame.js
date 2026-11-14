/**
 * @file public/components/PageFrame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The page itself: a wide paper column (the home), a narrow one for reading (the
 *   record), or the same column holding a spinner while the page loads. Its look is
 *   css/components/page-frame.css; the catalogue entry is `page-frame`.
 * @structure PageFrame({ width, loading, children })
 * @usage html`<${PageFrame} width="narrow">…<//>`
 * @version-history
 *   v1.1.0 — 2026-11-14 — width="rail": the wide column plus the contents rail beside it, so the
 *     home's own column keeps its width when the rail is drawn.
 *   v1.0.0 — 2026-09-23 — Moved out of views/home (index.js, history.js) with its markup unchanged
 *     (UI consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ width?: 'wide'|'narrow'|'rail', loading?: boolean, children?: any }} props */
export function PageFrame({ width = 'wide', loading = false, children }) {
  const cls = 'poster-page' + (loading ? ' poster-page-loading' : '') + (width === 'narrow' ? ' poster-page--narrow' : '')
    + (width === 'rail' ? ' poster-page--rail' : '');
  return html`<div class=${cls}>${children}</div>`;
}

export default PageFrame;
