/**
 * @file public/components/StatusPagePreview.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The page a node serves in its own place (the 503 of maintenance), drawn small as a
 *   visitor gets it: the status line and the content type in the typewriter face on top, then the
 *   node's name, the headline in the poster face, the line the operator wrote, and the line under it.
 *   Over it either its label, or, while the page is live, the coral "live" mark with its square; a
 *   grey hint under it. A page passes the words; it never writes a class. Its look is
 *   css/components/status-page-preview.css (main's Maintenance preview, .adm-maint-prev*).
 * @structure StatusPagePreview({ status, type, node, head, message, sub, label, live, hint })
 * @usage html`<${StatusPagePreview} status="503 Service Unavailable" type="text/html" node=${nodeId}
 *          head=${x('previewHead')} message=${msg || x('previewEmpty')} sub=${x('previewSub')}
 *          label=${live ? x('previewLive') : x('previewLabel')} live=${live} hint=${x('previewHint')} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the Maintenance page's 503 preview as a component (admin group G2).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ status: any, type?: any, node?: any, head: any, message: any, sub?: any, label?: any, live?: boolean, hint?: any }} props */
export function StatusPagePreview({ status, type, node, head, message, sub, label, live, hint }) {
  return html`
    <div class="status-page-preview">
      ${live
        ? html`<span class="status-page-preview-live"><i aria-hidden="true"></i>${label}</span>`
        : html`<span class="poster-label poster-label--block status-page-preview-label">${label}</span>`}
      <div class="status-page-preview-page">
        <div class="status-page-preview-top"><span>${status}</span><span>${type}</span></div>
        <div class="status-page-preview-body">
          <div class="status-page-preview-node">${node}</div>
          <h3 class="poster-record-title status-page-preview-head">${head}</h3>
          <p class="status-page-preview-msg">${message}</p>
          ${sub ? html`<p class="status-page-preview-sub">${sub}</p>` : null}
        </div>
      </div>
      ${hint ? html`<p class="status-page-preview-hint">${hint}</p>` : null}
    </div>`;
}

export default StatusPagePreview;
