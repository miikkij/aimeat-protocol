/**
 * @file app-grant.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Trusted consent page (apex origin) for the H-2 app-grant flow. An app on the
 *   isolated app origin sends the owner here (GET /v1/app-grants/authorize → 302 → /v1/app-grant
 *   ?req=...). The owner, authenticated on the node's own origin, reviews the requesting app + the exact
 *   scopes and Allows or Denies. On Allow we POST /v1/app-grants/authorize-consent and get back the
 *   app's redirect_url carrying a one-time code. Two delivery modes:
 *     • web_message (popup): postMessage { type:'aimeat_app_grant', code, state } to the app
 *       popup-opener (targeted at the exact app origin) and close — the user stays in the app.
 *     • query (full redirect, legacy): navigate to redirect_url.
 *   The app never sees the session, only the scoped, revocable grant token it then exchanges.
 *   "Advanced" lets the owner grant a SUBSET of the requested scopes (never more).
 * @structure default export AppGrant() — loads the pending request, renders the trust prompt +
 *   scopes (+ advanced per-scope checkboxes), Allow/Deny.
 * @usage routed at /v1/app-grant?req=<id> by spa.html
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial (H-2 app-origin isolation, Phase 3: consent page).
 *   v1.1.0 — 2026-06-20 — Popup (web_message) delivery + "trust this app" reframe + Advanced
 *     per-scope subset selection (consent flow wired to apps via the SDK).
 *   v1.2.0 — 2026-07-19 — Own-app + scope-upgrade fixes (Band Jam findings): the signed-in owner's
 *     OWN app (server-verified origin_bound + app_owner) auto-approves like the silent bridge and
 *     shows "Your app" instead of "not yours"; manage mode pre-checks the UNION of granted +
 *     requested scopes and badges newly requested ones "new" (they used to come unchecked, so
 *     users silently kept the old grant after an app added a scope).
 *   v1.3.0 — 2026-07-27 — Weight + framing pass (outside feedback: the screen "was heavy and would
 *     easily scare people away"). Generic for every app, nothing app-specific here:
 *       • identity first — icon (manifest) or a monogram, name, origin, and the app's own
 *         description, so a stranger sees WHAT this is before what it asks for;
 *       • the scope wall collapses to ONE line of areas ("Works with: your saved data, your
 *         files") behind "Show the exact permissions (N)". The exact list is unchanged and one
 *         click away — the wording is not softened, because app-grant memory scopes really do
 *         reach the owner's whole namespace;
 *       • one disclosure instead of two: expanding shows the list WITH the per-scope checkboxes
 *         (the old "Advanced" toggle hid subset selection from everyone who never found it);
 *       • the guarantees read as promises, not as the warning "This app is not yours";
 *       • "Don't trust" → "Not now": cancelling no longer means declaring the app untrustworthy.
 *   v1.4.0 — 2026-08-17 — The vocabulary moved to /js/consent-vocab.js (shared with the OAuth and
 *     device-auth consent pages) and the screen answers the OUTWARD fear it never addressed: a real
 *     user read "storage" as their own hard drive. The boundary sentences (only your AIMEAT account
 *     here, never your computer or outside accounts; nothing visible until you share; recorded and
 *     revocable) lead the guarantees, the per-scope rows read the localized sentence tree instead
 *     of the server's English-only description, and a priming line names what is happening before
 *     anything is asked. The INWARD honesty is untouched: scope sentences still say the whole
 *     namespace, per the v1.3.0 rule.
 *   v1.5.0 — 2026-09-27 — Drawn from library components and writing no class (page group G9): the
 *     card is AskPage (who asks, the question, the ways to answer), the badge a Status (fine for your
 *     own app, attention for an outside one), the "updated" notice the sun-edged Box, the one-line
 *     summary the dim Box, the details toggle an action link that says it is open, each scope a Check
 *     in a row Box with its name as Code and "new" as the coral Tag, the promises ticked list lines,
 *     Revoke the danger action link and Connect the loud action. css/views/app-grant.css is gone.
 *   v1.5.1 — 2026-09-28 — No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so an app name, origin, description, scope or error with a quote or an ampersand
 *     showed as &quot; / &amp;.
 *   v1.5.2 — 2026-09-29 — The signed-out screen names the node the person is on ({node}, the host of
 *     getNodeUrl()) instead of a hard-coded "aimeat.io", and says what happens after login (the
 *     Connect screen for an app used the first time, then back in the app signed in) instead of
 *     asking the person to re-open the app's link, which nobody needs to do.
 *   v1.6.0 — 2026-09-29 — Log in opens the dialog with `redirect` set to the app that asked, so an
 *     emailed sign-in link returns the person to the app. This page cannot be the place: the request
 *     it shows lives ten minutes, and a link opened from the mail has no popup opener to answer.
 *   v1.7.0 — 2026-10-04 — Signed out, the sign-in dialog opens at once (the person pressed Sign in in
 *     the app to get here), on the create-account form when the app asked for it (`prompt: 'create'`,
 *     from signIn({ register: true })); "Log in to continue" stays under it. A package-installed app
 *     (`package_app`) is not auto-approved for its owner: it was the one path that skipped the screen
 *     for somebody else's code. Asked by aimeat-commercial, measured on its store's buyer path.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { showLoginModal, getStoredGhii, getNodeUrl } from '/js/services/auth.js';
import { useSession } from '/js/use-session.js';
import { scopeSentence, areaLine, boundaryLines } from '/js/consent-vocab.js';
import { AskPage } from '/components/AskPage.js';
import { Action, Loud } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { Check } from '/components/Check.js';
import { Code, Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Space, Stack } from '/components/Layout.js';
import { List, Row, Tick, Cell } from '/components/List.js';

const html = htm.bind(h);
/** t() with a literal fallback; {vars} are interpolated into the fallback too (missing-key safety). */
const tr = (key, fallback, vars) => {
  const v = t(key, vars);
  if (v && v !== key) return v;
  let s = fallback;
  if (vars) for (const [k, val] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(val));
  return s;
};

export default function AppGrant() {
  const [state, setState] = useState({ status: 'loading', request: null, error: '' });
  const [submitting, setSubmitting] = useState(false);
  const [details, setDetails] = useState(false); // exact per-scope list + checkboxes, collapsed by default
  const [selected, setSelected] = useState(() => new Set());
  const [existingGrant, setExistingGrant] = useState(null); // the grant this app already holds (manage mode)
  const [ownApp, setOwnApp] = useState(false); // server-verified: origin-bound request for the signed-in owner's own app

  const requestId = new URLSearchParams(window.location.search).get('req') || '';
  // Reactive to login: the consent popup may open with no one logged in (login_required) and the
  // user signs in right here — the session hook flips this to the consent view on success.
  const authed = !!useSession();
  // The sign-in dialog opens once by itself; after that only the Log in button opens it.
  const loginOpened = useRef(false);

  async function doLogin() {
    // An emailed sign-in link returns to the app that asked, not to this page (v1.6.0). An app that
    // asked for the create-account form (prompt=create) gets the dialog open on it (v1.7.0).
    let redirect = '';
    let register = false;
    try {
      const res = await api(`/v1/app-grants/request/${encodeURIComponent(requestId)}`);
      redirect = res.data?.app_origin || '';
      register = res.data?.prompt === 'create';
    } catch (err) { swallowed('app-grant: the app to return to', err); }
    const opts = { ...(redirect ? { redirect } : {}), ...(register ? { tab: 'register' } : {}) };
    if (!showLoginModal(opts)) window.location.href = '/v1/profile';
  }

  useEffect(() => {
    if (!requestId) { setState({ status: 'error', error: tr('appGrant.missing', 'No authorization request.') }); return; }
    if (!authed) {
      // The person pressed Sign in inside the app to get here, so the dialog opens at once. The
      // "Log in to continue" screen stays under it for someone who closes the dialog.
      setState({ status: 'login' });
      if (!loginOpened.current) { loginOpened.current = true; doLogin(); }
      return;
    }
    let live = true;
    api(`/v1/app-grants/request/${encodeURIComponent(requestId)}`)
      .then(async (res) => {
        if (!live) return;
        // If this app already holds a grant, this is "manage mode": pre-check the currently granted
        // scopes and offer Revoke. Best-effort — a failed lookup just falls back to first-consent.
        let grant = null;
        try {
          const list = await api('/v1/app-grants');
          grant = (list.data?.grants || []).find((g) => g.app === res.data.app) || null;
        } catch (err) { swallowed('app-grant: doLogin', err); }
        if (!live) return;
        const reqScopes = (res.data.scopes || []).map((s) => s.scope);
        // The owner's OWN app (server-verified: the redirect origin is bound to exactly this app):
        // same auto-approve policy as the silent bridge — their own app never needs the trust prompt.
        // The server computes `own` independently at consent time, so this is UX, not the gate.
        const myOwner = (getStoredGhii() || '').split('@')[0];
        // A package installed the app: somebody else's code under the owner's name, so the owner
        // sees the screen like anyone else (v1.7.0; the server never marks it own either).
        const own = !!(res.data.origin_bound && res.data.app_owner && myOwner && myOwner === res.data.app_owner && !res.data.package_app);
        // Pre-check the UNION of already-granted and now-requested scopes: an app update that added
        // a scope must surface it CHECKED — presenting it unchecked made users keep the old grant
        // without noticing (the Band Jam scope-upgrade trap).
        const granted = grant ? [...new Set([...grant.scopes, ...reqScopes])] : reqScopes;
        setExistingGrant(grant);
        setSelected(new Set(granted));
        setOwnApp(own);
        if (own && !res.data.manage) { setState({ status: 'autoapprove', request: res.data }); return; }
        // Pass-through: when NOT explicitly managing (the gear) and the app already holds a grant that
        // covers what it's asking for, just approve silently — no second prompt for an app you trust.
        const covers = grant && reqScopes.every((s) => grant.scopes.includes(s));
        if (grant && !res.data.manage && covers) { setState({ status: 'autoapprove', request: res.data }); return; }
        if (grant) setDetails(true); // manage / add-scopes → open the exact list + checkboxes up front
        setState({ status: 'ready', request: res.data });
      })
      .catch((e) => { if (live) setState({ status: 'error', error: e.message || tr('appGrant.expired', 'This request has expired.') }); });
    return () => { live = false; };
    // doLogin reads only requestId, which is listed, and loginOpened keeps it to one call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, authed]);

  // Pass-through approval (already-granted app, not managing): approve once, silently.
  useEffect(() => {
    if (state.status === 'autoapprove' && !submitting) approve();
    // eslint-disable-next-line
  }, [state.status]);

  async function revoke() {
    if (!existingGrant) return;
    setSubmitting(true);
    try {
      await api(`/v1/app-grants/${encodeURIComponent(existingGrant.grant_id)}`, { method: 'DELETE' });
      if (state.request?.response_mode === 'web_message' && window.opener) {
        window.opener.postMessage({ type: 'aimeat_app_grant', revoked: true, state: state.request.state }, state.request.app_origin);
        window.close();
        return;
      }
      window.location.href = state.request?.app_origin || '/v1/profile';
    } catch (e) {
      setState((s) => ({ ...s, status: 'error', error: e.message || 'Failed to revoke.' }));
      setSubmitting(false);
    }
  }

  function toggle(scope) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(scope)) n.delete(scope); else n.add(scope); return n; });
  }

  async function approve() {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const res = await api('/v1/app-grants/authorize-consent', {
        method: 'POST', body: JSON.stringify({ request_id: requestId, scopes: [...selected] }),
      });
      const url = new URL(res.data.redirect_url);
      const code = url.searchParams.get('code');
      const st = url.searchParams.get('state');
      // Popup mode: hand the code back to the app (popup-opener) at its exact origin, then close.
      if (state.request?.response_mode === 'web_message' && window.opener) {
        window.opener.postMessage({ type: 'aimeat_app_grant', code, state: st }, state.request.app_origin);
        window.close();
        return;
      }
      window.location.href = res.data.redirect_url; // legacy full-redirect mode
    } catch (e) {
      setState((s) => ({ ...s, status: 'error', error: e.message || 'Failed to approve.' }));
      setSubmitting(false);
    }
  }

  function deny() {
    if (state.request?.response_mode === 'web_message' && window.opener) {
      window.opener.postMessage({ type: 'aimeat_app_grant', code: null, state: null }, state.request.app_origin);
      window.close();
      return;
    }
    const origin = state.request?.app_origin;
    window.location.href = origin || '/v1/profile';
  }

  if (state.status === 'loading' || state.status === 'autoapprove') {
    const msg = state.status === 'autoapprove' ? tr('appGrant.signingIn', 'Signing you in…') : tr('common.loading', 'Loading…');
    return html`<${AskPage} message=${msg} />`;
  }
  if (state.status === 'login') {
    // This page runs on the node's own origin, so its host is the name the login modal's crumb shows
    // and the host of config.baseUrl that the server-rendered pages call nodeName (routes/portal.ts).
    let nodeHost = '';
    try { nodeHost = new URL(getNodeUrl()).host; } catch (err) { swallowed('app-grant: nodeHost', err); }
    return html`
      <${AskPage} title=${tr('appGrant.loginTitle', 'Log in to continue')}
        doors=${html`<${Loud} onClick=${doLogin}>${tr('appGrant.loginCta', 'Log in')}<//>`}>
        <${Note} kind="lead">${tr('appGrant.loginBody', 'Log in with your account on {node}. If you use this app for the first time, you then choose what it can use. After that, you are back in the app, signed in.', { node: nodeHost })}<//>
      <//>`;
  }
  if (state.status === 'error') {
    return html`
      <${AskPage} title=${tr('appGrant.errorTitle', 'Cannot grant access')}
        doors=${html`<${Action} onClick=${deny}>${tr('common.back', 'Back')}<//>`}>
        <${Note} kind="lead">${state.error}<//>
      <//>`;
  }

  const req = state.request;
  // One plain line of areas, in the order the app asked for them — the vocabulary is shared with
  // every other consent surface (consent-vocab.js), so a family renamed there is renamed here.
  const reqScopeNames = req.scopes.map((s) => s.scope);
  const summaryLine = areaLine(reqScopeNames, t);
  // What this app asks for that the live grant does not already carry. Non-empty means the screen is
  // back because the APP changed, not because the person is connecting it for the first time — and a
  // person who has approved this app before deserves to be told which of the two is happening.
  const addedScopes = existingGrant
    ? reqScopeNames.filter((s) => !existingGrant.scopes.includes(s))
    : [];
  const icon = String(req.app_icon || '').trim();
  const iconIsUrl = /^(https?:\/\/|\/)/.test(icon);
  const monogram = (Array.from(String(req.app_name || '?').trim())[0] || '?').toUpperCase();

  // The guarantees, said as promises: each one a ticked line.
  const boundaries = boundaryLines(t);
  const promises = [
    ...boundaries,
    tr('appGrant.assureKey', 'It gets its own key, never your password.'),
    !existingGrant && tr('appGrant.assureNext', 'Next time it signs you in without this screen.'),
  ].filter(Boolean);

  return html`
    <${AskPage}
      who=${{
        // The app's own icon (an address or one sign), or the first letter of its name.
        picture: icon && iconIsUrl ? html`<img src=${icon} alt="" />` : null,
        text: icon || monogram,
        name: req.app_name,
        meta: req.app_origin,
        mark: html`<${Mark} kind="status" tone=${ownApp ? 'fine' : 'attention'}>${ownApp ? tr('appGrant.ownBadge', 'Your app') : tr('appGrant.externalBadge', 'External app')}<//>`,
      }}
      title=${existingGrant
        ? tr('appGrant.manageTitle', 'Manage this app’s access')
        : tr('appGrant.connectTitle', 'Connect {app} to your account', { app: req.app_name })}
      doors=${html`
        ${existingGrant
          ? html`<${Action} tone="danger" onClick=${revoke} disabled=${submitting}>${tr('appGrant.revoke', 'Revoke access')}<//>`
          : html`<${Action} onClick=${deny} disabled=${submitting}>${tr('appGrant.notNow', 'Not now')}<//>`}
        <${Loud} onClick=${approve} disabled=${submitting || selected.size === 0}>
          ${submitting ? tr('appGrant.approving', 'Allowing…') : (existingGrant ? tr('appGrant.saveCta', 'Save changes') : tr('appGrant.connectCta', 'Connect'))}
        <//>`}>
      ${!existingGrant && html`<${Note} kind="lead">${tr('consent.priming.appGrant', '{app} is asking to use part of your AIMEAT account.', { app: req.app_name })}<//>`}
      ${addedScopes.length > 0 && html`<${Box} tone="edge"><${Note} kind="lead">${tr(
        'appGrant.updatedNotice',
        'This app has been updated and now asks for something new. Approve it again to keep using it.',
      )}<//><//>`}
      ${req.app_description && html`<${Note} kind="lead">${req.app_description}<//>`}

      <${Box} tone="dim"><b>${tr('appGrant.worksWith', 'Works with:')}</b> ${summaryLine}<//>
      <${Action} small expanded=${details} onClick=${() => setDetails((v) => !v)}>
        ${details
          ? tr('appGrant.hideDetails', 'Hide the exact permissions')
          : tr('appGrant.showDetails', 'Show the exact permissions ({n})', { n: req.scopes.length })}
      <//>

      ${details && html`
        <${Stack} list gap="small" above="small">
          ${req.scopes.map((s) => html`
            <${Box} key=${s.scope} tone="row" packed>
              <${Check} checked=${selected.has(s.scope)} onChange=${() => toggle(s.scope)} ariaLabel=${s.scope}
                hint=${html`<${Code}>${s.scope}<//>`}>
                ${scopeSentence(s.scope, t, s.description)}
                ${existingGrant && !existingGrant.scopes.includes(s.scope) && html` <${Mark} tone="coral">${tr('appGrant.newScope', 'new')}<//>`}
              <//>
            <//>`)}
        <//>
        <${Note}>${tr('appGrant.subsetHint', 'Uncheck anything you would rather not give. The app gets exactly what stays checked.')}<//>`}

      <${Space} above="medium">
        <${List} cols="mark-name" keepCols small>
          ${promises.map((line) => html`<${Row} key=${line}><${Tick} bare state="done" /><${Cell}>${line}<//><//>`)}
        <//>
      <//>
    <//>`;
}
