/**
 * @file public/views/provenance-open.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The readable provenance record of an AI label, read with the session. A visible AI label
 *   inside an app links to GET /v1/provenance/:id in a new tab, and a new tab sends no credential even
 *   for a signed-in person. On a node set to show its content to signed-in accounts only, the content
 *   access gate sends such a browser here (middleware/content-access-gate.ts provenanceOpenRedirect),
 *   and this page asks the same route with the session for the same readable page a browser gets on an
 *   open node (services/ai/provenance-page.ts). One renderer, on the server; this page only carries the
 *   session to it.
 *
 *   THE FRAME. The record page is shown in a sandboxed srcdoc frame that runs no script (no
 *   allow-scripts): the page has none, and a frame that cannot run one keeps it that way whatever the
 *   record holds. allow-same-origin without allow-scripts lets this page measure the document's height,
 *   so the record reads as the page and not as a box with a scroll bar. `<base target="_top">` makes the
 *   page's links (the transparency statement, the JSON record, a source) open in the window, which the
 *   sandbox allows on a press only.
 *
 *   The route decides what the session may see: the owner gets the whole record, another account the
 *   record of content something public points at, and everything else the route's one not-found page,
 *   which is shown in the frame as it is.
 * @structure withTopTarget() · ProvenanceOpen() (fit() measures the frame on load and when its width changes)
 * @usage '/v1/provenance-open': () => import('/views/provenance-open.js' + B)   // spa.html ROUTES, ?id=<record id>
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial: an AI label's link answered a signed-in person 401 on a signed-in-only
 *     node (seen on orgnode.example).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { api } from '/js/api.js';
import { showLoginModal } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';
import { AskPage } from '/components/AskPage.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);

/** The record page with its links opening in the window instead of the frame. */
function withTopTarget(doc) {
  const base = '<base target="_top">';
  return /<head[^>]*>/i.test(doc) ? doc.replace(/<head[^>]*>/i, (m) => m + base) : base + doc;
}

export default function ProvenanceOpen() {
  const id = new URLSearchParams(window.location.search).get('id') || '';
  const [state, setState] = useState({ status: 'loading', doc: '', error: '' });
  const frame = useRef(null);
  document.title = `${t('aiLabel.page.title')} — AIMEAT`;

  useEffect(() => {
    if (!id) { setState({ status: 'error', doc: '', error: t('provenanceOpen.missing') }); return; }
    // The readable page, as the route negotiates it for a browser, in the language this page shows.
    api(`/v1/provenance/${encodeURIComponent(id)}`, {
      rawText: true, headers: { Accept: 'text/html', 'Accept-Language': getLocale() },
    }).then((doc) => {
      if (typeof doc === 'string') setState({ status: 'ready', doc: withTopTarget(doc), error: '' });
      else setState({ status: 'error', doc: '', error: t('provenanceOpen.failed') });
    }).catch((e) => {
      const code = e?.response?.error?.code || e?.code || '';
      // The session ran out between the page load and this read.
      if (code === 'SIGN_IN_REQUIRED' || e?.status === 401) { setState({ status: 'login', doc: '', error: '' }); return; }
      setState({ status: 'error', doc: '', error: e?.message || t('provenanceOpen.failed') });
    });
  }, [id]);

  /**
   * The frame as tall as the record, so the window scrolls and the frame does not. The root's own box
   * is the record's height; its scrollHeight never goes below the frame's, so a frame that once grew
   * would never shrink back.
   */
  function fit() {
    try {
      const el = frame.current;
      const doc = el?.contentDocument?.documentElement;
      if (el && doc) el.style.height = `${Math.ceil(doc.getBoundingClientRect().height)}px`;
    } catch (err) { swallowed('provenance-open: fit', err); }
  }

  // A narrower frame wraps the record onto more lines: measure again whenever its width changes, which
  // a window resize does and so does the window's scroll bar appearing once the frame has grown.
  useEffect(() => {
    if (state.status !== 'ready' || !frame.current || typeof ResizeObserver !== 'function') return undefined;
    let width = 0;
    const watch = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w !== width) { width = w; fit(); }
    });
    watch.observe(frame.current);
    return () => watch.disconnect();
  }, [state.status]);

  if (state.status === 'loading') return html`<${AskPage} message=${t('provenanceOpen.loading')} />`;

  if (state.status === 'login') {
    const signIn = () => { if (!showLoginModal({ redirect: window.location.href })) window.location.reload(); };
    return html`
      <${AskPage} title=${t('signInFirst.title')}
        doors=${html`<${Loud} onClick=${signIn}>${t('signInFirst.cta')}<//>`}>
        <${Note} kind="lead">${t('signInFirst.body')}<//>
      <//>`;
  }

  if (state.status === 'error') {
    return html`
      <${AskPage} title=${t('provenanceOpen.errorTitle')}
        doors=${html`<${Action} onClick=${() => { window.location.href = '/v1/home'; }}>${t('common.back')}<//>`}>
        <${Note} kind="lead">${state.error}<//>
      <//>`;
  }

  return html`
    <div class="tp-record">
      <iframe ref=${frame} class="tp-record-frame" title=${t('aiLabel.page.title')}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
        srcdoc=${state.doc} onLoad=${fit}></iframe>
    </div>`;
}
