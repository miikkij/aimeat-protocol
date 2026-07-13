/**
 * @file src/routes/libs/auth-lib-part3.ts
 * @description aimeat-auth.js browser library source, tail segment (sign-in modal, signup modals, focus/visibility refresh, global expose). Extracted from libs.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from libs.ts (max-file-lines)
 */
export function aimeatAuthLibPart3(): string {
  return `            return '<button type="button" class="aimeat-oauth-btn" data-provider="' + escHtml(p.id) + '" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;padding:11px;margin-bottom:8px;background:#fff;color:#1A1A2E;border:1.5px solid #E5E7EB;border-radius:10px;cursor:pointer;font-weight:600;font-size:15px;font-family:DM Sans,system-ui,sans-serif;transition:background .15s,border-color .15s">'
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
    // Complete-account sub-view (hidden) — shown after a correct password when the account still needs
    // a verified email (legacy accounts with none, or a registered-but-unverified email to confirm).
    + '<div id="aimeat-email-view" style="padding:24px 32px;display:none">'
    + '<div id="aimeat-em-step1">'
    + '<h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1A1A2E">' + escHtml(i.completeAccountTitle || 'One last step') + '</h3>'
    + '<p style="font-size:13px;color:#6B7280;margin-bottom:14px">' + escHtml(i.completeAccountDesc || 'Add an email to finish setting up your account. We\\u2019ll send a verification code to confirm it.') + '</p>'
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
    + '<h4 style="margin:0 0 12px;font-size:13px;font-weight:700;color:#1A1A2E;display:flex;align-items:center;gap:6px">\\u2728 ' + escHtml(i.whyTitle || 'What do you get?') + '</h4>'
    + '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;margin-bottom:8px;line-height:1.45"><div class="aimeat-fi" style="background:#FFF1F0;color:#E8564A">\\u2665</div><span>' + escHtml(i.whyGhii || 'A free GHII (Global Human Intelligence Identifier), your personal AI identity') + '</span></div>'
    + '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;margin-bottom:8px;line-height:1.45"><div class="aimeat-fi" style="background:#EFF6FF;color:#3B82F6">\\ud83d\\udd12</div><span>' + escHtml(i.whyPrivacy || 'Your own private memory space, protected by your password') + '</span></div>'
    + '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;margin-bottom:8px;line-height:1.45"><div class="aimeat-fi" style="background:#F0FDF4;color:#22C55E">\\ud83e\\udd16</div><span>' + escHtml(i.whyAgents || 'Connect AI agents that remember you and work on your behalf') + '</span></div>'
    + '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#6B7280;line-height:1.45"><div class="aimeat-fi" style="background:#FFF1F0;color:#E8564A">\\u2665</div><span><strong>' + escHtml(i.whyMorsels || 'Your own AI-built apps and agents work for you \\u2014 a digital agency under your own roof.') + '</strong></span></div>'
    + '</div>'
    + '</div></div>';
  } // end buildModalInner

  function wireModal() {

  // Language switcher (EN/FI) — persists choice + re-renders the modal in place
  modal.querySelectorAll('.aimeat-lang').forEach(function(b) {
    b.addEventListener('click', function() { switchLang(b.getAttribute('data-lang')); });
  });

  document.getElementById('aimeat-cancel-btn').addEventListener('click', () => modal.remove());

  // Social sign-in — full-page navigation to the provider's OIDC start endpoint. The node sets a
  // refresh cookie on callback and redirects back; the SPA then boots logged-in.
  modal.querySelectorAll('.aimeat-oauth-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
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

  // Credentials captured from the last correct-password attempt that hit the email gate, reused to
  // send the code (attach-email) and to re-login once the email is verified.
  var pendingEmailLogin = null;

  // Open the complete-account flow after a successful password but an unverified/missing email.
  // hasEmail (from the server details) picks the prefill hint text.
  function openEmailCompletion(user, pass, hasEmail) {
    pendingEmailLogin = { username: user, password: pass };
    showView('email');
    document.getElementById('aimeat-em-step1').style.display = '';
    document.getElementById('aimeat-em-step2').style.display = 'none';
    var emailInput = document.getElementById('aimeat-em-email');
    emailInput.value = '';
    var desc = document.querySelector('#aimeat-em-step1 p');
    if (desc) {
      desc.textContent = hasEmail
        ? (i.completeAccountDescResend || 'Confirm your email to finish signing in. We\\u2019ll send a verification code — edit the address if it\\u2019s wrong.')
        : (i.completeAccountDesc || 'Add an email to finish setting up your account. We\\u2019ll send a verification code to confirm it.');
    }
    document.getElementById('aimeat-em-err').style.display = 'none';
    setTimeout(function () { emailInput.focus(); }, 50);
  }

  // Forgot password link
  document.getElementById('aimeat-forgot-pw').addEventListener('click', function(e) {
    e.preventDefault();
    showView('forgot-pw');
    document.getElementById('aimeat-fpw-step1').style.display = '';
    document.getElementById('aimeat-fpw-step2').style.display = 'none';
  });

  // Forgot username link
  document.getElementById('aimeat-forgot-user').addEventListener('click', function(e) {
    e.preventDefault();
    showView('forgot-user');
  });

  // Back to login buttons
  ['aimeat-fpw-back', 'aimeat-fpw-back2', 'aimeat-fu-back', 'aimeat-em-back', 'aimeat-em-back2'].forEach(function(id) {
    document.getElementById(id).addEventListener('click', function() { showView('login'); });
  });

  // Complete-account step 1 — send a verification code to the entered email (re-verifies password server-side).
  document.getElementById('aimeat-em-send').addEventListener('click', async function() {
    var email = document.getElementById('aimeat-em-email').value.trim();
    var errEl = document.getElementById('aimeat-em-err');
    errEl.style.display = 'none';
    if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
      errEl.textContent = i.errEmailInvalid || 'Please enter a valid email address.';
      errEl.style.display = 'block';
      return;
    }
    if (!pendingEmailLogin) { showView('login'); return; }
    var btn = document.getElementById('aimeat-em-send');
    btn.textContent = i.working || 'Working...';
    btn.disabled = true;
    try {
      var res = await api('/v1/ghii/login/attach-email', {
        method: 'POST',
        body: JSON.stringify({ username: pendingEmailLogin.username, password: pendingEmailLogin.password, email: email }),
      });
      // Keep the id — /v1/ghii/verify-email requires it to confirm the code.
      pendingEmailLogin.verificationId = res.data && res.data.verification_id;
      document.getElementById('aimeat-em-step1').style.display = 'none';
      document.getElementById('aimeat-em-step2').style.display = '';
      setTimeout(function () { document.getElementById('aimeat-em-code').focus(); }, 50);
    } catch(e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.textContent = i.sendVerificationCode || 'Send Verification Code';
      btn.disabled = false;
    }
  });

  // Complete-account step 2 — confirm the code, then re-run the password login for a normal session.
  document.getElementById('aimeat-em-confirm').addEventListener('click', async function() {
    var code = document.getElementById('aimeat-em-code').value.trim();
    var msgEl = document.getElementById('aimeat-em-msg2');
    var errEl = document.getElementById('aimeat-em-err2');
    msgEl.style.display = 'none';
    errEl.style.display = 'none';
    if (!code) { errEl.textContent = i.errCodeRequired || 'Enter the verification code.'; errEl.style.display = 'block'; return; }
    if (!pendingEmailLogin) { showView('login'); return; }
    var btn = document.getElementById('aimeat-em-confirm');
    btn.textContent = i.working || 'Working...';
    btn.disabled = true;
    try {
      // verify-email finalises the email + sets verificationLevel=1, keyed by the verification_id
      // returned from attach-email above.
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
    } catch(e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      btn.textContent = i.confirmAndSignIn || 'Confirm & Sign In';
      btn.disabled = false;
    }
  });

  // Send password reset code
  document.getElementById('aimeat-fpw-send').addEventListener('click', async function() {
    var username = document.getElementById('aimeat-fpw-username').value.trim().toLowerCase();
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
      // Pre-fill the username for the reset step
      window.__aimeatResetUser = username;
    } catch(e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
    }
  });

  // Reset password with code
  document.getElementById('aimeat-fpw-reset').addEventListener('click', async function() {
    var code = document.getElementById('aimeat-fpw-code').value.trim();
    var newPass = document.getElementById('aimeat-fpw-newpass').value;
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
        newPassword: newPass
      }) });
      msgEl.textContent = i.resetSuccess || 'Password reset successful! You can now sign in.';
      msgEl.style.display = 'block';
      setTimeout(function() { showView('login'); }, 2000);
    } catch(e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
    }
  });

  // Send username recovery
  document.getElementById('aimeat-fu-send').addEventListener('click', async function() {
    var email = document.getElementById('aimeat-fu-email').value.trim();
    var msgEl = document.getElementById('aimeat-fu-msg');
    msgEl.style.display = 'none';
    if (!email) return;
    try {
      await api('/v1/ghii/account/recover', { method: 'POST', body: JSON.stringify({ email: email }) });
    } catch(_) { /* always show success */ }
    msgEl.textContent = i.usernameSent || 'If an account with that email exists, your username was sent.';
    msgEl.style.display = 'block';
  });

  // Enter in any of the sign-in fields submits (unless the button is mid-request/disabled).
  ['aimeat-username', 'aimeat-password', 'aimeat-displayname'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var btn = document.getElementById('aimeat-go-btn');
      if (btn && !btn.disabled) btn.click();
    });
  });

  document.getElementById('aimeat-go-btn').addEventListener('click', async () => {
    let username = document.getElementById('aimeat-username').value.trim().toLowerCase();
    const password = document.getElementById('aimeat-password').value;
    const errEl = document.getElementById('aimeat-error');

    // Accept full GHII (e.g. "alice@node-id") -- detect local vs federated
    let isGhii = false;
    let isFederated = false;
    let fullUsername = username;
    if (username.includes('@')) {
      const atIdx = username.indexOf('@');
      const nodePart = username.substring(atIdx + 1);
      if (nodePart && nodePart !== NODE_ID) {
        // Federated login -- keep full username@node-id for the server
        isFederated = true;
        isGhii = true;
      } else {
        // Local GHII -- strip the @node-id
        username = username.substring(0, atIdx);
        isGhii = true;
      }
    }

    const displayName = document.getElementById('aimeat-displayname').value.trim() || username;

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

    const btn = document.getElementById('aimeat-go-btn');
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
      } catch(e2) {
        // Password was correct but the account still needs a verified email — open the completion
        // flow instead of a dead-end error. Federated accounts are completed on their home node.
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
    } catch(e) {
      // If NAME_TAKEN, try logging in with password
      if (e.message.includes('already registered') || e.message.includes('NAME_TAKEN')) {
        try {
          const session = await auth.loginWithPassword(username, password);
          modal.remove();
          renderBtn();
          if (opts.onLogin) opts.onLogin(session);
        } catch(e2) {
          // Correct password but the account needs a verified email → open the completion flow.
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

// ── One-time username choice after a first Google sign-in ──
// A brand-new Google user is NOT auto-created server-side. The callback bounced them back here
// with ?aimeat_signup=1 plus a short-lived signed cookie holding their verified Google identity.
// This modal shows the suggested username (derived from their Google account), lets them change
// it, warns that it is PERMANENT, then POSTs to finalize — which creates the account + session.
var USERNAME_RE = new RegExp('^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$');

function fillTemplate(str, vars) {
  return String(str || '').replace(/\\{(\\w+)\\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; });
}

// Drop ?aimeat_signup=1 from the address bar so a reload doesn't re-open the modal.
function cleanSignupParam() {
  try {
    var url = new URL(location.href);
    if (!url.searchParams.has('aimeat_signup')) return;
    url.searchParams.delete('aimeat_signup');
    history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
  } catch (e) {}
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
    + '<div style="position:fixed;inset:0;background:rgba(26,26,46,.4);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:DM Sans,system-ui,sans-serif;padding:24px">'
    + '<div style="background:#FFFFFF;border-radius:16px;max-width:440px;width:100%;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.15),0 0 0 1px rgba(0,0,0,.05)">'
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

  // An account already claims this email but never verified it locally — the server refuses to
  // link (anti-takeover) AND to create a duplicate. Explain the one-time password sign-in path
  // instead of dead-ending the user at "username taken".
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
    + '<div style="position:fixed;inset:0;background:rgba(26,26,46,.4);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:DM Sans,system-ui,sans-serif;padding:24px">'
    + '<div style="background:#FFFFFF;border-radius:16px;max-width:440px;width:100%;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.15),0 0 0 1px rgba(0,0,0,.05)">'
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

  var input = document.getElementById('aimeat-su-name');
  var statusEl = document.getElementById('aimeat-su-status');
  var createBtn = document.getElementById('aimeat-su-create');
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
    var displayEl = document.getElementById('aimeat-su-display');
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
      // Full navigation to the post-login target — the page boots logged-in from the new
      // refresh cookie (same as the returning-user Google path).
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

// On load, if the Google callback flagged a pending sign-up, fetch it and prompt. If the signed
// cookie is missing/expired the pending fetch 404s — explain that (retry Google, no password
// needed) instead of doing nothing: the silent path stranded users at the password sign-in form,
// where they concluded Google requires setting a password.
function maybeShowGoogleSignup() {
  var params;
  try { params = new URLSearchParams(location.search); } catch (e) { return; }
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
if (typeof document !== 'undefined' && document.addEventListener) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeShowGoogleSignup);
  else maybeShowGoogleSignup();
}

// ── Refresh on focus / visibility ──
// The auto-refresh setTimeout fires 5 min before expiry, but timers do NOT fire
// while the machine is asleep or the tab is frozen/discarded by the browser. So
// after the user steps away and returns, the proactive refresh never happened and
// the JWT may already be expired. Re-check the token whenever the tab regains
// visibility or focus, and refresh if it is within the 5-min window (or expired).
let focusRefreshInFlight = null;
function refreshOnFocus() {
  const session = currentSession;
  // Federated sessions cannot self-refresh by signing — leave them to re-login.
  if (!session || !session.jwt || session.federated) return;
  const payload = parseJwt(session.jwt);
  if (!payload || !payload.exp) return;
  const msUntilExpiry = (payload.exp * 1000) - Date.now();
  if (msUntilExpiry > 5 * 60 * 1000) return; // still comfortably valid
  if (focusRefreshInFlight) return; // focus + visibilitychange can both fire — de-dupe
  const wasExpired = msUntilExpiry <= 0;
  focusRefreshInFlight = session.refresh()
    .then(() => { emit('refreshed', session); })
    .catch((e) => {
      console.warn('[aimeat-auth] Focus refresh failed:', e.message);
      // Only declare the session dead if the token had actually expired. A
      // transient failure while still inside the pre-expiry window can be
      // retried by the scheduled timer or the next API call.
      if (wasExpired) emit('expired', { reason: 'refresh_failed', error: e.message });
    })
    .finally(() => { focusRefreshInFlight = null; });
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnFocus();
  });
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('focus', refreshOnFocus);
}

// ── Expose globally ──
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.auth = auth;
global.AIMEAT.version = '2026-07-02-001';

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
