/**
 * @file app-grant.js
 * @description Trusted consent page (apex origin) for the H-2 app-grant flow. An app on the
 *   isolated app origin sends the owner here (GET /v1/app-grants/authorize → 302 → /v1/app-grant
 *   ?req=...). The owner, authenticated on aimeat.io, reviews the requesting app + the exact
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
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api } from '/js/api.js';
import { escHtml } from '/js/utils.js';
import { swallowed } from '/js/swallowed.js';
import { showLoginModal, getStoredGhii } from '/js/services/auth.js';
import { useSession } from '/js/use-session.js';

const html = htm.bind(h);
/** t() with a literal fallback; {vars} are interpolated into the fallback too (missing-key safety). */
const tr = (key, fallback, vars) => {
  const v = t(key, vars);
  if (v && v !== key) return v;
  let s = fallback;
  if (vars) for (const [k, val] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(val));
  return s;
};

/**
 * Plain-language area per scope family, for the one-line summary. The summary names WHAT the app
 * touches; the exact verbs (read / create / delete) stay in the expandable list, unchanged.
 */
const AREA_FALLBACKS = {
  memory: 'your saved data',
  storage: 'your files',
  catalogue: 'the public catalogue',
  social: 'boards',
  messages: 'your messages',
  wallet: 'your morsel balance',
  knowledge: 'your knowledge packages',
  task: "your agents' tasks",
  workflow: 'your automations',
  ai: 'your AI budget',
  notifications: 'notifications to you',
  organism: 'your workspaces',
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

  function doLogin() {
    if (!showLoginModal({})) window.location.href = '/v1/profile';
  }

  useEffect(() => {
    if (!requestId) { setState({ status: 'error', error: tr('appGrant.missing', 'No authorization request.') }); return; }
    if (!authed) { setState({ status: 'login' }); return; }
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
        const own = !!(res.data.origin_bound && res.data.app_owner && myOwner && myOwner === res.data.app_owner);
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
    return html`<div class="agr-wrap"><p class="agr-muted">${msg}</p></div>`;
  }
  if (state.status === 'login') {
    return html`
      <div class="agr-wrap">
        <div class="agr-card">
          <h1 class="agr-title">${tr('appGrant.loginTitle', 'Log in to continue')}</h1>
          <p class="agr-muted">${tr('appGrant.loginBody', 'Log in on aimeat.io, then re-open the app’s link to approve access.')}</p>
          <button class="btn-primary agr-btn" onClick=${doLogin}>${tr('appGrant.loginCta', 'Log in')}</button>
        </div>
      </div>`;
  }
  if (state.status === 'error') {
    return html`
      <div class="agr-wrap">
        <div class="agr-card">
          <h1 class="agr-title">${tr('appGrant.errorTitle', 'Cannot grant access')}</h1>
          <p class="agr-muted">${escHtml(state.error)}</p>
          <button class="btn-outline agr-btn" onClick=${deny}>${tr('common.back', 'Back')}</button>
        </div>
      </div>`;
  }

  const req = state.request;
  // Areas, in the order the app asked for them — one plain line instead of a wall of boxes.
  const areas = [];
  for (const s of req.scopes) {
    const family = String(s.scope).split(':')[0];
    if (!areas.includes(family)) areas.push(family);
  }
  const areaLine = areas.map((a) => tr(`appGrant.area.${a}`, AREA_FALLBACKS[a] || a)).join(', ');
  const keepsData = areas.includes('memory') || areas.includes('storage');
  const icon = String(req.app_icon || '').trim();
  const iconIsUrl = /^(https?:\/\/|\/)/.test(icon);
  const monogram = (Array.from(String(req.app_name || '?').trim())[0] || '?').toUpperCase();

  return html`
    <div class="agr-wrap">
      <div class="agr-card">
        <div class="agr-head">
          <div class="agr-icon" aria-hidden="true">
            ${icon
              ? (iconIsUrl
                ? html`<img class="agr-icon-img" src=${icon} alt="" />`
                : html`<span class="agr-icon-glyph">${escHtml(icon)}</span>`)
              : html`<span class="agr-icon-mono">${escHtml(monogram)}</span>`}
          </div>
          <div class="agr-head-text">
            <div class="agr-app-name">${escHtml(req.app_name)}</div>
            <div class="agr-app-origin">${escHtml(req.app_origin)}</div>
          </div>
          <span class="agr-badge ${ownApp ? 'agr-badge-own' : ''}">${ownApp ? tr('appGrant.ownBadge', 'Your app') : tr('appGrant.externalBadge', 'External app')}</span>
        </div>

        <h1 class="agr-title">${existingGrant
          ? tr('appGrant.manageTitle', 'Manage this app’s access')
          : tr('appGrant.connectTitle', 'Connect {app} to your account', { app: req.app_name })}</h1>
        ${req.app_description && html`<p class="agr-lede">${escHtml(req.app_description)}</p>`}

        <div class="agr-summary">
          <span class="agr-summary-label">${tr('appGrant.worksWith', 'Works with:')}</span>
          <span class="agr-summary-areas">${escHtml(areaLine)}</span>
        </div>
        <button class="agr-details-toggle" aria-expanded=${details} onClick=${() => setDetails((v) => !v)}>
          ${details
            ? tr('appGrant.hideDetails', 'Hide the exact permissions')
            : tr('appGrant.showDetails', 'Show the exact permissions ({n})', { n: req.scopes.length })}
        </button>

        ${details && html`
          <ul class="agr-scopes">
            ${req.scopes.map((s) => html`
              <li class="agr-scope" key=${s.scope}>
                <input type="checkbox" class="agr-scope-check" checked=${selected.has(s.scope)}
                  onChange=${() => toggle(s.scope)} aria-label=${s.scope} />
                <span class="agr-scope-text">
                  <span class="agr-scope-desc">${escHtml(s.description || s.scope)}
                    ${existingGrant && !existingGrant.scopes.includes(s.scope) && html`<span class="agr-scope-newbadge">${tr('appGrant.newScope', 'new')}</span>`}
                  </span>
                  <span class="agr-scope-name">${escHtml(s.scope)}</span>
                </span>
              </li>`)}
          </ul>
          <p class="agr-details-hint">${tr('appGrant.subsetHint', 'Uncheck anything you would rather not give. The app gets exactly what stays checked.')}</p>`}

        <ul class="agr-assure">
          <li>${tr('appGrant.assureKey', 'It gets its own key, never your password.')}</li>
          ${keepsData && html`<li>${tr('appGrant.assureHome', 'What it saves lives in your own AIMEAT account.')}</li>`}
          <li>${tr('appGrant.assureRevoke', 'You can revoke it in one click: Profile › Access.')}</li>
          ${!existingGrant && html`<li>${tr('appGrant.assureNext', 'Next time it signs you in without this screen.')}</li>`}
        </ul>

        <div class="agr-actions">
          ${existingGrant
            ? html`<button class="btn-danger agr-btn" onClick=${revoke} disabled=${submitting}>${tr('appGrant.revoke', 'Revoke access')}</button>`
            : html`<button class="btn-outline agr-btn" onClick=${deny} disabled=${submitting}>${tr('appGrant.notNow', 'Not now')}</button>`}
          <button class="btn-primary agr-btn" onClick=${approve} disabled=${submitting || selected.size === 0}>
            ${submitting ? tr('appGrant.approving', 'Allowing…') : (existingGrant ? tr('appGrant.saveCta', 'Save changes') : tr('appGrant.connectCta', 'Connect'))}
          </button>
        </div>
      </div>
    </div>`;
}
