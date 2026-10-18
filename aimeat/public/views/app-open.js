/**
 * @file public/views/app-open.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Opening an app, a welcome page or a company front page that needs a sign-in (plan
 *   doc-mvcn6c7e4e5q, V2.2 and V3.10). The app origin, the portfolio origin, the company origin and the
 *   apex app read send a browser here when what it opened opens only for signed-in people or for one
 *   organism's members (an app's `open_to`, a page's `access`, or the node's signed-in content access).
 *   This page holds the session the page load could not carry: it signs the person in when needed,
 *   asks the open route with the session, and goes to the address that answers, which carries a
 *   short-lived grant the origin verifies. Three targets, one per query parameter:
 *
 *     ?app=<owner>/<file>   POST /v1/apps/:owner/:filename/open   (an access code is asked for here too)
 *     ?portfolio=<user>     POST /v1/portfolio/:username/open
 *     ?company=<id>         POST /v1/companies/:id/open
 *
 *   Same page shape as the app-grant page (components/AskPage.js).
 * @structure targetOf() · AppOpen()
 * @usage '/v1/app-open': () => import('/views/app-open.js' + B)   // spa.html ROUTES
 * @version-history
 *   v1.2.0 — 2026-10-18 — A refusal in words of the page language: NOT_FOUND says the page's own
 *     "cannot be opened", and SIGN_IN_REQUIRED (a session that ran out on the way) asks for the sign-in
 *     again. The denial names a shared place, the word a person reads for an organism.
 *   v1.1.0 — 2026-10-18 — Also opens a welcome page (?portfolio=) and a company front page (?company=),
 *     with page wording (appOpen.page.*); a page has no access code (V3.10).
 *   v1.0.0 — 2026-10-17 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api } from '/js/api.js';
import { showLoginModal, getNodeUrl } from '/js/services/auth.js';
import { useSession } from '/js/use-session.js';
import { swallowed } from '/js/swallowed.js';
import { AskPage } from '/components/AskPage.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { TextField } from '/components/TextField.js';

const html = htm.bind(h);
const tr = (key, fallback, vars) => {
  const v = t(key, vars);
  if (v && v !== key) return v;
  let s = fallback;
  if (vars) for (const [k, val] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(val));
  return s;
};

/**
 * What the address names: the open route to ask, and whether it is a page (page wording, no access
 * code). Null when it names nothing usable.
 */
function targetOf(params) {
  const app = params.get('app') || '';
  const slash = app.indexOf('/');
  if (slash > 0 && slash < app.length - 1) {
    return { route: `/v1/apps/${encodeURIComponent(app.slice(0, slash))}/${encodeURIComponent(app.slice(slash + 1))}/open`, page: false };
  }
  const portfolio = params.get('portfolio') || '';
  if (portfolio) return { route: `/v1/portfolio/${encodeURIComponent(portfolio)}/open`, page: true };
  const company = params.get('company') || '';
  if (company) return { route: `/v1/companies/${encodeURIComponent(company)}/open`, page: true };
  return null;
}

export default function AppOpen() {
  const search = window.location.search;
  const target = targetOf(new URLSearchParams(search));
  const route = target ? target.route : '';
  const isPage = !!target && target.page;
  // The page wording sits under appOpen.page.*; the shared strings (sign-in button, code form) stay under appOpen.*.
  const w = (key, appFallback, pageFallback, vars) => (isPage
    ? tr(`appOpen.page.${key}`, pageFallback, vars)
    : tr(`appOpen.${key}`, appFallback, vars));
  const authed = !!useSession();
  const loginOpened = useRef(false);
  const [state, setState] = useState({ status: 'loading', error: '' });
  const [code, setCode] = useState('');

  function doLogin() {
    // Back to this page after signing in, so the app or page opens without a second click.
    if (!showLoginModal({ redirect: window.location.href })) window.location.href = '/v1/profile';
  }

  async function open(withCode) {
    setState({ status: 'loading', error: '' });
    try {
      const res = await api(route, {
        method: 'POST', body: JSON.stringify(withCode ? { code: withCode } : {}),
      });
      window.location.replace(res.data.url);
    } catch (e) {
      const codeName = e?.response?.error?.code || e?.code || '';
      if (codeName === 'ACCESS_CODE_REQUIRED' && !isPage) { setState({ status: 'code', error: withCode ? tr('appOpen.codeWrong', 'That code does not open this app.') : '' }); return; }
      if (codeName === 'ACCESS_DENIED') { setState({ status: 'denied', error: '' }); return; }
      // The session ran out between the page load and this call: the same sign-in as a visitor's.
      if (codeName === 'SIGN_IN_REQUIRED' || e?.status === 401) { setState({ status: 'login', error: '' }); return; }
      const notFound = w('notFound', 'This app cannot be opened.', 'This page cannot be opened.');
      setState({ status: 'error', error: codeName === 'NOT_FOUND' ? notFound : (e?.message || notFound) });
    }
  }

  useEffect(() => {
    if (!route) { setState({ status: 'error', error: tr('appOpen.missing', 'No app was named.') }); return; }
    if (!authed) {
      setState({ status: 'login', error: '' });
      if (!loginOpened.current) { loginOpened.current = true; doLogin(); }
      return;
    }
    open('').catch((err) => swallowed('app-open: open', err));
    // open() and doLogin() read only the route and the session, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, route]);

  if (state.status === 'loading') return html`<${AskPage} message=${w('opening', 'Opening the app…', 'Opening the page…')} />`;

  if (state.status === 'login') {
    let nodeHost = '';
    try { nodeHost = new URL(getNodeUrl()).host; } catch (err) { swallowed('app-open: nodeHost', err); }
    return html`
      <${AskPage} title=${w('loginTitle', 'Sign in to open this app', 'Sign in to open this page')}
        doors=${html`<${Loud} onClick=${doLogin}>${tr('appOpen.loginCta', 'Sign in')}<//>`}>
        <${Note} kind="lead">${w('loginBody',
          'This app opens for people signed in to {node}. Sign in, and the app opens right after.',
          'This page opens for people signed in to {node}. Sign in, and the page opens right after.',
          { node: nodeHost })}<//>
      <//>`;
  }

  if (state.status === 'code') {
    return html`
      <${AskPage} title=${tr('appOpen.codeTitle', 'This app asks for a code')}
        doors=${html`<${Loud} onClick=${() => open(code)} disabled=${!code}>${tr('appOpen.codeCta', 'Open')}<//>`}>
        <${Note} kind="lead">${tr('appOpen.codeBody', 'Its owner gave the people who may open it a code. Type it here.')}<//>
        <${TextField} secret label=${tr('appOpen.codeLabel', 'Access code')} value=${code} onInput=${setCode} onEnter=${() => code && open(code)} message=${state.error} />
      <//>`;
  }

  if (state.status === 'denied') {
    return html`
      <${AskPage} title=${w('deniedTitle', 'This app is not open to you', 'This page is not open to you')}
        doors=${html`<${Action} onClick=${() => { window.location.href = '/v1/home'; }}>${tr('common.back', 'Back')}<//>`}>
        <${Note} kind="lead">${w('deniedBody',
          'Its owner opened it to the members of one shared place. Ask the owner to add you, and open it again.',
          'Its owner opened it to the members of one shared place. Ask the owner to add you, and open it again.')}<//>
      <//>`;
  }

  return html`
    <${AskPage} title=${w('errorTitle', 'The app does not open', 'The page does not open')}
      doors=${html`<${Action} onClick=${() => { window.location.href = '/v1/home'; }}>${tr('common.back', 'Back')}<//>`}>
      <${Note} kind="lead">${state.error}<//>
    <//>`;
}
