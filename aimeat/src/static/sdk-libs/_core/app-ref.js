/**
 * @file _core/app-ref.js
 * @description The served app's own identity, read from the `#aimeat-app-ref` block the node injects.
 *   Moved unchanged out of atelier/mosaic-layout.js so aimeat-data can read it too
 *   (AIMEAT.data.appConfig()); mosaic-layout.js re-exports it, so no importer changes.
 * @structure appRef()
 * @usage import { appRef } from '../_core/app-ref.js';
 * @version-history
 *   v1.0.0 — 2026-09-28 — Moved from atelier/mosaic-layout.js (v0.53.2), unchanged.
 */

/**
 * The app's own identity, from the `#aimeat-app-ref` block the node injects into the head of every
 * served app, so it is readable from the app's first line of script. Null when absent (a raw file
 * open, a test page), and the mosaic then renders the fallback.
 * @returns {{ owner: string, filename: string }|null}
 */
export function appRef() {
  try {
    const node = document.getElementById('aimeat-app-ref');
    if (!node) return null;
    const raw = node.textContent || '';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A page served before 2026-09-13 carries the block HTML-escaped, and script content is raw
      // text, so the entities arrive literal and have to be decoded by hand.
      parsed = JSON.parse(raw
        .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    }
    return parsed && parsed.owner && parsed.app_id
      ? { owner: String(parsed.owner), filename: String(parsed.app_id) }
      : null;
  } catch {
    return null;
  }
}
