/**
 * @file public/views/sign-in-first.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sign-in page of a node set to show its content to signed-in accounts only (config
 *   contentAccess 'signed-in', plan doc-mvcn6c7e4e5q V1.5). spa.html draws it in place of every view
 *   for a visitor without a session (js/site.js signInFirst), the front page included, because the API
 *   answers such a visitor 401 everywhere outside sign-in (middleware/content-access-gate.ts). The
 *   steps of signing in (js/site.js SIGN_IN_STEPS) keep their own views.
 *
 *   The address stays the one the visitor opened. The sign-in dialog (password, passkey, a provider,
 *   an emailed link) returns to it, and spa.html routes the address again the moment the session
 *   arrives, so the page the visitor came for opens without a second click.
 *
 *   Same page shape as the app-open and app-grant pages (components/AskPage.js): the address of this
 *   service at the top, so the visitor knows where they sign in.
 * @structure SignInFirst()
 * @usage spa.html viewFor(): signInFirst(pathname, !!getSession()) → import('/views/sign-in-first.js' + B)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V1.5).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { showLoginModal } from '/js/services/auth.js';
import { AskPage } from '/components/AskPage.js';
import { Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);

export default function SignInFirst() {
  const host = window.location.host;
  // The dialog returns an emailed sign-in link to this address by default, which is the page the
  // visitor opened. Without the auth library there is no dialog: a reload loads it again.
  const signIn = () => { if (!showLoginModal({})) window.location.reload(); };
  return html`
    <${AskPage} title=${t('signInFirst.title')}
      who=${{ name: host, text: host.charAt(0).toUpperCase() }}
      doors=${html`<${Loud} onClick=${signIn}>${t('signInFirst.cta')}<//>`}>
      <${Note} kind="lead">${t('signInFirst.body')}<//>
      <${Note} kind="hint">${t('signInFirst.noAccount')}<//>
    <//>`;
}
