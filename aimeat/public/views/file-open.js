/**
 * @file public/views/file-open.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A stored file, read with the session. A link to GET /v1/pub/:owner/{*key} (in an AI's
 *   answer, a message, a document) opens in a new tab, and a new tab sends no credential even for a
 *   signed-in person: the SPA keeps the session in localStorage. Where that tab could not read the file
 *   (the content access gate on a signed-in-only node, the route's 404 on an open node), the node sends
 *   the browser here (middleware/file-open-redirect.ts) with the address it asked for in `path`.
 *
 *   This page asks the same address with the session for a download handle (`?mode=handle`), which the
 *   route answers on the same access decision as the bytes, and goes to the handle's presigned
 *   /v1/download/ address, which carries its own credential. The route decides: the page only carries
 *   the session to it. A person with no session is asked to sign in first; a refusal and a missing file
 *   are said in words, with the server's own message for a refusal.
 *
 *   ONLY A FILE ADDRESS ON THIS NODE. `path` must start with /v1/pub/, and the page goes only to the
 *   path of the handle's address on this origin, so the page cannot be made to send anyone elsewhere.
 * @structure fileAddressOf() · handleAddressOf() · downloadPathOf() · FileOpen()
 * @usage '/v1/file-open': () => import('/views/file-open.js')   // spa.html ROUTES, ?path=<the /v1/pub address>
 * @version-history
 *   v1.0.1 — 2026-11-27 — A `path` with a dot segment is not a file address (secaudit2026nov26).
 *   v1.0.0 — 2026-11-23 — Initial: a file link answered a signed-in person 401 on a signed-in-only node
 *     and 404 on an open node for a file that is not public.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api, hasDotSegment } from '/js/api.js';
import { showLoginModal } from '/js/services/auth.js';
import { useSession } from '/js/use-session.js';
import { swallowed } from '/js/swallowed.js';
import { AskPage } from '/components/AskPage.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);

/**
 * The file address the link named, or '' when `path` is not a file address on this node. A path with
 * a dot segment is none: the browser resolves the dots before it sends, so `/v1/pub/a/../../auth/x`
 * passes the pattern and asks another route with the session (secaudit2026nov26).
 */
function fileAddressOf(search) {
  const path = new URLSearchParams(search).get('path') || '';
  return /^\/v1\/pub\/[^/?#]+\/[^?#]+(\?[^#]*)?$/.test(path) && !hasDotSegment(path) ? path : '';
}

/** The same address asking for the download handle instead of the bytes. */
function handleAddressOf(path) {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('mode', 'handle');
  return `${base}?${params.toString()}`;
}

/** The path of the handle's presigned address on this origin, or '' when it is not one. */
function downloadPathOf(url) {
  try {
    const u = new URL(url, window.location.origin);
    return /^\/v1\/download\/[^/]+$/.test(u.pathname) ? u.pathname + u.search : '';
  } catch (err) {
    swallowed('file-open: download address', err);
    return '';
  }
}

export default function FileOpen() {
  const path = fileAddressOf(window.location.search);
  const signedIn = !!useSession();
  const [state, setState] = useState({ status: 'loading', error: '' });
  document.title = `${t('fileOpen.title')} — AIMEAT`;

  useEffect(() => {
    if (!path) { setState({ status: 'error', error: t('fileOpen.missing') }); return; }
    if (!signedIn) { setState({ status: 'login', error: '' }); return; }
    setState({ status: 'loading', error: '' });
    api(handleAddressOf(path)).then((res) => {
      const to = downloadPathOf(res?.data?.download_url || '');
      if (to) window.location.replace(to);
      else setState({ status: 'error', error: t('fileOpen.failed') });
    }).catch((e) => {
      const code = e?.response?.error?.code || e?.code || '';
      // The session ran out between the page load and this read.
      if (code === 'SIGN_IN_REQUIRED' || e?.status === 401) { setState({ status: 'login', error: '' }); return; }
      if (code === 'NOT_FOUND' || e?.status === 404) { setState({ status: 'error', error: t('fileOpen.notFound') }); return; }
      setState({ status: 'error', error: e?.message || t('fileOpen.failed') });
    });
  }, [path, signedIn]);

  if (state.status === 'loading') return html`<${AskPage} message=${t('fileOpen.loading')} />`;

  if (state.status === 'login') {
    const signIn = () => { if (!showLoginModal({ redirect: window.location.href })) window.location.href = '/v1/profile'; };
    return html`
      <${AskPage} title=${t('signInFirst.title')}
        doors=${html`<${Loud} onClick=${signIn}>${t('signInFirst.cta')}<//>`}>
        <${Note} kind="lead">${t('fileOpen.signIn')}<//>
      <//>`;
  }

  return html`
    <${AskPage} title=${t('fileOpen.errorTitle')}
      doors=${html`<${Action} onClick=${() => { window.location.href = '/v1/home'; }}>${t('common.back')}<//>`}>
      <${Note} kind="lead">${state.error}<//>
    <//>`;
}
