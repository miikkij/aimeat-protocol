/**
 * @file src/static/page-frame-holder.js
 * @description The script of the page frame's holder (src/static/page-frame-holder.html): a link the
 *   page inside asks to open (src/static/page-frame-shim.js) goes on to the viewer around the holder,
 *   which shows the address and opens it only when the person presses Open. Only that one message,
 *   only from the page's own frame, and only its address is passed on.
 *   The leading comment block is removed before the script is served (utils/app-frame-assets.ts).
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (HTML pages in workspaces).
 */
(function () {
  'use strict';
  var frame = document.querySelector('iframe');
  window.addEventListener('message', function (e) {
    if (!frame || e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || d.type !== 'aimeat_page_open' || typeof d.url !== 'string' || d.url.length > 4096) return;
    window.parent.postMessage({ type: 'aimeat_page_open', url: d.url }, '*');
  });
})();
