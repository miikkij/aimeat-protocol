/**
 * @file auth/app-frame.js
 * @description The isolated-frame half of aimeat-auth. On a node that several people share and that
 *   has no app origin, an app runs in a frame whose origin is opaque: it has no cookie and no storage
 *   of the node, and the page around it (the node's src/static/app-frame.js) asks the node for the
 *   app's own grant on its behalf. These two helpers are the frame's side of that conversation. They
 *   carry the same three requests the app-origin bridge makes (the silent sign-in, the visible
 *   consent, the node sign-out), sent to the parent page instead of to a hidden bridge iframe, which a
 *   frame with an opaque origin could not use: the bridge would inherit the sandbox.
 * @structure inIsolatedFrame() · askFrameHost(op, payload, timeoutMs)
 * @usage import { inIsolatedFrame, askFrameHost } from './app-frame.js';
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (audit A7-1: apps on shared nodes without an app origin).
 *   v1.1.0 — 2026-09-26 — The page's origin comes from window.__AIMEAT_FRAME__ when the page named it,
 *     so the App Catalog's srcdoc preview can ask its page too.
 */

/**
 * True when the node served this app into its isolated frame, with the page that answers for it
 * around it. The node's frame support script (app-frame-shim.js) is the first script of such a
 * document and sets window.__AIMEAT_FRAME__; `host` is false when the same bytes were opened some
 * other way, and then there is nobody to ask.
 * @returns {boolean}
 */
export function inIsolatedFrame() {
  try {
    var f = /** @type {any} */ (window).__AIMEAT_FRAME__;
    return !!(f && f.host) && window.parent !== window;
  } catch { return false; }
}

var sequence = 0;

/**
 * Ask the page that holds this frame, and wait for its answer to exactly this request. The page
 * listens on the address both were served from, which is this document's URL, not its opaque origin.
 * Resolves to the page's result, or null when it does not answer in time.
 * @param {string} op  'login' | 'consent' | 'logout'
 * @param {Record<string, unknown>} [payload]
 * @param {number} [timeoutMs]
 * @returns {Promise<any>}
 */
export function askFrameHost(op, payload, timeoutMs) {
  return new Promise(function (resolve) {
    var id = 'f' + (++sequence) + '-' + Math.random().toString(36).slice(2);
    // The page names its origin in the boot data (the frame support script keeps it); a preview
    // written in as srcdoc has no address of its own to fall back to.
    var named = /** @type {any} */ (window).__AIMEAT_FRAME__;
    var host = (named && typeof named.origin === 'string' && named.origin) || (location.protocol + '//' + location.host);
    var timer = null;
    function done(value) {
      window.removeEventListener('message', onMessage);
      if (timer) clearTimeout(timer);
      resolve(value);
    }
    function onMessage(e) {
      if (e.source !== window.parent || e.origin !== host) return;
      var d = e.data || {};
      if (d.type !== 'aimeat_frame_res' || d.id !== id) return;
      done(d.result === undefined ? null : d.result);
    }
    window.addEventListener('message', onMessage);
    if (timeoutMs) timer = setTimeout(function () { done(null); }, timeoutMs);
    try {
      window.parent.postMessage(Object.assign({ type: 'aimeat_frame_req', id: id, op: op }, payload || {}), host);
    } catch { done(null); }
  });
}
