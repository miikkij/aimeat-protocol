/**
 * @file auth/modal-recovery-views.js
 * @description The three sub-views of the sign-in modal that are not sign-in itself: forgot
 *   password (ask for a code, then set a new password), forgot username (the address gets the name
 *   sent to it), and complete-account (an account with no verified email, and a brand-new account
 *   created under the email gate). Markup only. modal.js owns the wiring, because these steps share
 *   its pendingEmailLogin state.
 *
 *   PURE EXTRACTION from modal.js on 2026-09-04, moved because that file passed the 800-line
 *   ceiling when the second-factor step arrived. The strings are the same bytes, re-indented.
 *
 * @structure recoveryViewsHtml(i, field) -> the three hidden views as one markup string
 * @usage import { recoveryViewsHtml } from './modal-recovery-views.js';
 * @version-history
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
