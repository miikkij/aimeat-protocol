/**
 * @file invite-accept.js
 * @description Public accept page for an EMAIL invitation. Reached via the emailed link
 *   /v1/invite?token=<token>. Loads the invitation (GET /v1/invitations/:token) and shows what the
 *   recipient is being invited to (organism + workspace roles + inviter). A NOT-yet-registered
 *   visitor registers right here (username + password; the invited email is shown, locked, and
 *   recorded as verified) and is joined in one atomic POST /v1/invitations/:token/accept. An already
 *   registered / already logged-in visitor (including anyone returning from a social sign-in) accepts
 *   as their current account. Social sign-up + existing-user login reuse AIMEAT.auth.showLoginModal
 *   (its social buttons redirect back here logged-in; then "Accept" joins as that account). On accept
 *   the server sets the refresh cookie, so a full navigation to the redirect boots the SPA logged-in.
 * @structure default export InviteAccept() — load invitation → register-and-join OR accept-as-me.
 * @usage routed at /v1/invite?token=<token> by spa.html
 * @version-history
 *   v1.0.0 — 2026-07-04 — Initial (email invitations for unregistered users).
 *   v1.0.1 — 2026-07-04 — React to the auth 'logout' event too, so an in-page logout flips back to
 *     the register form instead of leaving the stale accept-as-me button.
 *   v1.1.0 — 2026-07-10 — Social sign-in providers (GET /v1/auth/providers) rendered as co-equal
 *     "Continue with X" buttons: Google was hidden behind a text link, so invited first-timers
 *     concluded a password was mandatory.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api } from '/js/api.js';
import { escHtml } from '/js/utils.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export default function InviteAccept() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [state, setState] = useState({ status: 'loading', inv: null, error: '' });
  const [authed, setAuthed] = useState(() => !!window.AIMEAT?.auth?.hasSession);
  const [form, setForm] = useState({ username: '', password: '', display_name: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [providers, setProviders] = useState([]);

  // Social sign-in providers, rendered as co-equal buttons — an invited first-timer should not
  // conclude a password is mandatory when the node offers Google & co.
  useEffect(() => {
    let live = true;
    api('/v1/auth/providers')
      .then((res) => { if (live) setProviders(res?.data?.providers || []); })
      .catch(() => { /* no providers — password form stands alone */ });
    return () => { live = false; };
  }, []);

  // Full-page navigation to the provider's OIDC start; the callback redirects back here logged-in
  // (or with the one-time username-choice step), after which "Accept & join" joins as that account.
  function socialSignIn(p) {
    const back = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = (p.loginUrl || `/v1/ghii/login/${p.id}`) + '?redirect=' + back;
  }

  // Become reactive to an in-place login/logout (username/password via the shared modal, or a
  // logout on this page) so the view flips between the accept-as-me button and the register form.
  useEffect(() => {
    const onLogin = () => setAuthed(true);
    const onLogout = () => setAuthed(false);
    window.AIMEAT?.auth?.on?.('login', onLogin);
    window.AIMEAT?.auth?.on?.('logout', onLogout);
    return () => {
      window.AIMEAT?.auth?.off?.('login', onLogin);
      window.AIMEAT?.auth?.off?.('logout', onLogout);
    };
  }, []);

  // Load the invitation details (public).
  useEffect(() => {
    if (!token) { setState({ status: 'error', error: tr('invite.missing', 'This invitation link is missing its token.') }); return undefined; }
    let live = true;
    api('/v1/invitations/' + encodeURIComponent(token))
      .then((res) => { if (live) setState({ status: 'ready', inv: res.data.invitation, error: '' }); })
      .catch((e) => { if (live) setState({ status: 'error', error: e.message || tr('invite.invalid', 'This invitation is invalid, was cancelled, or has expired.') }); });
    return () => { live = false; };
  }, [token]);

  // POST accept: with a body (new account) or empty (accept as the current session). On success the
  // server set the refresh cookie — a full navigation boots the SPA logged-in at the redirect.
  async function accept(body) {
    setSubmitting(true); setFormError('');
    try {
      const res = await api('/v1/invitations/' + encodeURIComponent(token) + '/accept', {
        method: 'POST', body: JSON.stringify(body || {}),
      });
      window.location.href = (res && res.data && res.data.redirect) || '/v1/profile#organisms';
    } catch (e) {
      setFormError(e.message || tr('invite.acceptFailed', 'Could not accept the invitation.'));
      setSubmitting(false);
    }
  }

  function acceptAsNew() {
    const username = form.username.trim();
    const password = form.password;
    if (!username) { setFormError(tr('invite.usernameRequired', 'Choose a username.')); return; }
    if (!password) { setFormError(tr('invite.passwordRequired', 'Choose a password.')); return; }
    accept({ username, password, display_name: form.display_name.trim() || undefined });
  }

  function signInInstead() {
    if (window.AIMEAT?.auth?.showLoginModal) window.AIMEAT.auth.showLoginModal({ onLogin: () => setAuthed(true) });
  }

  if (state.status === 'loading') {
    return html`<div class="inv-wrap"><div class="inv-card"><p class="inv-muted">${tr('common.loading', 'Loading…')}</p></div></div>`;
  }
  if (state.status === 'error') {
    return html`
      <div class="inv-wrap">
        <div class="inv-card">
          <h1 class="inv-title">${tr('invite.errorTitle', 'Invitation unavailable')}</h1>
          <p class="inv-muted">${escHtml(state.error)}</p>
          <a class="btn-outline inv-btn" href="/v1/profile">${tr('common.back', 'Back')}</a>
        </div>
      </div>`;
  }

  const inv = state.inv;
  const org = inv.organism || {};
  const workspaces = inv.workspaces || [];
  const summary = html`
    <div class="inv-summary">
      <div class="inv-org">
        <div class="inv-org-name">${escHtml(org.name || '')}</div>
        ${org.description ? html`<div class="inv-muted">${escHtml(org.description)}</div>` : null}
      </div>
      <p class="inv-muted">${tr('invite.invitedBy', 'Invited by')} <strong>${escHtml(inv.invited_by || '')}</strong> ${tr('invite.asRole', 'as')} <strong>${escHtml(inv.org_role || 'member')}</strong>.</p>
      ${workspaces.length ? html`
        <div class="inv-wslabel">${tr('invite.workspacesLabel', "You'll get access to:")}</div>
        <ul class="inv-wslist">
          ${workspaces.map((w) => html`<li key=${w.ws}>${escHtml(w.name || w.ws)} — ${escHtml(w.role)}</li>`)}
        </ul>` : null}
      ${inv.message ? html`<p class="inv-message">“${escHtml(inv.message)}”</p>` : null}
    </div>`;

  // Already signed in (incl. returning from a social sign-in): accept as the current account.
  if (authed) {
    return html`
      <div class="inv-wrap">
        <div class="inv-card">
          <span class="inv-badge">${tr('invite.badge', 'Invitation')}</span>
          <h1 class="inv-title">${tr('invite.acceptTitle', "You're invited")}</h1>
          ${summary}
          ${formError ? html`<p class="inv-error">${escHtml(formError)}</p>` : null}
          <div class="inv-actions">
            <button class="btn-primary inv-btn" onClick=${() => accept({})} disabled=${submitting}>
              ${submitting ? tr('invite.joining', 'Joining…') : tr('invite.acceptCta', 'Accept & join')}
            </button>
          </div>
        </div>
      </div>`;
  }

  // Not signed in: register right here (email locked + recorded as verified) and join in one step.
  return html`
    <div class="inv-wrap">
      <div class="inv-card">
        <span class="inv-badge">${tr('invite.badge', 'Invitation')}</span>
        <h1 class="inv-title">${tr('invite.acceptTitle', "You're invited")}</h1>
        ${summary}

        <div class="inv-form">
          <div class="inv-field">
            <label>${tr('invite.emailLabel', 'Your email')}</label>
            <input class="input-field input-sm" type="email" value=${inv.email || ''} readonly />
          </div>
          <div class="inv-field">
            <label>${tr('invite.usernameLabel', 'Choose a username')}</label>
            <input class="input-field input-sm" autofocus value=${form.username}
              onInput=${(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder=${tr('invite.usernamePlaceholder', 'e.g. alice')} />
          </div>
          <div class="inv-field">
            <label>${tr('invite.passwordLabel', 'Choose a password')}</label>
            <input class="input-field input-sm" type="password" value=${form.password}
              onInput=${(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder=${tr('invite.passwordPlaceholder', 'At least 8 characters')} />
          </div>
          <div class="inv-field">
            <label>${tr('invite.displayNameLabel', 'Display name (optional)')}</label>
            <input class="input-field input-sm" value=${form.display_name}
              onInput=${(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} />
          </div>
          ${formError ? html`<p class="inv-error">${escHtml(formError)}</p>` : null}
          <div class="inv-actions">
            <button class="btn-primary inv-btn" onClick=${acceptAsNew} disabled=${submitting}>
              ${submitting ? tr('invite.creating', 'Creating account…') : tr('invite.registerCta', 'Create account & join')}
            </button>
          </div>
        </div>

        <div class="inv-or">${tr('invite.or', 'OR')}</div>
        ${providers.map((p) => html`
          <button key=${p.id} class="btn-outline inv-btn inv-signin" onClick=${() => socialSignIn(p)}>
            ${tr('invite.continueWith', 'Continue with {label}').replace('{label}', p.label || p.id)}
          </button>`)}
        <button class="btn-outline inv-btn inv-signin" onClick=${signInInstead}>
          ${tr('invite.signInInstead', 'Already have an account? Sign in')}
        </button>
      </div>
    </div>`;
}
