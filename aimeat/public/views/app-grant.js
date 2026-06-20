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
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [existingGrant, setExistingGrant] = useState(null); // the grant this app already holds (manage mode)

  const requestId = new URLSearchParams(window.location.search).get('req') || '';
  const [authed, setAuthed] = useState(() => !!window.AIMEAT?.auth?.hasSession);

  // Become reactive to login: the consent popup may open with no one logged in (login_required), and
  // the user signs in right here (auth.showLoginModal) — flip to the consent view on success.
  useEffect(() => {
    const onLogin = () => setAuthed(true);
    window.AIMEAT?.auth?.on?.('login', onLogin);
    return () => window.AIMEAT?.auth?.off?.('login', onLogin);
  }, []);

  function doLogin() {
    if (window.AIMEAT?.auth?.showLoginModal) window.AIMEAT.auth.showLoginModal({ onLogin: () => setAuthed(true) });
    else window.location.href = '/v1/profile';
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
        } catch { /* ignore */ }
        if (!live) return;
        const granted = grant ? grant.scopes : (res.data.scopes || []).map((s) => s.scope);
        setExistingGrant(grant);
        setSelected(new Set(granted));
        if (grant) setAdvanced(true); // manage mode → show the per-scope checkboxes up front
        setState({ status: 'ready', request: res.data });
      })
      .catch((e) => { if (live) setState({ status: 'error', error: e.message || tr('appGrant.expired', 'This request has expired.') }); });
    return () => { live = false; };
  }, [requestId, authed]);

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

  if (state.status === 'loading') {
    return html`<div class="agr-wrap"><p class="agr-muted">${tr('common.loading', 'Loading…')}</p></div>`;
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
  return html`
    <div class="agr-wrap">
      <div class="agr-card">
        <span class="agr-badge">${tr('appGrant.externalBadge', 'External app')}</span>
        <h1 class="agr-title">${existingGrant ? tr('appGrant.manageTitle', 'Manage this app’s access') : tr('appGrant.trustTitle', 'Trust this app?')}</h1>
        <div class="agr-app">
          <div class="agr-app-name">${escHtml(req.app_name)}</div>
          <div class="agr-app-origin">${escHtml(req.app_origin)}</div>
        </div>
        <p class="agr-muted">${tr('appGrant.trustIntro', 'This app is not yours. It gets its OWN scoped, revocable key — never your login session. You can revoke it anytime in Profile › Access.')}</p>

        <div class="agr-scopes-label">${tr('appGrant.needsLabel', 'This app needs:')}</div>
        <ul class="agr-scopes">
          ${req.scopes.map((s) => html`
            <li class="agr-scope" key=${s.scope}>
              ${advanced && html`
                <input type="checkbox" class="agr-scope-check" checked=${selected.has(s.scope)}
                  onChange=${() => toggle(s.scope)} aria-label=${s.scope} />`}
              <span class="agr-scope-text">
                <span class="agr-scope-desc">${escHtml(s.description || s.scope)}</span>
                <span class="agr-scope-name">${escHtml(s.scope)}</span>
              </span>
            </li>`)}
        </ul>

        <button class="agr-advanced-toggle" onClick=${() => setAdvanced((v) => !v)}>
          ${advanced ? tr('appGrant.advancedHide', '▲ Hide advanced') : tr('appGrant.advancedShow', '⚙ Advanced — choose permissions')}
        </button>

        <div class="agr-actions">
          ${existingGrant
            ? html`<button class="btn-danger agr-btn" onClick=${revoke} disabled=${submitting}>${tr('appGrant.revoke', 'Revoke access')}</button>`
            : html`<button class="btn-outline agr-btn" onClick=${deny} disabled=${submitting}>${tr('appGrant.deny', 'Don’t trust')}</button>`}
          <button class="btn-primary agr-btn" onClick=${approve} disabled=${submitting || selected.size === 0}>
            ${submitting ? tr('appGrant.approving', 'Allowing…') : (existingGrant ? tr('appGrant.saveCta', 'Save changes') : tr('appGrant.trustCta', '❤ Trust — allow access'))}
          </button>
        </div>
        ${!existingGrant && html`<p class="agr-next">${tr('appGrant.nextNote', 'Next time this app logs you in automatically — no prompt.')}</p>`}
      </div>
    </div>`;
}
