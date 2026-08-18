/**
 * @file public/views/portal-dev.upload.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Publish pointer for the portal-dev view. Extracted from portal-dev.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portal-dev.js (max-file-lines)
 *   v1.1.0 — 2026-07-28 — UploadSection becomes a pointer to the app catalog. It taught the
 *     obsolete "save the HTML and email it" model, and for signed-in owners it POSTed an inline
 *     base64 body to /v1/apps — a second publish path with no versioning, origin isolation or
 *     share link. Community list leads with Open (the app runs on the node); Download is secondary.
 *   v2.0.0 — 2026-07-28 — Community app list removed. It offered a Download button for apps their
 *     authors never made forkable, and the same apps are already the landing page's wall, so the
 *     developer page was advertising them a second time with the wrong verb. The per-app access-code
 *     manager went with it — it existed only to gate those downloads.
 */
import { html, dt } from './portal-dev.shared.js';

/* ══════════════════════════════════════════════
   PUBLISH (Step 4)
   ══════════════════════════════════════════════ */
/* One publish path: the app catalog. This panel used to teach "save the HTML and email it
   around", and for signed-in owners it POSTed an inline base64 body to /v1/apps — a second,
   divergent publish path that skipped the catalog's versioning, origin isolation and share
   link. Replaced 2026-07-28 with a pointer to the one real path. */
function UploadSection({ locale }) {
  const steps = ['publish.step1', 'publish.step2', 'publish.step3'];
  return html`
    <div class="dv-panel">
      <h3>${dt('publish.title', locale)}</h3>
      <p>${dt('publish.desc', locale)}</p>
      <ol class="dv-steps">
        ${steps.map(k => html`<li key=${k}>${dt(k, locale)}</li>`)}
      </ol>
      <a class="btn-primary" href="/app-catalog.html">${dt('publish.cta', locale)}</a>
      <p class="dv-hint">${dt('publish.note', locale)}</p>
    </div>
  `;
}

export { UploadSection };
