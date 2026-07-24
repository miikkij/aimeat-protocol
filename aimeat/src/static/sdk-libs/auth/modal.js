/**
 * @file auth/modal.js
 * @description aimeat-auth sign-in modal (SDK-libs migration Phase 3): the password + social login
 *   modal with its own EN/FI switcher, forgot-password / forgot-username sub-views, and the
 *   email-completion sub-view (legacy accounts + the register-under-email-gate flow). wireModal's
 *   submit tries register → NAME_TAKEN → loginWithPassword, branching on EMAIL_REQUIRED /
 *   EMAIL_NOT_VERIFIED into the email step. Delegates account creation to the AIMEAT.auth object.
 *   Extracted from auth-lib-part2/3.ts.
 * @structure showLoginModal(opts, renderBtn) → { buildModalInner, wireModal, render, switchLang,
 *   openEmailCompletion, showView, capture/restoreInputs }.
 * @usage import { showLoginModal } from './modal.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — Extracted from src/routes/libs/auth-lib-part2/3.ts (SDK-libs migration Phase 3).
 *   v1.0.1 — 2026-07-25 — Fix: adopt the node's full locale dict when any key differs, so newer modal
 *     keys (email-step strings) missing from a host's opts.i18n no longer fall back to English.
 */
import { auth, api } from './session.js';
import { escHtml } from './theme.js';
import { currentModalLang, loadModalI18n, MODAL_LANG_KEY } from './i18n.js';
import { NODE_URL, NODE_ID, AUTH_PROVIDERS, PROVIDER_ICONS } from './config.js';

export function showLoginModal(opts, renderBtn) {
  var i = opts.i18n || {};
  var lang = currentModalLang();
  // Remove existing modal
  const old = document.getElementById('aimeat-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'aimeat-modal';

  // Capture typed values so they survive a re-render (language change).
  function captureInputs() {
    var g = function (id) { var el = /** @type {any} */ (document.getElementById(id)); return el ? el.value : ''; };
    return { u: g('aimeat-username'), p: g('aimeat-password'), d: g('aimeat-displayname') };
  }
  function restoreInputs(vals) {
    var s = function (id, val) { var el = /** @type {any} */ (document.getElementById(id)); if (el && val) el.value = val; };
    s('aimeat-username', vals.u); s('aimeat-password', vals.p); s('aimeat-displayname', vals.d);
  }

  // Switch language: persist the choice, reload translations, re-render in place (no page reload).
  function switchLang(next) {
    if (next === lang) return;
    try {
      localStorage.setItem(MODAL_LANG_KEY, next);
      document.cookie = 'aimeat-lang=' + next + ';path=/;max-age=31536000;SameSite=Lax';
    } catch { /* storage blocked */ }
    var vals = captureInputs();
    loadModalI18n(next).then(function (fresh) {
      lang = next;
      if (fresh && Object.keys(fresh).length) i = fresh;
      render(false);
      restoreInputs(vals);
    });
  }

  function render(anim) {
    modal.innerHTML = buildModalInner(i, lang, anim);
    wireModal();
  }

  document.body.appendChild(modal);
  render(true);

  // Adopt the node's full, correct-language dictionary. `fresh` is authoritative: it corrects a
  // wrong-language opts.i18n AND — the common case — fills newer keys the host's opts.i18n predates
  // (e.g. the email-step strings), which a signInBtn/descNew-only guard would wrongly skip, leaving
  // those keys undefined and rendering their English fallbacks.
  loadModalI18n(lang).then(function (fresh) {
    if (!fresh || !Object.keys(fresh).length) return;
    var differs = false;
    for (var k in fresh) {
      if (Object.prototype.hasOwnProperty.call(fresh, k) && fresh[k] !== i[k]) { differs = true; break; }
    }
    if (!differs) return;
    var vals = captureInputs();
    i = fresh;
    render(false);
    restoreInputs(vals);
  });

  function buildModalInner(i, lang, anim) {
    return '<style>'
      + '.aimeat-inp{width:100%;padding:11px 14px;border:1.5px solid #E5E7EB;border-radius:10px;font-family:DM Sans,system-ui,sans-serif;font-size:15px;color:#1A1A2E;background:#FAFAF8;box-sizing:border-box;transition:all .15s;outline:none}'
      + '.aimeat-inp:focus{border-color:#E8564A;box-shadow:0 0 0 3px rgba(232,86,74,.1)}'
      + '.aimeat-inp::placeholder{color:#9CA3AF}'
      + '.aimeat-go{flex:1;padding:12px;background:linear-gradient(135deg,#E8564A,#D4493F);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:15px;font-family:DM Sans,system-ui,sans-serif;box-shadow:0 2px 8px rgba(232,86,74,.25);transition:transform .15s,box-shadow .15s}'
      + '.aimeat-go:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(232,86,74,.35)}'
      + '.aimeat-label{display:block;margin-bottom:5px;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#6B7280}'
      + '.aimeat-cancel{padding:12px 20px;background:none;color:#1A1A2E;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer;font-size:15px;font-weight:500;font-family:DM Sans,system-ui,sans-serif;transition:background .15s}'
      + '.aimeat-cancel:hover{background:#F3F4F6}'
      + '.aimeat-fi{width:20px;height:20px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;margin-top:1px}'
      + '.aimeat-langsw{position:absolute;top:24px;right:28px;display:flex;gap:5px}'
      + '.aimeat-lang{padding:4px 9px;border:1px solid #E5E7EB;background:#fff;color:#6B7280;border-radius:7px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:.4px;line-height:1;font-family:DM Sans,system-ui,sans-serif;transition:all .15s}'
      + '.aimeat-lang:hover{border-color:#E8564A;color:#E8564A}'
      + '.aimeat-lang.active{background:#E8564A;color:#fff;border-color:#E8564A;cursor:default}'
      + '@keyframes aimeatModalIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}'
      + '</style>'
      + '<div style="position:fixed;inset:0;background:rgba(26,26,46,.4);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;z-index:99999;font-family:DM Sans,system-ui,sans-serif;padding:24px">'
      + '<div style="background:#FFFFFF;border-radius:16px;max-width:420px;width:100%;margin:auto;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.15),0 0 0 1px rgba(0,0,0,.05);' + (anim ? 'animation:aimeatModalIn .3s ease' : '') + '">'
      + '<div style="padding:28px 32px 0;position:relative">'
      + '<div class="aimeat-langsw">'
      + '<button type="button" class="aimeat-lang' + (lang === 'en' ? ' active' : '') + '" data-lang="en">EN</button>'
      + '<button type="button" class="aimeat-lang' + (lang === 'fi' ? ' active' : '') + '" data-lang="fi">FI</button>'
      + '</div>'
      + '<h2 style="margin:0;font-size:22px;font-weight:800;display:flex;align-items:center;gap:8px;color:#1A1A2E">'
      + 'AIME <span style="width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,#E8564A,#D4493F);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:14px">♥</span> AT Sign In'
      + '</h2>'
      + '<p style="margin:8px 0 0;font-size:14px;color:#6B7280;line-height:1.5">' + escHtml(i.descNew || 'New? Pick a username and password to create an account.') + ' ' + escHtml(i.descReturning || 'Already have an account? Enter your username and password.') + '</p>'
      + '</div>'
      // Body
      + '<div id="aimeat-modal-body" style="padding:24px 32px">'
      + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.usernameLabel || 'Username') + '</label>'
      + '<input id="aimeat-username" class="aimeat-inp" placeholder="' + escHtml(i.usernamePlaceholder || 'Username') + '"></div>'
      + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.passwordLabel || 'Password') + '</label>'
      + '<input id="aimeat-password" type="password" class="aimeat-inp" placeholder="' + escHtml(i.passwordPlaceholder || 'Password (min 4 chars)') + '"></div>'
      + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.displayNameLabel || 'Display Name') + ' <span style="font-weight:400;text-transform:none;letter-spacing:0">(' + escHtml(i.displayNameHint || 'optional, for new accounts') + ')</span></label>'
      + '<input id="aimeat-displayname" class="aimeat-inp" placeholder="' + escHtml(i.displayNamePlaceholder || 'Display Name') + '"></div>'
      + '<div style="display:flex;gap:10px;margin-top:20px">'
      + '<button id="aimeat-go-btn" class="aimeat-go">' + escHtml(i.signInBtn || 'Sign In / Register') + '</button>'
      + '<button id="aimeat-cancel-btn" class="aimeat-cancel">' + escHtml(i.cancelBtn || 'Cancel') + '</button>'
      + '</div>'
      + '<p id="aimeat-error" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p>'
      // Social login — one button per enabled OIDC provider, baked from config
      + (AUTH_PROVIDERS.length ? (
        '<div style="display:flex;align-items:center;gap:12px;margin:18px 0 14px;color:#9CA3AF;font-size:12px;font-weight:600;letter-spacing:.5px">'
        + '<span style="flex:1;height:1px;background:#E5E7EB"></span>' + escHtml(i.orLabel || 'OR') + '<span style="flex:1;height:1px;background:#E5E7EB"></span>'
        + '</div>'
        + AUTH_PROVIDERS.map(function (p) {
          return '<button type="button" class="aimeat-oauth-btn" data-provider="' + escHtml(p.id) + '" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;padding:11px;margin-bottom:8px;background:#fff;color:#1A1A2E;border:1.5px solid #E5E7EB;border-radius:10px;cursor:pointer;font-weight:600;font-size:15px;font-family:DM Sans,system-ui,sans-serif;transition:background .15s,border-color .15s">'
            + (PROVIDER_ICONS[p.id] || '')
            + escHtml((i[p.i18nKey]) || p.label) + '</button>';
        }).join('')
      ) : '')
      + '<div style="margin-top:14px;display:flex;gap:16px">'
      + '<a href="#" id="aimeat-forgot-pw" style="font-size:13px;color:#6B7280;cursor:pointer;text-decoration:underline">' + escHtml(i.forgotPassword || 'Forgot password?') + '</a>'
      + '<a href="#" id="aimeat-forgot-user" style="font-size:13px;color:#6B7280;cursor:pointer;text-decoration:underline">' + escHtml(i.forgotUsername || 'Forgot username?') + '</a>'
      + '</div>'
      + '</div>'
      // Forgot password sub-view (hidden by default)
      + '<div id="aimeat-forgot-pw-view" style="padding:24px 32px;display:none">'
      + '<div id="aimeat-fpw-step1">'
      + '<h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i.resetPasswordTitle || 'Reset Password') + '</h3>'
      + '<p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i.resetPasswordDesc || 'Enter your username to receive a reset code by email.') + '</p>'
      + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.usernameLabel || 'Username') + '</label>'
      + '<input id="aimeat-fpw-username" class="aimeat-inp" placeholder="' + escHtml(i.usernamePlaceholder || 'Username') + '"></div>'
      + '<div style="display:flex;gap:10px">'
      + '<button id="aimeat-fpw-send" class="aimeat-go">' + escHtml(i.sendResetCode || 'Send Reset Code') + '</button>'
      + '<button id="aimeat-fpw-back" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
      + '</div>'
      + '<p id="aimeat-fpw-msg" style="margin:8px 0 0;font-size:13px;color:#22C55E;display:none"></p>'
      + '<p id="aimeat-fpw-err" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p>'
      + '</div>'
      + '<div id="aimeat-fpw-step2" style="display:none">'
      + '<h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i.enterNewPasswordTitle || 'Enter New Password') + '</h3>'
      + '<p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i.resetCodeSent || 'A reset code was sent to your email. Enter it below with your new password.') + '</p>'
      + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.codeLabel || 'Reset Code') + '</label>'
      + '<input id="aimeat-fpw-code" class="aimeat-inp" placeholder="123456" maxlength="6"></div>'
      + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.newPasswordLabel || 'New Password') + '</label>'
      + '<input id="aimeat-fpw-newpass" type="password" class="aimeat-inp" placeholder="' + escHtml(i.newPasswordPlaceholder || 'New password (min 8 chars)') + '"></div>'
      + '<div style="display:flex;gap:10px">'
      + '<button id="aimeat-fpw-reset" class="aimeat-go">' + escHtml(i.resetPassword || 'Reset Password') + '</button>'
      + '<button id="aimeat-fpw-back2" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
      + '</div>'
      + '<p id="aimeat-fpw-msg2" style="margin:8px 0 0;font-size:13px;color:#22C55E;display:none"></p>'
      + '<p id="aimeat-fpw-err2" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p>'
      + '</div>'
      + '</div>'
      // Forgot username sub-view (hidden by default)
      + '<div id="aimeat-forgot-user-view" style="padding:24px 32px;display:none">'
      + '<h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i.recoverUsernameTitle || 'Recover Username') + '</h3>'
      + '<p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i.recoverUsernameDesc || 'Enter the email address associated with your account.') + '</p>'
      + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.emailLabel || 'Email') + '</label>'
      + '<input id="aimeat-fu-email" class="aimeat-inp" type="email" placeholder="you@example.com"></div>'
      + '<div style="display:flex;gap:10px">'
      + '<button id="aimeat-fu-send" class="aimeat-go">' + escHtml(i.sendUsername || 'Send My Username') + '</button>'
      + '<button id="aimeat-fu-back" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
      + '</div>'
      + '<p id="aimeat-fu-msg" style="margin:8px 0 0;font-size:13px;color:#22C55E;display:none"></p>'
      + '</div>'
      // Complete-account sub-view (hidden) — email verification (legacy accounts + register-under-gate).
      + '<div id="aimeat-email-view" style="padding:24px 32px;display:none">'
      + '<div id="aimeat-em-step1">'
      + '<h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i.completeAccountTitle || 'One last step') + '</h3>'
      + '<p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i.completeAccountDesc || 'Add an email to finish setting up your account. We’ll send a verification code to confirm it.') + '</p>'
      + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.emailLabel || 'Email') + '</label>'
      + '<input id="aimeat-em-email" class="aimeat-inp" type="email" placeholder="you@example.com"></div>'
      + '<div style="display:flex;gap:10px">'
      + '<button id="aimeat-em-send" class="aimeat-go">' + escHtml(i.sendVerificationCode || 'Send Verification Code') + '</button>'
      + '<button id="aimeat-em-back" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
      + '</div>'
      + '<p id="aimeat-em-err" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p>'
      + '</div>'
      + '<div id="aimeat-em-step2" style="display:none">'
      + '<h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i.enterCodeTitle || 'Enter Verification Code') + '</h3>'
      + '<p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i.enterCodeDesc || 'We sent a 6-digit code to your email. Enter it below to finish and sign in.') + '</p>'
      + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.codeLabel || 'Verification Code') + '</label>'
      + '<input id="aimeat-em-code" class="aimeat-inp" placeholder="123456" maxlength="6" inputmode="numeric"></div>'
      + '<div style="display:flex;gap:10px">'
      + '<button id="aimeat-em-confirm" class="aimeat-go">' + escHtml(i.confirmAndSignIn || 'Confirm & Sign In') + '</button>'
      + '<button id="aimeat-em-back2" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
      + '</div>'
      + '<p id="aimeat-em-msg2" style="margin:8px 0 0;font-size:13px;color:#22C55E;display:none"></p>'
      + '<p id="aimeat-em-err2" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p>'
      + '</div>'
      + '</div>'
      // Features footer
      + '<div style="padding:20px 32px 28px;background:#F9FAFB;border-top:1px solid #E5E7EB">'
      + '<h4 style="margin:0 0 12px;font-size:13px;font-weight:700;color:#1A1A2E;display:flex;align-items:center;gap:6px">✨ ' + escHtml(i.whyTitle || 'What do you get?') + '</h4>'
      + '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;margin-bottom:8px;line-height:1.45"><div class="aimeat-fi" style="background:#FFF1F0;color:#E8564A">♥</div><span>' + escHtml(i.whyGhii || 'A free GHII (Global Human Intelligence Identifier), your personal AI identity') + '</span></div>'
      + '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;margin-bottom:8px;line-height:1.45"><div class="aimeat-fi" style="background:#EFF6FF;color:#3B82F6">🔒</div><span>' + escHtml(i.whyPrivacy || 'Your own private memory space, protected by your password') + '</span></div>'
      + '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;margin-bottom:8px;line-height:1.45"><div class="aimeat-fi" style="background:#F0FDF4;color:#22C55E">🤖</div><span>' + escHtml(i.whyAgents || 'Connect AI agents that remember you and work on your behalf') + '</span></div>'
      + '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;line-height:1.45"><div class="aimeat-fi" style="background:#FFF1F0;color:#E8564A">♥</div><span><strong>' + escHtml(i.whyMorsels || 'Your own AI-built apps and agents work for you — a digital agency under your own roof.') + '</strong></span></div>'
      + '</div>'
      + '</div></div>';
  } // end buildModalInner

  function wireModal() {

    // Language switcher (EN/FI) — persists choice + re-renders the modal in place
    modal.querySelectorAll('.aimeat-lang').forEach(function (b) {
      b.addEventListener('click', function () { switchLang(b.getAttribute('data-lang')); });
    });

    document.getElementById('aimeat-cancel-btn').addEventListener('click', () => modal.remove());

    // Social sign-in — full-page navigation to the provider's OIDC start endpoint.
    modal.querySelectorAll('.aimeat-oauth-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-provider');
        var back = encodeURIComponent(location.pathname + location.search + location.hash);
        location.href = NODE_URL + '/v1/ghii/login/' + id + '?redirect=' + back;
      });
    });

    // Helper to toggle between views
    function showView(view) {
      document.getElementById('aimeat-modal-body').style.display = view === 'login' ? '' : 'none';
      document.getElementById('aimeat-forgot-pw-view').style.display = view === 'forgot-pw' ? '' : 'none';
      document.getElementById('aimeat-forgot-user-view').style.display = view === 'forgot-user' ? '' : 'none';
      document.getElementById('aimeat-email-view').style.display = view === 'email' ? '' : 'none';
    }

    // Credentials captured from the last correct-password attempt that hit the email gate.
    var pendingEmailLogin = null;

    // Open the email step. 'attach' — existing account needs a verified email. 'register' — brand-new
    // account under the email gate: step1 POST /v1/ghii (with email) creates it. Both finish identically.
    function openEmailCompletion(user, pass, hasEmail, mode, displayName) {
      pendingEmailLogin = { username: user, password: pass, mode: mode || 'attach', displayName: displayName || user };
      showView('email');
      document.getElementById('aimeat-em-step1').style.display = '';
      document.getElementById('aimeat-em-step2').style.display = 'none';
      var emailInput = /** @type {any} */ (document.getElementById('aimeat-em-email'));
      emailInput.value = '';
      var titleEl = document.querySelector('#aimeat-em-step1 h3');
      var desc = document.querySelector('#aimeat-em-step1 p');
      if (pendingEmailLogin.mode === 'register') {
        if (titleEl) titleEl.textContent = i.registerEmailTitle || 'Add your email';
        if (desc) desc.textContent = i.registerEmailDesc || 'Enter your email to create your account. We’ll send a verification code to confirm it.';
      } else {
        if (titleEl) titleEl.textContent = i.completeAccountTitle || 'One last step';
        if (desc) {
          desc.textContent = hasEmail
            ? (i.completeAccountDescResend || 'Confirm your email to finish signing in. We’ll send a verification code — edit the address if it’s wrong.')
            : (i.completeAccountDesc || 'Add an email to finish setting up your account. We’ll send a verification code to confirm it.');
        }
      }
      document.getElementById('aimeat-em-err').style.display = 'none';
      setTimeout(function () { emailInput.focus(); }, 50);
    }

    // Forgot password link
    document.getElementById('aimeat-forgot-pw').addEventListener('click', function (e) {
      e.preventDefault();
      showView('forgot-pw');
      document.getElementById('aimeat-fpw-step1').style.display = '';
      document.getElementById('aimeat-fpw-step2').style.display = 'none';
    });

    // Forgot username link
    document.getElementById('aimeat-forgot-user').addEventListener('click', function (e) {
      e.preventDefault();
      showView('forgot-user');
    });

    // Back to login buttons
    ['aimeat-fpw-back', 'aimeat-fpw-back2', 'aimeat-fu-back', 'aimeat-em-back', 'aimeat-em-back2'].forEach(function (id) {
      document.getElementById(id).addEventListener('click', function () { showView('login'); });
    });

    // Complete-account step 1 — send a verification code (re-verifies password server-side).
    document.getElementById('aimeat-em-send').addEventListener('click', async function () {
      var email = /** @type {any} */ (document.getElementById('aimeat-em-email')).value.trim();
      var errEl = document.getElementById('aimeat-em-err');
      errEl.style.display = 'none';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errEl.textContent = i.errEmailInvalid || 'Please enter a valid email address.';
        errEl.style.display = 'block';
        return;
      }
      if (!pendingEmailLogin) { showView('login'); return; }
      var btn = /** @type {any} */ (document.getElementById('aimeat-em-send'));
      btn.textContent = i.working || 'Working...';
      btn.disabled = true;
      try {
        var res;
        if (pendingEmailLogin.mode === 'register') {
          // Brand-new account under the email gate: create it now WITH the email (returns verification_id).
          res = await api('/v1/ghii', {
            method: 'POST',
            credentials: 'include',
            body: JSON.stringify({
              username: pendingEmailLogin.username,
              display_name: pendingEmailLogin.displayName,
              password: pendingEmailLogin.password,
              email: email,
            }),
          });
        } else {
          res = await api('/v1/ghii/login/attach-email', {
            method: 'POST',
            body: JSON.stringify({ username: pendingEmailLogin.username, password: pendingEmailLogin.password, email: email }),
          });
        }
        pendingEmailLogin.verificationId = res.data && res.data.verification_id;
        document.getElementById('aimeat-em-step1').style.display = 'none';
        document.getElementById('aimeat-em-step2').style.display = '';
        setTimeout(function () { /** @type {any} */ (document.getElementById('aimeat-em-code')).focus(); }, 50);
      } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
      } finally {
        btn.textContent = i.sendVerificationCode || 'Send Verification Code';
        btn.disabled = false;
      }
    });

    // Complete-account step 2 — confirm the code, then re-run the password login for a normal session.
    document.getElementById('aimeat-em-confirm').addEventListener('click', async function () {
      var code = /** @type {any} */ (document.getElementById('aimeat-em-code')).value.trim();
      var msgEl = document.getElementById('aimeat-em-msg2');
      var errEl = document.getElementById('aimeat-em-err2');
      msgEl.style.display = 'none';
      errEl.style.display = 'none';
      if (!code) { errEl.textContent = i.errCodeRequired || 'Enter the verification code.'; errEl.style.display = 'block'; return; }
      if (!pendingEmailLogin) { showView('login'); return; }
      var btn = /** @type {any} */ (document.getElementById('aimeat-em-confirm'));
      btn.textContent = i.working || 'Working...';
      btn.disabled = true;
      try {
        await api('/v1/ghii/verify-email', {
          method: 'POST',
          body: JSON.stringify({ verification_id: pendingEmailLogin.verificationId, code: code }),
        });
        msgEl.textContent = i.emailVerifiedSigningIn || 'Verified! Signing you in...';
        msgEl.style.display = 'block';
        var session = await auth.loginWithPassword(pendingEmailLogin.username, pendingEmailLogin.password);
        pendingEmailLogin = null;
        modal.remove();
        renderBtn();
        if (opts.onLogin) opts.onLogin(session);
      } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
        btn.textContent = i.confirmAndSignIn || 'Confirm & Sign In';
        btn.disabled = false;
      }
    });

    // Send password reset code
    document.getElementById('aimeat-fpw-send').addEventListener('click', async function () {
      var username = /** @type {any} */ (document.getElementById('aimeat-fpw-username')).value.trim().toLowerCase();
      var msgEl = document.getElementById('aimeat-fpw-msg');
      var errEl = document.getElementById('aimeat-fpw-err');
      msgEl.style.display = 'none';
      errEl.style.display = 'none';
      if (!username) { errEl.textContent = i.errUserShort || 'Username is required'; errEl.style.display = 'block'; return; }
      try {
        await api('/v1/ghii/password/reset-request', { method: 'POST', body: JSON.stringify({ username: username }) });
        msgEl.textContent = i.resetCodeSent || 'If your account has a verified email, a reset code was sent.';
        msgEl.style.display = 'block';
        document.getElementById('aimeat-fpw-step1').style.display = 'none';
        document.getElementById('aimeat-fpw-step2').style.display = '';
        window.__aimeatResetUser = username;
      } catch (e) {
        errEl.textContent = e.message; errEl.style.display = 'block';
      }
    });

    // Reset password with code
    document.getElementById('aimeat-fpw-reset').addEventListener('click', async function () {
      var code = /** @type {any} */ (document.getElementById('aimeat-fpw-code')).value.trim();
      var newPass = /** @type {any} */ (document.getElementById('aimeat-fpw-newpass')).value;
      var msgEl = document.getElementById('aimeat-fpw-msg2');
      var errEl = document.getElementById('aimeat-fpw-err2');
      msgEl.style.display = 'none';
      errEl.style.display = 'none';
      if (!code) { errEl.textContent = 'Code is required'; errEl.style.display = 'block'; return; }
      if (!newPass || newPass.length < 8) { errEl.textContent = i.errPassWeak || 'Password must be at least 8 characters'; errEl.style.display = 'block'; return; }
      try {
        await api('/v1/ghii/password/reset', { method: 'POST', body: JSON.stringify({
          username: window.__aimeatResetUser || '',
          code: code,
          newPassword: newPass,
        }) });
        msgEl.textContent = i.resetSuccess || 'Password reset successful! You can now sign in.';
        msgEl.style.display = 'block';
        setTimeout(function () { showView('login'); }, 2000);
      } catch (e) {
        errEl.textContent = e.message; errEl.style.display = 'block';
      }
    });

    // Send username recovery
    document.getElementById('aimeat-fu-send').addEventListener('click', async function () {
      var email = /** @type {any} */ (document.getElementById('aimeat-fu-email')).value.trim();
      var msgEl = document.getElementById('aimeat-fu-msg');
      msgEl.style.display = 'none';
      if (!email) return;
      try {
        await api('/v1/ghii/account/recover', { method: 'POST', body: JSON.stringify({ email: email }) });
      } catch { /* always show success */ }
      msgEl.textContent = i.usernameSent || 'If an account with that email exists, your username was sent.';
      msgEl.style.display = 'block';
    });

    // Enter in any of the sign-in fields submits (unless the button is mid-request/disabled).
    ['aimeat-username', 'aimeat-password', 'aimeat-displayname'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var btn = /** @type {any} */ (document.getElementById('aimeat-go-btn'));
        if (btn && !btn.disabled) btn.click();
      });
    });

    document.getElementById('aimeat-go-btn').addEventListener('click', async () => {
      let username = /** @type {any} */ (document.getElementById('aimeat-username')).value.trim().toLowerCase();
      const password = /** @type {any} */ (document.getElementById('aimeat-password')).value;
      const errEl = document.getElementById('aimeat-error');

      // Accept full GHII (e.g. "alice@node-id") — detect local vs federated
      let isGhii = false;
      let isFederated = false;
      let fullUsername = username;
      if (username.includes('@')) {
        const atIdx = username.indexOf('@');
        const nodePart = username.substring(atIdx + 1);
        if (nodePart && nodePart !== NODE_ID) {
          isFederated = true;
          isGhii = true;
        } else {
          username = username.substring(0, atIdx);
          isGhii = true;
        }
      }

      const displayName = /** @type {any} */ (document.getElementById('aimeat-displayname')).value.trim() || username;

      if (!username || username.length < 3) {
        errEl.textContent = i.errUserShort || 'Username must be at least 3 characters';
        errEl.style.display = 'block';
        return;
      }

      if (!password || password.length < 4) {
        errEl.textContent = i.errPassShort || 'Password must be at least 4 characters';
        errEl.style.display = 'block';
        return;
      }

      const btn = /** @type {any} */ (document.getElementById('aimeat-go-btn'));
      btn.textContent = i.working || 'Working...';
      btn.disabled = true;

      // If input was a full GHII, skip register and go straight to login
      if (isGhii) {
        try {
          if (isFederated) {
            btn.textContent = i.connectingHome || 'Connecting to home node...';
          }
          const loginUser = isFederated ? fullUsername : username;
          const session = await auth.loginWithPassword(loginUser, password);
          modal.remove();
          renderBtn();
          if (opts.onLogin) opts.onLogin(session);
        } catch (e2) {
          // Password correct but the account still needs a verified email — open the completion flow.
          if (e2.code === 'EMAIL_NOT_VERIFIED' && !isFederated) {
            btn.textContent = i.signInBtn || 'Sign In / Register';
            btn.disabled = false;
            openEmailCompletion(username, password, !!(e2.details && e2.details.has_email));
            return;
          }
          errEl.textContent = e2.message.includes('Invalid username or password')
            ? (i.errWrongPass || 'Wrong password for that username.')
            : e2.message;
          errEl.style.display = 'block';
          btn.textContent = i.signInBtn || 'Sign In / Register';
          btn.disabled = false;
        }
        return;
      }

      try {
        // Try registering first (new account)
        const session = await auth.register(username, displayName, { password });
        modal.remove();
        renderBtn();
        if (opts.onLogin) opts.onLogin(session);
      } catch (e) {
        // Email gate on + a genuinely new username → open the email step (register mode) to collect one.
        if (e.code === 'EMAIL_REQUIRED') {
          btn.textContent = i.signInBtn || 'Sign In / Register';
          btn.disabled = false;
          openEmailCompletion(username, password, false, 'register', displayName);
          return;
        }
        // If NAME_TAKEN, try logging in with password
        if (e.message.includes('already registered') || e.message.includes('NAME_TAKEN')) {
          try {
            const session = await auth.loginWithPassword(username, password);
            modal.remove();
            renderBtn();
            if (opts.onLogin) opts.onLogin(session);
          } catch (e2) {
            if (e2.code === 'EMAIL_NOT_VERIFIED') {
              btn.textContent = i.signInBtn || 'Sign In / Register';
              btn.disabled = false;
              openEmailCompletion(username, password, !!(e2.details && e2.details.has_email));
              return;
            }
            errEl.textContent = e2.message.includes('Invalid username or password')
              ? (i.errWrongPass || 'Wrong password for that username.')
              : e2.message;
            errEl.style.display = 'block';
            btn.textContent = i.signInBtn || 'Sign In';
            btn.disabled = false;
          }
        } else {
          errEl.textContent = e.message;
          errEl.style.display = 'block';
          btn.textContent = i.signInBtn || 'Sign In / Register';
          btn.disabled = false;
        }
      }
    });

  } // end wireModal
}
