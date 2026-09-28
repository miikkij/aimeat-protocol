/**
 * @file invite-accept.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.3.0 — 2026-09-27 — Drawn from library components and writing no class (page group G9): the
 *     card is AskPage (the tag, the question, the ways to answer, and the other ways in under "or"),
 *     the invitation's summary the dim Box named by the organism, the fields TextFields in Fields,
 *     a refusal the error message, the answers Loud and Action. css/views/invite-accept.css is gone.
 *   v1.3.1 — 2026-09-28 — No escHtml() on text: preact escapes every text child and attribute itself,
 *     so the page showed `&quot;` and `&amp;` in the organism's name, description, workspace names and
 *     the invitation message (reported from a live invitation on originalmiskate.com).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { showLoginModal, logout } from '/js/services/auth.js';
import { useSession } from '/js/use-session.js';
import { AskPage } from '/components/AskPage.js';
import { Action, Loud } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Label, Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Stack } from '/components/Layout.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const fill = (s, vars) => Object.keys(vars).reduce((acc, k) => acc.split(`{${k}}`).join(vars[k]), s);

export default function InviteAccept() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [state, setState] = useState({ status: 'loading', inv: null, viewer: null, error: '' });
  // Reactive to an in-place login/logout (the shared modal, or a sign-out on this page) so the view
  // flips between accept-as-me and the register form, and the effect below re-fetches the server's
  // per-session `viewer` verdict for the newly-active (or cleared) session.
  const session = useSession();
  const authed = !!session;
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

  // A session change clears the stale EMAIL_MISMATCH verdict — it belonged to the previous account.
  useEffect(() => { setMismatch(false); }, [session]);

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
    showLoginModal({});
  }

  // Sign out and stay on the accept page, so the visitor can register the invited email or sign in as
  // the account it belongs to. The session hook flips `authed` and re-fetches the viewer verdict.
  function signOutAndRetry() {
    logout().catch(err => { swallowed('invite-accept: signOutAndRetry', err); });
  }

  if (state.status === 'loading') {
    return html`<${AskPage} message=${tr('common.loading', 'Loading…')} />`;
  }
  if (state.status === 'error') {
    return html`
      <${AskPage} title=${tr('invite.errorTitle', 'Invitation unavailable')}
        doors=${html`<${Action} href="/v1/profile">${tr('common.back', 'Back')}<//>`}>
        <${Note} kind="lead">${state.error}<//>
      <//>`;
  }

  const inv = state.inv;
  const viewer = state.viewer;
  const org = inv.organism || {};
  const workspaces = inv.workspaces || [];
  const tag = html`<${Mark} tone="coral">${tr('invite.badge', 'Invitation')}<//>`;
  // What the invitation is to, by whom and as what, in the dim box: the organism by name.
  const summary = html`
    <${Box} tone="dim" name=${org.name || ''}>
      ${org.description ? html`<${Note}>${org.description}<//>` : null}
      <${Note} kind="lead">${tr('invite.invitedBy', 'Invited by')} <strong>${inv.invited_by || ''}</strong> ${tr('invite.asRole', 'as')} <strong>${inv.org_role || 'member'}</strong>.<//>
      ${workspaces.length ? html`
        <${Label} block>${tr('invite.workspacesLabel', "You'll get access to:")}<//>
        <${Stack} list gap="tight">
          ${workspaces.map((w) => html`<span key=${w.ws}>${w.name || w.ws} — ${w.role}</span>`)}
        <//>` : null}
      ${inv.message ? html`<${Note} kind="quiet">“${inv.message}”<//>` : null}
    <//>`;

  // Signed in, but this account is NOT the invited party (verified email doesn't match) — OR the
  // server refused a POST with EMAIL_MISMATCH. Never let a wrong account absorb an operator-curated
  // invitation: explain, and offer to sign out / switch account rather than showing an accept button.
  const wrongAccount = authed && (mismatch || (viewer && viewer.email_matches === false));
  if (wrongAccount) {
    const who = (viewer && viewer.owner) || session?.owner || '';
    return html`
      <${AskPage} tag=${tag} title=${tr('invite.mismatchTitle', 'Wrong account')}
        doors=${html`
          <${Action} onClick=${signInInstead}>${tr('invite.switchAccount', 'Use a different account')}<//>
          <${Loud} onClick=${signOutAndRetry}>${tr('invite.signOutRetry', 'Sign out')}<//>`}>
        ${summary}
        <${Note} kind="message" error>
          ${who ? fill(tr('invite.signedInAs', "You're signed in as {owner}."), { owner: who }) + ' ' : null}
          ${fill(tr('invite.mismatchBody', 'This invitation was sent to {email}. It can only be accepted by the account whose verified email is that address. Sign out and open the link again, or ask the inviter to add your account directly.'), { email: inv.email || '' })}
        <//>
      <//>`;
  }

  // Already signed in as the invited party (verified email matches): accept as the current account.
  if (authed) {
    return html`
      <${AskPage} tag=${tag} title=${tr('invite.acceptTitle', "You're invited")}
        doors=${html`
          <${Loud} onClick=${() => accept({})} disabled=${submitting}>
            ${submitting ? tr('invite.joining', 'Joining…') : tr('invite.acceptCta', 'Accept & join')}
          <//>`}>
        ${summary}
        ${formError ? html`<${Note} kind="message" error>${formError}<//>` : null}
      <//>`;
  }

  // Not signed in: register right here (email locked + recorded as verified) and join in one step.
  return html`
    <${AskPage} tag=${tag} title=${tr('invite.acceptTitle', "You're invited")}
      doors=${html`
        <${Loud} onClick=${acceptAsNew} disabled=${submitting}>
          ${submitting ? tr('invite.creating', 'Creating account…') : tr('invite.registerCta', 'Create account & join')}
        <//>`}
      or=${tr('invite.or', 'OR')}
      ways=${html`
        ${providers.map((p) => html`
          <${Action} key=${p.id} onClick=${() => socialSignIn(p)}>
            ${fill(tr('invite.continueWith', 'Continue with {label}'), { label: p.label || p.id })}
          <//>`)}
        <${Action} onClick=${signInInstead}>
          ${tr('invite.signInInstead', 'Already have an account? Sign in')}
        <//>`}>
      ${summary}
      <${Fields}>
        <${TextField} label=${tr('invite.emailLabel', 'Your email')} type="email" value=${inv.email || ''} readOnly />
        <${TextField} label=${tr('invite.usernameLabel', 'Choose a username')} autoFocus value=${form.username}
          onInput=${(v) => setForm((f) => ({ ...f, username: v }))} placeholder=${tr('invite.usernamePlaceholder', 'e.g. alice')} />
        <${TextField} label=${tr('invite.passwordLabel', 'Choose a password')} type="password" value=${form.password}
          onInput=${(v) => setForm((f) => ({ ...f, password: v }))} placeholder=${tr('invite.passwordPlaceholder', 'At least 8 characters')} />
        <${TextField} label=${tr('invite.displayNameLabel', 'Display name (optional)')} value=${form.display_name}
          onInput=${(v) => setForm((f) => ({ ...f, display_name: v }))} />
      <//>
      ${formError ? html`<${Note} kind="message" error>${formError}<//>` : null}
    <//>`;
}
