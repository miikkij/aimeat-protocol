/**
 * @file invite-accept.js
 * @description Public accept page for an EMAIL invitation. Reached via the emailed link
 *   /v1/invite?token=<token>. Loads the invitation (GET /v1/invitations/:token) and shows what the
 *   recipient is being invited to (organism + workspace roles + inviter). A NOT-yet-registered
 *   visitor registers right here (username + password; the invited email is shown, locked, and
 *   recorded as verified) and is joined in one atomic POST /v1/invitations/:token/accept. An already
 *   registered / already logged-in visitor (including anyone returning from a social sign-in) accepts
 *   as their current account — BUT only when that account's verified email matches the invited
 *   address (recipient binding; the server enforces it and the page warns up front using the GET
 *   `viewer` verdict, so a wrong signed-in session cannot silently absorb the grant). Social sign-up +
 *   existing-user login reuse AIMEAT.auth.showLoginModal. On accept the server sets the refresh cookie
 *   and returns a redirect target (the inviter's allowlisted app return URL, else the profile); a full
 *   navigation there boots the SPA / opens the app logged-in.
 * @structure default export InviteAccept() — load invitation (+viewer) → register-and-join OR
 *   accept-as-me (email-matched) OR wrong-account panel (sign out / switch account).
 * @usage routed at /v1/invite?token=<token> by spa.html
 * @version-history
 *   v1.0.0 — 2026-07-04 — Initial (email invitations for unregistered users).
 *   v1.0.1 — 2026-07-04 — React to the auth 'logout' event too, so an in-page logout flips back to
 *     the register form instead of leaving the stale accept-as-me button.
 *   v1.1.0 — 2026-07-10 — Social sign-in providers (GET /v1/auth/providers) rendered as co-equal
 *     "Continue with X" buttons: Google was hidden behind a text link, so invited first-timers
 *     concluded a password was mandatory.
 *   v1.2.0 — 2026-07-18 — SECURITY (invite-hijack): a signed-in visitor whose verified email does NOT
 *     match the invited address sees a "wrong account" panel (sign out / switch account) instead of an
 *     accept button; the server's 403 EMAIL_MISMATCH is rendered the same way as a fallback. Re-fetch
 *     the `viewer` verdict on login/logout. Redirect follows the accept response's return target.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api } from '/js/api.js';
import { escHtml } from '/js/utils.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const fill = (s, vars) => Object.keys(vars).reduce((acc, k) => acc.split(`{${k}}`).join(vars[k]), s);

export default function InviteAccept() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [state, setState] = useState({ status: 'loading', inv: null, viewer: null, error: '' });
  const [authed, setAuthed] = useState(() => !!window.AIMEAT?.auth?.hasSession);
  const [form, setForm] = useState({ username: '', password: '', display_name: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [mismatch, setMismatch] = useState(false); // server said EMAIL_MISMATCH on POST (fallback path)
  const [providers, setProviders] = useState([]);

  // Social sign-in providers, rendered as co-equal buttons — an invited first-timer should not
  // conclude a password is mandatory when the node offers Google & co.
  useEffect(() => {
    let live = true;
    api('/v1/auth/providers')
      .then((res) => { if (live) setProviders(res?.data?.providers || []); })
      .catch(err => { swallowed('invite-accept: InviteAccept', err); });
    return () => { live = false; };
  }, []);

  // Full-page navigation to the provider's OIDC start; the callback redirects back here logged-in
  // (or with the one-time username-choice step), after which "Accept & join" joins as that account.
  function socialSignIn(p) {
    const back = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = (p.loginUrl || `/v1/ghii/login/${p.id}`) + '?redirect=' + back;
  }

  // Become reactive to an in-place login/logout (username/password via the shared modal, or a
  // logout on this page) so the view flips between accept-as-me and the register form, and so we
  // re-fetch the server's per-session `viewer` verdict for the newly-active (or cleared) session.
  useEffect(() => {
    const onLogin = () => setAuthed(true);
    const onLogout = () => { setAuthed(false); setMismatch(false); };
    window.AIMEAT?.auth?.on?.('login', onLogin);
    window.AIMEAT?.auth?.on?.('logout', onLogout);
    return () => {
      window.AIMEAT?.auth?.off?.('login', onLogin);
      window.AIMEAT?.auth?.off?.('logout', onLogout);
    };
  }, []);

  // Load the invitation details (public). Re-runs when the session changes so `viewer.email_matches`
  // (whether accepting as the current account is allowed) reflects who is actually signed in.
  useEffect(() => {
    if (!token) { setState({ status: 'error', inv: null, viewer: null, error: tr('invite.missing', 'This invitation link is missing its token.') }); return undefined; }
    let live = true;
    api('/v1/invitations/' + encodeURIComponent(token))
      .then((res) => { if (live) setState({ status: 'ready', inv: res.data.invitation, viewer: res.data.viewer || null, error: '' }); })
      .catch((e) => { if (live) setState({ status: 'error', inv: null, viewer: null, error: e.message || tr('invite.invalid', 'This invitation is invalid, was cancelled, or has expired.') }); });
    return () => { live = false; };
  }, [token, authed]);

  // POST accept: with a body (new account) or empty (accept as the current session). On success the
  // server set the refresh cookie + returned a redirect target — a full navigation opens it logged-in.
  const accept = useCallback(async (body) => {
    setSubmitting(true); setFormError(''); setMismatch(false);
    try {
      const res = await api('/v1/invitations/' + encodeURIComponent(token) + '/accept', {
        method: 'POST', body: JSON.stringify(body || {}),
      });
      // Fallback mirrors the server default: land INSIDE the organism, flagged as a fresh join.
      const orgId = res && res.data && res.data.organism_id;
      window.location.href = (res && res.data && res.data.redirect)
        || (orgId ? `/v1/profile?tab=organisms&org=${encodeURIComponent(orgId)}&joined=1` : '/v1/profile#organisms');
    } catch (e) {
      if (e && e.code === 'EMAIL_MISMATCH') { setMismatch(true); setSubmitting(false); return; }
      setFormError(e.message || tr('invite.acceptFailed', 'Could not accept the invitation.'));
      setSubmitting(false);
    }
  }, [token]);

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

  // Sign out and stay on the accept page, so the visitor can register the invited email or sign in as
  // the account it belongs to. The 'logout' event handler above re-fetches the viewer verdict.
  function signOutAndRetry() {
    try { window.AIMEAT?.auth?.logout?.(); } catch (err) { swallowed('invite-accept: signOutAndRetry', err); }
    setAuthed(false); setMismatch(false);
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
  const viewer = state.viewer;
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

  // Signed in, but this account is NOT the invited party (verified email doesn't match) — OR the
  // server refused a POST with EMAIL_MISMATCH. Never let a wrong account absorb an operator-curated
  // invitation: explain, and offer to sign out / switch account rather than showing an accept button.
  const wrongAccount = authed && (mismatch || (viewer && viewer.email_matches === false));
  if (wrongAccount) {
    const who = (viewer && viewer.owner) || (window.AIMEAT?.auth?.getSession?.()?.owner) || '';
    return html`
      <div class="inv-wrap">
        <div class="inv-card">
          <span class="inv-badge">${tr('invite.badge', 'Invitation')}</span>
          <h1 class="inv-title">${tr('invite.mismatchTitle', 'Wrong account')}</h1>
          ${summary}
          <p class="inv-error">
            ${who ? fill(tr('invite.signedInAs', "You're signed in as {owner}."), { owner: who }) + ' ' : null}
            ${fill(tr('invite.mismatchBody', 'This invitation was sent to {email}. It can only be accepted by the account whose verified email is that address. Sign out and open the link again, or ask the inviter to add your account directly.'), { email: inv.email || '' })}
          </p>
          <div class="inv-actions">
            <button class="btn-primary inv-btn" onClick=${signOutAndRetry}>${tr('invite.signOutRetry', 'Sign out')}</button>
            <button class="btn-outline inv-btn" onClick=${signInInstead}>${tr('invite.switchAccount', 'Use a different account')}</button>
          </div>
        </div>
      </div>`;
  }

  // Already signed in as the invited party (verified email matches): accept as the current account.
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
            ${fill(tr('invite.continueWith', 'Continue with {label}'), { label: p.label || p.id })}
          </button>`)}
        <button class="btn-outline inv-btn inv-signin" onClick=${signInInstead}>
          ${tr('invite.signInInstead', 'Already have an account? Sign in')}
        </button>
      </div>
    </div>`;
}
