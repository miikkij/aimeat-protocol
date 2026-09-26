/**
 * @file preview-host.js
 * @description The catalog's preview frame (#app-iframe, sandboxed without allow-same-origin) and what
 *   this page answers the code in it. A preview holds code nobody has published yet: a working copy,
 *   a checkpoint, an AI proposal. It can be another person's work (a fork's author, a builder holding
 *   a development right), so it gets what the app would get and nothing more:
 *     - a sign-in is the app's own scoped grant from /v1/auth/app-grant-silent?app=owner/file, asked
 *       with this page's cookie (../../app-frame-core.js, the same door the isolated frame uses): the
 *       owner's own app silently, another person's app nothing until the owner agrees in the consent
 *       window. The frame gets the access token alone; the refresh token stays here;
 *     - the older road (AIMEAT.auth.requestParentAuth, `aimeat-request-auth`) gets that token or none;
 *     - code with no published name gets nothing, and a preview never ends the owner's session.
 *   The owner's session token never enters the frame. Until 2026-09-26 this page answered the older
 *   road with it, whoever had written the code.
 * @structure previewTarget(owner, filename) · answerPreview(data, target, deps) (pure) ·
 *   openPreview(html, target) · initPreviewHost()
 * @usage import { openPreview, previewTarget, initPreviewHost } from './preview-host.js'
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the preview gets the app's own grant, never the owner's session
 *     (main.js answered `aimeat-request-auth` with the session token).
 */
import { silentGrant, consentWindow } from '../../app-frame-core.js';
import { showNotice } from './ui.js';
import { t } from './i18n.js';

/** The app the preview frame holds, as the node names it (`owner/file`), or '' when it has no name. */
var currentTarget = '';

/** The script the node puts in front of an app in a frame of its own (fetched once, revalidated). */
var shimSource = null;

/** `owner/file` for a preview of a published app, '' for code that has no name on the node. */
export function previewTarget(owner, filename) {
  return owner && filename ? String(owner) + '/' + String(filename) : '';
}

/**
 * The answer to one message from the preview frame, or null for none. Pure: `deps.grant(app, scope)`
 * asks the node for the app's own grant, `deps.consent(app, scope, manage)` runs the consent window,
 * `deps.origin` is this page's origin. Nothing else the page holds is read, the owner's session least
 * of all.
 */
export async function answerPreview(data, target, deps) {
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'aimeat-request-auth') {
    var r = target ? await deps.grant(target, '') : null;
    return { type: 'aimeat-auth', jwt: r && r.ok && r.access_token ? r.access_token : null, nodeUrl: deps.origin };
  }
  if (data.type !== 'aimeat_frame_req' || typeof data.id !== 'string') return null;
  var reply = function (result) { return { type: 'aimeat_frame_res', id: data.id, op: data.op, result: result === undefined ? null : result }; };
  var scope = String(data.scope || '');
  if (data.op === 'login') return reply(target ? await deps.grant(target, scope) : { ok: false, error: 'unknown_app' });
  if (data.op === 'consent') return reply(target ? await deps.consent(target, scope, !!data.manage) : null);
  // The owner signs out of the node on the node's own pages, never from code being previewed.
  if (data.op === 'logout') return reply({ ok: false, error: 'preview' });
  return reply(null);
}

/** The consent window for the previewed app; its redirect is the app's own address on the node. */
function consentForPreview(app, scope, manage) {
  var slash = app.indexOf('/');
  var redirectUri = location.origin + '/v1/apps/' + encodeURIComponent(app.slice(0, slash))
    + '/' + encodeURIComponent(app.slice(slash + 1));
  return consentWindow(app, scope, manage, redirectUri, function (_retry, cancel) {
    // The browser stopped the window; the preview's own button is the click to try again from.
    showNotice(t('preview.popupBlocked'));
    cancel();
  });
}

/** Put the node's frame support script in front of the preview's own markup. */
function withSupport(html) {
  if (!shimSource) return html;
  var tag = '<script data-aimeat-frame-support>' + shimSource + '</' + 'script>';
  var at = /<head\b[^>]*>/i.exec(html) || /<html\b[^>]*>/i.exec(html) || /^\s*<!doctype[^>]*>/i.exec(html);
  var cut = at ? at.index + at[0].length : 0;
  return html.slice(0, cut) + tag + html.slice(cut);
}

/**
 * Show `html` in the preview frame as the app `target` (see previewTarget). The frame's name carries
 * the boot data the support script reads, so aimeat-auth in the preview asks this page for a sign-in.
 */
export function openPreview(html, target) {
  var iframe = document.getElementById('app-iframe');
  currentTarget = target || '';
  // A browser reads an iframe's name into the frame only when the frame is created, so every preview
  // gets a fresh copy of the element (its id, sandbox and data attributes come along).
  var fresh = /** @type {HTMLIFrameElement} */ (iframe.cloneNode(false));
  fresh.removeAttribute('src');
  fresh.name = 'aimeat-frame:' + JSON.stringify({ v: 1, origin: location.origin, ls: {}, ss: {} });
  fresh.srcdoc = withSupport(html);
  iframe.replaceWith(fresh);
}

/** The one door in: this page's own preview frame, while it is sandboxed (its origin is opaque). */
export function initPreviewHost() {
  fetch('/app-frame-shim.js', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.text() : ''; })
    .then(function (text) { shimSource = text ? text.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '') : null; })
    .catch(function () { shimSource = null; });
  var deps = { grant: silentGrant, consent: consentForPreview, origin: location.origin };
  window.addEventListener('message', function (e) {
    var iframe = document.getElementById('app-iframe');
    if (!iframe || !iframe.contentWindow || e.source !== iframe.contentWindow || e.origin !== 'null') return;
    var target = currentTarget;
    answerPreview(e.data, target, deps).then(function (answer) {
      // '*' because the frame's origin is opaque; the answer goes to this page's own frame only, and
      // only while it still holds the preview that asked.
      if (answer && currentTarget === target && iframe.contentWindow) iframe.contentWindow.postMessage(answer, '*');
    });
  });
}

/** Forget the preview when the frame closes, so a late answer cannot reach the next one. */
export function clearPreview() {
  currentTarget = '';
}
