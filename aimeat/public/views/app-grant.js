/**
 * @file app-grant.js
 * @description Trusted consent page (apex origin) for the H-2 app-grant flow. An app on the
 *   isolated app origin sends the owner here (GET /v1/app-grants/authorize → 302 → /v1/app-grant
 *   ?req=...). The owner, authenticated on aimeat.io, reviews the requesting app + the exact
 *   scopes and Approves or Denies. Approve POSTs to /v1/app-grants/authorize-consent and the
 *   server returns the app's redirect_url (carrying the one-time code) which we navigate to —
 *   the app never sees the session, only the scoped grant token it then exchanges.
 * @structure default export AppGrant() — loads the pending request, renders scopes + actions.
 * @usage routed at /v1/app-grant?req=<id> by spa.html
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial (H-2 app-origin isolation, Phase 3: consent page).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api } from '/js/api.js';
import { escHtml } from '/js/utils.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export default function AppGrant() {
  const [state, setState] = useState({ status: 'loading', request: null, error: '' });
  const [submitting, setSubmitting] = useState(false);

  const requestId = new URLSearchParams(window.location.search).get('req') || '';
  const loggedIn = !!window.AIMEAT?.auth?.hasSession;

  useEffect(() => {
    if (!requestId) { setState({ status: 'error', error: tr('appGrant.missing', 'No authorization request.') }); return; }
    if (!loggedIn) { setState({ status: 'login' }); return; }
    let live = true;
    api(`/v1/app-grants/request/${encodeURIComponent(requestId)}`)
      .then((res) => { if (live) setState({ status: 'ready', request: res.data }); })
      .catch((e) => { if (live) setState({ status: 'error', error: e.message || tr('appGrant.expired', 'This request has expired.') }); });
    return () => { live = false; };
  }, [requestId, loggedIn]);

  async function approve() {
    setSubmitting(true);
    try {
      const res = await api('/v1/app-grants/authorize-consent', { method: 'POST', body: JSON.stringify({ request_id: requestId }) });
      window.location.href = res.data.redirect_url; // back to the app, carrying the one-time code
    } catch (e) {
      setState((s) => ({ ...s, status: 'error', error: e.message || 'Failed to approve.' }));
      setSubmitting(false);
    }
  }

  function deny() {
    const origin = state.request?.app_origin;
    if (origin) window.location.href = origin; else window.location.href = '/v1/profile';
  }

  if (state.status === 'loading') {
    return html`<div class="agr-wrap"><p class="agr-muted">${tr('common.loading', 'Loading…')}</p></div>`;
  }
  if (state.status === 'login') {
    return html`
      <div class="agr-wrap">
        <div class="agr-card">
          <h1 class="agr-title">${tr('appGrant.loginTitle', 'Log in to continue')}</h1>
          <p class="agr-muted">${tr('appGrant.loginBody', 'Log in on aimeat.io, then re-open the app’s link to approve access.')}</p>
          <a class="btn-primary agr-btn" href="/v1/profile">${tr('appGrant.loginCta', 'Log in')}</a>
        </div>
      </div>`;
  }
  if (state.status === 'error') {
    return html`
      <div class="agr-wrap">
        <div class="agr-card">
          <h1 class="agr-title">${tr('appGrant.errorTitle', 'Cannot grant access')}</h1>
          <p class="agr-muted">${escHtml(state.error)}</p>
          <a class="btn-outline agr-btn" href="/v1/profile">${tr('common.back', 'Back')}</a>
        </div>
      </div>`;
  }

  const req = state.request;
  return html`
    <div class="agr-wrap">
      <div class="agr-card">
        <h1 class="agr-title">${tr('appGrant.title', 'Allow this app to access your data?')}</h1>
        <div class="agr-app">
          <div class="agr-app-name">${escHtml(req.app_name)}</div>
          <div class="agr-app-origin">${escHtml(req.app_origin)}</div>
        </div>
        <p class="agr-muted">${tr('appGrant.intro', 'It will receive its own scoped, revocable token — never your login session. You can revoke it anytime in Profile › Access.')}</p>
        <div class="agr-scopes-label">${tr('appGrant.scopesLabel', 'Requested access')}</div>
        <ul class="agr-scopes">
          ${req.scopes.map((s) => html`
            <li class="agr-scope" key=${s.scope}>
              <span class="agr-scope-name">${escHtml(s.scope)}</span>
              <span class="agr-scope-desc">${escHtml(s.description || '')}</span>
            </li>`)}
        </ul>
        <div class="agr-actions">
          <button class="btn-outline agr-btn" onClick=${deny} disabled=${submitting}>${tr('appGrant.deny', 'Deny')}</button>
          <button class="btn-primary agr-btn" onClick=${approve} disabled=${submitting}>
            ${submitting ? tr('appGrant.approving', 'Approving…') : tr('appGrant.approve', 'Allow access')}
          </button>
        </div>
      </div>
    </div>`;
}
