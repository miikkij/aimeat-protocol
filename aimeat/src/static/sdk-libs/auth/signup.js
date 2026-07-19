/**
 * @file auth/signup.js
 * @description aimeat-auth first-time social-signup flow (SDK-libs migration Phase 3). After a first
 *   Google/OIDC sign-in the server does NOT auto-create the account — it bounces back with
 *   ?aimeat_signup=1 + a short-lived signed cookie. showGoogleSignupModal prompts for a permanent
 *   username (live availability check) + display name, then POSTs finalize (creates account +
 *   session). showSignupNoticeModal handles the link-existing / expired-pending explanations.
 *   maybeShowGoogleSignup runs on load. Extracted from auth-lib-part3.ts.
 * @structure USERNAME_RE · fillTemplate · cleanSignupParam · showSignupNoticeModal ·
 *   showGoogleSignupModal · maybeShowGoogleSignup.
 * @usage import { maybeShowGoogleSignup } from './signup.js';  (boot calls it on load)
 * @version-history
 *   v1.0.0 — 2026-07-19 — Extracted from src/routes/libs/auth-lib-part3.ts (SDK-libs migration Phase 3).
 */
import { api } from './session.js';
import { escHtml } from './theme.js';
import { currentModalLang, loadModalI18n } from './i18n.js';
import { NODE_URL } from './config.js';
import { showLoginModal } from './modal.js';

var USERNAME_RE = new RegExp('^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$');

function fillTemplate(str, vars) {
  return String(str || '').replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; });
}

// Drop ?aimeat_signup=1 from the address bar so a reload doesn't re-open the modal.
function cleanSignupParam() {
  try {
    var url = new URL(location.href);
    if (!url.searchParams.has('aimeat_signup')) return;
    url.searchParams.delete('aimeat_signup');
    history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
  } catch { /* URL/history unavailable */ }
}

// Minimal notice modal sharing the signup modal's chrome — used when the username-choice step is
// replaced by an explanation (existing unverified-email account; expired pending sign-up).
function showSignupNoticeModal(i, opts) {
  var old = document.getElementById('aimeat-modal');
  if (old) old.remove();
  var modal = document.createElement('div');
  modal.id = 'aimeat-modal';
  document.body.appendChild(modal);
  modal.innerHTML = '<style>'
    + '.aimeat-go{flex:1;padding:12px;background:linear-gradient(135deg,#E8564A,#D4493F);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:15px;font-family:DM Sans,system-ui,sans-serif;box-shadow:0 2px 8px rgba(232,86,74,.25);transition:transform .15s,box-shadow .15s}'
    + '.aimeat-cancel{padding:12px 20px;background:none;color:#1A1A2E;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer;font-size:15px;font-weight:500;font-family:DM Sans,system-ui,sans-serif;transition:background .15s}'
    + '.aimeat-cancel:hover{background:#F3F4F6}'
    + '</style>'
    + '<div style="position:fixed;inset:0;background:rgba(26,26,46,.4);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;z-index:99999;font-family:DM Sans,system-ui,sans-serif;padding:24px">'
    + '<div style="background:#FFFFFF;border-radius:16px;max-width:440px;width:100%;margin:auto;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.15),0 0 0 1px rgba(0,0,0,.05)">'
    + '<div style="padding:28px 32px 24px">'
    + '<h2 style="margin:0 0 8px;font-size:21px;font-weight:800;color:#1A1A2E">' + escHtml(opts.title || '') + '</h2>'
    + '<p style="margin:0 0 18px;font-size:14px;color:#6B7280;line-height:1.55">' + escHtml(opts.body || '') + '</p>'
    + '<div style="display:flex;gap:10px">'
    + '<button id="aimeat-sn-primary" class="aimeat-go">' + escHtml(opts.primaryLabel || 'OK') + '</button>'
    + (opts.showCancel ? '<button id="aimeat-sn-cancel" class="aimeat-cancel">' + escHtml(i.signupCancelBtn || 'Cancel') + '</button>' : '')
    + '</div>'
    + '</div></div></div>';
  function close() { modal.remove(); cleanSignupParam(); }
  document.getElementById('aimeat-sn-primary').addEventListener('click', function () {
    close();
    if (opts.onPrimary) opts.onPrimary();
  });
  var cancelEl = document.getElementById('aimeat-sn-cancel');
  if (cancelEl) cancelEl.addEventListener('click', close);
}

function showGoogleSignupModal(pending, i) {
  i = i || {};

  // An account already claims this email but never verified it — explain the one-time password
  // sign-in path instead of dead-ending at "username taken".
  if (pending && pending.mode === 'link_existing') {
    var hint = pending.existing_hint
      ? ' ' + fillTemplate(i.signupLinkHint || '(Username hint: {hint}.)', { hint: pending.existing_hint })
      : '';
    showSignupNoticeModal(i, {
      title: i.signupLinkTitle || 'This email already has an account',
      body: fillTemplate(i.signupLinkIntro || 'An AIMEAT account already uses {email}, but its email has not been verified yet. Sign in with your username and password once — that verifies your email, and after that this sign-in connects to your account automatically.', { email: pending.email || '' }) + hint,
      primaryLabel: i.signupLinkSignInBtn || 'Sign in with password',
      showCancel: true,
      onPrimary: function () { showLoginModal({ i18n: i }, function () {}); },
    });
    return;
  }

  var old = document.getElementById('aimeat-modal');
  if (old) old.remove();
  var modal = document.createElement('div');
  modal.id = 'aimeat-modal';
  document.body.appendChild(modal);

  var emailNote = pending.email
    ? '<p style="margin:0 0 14px;font-size:13px;color:#6B7280">' + escHtml(fillTemplate(i.signupEmailNote || 'Signing up as {email}', { email: pending.email })) + '</p>'
    : '';

  modal.innerHTML = '<style>'
    + '.aimeat-inp{width:100%;padding:11px 14px;border:1.5px solid #E5E7EB;border-radius:10px;font-family:DM Sans,system-ui,sans-serif;font-size:15px;color:#1A1A2E;background:#FAFAF8;box-sizing:border-box;transition:all .15s;outline:none}'
    + '.aimeat-inp:focus{border-color:#E8564A;box-shadow:0 0 0 3px rgba(232,86,74,.1)}'
    + '.aimeat-go{flex:1;padding:12px;background:linear-gradient(135deg,#E8564A,#D4493F);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:15px;font-family:DM Sans,system-ui,sans-serif;box-shadow:0 2px 8px rgba(232,86,74,.25);transition:transform .15s,box-shadow .15s}'
    + '.aimeat-go:disabled{opacity:.55;cursor:not-allowed;box-shadow:none}'
    + '.aimeat-label{display:block;margin-bottom:5px;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#6B7280}'
    + '.aimeat-cancel{padding:12px 20px;background:none;color:#1A1A2E;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer;font-size:15px;font-weight:500;font-family:DM Sans,system-ui,sans-serif;transition:background .15s}'
    + '.aimeat-cancel:hover{background:#F3F4F6}'
    + '</style>'
    + '<div style="position:fixed;inset:0;background:rgba(26,26,46,.4);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;z-index:99999;font-family:DM Sans,system-ui,sans-serif;padding:24px">'
    + '<div style="background:#FFFFFF;border-radius:16px;max-width:440px;width:100%;margin:auto;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.15),0 0 0 1px rgba(0,0,0,.05)">'
    + '<div style="padding:28px 32px 24px">'
    + '<h2 style="margin:0 0 8px;font-size:21px;font-weight:800;color:#1A1A2E">' + escHtml(i.signupTitle || 'Choose your username') + '</h2>'
    + '<p style="margin:0 0 6px;font-size:14px;color:#6B7280;line-height:1.5">' + escHtml(i.signupIntro || "You're signing in for the first time. Pick the username for your AIMEAT account.") + '</p>'
    + emailNote
    + '<label class="aimeat-label" for="aimeat-su-name">' + escHtml(i.signupUsernameLabel || 'Username') + '</label>'
    + '<input id="aimeat-su-name" class="aimeat-inp" autocomplete="off" autocapitalize="none" spellcheck="false" value="' + escHtml(pending.suggested || '') + '">'
    + '<p id="aimeat-su-status" style="margin:6px 0 0;font-size:13px;min-height:18px"></p>'
    + '<p style="margin:8px 0 0;font-size:12px;color:#9CA3AF;line-height:1.45">' + escHtml(i.signupSuggestedHint || 'We suggested one from your account — change it to anything you like.') + '</p>'
    + '<div style="margin:16px 0 0;padding:12px 14px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;font-size:13px;color:#9A3412;line-height:1.5">' + escHtml(i.signupPermanentWarning || 'This username is permanent. It identifies you across AIMEAT and cannot be changed later — the only way to change it is to delete your account and create a new one.') + '</div>'
    + '<label class="aimeat-label" for="aimeat-su-display" style="margin-top:16px">' + escHtml(i.signupDisplayNameLabel || 'Display name') + '</label>'
    + '<input id="aimeat-su-display" class="aimeat-inp" autocomplete="off" maxlength="80" value="' + escHtml(pending.displayName || '') + '">'
    + '<p style="margin:6px 0 0;font-size:12px;color:#9CA3AF;line-height:1.45">' + escHtml(i.signupDisplayNameHint || 'Shown to others — not permanent, you can change it anytime later.') + '</p>'
    + '<div style="display:flex;gap:10px;margin-top:20px">'
    + '<button id="aimeat-su-create" class="aimeat-go">' + escHtml(i.signupCreateBtn || 'Create my account') + '</button>'
    + '<button id="aimeat-su-cancel" class="aimeat-cancel">' + escHtml(i.signupCancelBtn || 'Cancel') + '</button>'
    + '</div>'
    + '<p id="aimeat-su-err" style="margin:10px 0 0;font-size:13px;color:#ef4444;display:none"></p>'
    + '</div></div></div>';

  var input = /** @type {any} */ (document.getElementById('aimeat-su-name'));
  var statusEl = document.getElementById('aimeat-su-status');
  var createBtn = /** @type {any} */ (document.getElementById('aimeat-su-create'));
  var cancelBtn = document.getElementById('aimeat-su-cancel');
  var errEl = document.getElementById('aimeat-su-err');
  var checkTimer = null;
  var lastChecked = '';

  function setStatus(text, color) {
    statusEl.textContent = text || '';
    statusEl.style.color = color || '#6B7280';
  }

  // Validate format locally, then confirm availability against the node (debounced).
  function evaluate() {
    errEl.style.display = 'none';
    var name = (input.value || '').trim().toLowerCase();
    if (!USERNAME_RE.test(name)) {
      createBtn.disabled = true;
      setStatus(i.signupInvalid || 'Username must be 3–64 characters: lowercase letters, numbers and hyphens.', '#ef4444');
      return;
    }
    createBtn.disabled = true; // until availability confirms
    setStatus('…', '#9CA3AF');
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(function () {
      lastChecked = name;
      api('/v1/ghii/username-available?name=' + encodeURIComponent(name))
        .then(function (res) {
          var d = res && res.data;
          if (!d || (input.value || '').trim().toLowerCase() !== lastChecked) return; // stale
          if (d.valid && d.available) { createBtn.disabled = false; setStatus(i.signupAvailable || '✓ Available', '#16a34a'); }
          else if (!d.valid) { createBtn.disabled = true; setStatus(i.signupInvalid || d.reason || 'Invalid username', '#ef4444'); }
          else { createBtn.disabled = true; setStatus(i.signupTaken || 'That username is already taken — pick another.', '#ef4444'); }
        })
        .catch(function () { /* network blip — allow submit; finalize re-validates */ createBtn.disabled = false; setStatus('', '#6B7280'); });
    }, 350);
  }

  input.addEventListener('input', evaluate);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !createBtn.disabled) { e.preventDefault(); createBtn.click(); } });

  function close() { if (checkTimer) clearTimeout(checkTimer); modal.remove(); cleanSignupParam(); }
  cancelBtn.addEventListener('click', close);

  createBtn.addEventListener('click', async function () {
    var name = (input.value || '').trim().toLowerCase();
    if (!USERNAME_RE.test(name)) { evaluate(); return; }
    var displayEl = /** @type {any} */ (document.getElementById('aimeat-su-display'));
    var displayName = displayEl ? (displayEl.value || '').trim() : '';
    createBtn.disabled = true;
    createBtn.textContent = i.signupCreating || 'Creating account...';
    errEl.style.display = 'none';
    try {
      var res = await api('/v1/ghii/login/' + (pending.provider || 'google') + '/finalize', {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ username: name, displayName: displayName }),
      });
      cleanSignupParam();
      var redirect = (res && res.data && res.data.redirect) || pending.redirect || '/';
      // Full navigation to the post-login target — the page boots logged-in from the new refresh cookie.
      location.href = NODE_URL + redirect;
    } catch (e) {
      var msg = e && e.message ? e.message : 'Could not create account';
      if (msg.indexOf('already registered') >= 0 || msg.indexOf('NAME_TAKEN') >= 0) msg = i.signupTaken || msg;
      errEl.textContent = msg;
      errEl.style.display = 'block';
      createBtn.textContent = i.signupCreateBtn || 'Create my account';
      evaluate();
    }
  });

  // Confirm the pre-filled suggestion's availability on open.
  evaluate();
}

// On load, if the OIDC callback flagged a pending sign-up, fetch it and prompt. If the signed cookie
// is missing/expired the pending fetch 404s — explain that (retry, no password needed) instead of
// doing nothing.
export function maybeShowGoogleSignup() {
  var params;
  try { params = new URLSearchParams(location.search); } catch { return; }
  if (params.get('aimeat_signup') !== '1') return;
  function showExpired() {
    function open(i) {
      showSignupNoticeModal(i || {}, {
        title: (i && i.signupExpiredTitle) || 'Sign-in session expired',
        body: (i && i.signupExpiredBody) || 'Your sign-in session expired or was interrupted. No password is needed — just click “Continue with Google” again to restart.',
        primaryLabel: (i && i.signupExpiredOkBtn) || 'OK',
        showCancel: false,
      });
    }
    loadModalI18n(currentModalLang()).then(open).catch(function () { open({}); });
  }
  api('/v1/ghii/login/pending', { credentials: 'include' })
    .then(function (res) {
      var pending = res && res.data;
      if (!pending) { showExpired(); return; }
      loadModalI18n(currentModalLang())
        .then(function (i) { showGoogleSignupModal(pending, i || {}); })
        .catch(function () { showGoogleSignupModal(pending, {}); });
    })
    .catch(function () { showExpired(); });
}
