/**
 * @file auth/modal-recovery-views.js
 * @description The three sub-views of the sign-in modal that are not sign-in itself: forgot
 *   password (ask for a code, then set a new password), forgot username (the address gets the name
 *   sent to it), and complete-account (an account with no verified email, and a brand-new account
 *   created under the email gate). The markup of all three, and the wiring of the first two;
 *   modal.js wires complete-account, because that step shares its pendingEmailLogin state.
 *
 *   PURE EXTRACTION from modal.js on 2026-09-04, moved because that file passed the 800-line
 *   ceiling when the second-factor step arrived. The strings are the same bytes, re-indented.
 *
 * @structure recoveryViewsHtml(i, field) -> the three hidden views as one markup string ·
 *   wireRecoveryViews({ i, api, showView }) -> the forgot-password and forgot-username handlers
 * @usage import { recoveryViewsHtml, wireRecoveryViews } from './modal-recovery-views.js';
 * @version-history
 *   v1.1.0 — 2026-10-05 — wireRecoveryViews: the forgot-password and forgot-username handlers,
 *     extracted verbatim from modal.js, which the sign-up fix took past the 800-line ceiling.
 *   v1.0.0 — 2026-09-04 — Extracted verbatim from auth/modal.js.
 */
import { escHtml } from './theme.js';

/**
 * @param {Record<string, string>} i Modal strings.
 * @param {(label: string, input: string, hint?: string, opt?: string) => string} field
 *   The modal's field wrapper, passed in so the markup keeps one definition of a labelled field.
 */
export function recoveryViewsHtml(i, field) {
  return ''
    // Forgot password sub-view (hidden by default)
    + '<div id="aimeat-forgot-pw-view" class="aimeat-body" style="display:none">'
    + '<div id="aimeat-fpw-step1">'
    + '<h3 class="aimeat-sub-title">' + escHtml(i.resetPasswordTitle || 'Reset Password') + '</h3>'
    + '<p class="aimeat-sub-desc">' + escHtml(i.resetPasswordDesc || 'Enter your username to receive a reset code by email.') + '</p>'
    + field(i.usernameLabel || 'Username', '<input id="aimeat-fpw-username" class="aimeat-inp" placeholder="' + escHtml(i.usernamePlaceholder || 'Username') + '">')
    + '<div class="aimeat-actions">'
    + '<button id="aimeat-fpw-send" class="aimeat-go">' + escHtml(i.sendResetCode || 'Send Reset Code') + '</button>'
    + '<button id="aimeat-fpw-back" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
    + '</div>'
    + '<p id="aimeat-fpw-msg" class="aimeat-msg"></p>'
    + '<p id="aimeat-fpw-err" class="aimeat-err"></p>'
    + '</div>'
    + '<div id="aimeat-fpw-step2" style="display:none">'
    + '<h3 class="aimeat-sub-title">' + escHtml(i.enterNewPasswordTitle || 'Enter New Password') + '</h3>'
    + '<p class="aimeat-sub-desc">' + escHtml(i.resetCodeSent || 'A reset code was sent to your email. Enter it below with your new password.') + '</p>'
    + field(i.codeLabel || 'Reset Code', '<input id="aimeat-fpw-code" class="aimeat-inp" placeholder="123456" maxlength="6">')
    + field(i.newPasswordLabel || 'New Password', '<input id="aimeat-fpw-newpass" type="password" class="aimeat-inp" placeholder="' + escHtml(i.newPasswordPlaceholder || 'New password (min 8 chars)') + '">')
    + '<div class="aimeat-actions">'
    + '<button id="aimeat-fpw-reset" class="aimeat-go">' + escHtml(i.resetPassword || 'Reset Password') + '</button>'
    + '<button id="aimeat-fpw-back2" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
    + '</div>'
    + '<p id="aimeat-fpw-msg2" class="aimeat-msg"></p>'
    + '<p id="aimeat-fpw-err2" class="aimeat-err"></p>'
    + '</div>'
    + '</div>'
    // Forgot username sub-view (hidden by default)
    + '<div id="aimeat-forgot-user-view" class="aimeat-body" style="display:none">'
    + '<h3 class="aimeat-sub-title">' + escHtml(i.recoverUsernameTitle || 'Recover Username') + '</h3>'
    + '<p class="aimeat-sub-desc">' + escHtml(i.recoverUsernameDesc || 'Enter the email address associated with your account.') + '</p>'
    + field(i.emailLabel || 'Email', '<input id="aimeat-fu-email" class="aimeat-inp" type="email" placeholder="you@example.com">')
    + '<div class="aimeat-actions">'
    + '<button id="aimeat-fu-send" class="aimeat-go">' + escHtml(i.sendUsername || 'Send My Username') + '</button>'
    + '<button id="aimeat-fu-back" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
    + '</div>'
    + '<p id="aimeat-fu-msg" class="aimeat-msg"></p>'
    + '</div>'
    // Complete-account sub-view (hidden) — email verification (legacy accounts + register-under-gate).
    + '<div id="aimeat-email-view" class="aimeat-body" style="display:none">'
    + '<div id="aimeat-em-step1">'
    + '<h3 class="aimeat-sub-title">' + escHtml(i.completeAccountTitle || 'One last step') + '</h3>'
    + '<p class="aimeat-sub-desc">' + escHtml(i.completeAccountDesc || 'Add an email to finish setting up your account. We’ll send a verification code to confirm it.') + '</p>'
    + field(i.emailLabel || 'Email', '<input id="aimeat-em-email" class="aimeat-inp" type="email" placeholder="you@example.com">')
    + '<div class="aimeat-actions">'
    + '<button id="aimeat-em-send" class="aimeat-go">' + escHtml(i.sendVerificationCode || 'Send Verification Code') + '</button>'
    + '<button id="aimeat-em-back" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
    + '</div>'
    + '<p id="aimeat-em-err" class="aimeat-err"></p>'
    + '</div>'
    + '<div id="aimeat-em-step2" style="display:none">'
    + '<h3 class="aimeat-sub-title">' + escHtml(i.enterCodeTitle || 'Enter Verification Code') + '</h3>'
    + '<p class="aimeat-sub-desc">' + escHtml(i.enterCodeDesc || 'We sent a 6-digit code to your email. Enter it below to finish and sign in.') + '</p>'
    + field(i.codeLabel || 'Verification Code', '<input id="aimeat-em-code" class="aimeat-inp" placeholder="123456" maxlength="6" inputmode="numeric">')
    + '<div class="aimeat-actions">'
    + '<button id="aimeat-em-confirm" class="aimeat-go">' + escHtml(i.confirmAndSignIn || 'Confirm & Sign In') + '</button>'
    + '<button id="aimeat-em-back2" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
    + '</div>'
    + '<p id="aimeat-em-msg2" class="aimeat-msg"></p>'
    + '<p id="aimeat-em-err2" class="aimeat-err"></p>'
    + '</div>'
    + '</div>';
}

/**
 * Wire the forgot-password and forgot-username views. The complete-account view stays wired in
 * modal.js, which holds its pendingEmailLogin state.
 * @param {{ i: Record<string, string>, api: (path: string, opts?: any) => Promise<any>, showView: (view: string) => void }} ctx
 */
export function wireRecoveryViews(ctx) {
  var i = ctx.i, api = ctx.api, showView = ctx.showView;

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
}
