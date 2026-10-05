/**
 * @file public/views/appcat/viewer.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description appcat's app viewer (features F54–F56) and the preview host behind it (F296–F298): a
 *   layer over the whole window with the close button, the title, the "Publish your own app" pill and
 *   the app in a frame sandboxed `allow-scripts allow-forms allow-popups` (never allow-same-origin, so
 *   its origin is opaque). It shows only code that is not published as such: an AI proposal, a
 *   checkpoint. A published app never runs here; it opens in a tab of its own (F294).
 *
 *   The code in the frame gets what the app would get and nothing more (the old preview-host.js):
 *   every preview is a fresh frame whose name carries the boot data ('aimeat-frame:' + { v: 1, origin,
 *   secret, ls: {}, ss: {} }, which the shim clears) and whose srcdoc is the code with the node's frame shim (/app-frame-shim.js,
 *   fetched without the cache, its header comment removed) put right after <head> (or <html>, or the
 *   doctype, or at the start). The page answers messages from its own frame only while the frame is
 *   sandboxed (origin 'null'), the message carries the frame's secret, and the same preview still
 *   shows, and it answers on the request's MessagePort: `aimeat-request-auth` gets the app's
 *   own grant token or null; `aimeat_frame_req` login gets the silent grant for owner/file, consent
 *   the consent window, logout is refused ({ ok: false, error: 'preview' }), anything else null. Code
 *   with no published name gets no token, and the owner's session token never enters the frame.
 *   Closing forgets the preview, so a late answer cannot reach the next one.
 *
 *   The layer mounts itself on the first openViewer(), so no page has to draw it. Escape closes it
 *   before anything else on the page (F170), unless a dialog is open.
 *
 *   The SPA's page answers with a nonce-based script policy, and a srcdoc document inherits the
 *   policy of the page that holds it; so the shim and every <script> of the previewed code carry the
 *   page's own nonce, or none of them would run. Handlers written into attributes (onclick="…") still
 *   do not run in a preview here, which the old page (script-src 'unsafe-inline') allowed.
 * @structure openViewer({ title, html, target }) · closeViewer() · isViewerOpen() · previewTarget(owner, filename) ·
 *   answerPreview(data, target, deps) (pure)
 * @usage import { openViewer, previewTarget } from '/views/appcat/viewer.js';
 *        openViewer({ title: name + ' — ' + x('wc.previewTitle'), html, target: previewTarget(owner, file) });
 * @version-history
 *   v1.2.0 — 2026-10-05 — Secaudit 2026-10, WEB-1 and WEB-2: each preview frame gets a secret in its
 *     boot data (app-frame-core.js bootName) and the page answers only a message that carries it
 *     (fromFrame), on the request's MessagePort; a frame document without boot data gets the preview
 *     opened again; the grant is asked as unpublished code, so the owner's own app widens its grant
 *     only through the consent window.
 *   v1.1.0 — 2026-09-27 — Parity pass: the old toolbar's look (Overlay fill with normalLeading) and its
 *     "⚡ Publish your own app" pill (Overlay link) in place of an action link.
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's #iframe-view (render.js launchInIframe,
 *     closeIframe) and preview-host.js on the component library.
 */
import { h, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Overlay } from '/components/Overlay.js';
import { x } from '/views/appcat/i18n.js';
import { notice } from '/views/appcat/store.js';
import { anyDialogOpen } from '/views/appcat/dialogs/host.js';

const html = htm.bind(h);

/** @type {{ title: string, code: string, srcdoc: string, name: string, secret: string, target: string, seq: number } | null} */
let current = null;
/** The frame core once loaded (openViewer loads it before any frame exists). */
let core = null;
let reopened = [];
let seq = 0;
const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(); };

/** `owner/file` for a preview of a published app, '' for code that has no name on the node. */
export function previewTarget(owner, filename) {
  return owner && filename ? String(owner) + '/' + String(filename) : '';
}

/**
 * The answer to one message from the preview frame, or null for none. Pure: `deps.grant(app, scope)`
 * asks the node for the app's own grant, `deps.consent(app, scope, manage)` runs the consent window,
 * `deps.origin` is this page's origin. Nothing else the page holds is read, the session least of all.
 */
export async function answerPreview(data, target, deps) {
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'aimeat-request-auth') {
    const r = target ? await deps.grant(target, '') : null;
    return { type: 'aimeat-auth', jwt: r && r.ok && r.access_token ? r.access_token : null, nodeUrl: deps.origin };
  }
  if (data.type !== 'aimeat_frame_req' || typeof data.id !== 'string') return null;
  const reply = (result) => ({ type: 'aimeat_frame_res', id: data.id, op: data.op, result: result === undefined ? null : result });
  const scope = String(data.scope || '');
  if (data.op === 'login') return reply(target ? await deps.grant(target, scope) : { ok: false, error: 'unknown_app' });
  if (data.op === 'consent') return reply(target ? await deps.consent(target, scope, !!data.manage) : null);
  // The owner signs out on the node's own pages, never from code being previewed.
  if (data.op === 'logout') return reply({ ok: false, error: 'preview' });
  return reply(null);
}

// ── The node's frame support: the shim and the grant doors ─────────────────────────────────────

let shimPromise = null;
/** The frame shim's source without its header comment, fetched once and revalidated; null when there is none. */
function loadShim() {
  if (!shimPromise) {
    shimPromise = fetch('/app-frame-shim.js', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => (text ? text.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '') : null))
      // No shim: the preview runs without the storage bridge, as the old page did.
      .catch((err) => { console.warn('[appcat] the frame shim could not be read', err); return null; });
  }
  return shimPromise;
}

// The grant and consent code the isolated frame's page uses. It is served at the root with
// no-cache, so every open reads the node's own version; a name in a variable keeps it out of the
// importmap, which has nothing to stamp on it.
const FRAME_CORE = '/app-frame-core.js';
let corePromise = null;
const loadCore = () => (corePromise ||= import(FRAME_CORE));

/** The page's own script nonce (the policy the srcdoc inherits allows scripts that carry it). */
function pageNonce() {
  const el = /** @type {HTMLScriptElement|null} */ (document.querySelector('script[nonce]'));
  return (el && (el.nonce || el.getAttribute('nonce'))) || '';
}

/** The code with the shim in front of its own markup, every script carrying the page's nonce. */
function withSupport(code, shim, nonce) {
  let text = String(code || '');
  const n = nonce ? ' nonce="' + nonce.replace(/"/g, '') + '"' : '';
  if (n) text = text.replace(/<script\b(?![^>]*\bnonce=)/gi, '<script' + n);
  if (!shim) return text;
  const tag = '<script data-aimeat-frame-support' + n + '>' + shim + '</' + 'script>';
  const at = /<head\b[^>]*>/i.exec(text) || /<html\b[^>]*>/i.exec(text) || /^\s*<!doctype[^>]*>/i.exec(text);
  const cut = at ? at.index + at[0].length : 0;
  return text.slice(0, cut) + tag + text.slice(cut);
}

/** The consent window for the previewed app; its redirect is the app's own address on the node. */
async function consentForPreview(app, scope, manage) {
  const core = await loadCore();
  const slash = app.indexOf('/');
  const redirectUri = location.origin + '/v1/apps/' + encodeURIComponent(app.slice(0, slash)) + '/' + encodeURIComponent(app.slice(slash + 1));
  return core.consentWindow(app, scope, manage, redirectUri, (_retry, cancel) => {
    // The browser stopped the window; the preview's own button is the click to try again from.
    notice(x('preview.popupBlocked'), 'error');
    cancel();
  });
}

const deps = {
  // A preview is never the published version, so the node approves the owner's own app silently only
  // within the grant the owner already holds.
  grant: async (app, scope) => (await loadCore()).silentGrant(app, scope, { unpublished: true }),
  consent: consentForPreview,
  get origin() { return location.origin; },
};

// ── Open and close ─────────────────────────────────────────────────────────────────────────────

let mounted = false;
/** The layer mounts itself once, at the end of the body, the first time something is shown. */
function mount() {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  const host = document.createElement('div');
  host.setAttribute('data-appcat-viewer', '');
  document.body.appendChild(host);
  render(html`<${ViewerHost} />`, host);
}

/**
 * Show code in the sandboxed frame as the app `target` (see previewTarget; '' for code with no name).
 * @param {{ title: string, html: string, target?: string }} what
 */
export async function openViewer({ title, html: code, target }) {
  const mine = ++seq;
  const [shim, loaded] = await Promise.all([loadShim(), loadCore()]);
  if (mine !== seq) return;
  core = loaded;
  const secret = core.frameSecret();
  current = {
    title: String(title || ''),
    code: String(code || ''),
    srcdoc: withSupport(code, shim, pageNonce()),
    name: core.bootName({ origin: location.origin, secret }),
    secret,
    target: target || '',
    seq: mine,
  };
  mount();
  emit();
}

/** Close the viewer and forget the preview (F298). */
export function closeViewer() {
  if (!current) return;
  current = null;
  seq++;
  emit();
}

/** Whether the viewer is showing something (the page's Escape closes it first). */
export function isViewerOpen() { return !!current; }

function ViewerHost() {
  const [, tick] = useState(0);
  const frame = useRef(null);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);

  // The one way in: this viewer's own frame, while it is sandboxed (its origin is opaque), and only
  // with the secret the frame was given in its boot data.
  useEffect(() => {
    const onMessage = (e) => {
      const el = frame.current;
      const shown = current;
      if (!shown || !core || !el || !el.contentWindow || e.source !== el.contentWindow || e.origin !== 'null') return;
      const d = e.data;
      if (d && typeof d === 'object' && d.type === core.FRAME_BOOT) {
        // A reload inside the preview frame: the same preview in a new frame (bounded).
        const now = Date.now();
        reopened = reopened.filter((t) => now - t < 10000);
        if (reopened.length < 5) {
          reopened.push(now);
          openViewer({ title: shown.title, html: shown.code, target: shown.target });
        }
        return;
      }
      if (!core.fromFrame(e, el, shown.secret)) return;
      const port = e.ports && e.ports[0];
      if (!port) return;
      answerPreview(d, shown.target, deps).then((answer) => {
        // On the port of the document that asked, and only while the frame holds that preview.
        if (answer && current && current.seq === shown.seq) port.postMessage(answer);
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Escape closes the viewer first (F170), and nothing under it.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || !current || anyDialogOpen()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeViewer();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!current) return null;
  // The old toolbar's pill (.aimeat-cta): the spark, the words, a new tab to the node's front page.
  const link = { href: '/', label: x('cta.publishOwn'), mark: '⚡', title: x('cta.publishOwn') };
  // key: a browser reads a frame's name only when the frame is made, so every preview is a new frame.
  return html`<${Overlay} fill normalLeading label=${current.title} title=${current.title} link=${link}
      onClose=${closeViewer} closeLabel=${x('common.close')}>
    <iframe key=${current.seq} ref=${frame} name=${current.name} title=${current.title}
      sandbox="allow-scripts allow-forms allow-popups" srcdoc=${current.srcdoc}></iframe>
  <//>`;
}
