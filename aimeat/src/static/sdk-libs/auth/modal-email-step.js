/**
 * @file src/static/sdk-libs/auth/modal-email-step.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The complete-account step of the sign-in dialog: an account that needs a verified
 *   email before its first session ('attach'), or a new account under the node's email gate
 *   ('register'). Step one sends a code to the address, step two confirms it and signs the person in.
 *   Moved out of modal.js unchanged when the language switch's view keeping took that file past 800
 *   lines (max-file-lines); keep() and resume() are new, so the language switch can draw this step
 *   again in the new language with what it held.
 * @structure wireEmailStep(ctx) → { open(user, pass, hasEmail, mode, displayName, prefillEmail), keep(), resume(state) }
 * @usage import { wireEmailStep } from './modal-email-step.js';
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Moved out of modal.js unchanged; keep() and resume() for the language switch
 *     (secaudit2026nov08b round 15b).
 */
import { currentModalLang } from './i18n.js';

/**
 * Wire the step. Called once per modal render, alongside the other views' wiring.
 * @param {object} ctx
 * @param {Record<string, string>} ctx.i Modal strings.
 * @param {(path: string, opts?: any) => Promise<any>} ctx.api The modal's request helper.
 * @param {any} ctx.auth The session core (loginWithPassword).
 * @param {(view: string) => void} ctx.showView The modal's view switcher.
 * @param {() => void} ctx.finishLogin What the modal does with a finished sign-in.
 * @param {(e: any) => boolean} ctx.twoStepAsked Opens the two-step enrolment when the error asks for it.
 * @param {{ openTotpStep: (user: string, pass: string) => void }} ctx.totpStep The second-factor step.
 */
export function wireEmailStep(ctx) {
  var i = ctx.i, api = ctx.api, auth = ctx.auth, showView = ctx.showView;
  var finishLogin = ctx.finishLogin, twoStepAsked = ctx.twoStepAsked, totpStep = ctx.totpStep;

  // Credentials captured from the last correct-password attempt that hit the email gate.
  var pendingEmailLogin = null;

  // Open the email step. 'attach' — existing account needs a verified email. 'register' — brand-new
  // account under the email gate: step1 POST /v1/ghii (with email) creates it. Both finish identically.
  // `prefillEmail` comes from the Register tab, which already asked: the address is filled in and
  // the code sent straight away, so the person never types it twice.
  function openEmailCompletion(user, pass, hasEmail, mode, displayName, prefillEmail) {
    pendingEmailLogin = { username: user, password: pass, mode: mode || 'attach', displayName: displayName || user, hasEmail: !!hasEmail };
    showView('email');
    document.getElementById('aimeat-em-step1').style.display = '';
    document.getElementById('aimeat-em-step2').style.display = 'none';
    var emailInput = /** @type {any} */ (document.getElementById('aimeat-em-email'));
    emailInput.value = prefillEmail || '';
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
    if (prefillEmail) { sendEmailCode(); return; }
    setTimeout(function () { emailInput.focus(); }, 50);
  }

  /** POST /v1/ghii/login/attach-email: checks the password, records the address, mails a code. */
  function attachEmail(pending, email) {
    return api('/v1/ghii/login/attach-email', {
      method: 'POST',
      body: JSON.stringify({ username: pending.username, password: pending.password, email: email }),
    });
  }

  // Complete-account step 1 — send a verification code (re-verifies password server-side).
  // Named rather than inline so the Register tab can drive the same step with the address it
  // already collected, instead of repeating the create-and-verify calls.
  async function sendEmailCode() {
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
    var pending = pendingEmailLogin;
    try {
      var res;
      if (pending.mode === 'register') {
        // Brand-new account under the email gate: create it now WITH the email (returns verification_id).
        res = await api('/v1/ghii', {
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({
            username: pending.username,
            display_name: pending.displayName,
            password: pending.password,
            email: email,
            // The account's locale, so the verification code arrives in the language the
            // person is reading right now. Without it every account was created locale-less
            // and every system email fell back to English (UX-remake v3, measured).
            locale: currentModalLang(),
          }),
        }).catch(function (e) {
          // The name is taken. When it is this person's own account, made by an earlier press whose
          // code step never showed, the same password gets a new code for it through attach-email
          // instead of a dead end. A wrong password keeps the "taken" answer, which is then true.
          if (e.code !== 'NAME_TAKEN') throw e;
          return attachEmail(pending, email).catch(function (e2) {
            if (e2.code === 'ALREADY_VERIFIED') return null;
            throw e;
          });
        });
        // Taken, the password matches and the address is already confirmed: the account is
        // finished, so this is a sign-in.
        if (res === null) {
          try {
            await auth.loginWithPassword(pending.username, pending.password);
          } catch (le) {
            if (twoStepAsked(le)) return;
            if (le.code !== 'TOTP_REQUIRED') throw le;
            totpStep.openTotpStep(pending.username, pending.password);
            return;
          }
          pendingEmailLogin = null;
          finishLogin();
          return;
        }
      } else {
        res = await attachEmail(pending, email);
      }
      pending.verificationId = res.data && res.data.verification_id;
      document.getElementById('aimeat-em-step1').style.display = 'none';
      document.getElementById('aimeat-em-step2').style.display = '';
      setTimeout(function () { /** @type {any} */ (document.getElementById('aimeat-em-code')).focus(); }, 50);
    } catch (e) {
      errEl.textContent = e.code === 'NAME_TAKEN'
        ? (i.errNameTaken || 'That username is taken. If it is yours, sign in instead.')
        : e.message;
      errEl.style.display = 'block';
    } finally {
      btn.textContent = i.sendVerificationCode || 'Send Verification Code';
      btn.disabled = false;
    }
  }
  document.getElementById('aimeat-em-send').addEventListener('click', sendEmailCode);

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
      await auth.loginWithPassword(pendingEmailLogin.username, pendingEmailLogin.password);
      pendingEmailLogin = null;
      finishLogin();
    } catch (e) {
      if (twoStepAsked(e)) { pendingEmailLogin = null; return; }
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      btn.textContent = i.confirmAndSignIn || 'Confirm & Sign In';
      btn.disabled = false;
    }
  });

  return {
    open: openEmailCompletion,
    /** What the step holds while it is on screen, for the language switch; null when it is not. */
    keep: function () {
      if (!pendingEmailLogin) return null;
      var val = function (id) { var el = /** @type {any} */ (document.getElementById(id)); return el ? el.value : ''; };
      var step2 = /** @type {any} */ (document.getElementById('aimeat-em-step2'));
      return {
        pending: pendingEmailLogin,
        step2: !!step2 && step2.style.display !== 'none',
        email: val('aimeat-em-email'), code: val('aimeat-em-code'),
      };
    },
    /** Draw the step again with what keep() returned. Sends nothing: a code already sent stays valid. */
    resume: function (state) {
      var p = state.pending;
      openEmailCompletion(p.username, p.password, p.hasEmail, p.mode, p.displayName);
      pendingEmailLogin.verificationId = p.verificationId;
      /** @type {any} */ (document.getElementById('aimeat-em-email')).value = state.email || '';
      if (!state.step2) return;
      document.getElementById('aimeat-em-step1').style.display = 'none';
      document.getElementById('aimeat-em-step2').style.display = '';
      /** @type {any} */ (document.getElementById('aimeat-em-code')).value = state.code || '';
    },
  };
}
