/**
 * @file public/components/PagePreview.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A web page shown as it will look, inside the raised box: a sandboxed frame (scripts
 *   run, nothing else is allowed) 34rem high, 24rem on a phone; while the page's text loads, the
 *   loading line. A page passes the document and its title; it never writes a class. Its look is
 *   css/components/page-preview.css; the frame around it is the Box (raised, flush).
 * @structure PagePreview({ title, srcdoc, loading, loadingLabel })
 * @usage html`<${PagePreview} title=${title} srcdoc=${ctx.pageHtml ? ctx.previewDoc() : null} loadingLabel=${x('loading')} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the Portfolio page's preview (main's .pf-prev, .pf-prev-frame) as a
 *     component (page group G8).
 */
import { h } from 'preact';
import htm from 'htm';
import { Box } from '/components/Box.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);

/** Without `srcdoc` (or with `loading`) it says the page is loading. */
export function PagePreview({ title, srcdoc, loading, loadingLabel }) {
  return html`<${Box} tone="raised" flush>
    ${srcdoc && !loading
      ? html`<iframe class="page-preview-frame" title=${title} sandbox="allow-scripts" srcdoc=${srcdoc}></iframe>`
      : html`<${Note} kind="loading">${loadingLabel}<//>`}
  <//>`;
}

export default PagePreview;
