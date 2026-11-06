/**
 * @file app-body.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Removes the app's server-written name and description (#aimeat-app-body,
 *   src/utils/app-page-body.ts) when the document has been parsed. Loaded with `defer` from inside
 *   the block, so it runs after the parser has passed every inline script the app wrote, just before
 *   DOMContentLoaded, which is when a single-file app starts drawing its own view. A reader without JavaScript
 *   keeps the block, and so does a person until this runs: the text is the same for both
 *   (TARGET-089).
 * @version-history
 *   v1.0.0 — 2026-11-06 — Initial.
 */
(function () {
  var block = document.getElementById('aimeat-app-body');
  if (block && block.parentNode) block.parentNode.removeChild(block);
})();
