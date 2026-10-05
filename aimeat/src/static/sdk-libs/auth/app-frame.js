/**
 * @file auth/app-frame.js
 * @description The isolated-frame half of aimeat-auth. On a node that several people share and that
 *   has no app origin, an app runs in a frame whose origin is opaque: it has no cookie and no storage
 *   of the node, and the page around it (the node's src/static/app-frame.js) asks the node for the
 *   app's own grant on its behalf. These two helpers are the frame's side of that conversation. They
 *   carry the same three requests the app-origin bridge makes (the silent sign-in, the visible
 *   consent, the node sign-out), sent to the parent page instead of to a hidden bridge iframe, which a
 *   frame with an opaque origin could not use: the bridge would inherit the sandbox.
 * @structure inIsolatedFrame() · frameHost() · postToFrameHost(message, timeoutMs, accept) ·
 *   parentAuth(timeoutMs) · askFrameHost(op, payload, timeoutMs)
 * @usage import { inIsolatedFrame, askFrameHost, parentAuth } from './app-frame.js';
 * @version-history
 *   v1.2.0 — 2026-10-05 — Secaudit 2026-10, WEB-1: every request carries the frame's secret
 *     (window.__AIMEAT_FRAME__.secret, which the frame support script took from the boot data), and
 *     the answer comes back on a MessagePort of this document, so the page never answers by posting
 *     to the frame's window, where a later document could read it.
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
 * The page's origin and this frame's secret, as the frame support script kept them from the boot
 * data. A preview written in as srcdoc has no address of its own to fall back to.
 * @returns {{ host: string, secret: string }}
 */
export function frameHost() {
  var named = /** @type {any} */ (window).__AIMEAT_FRAME__;
  return {
    host: (named && typeof named.origin === 'string' && named.origin) || (location.protocol + '//' + location.host),
    secret: (named && typeof named.secret === 'string' && named.secret) || '',
  };
}

/**
 * Post `message` to the page that holds this frame, with the frame's secret, and resolve to the first
 * answer that arrives on a MessagePort this document owns (or null on a timeout). The page answers
 * only a message with the secret, and only on the port, so no other document of the frame sees it.
 * @param {Record<string, unknown>} message
 * @param {number} [timeoutMs]
 * @param {(data: any) => boolean} [accept]  which answer on the port is the one
 * @returns {Promise<any>}
 */
export function postToFrameHost(message, timeoutMs, accept) {
  return new Promise(function (resolve) {
    var at = frameHost();
    var channel = new MessageChannel();
    var timer = null;
    function done(value) {
      if (timer) clearTimeout(timer);
      try { channel.port1.close(); } catch { /* closed already */ }
      resolve(value);
    }
    channel.port1.onmessage = function (e) {
      var d = e.data || {};
      if (accept && !accept(d)) return;
      done(d);
    };
    if (timeoutMs) timer = setTimeout(function () { done(null); }, timeoutMs);
    try {
      window.parent.postMessage(Object.assign({}, message, { secret: at.secret }), at.host, [channel.port2]);
    } catch { done(null); }
  });
}

/**
 * The older sandbox request (AIMEAT.auth.requestParentAuth): ask the parent page for a token.
 * Inside the node's isolated frame it goes with the secret and comes back on a port. Elsewhere (an
 * app framed by a page of its own) the answer is taken only from the parent window, so another
 * window the app opened cannot hand it a token. Resolves to { jwt, nodeUrl } or null.
 * @param {number} timeoutMs
 * @returns {Promise<{ jwt: string, nodeUrl: string } | null>}
 */
export function parentAuth(timeoutMs) {
  var pick = function (d) { return d && d.type === 'aimeat-auth' && d.jwt ? { jwt: String(d.jwt), nodeUrl: d.nodeUrl ? String(d.nodeUrl) : '' } : null; };
  if (inIsolatedFrame()) {
    return postToFrameHost({ type: 'aimeat-request-auth' }, timeoutMs, function (d) { return d.type === 'aimeat-auth'; }).then(pick);
  }
  return new Promise(function (resolve) {
    var timer = setTimeout(function () { window.removeEventListener('message', onMessage); resolve(null); }, timeoutMs);
    function onMessage(e) {
      if (e.source !== window.parent || !e.data || e.data.type !== 'aimeat-auth') return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(pick(e.data));
    }
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'aimeat-request-auth' }, '*');
  });
}

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
  var id = 'f' + (++sequence) + '-' + Math.random().toString(36).slice(2);
  var request = Object.assign({}, payload || {}, { type: 'aimeat_frame_req', id: id, op: op });
  return postToFrameHost(request, timeoutMs, function (d) { return d.type === 'aimeat_frame_res' && d.id === id; })
    .then(function (d) { return d && d.result !== undefined ? d.result : null; });
}
