/**
 * @file src/static/sdk-libs/auth/modal-two-step.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two-step enrolment step of the sign-in dialog. The operator of the node requires
 *   two-step sign-in (auth.two_step_required), the person's credential was right, and their account
 *   has no authenticator app yet: the node answered TWO_STEP_SETUP_REQUIRED with a setup token
 *   (routes/ghii/login-two-step.ts), or an emailed link brought the token in the address fragment.
 *
 *   ONE VIEW, TWO PHASES. First: one sentence on why, the QR code and the key for the app (the same
 *   QR the profile's setup shows, made by the node), and a field for the first code. POST
 *   /v1/ghii/login/two-step/start gives the QR and the key; /finish takes the code. Second: the
 *   backup codes, shown once, and a button that signs the person in. The node set the refresh cookie
 *   with the finish answer; the session is adopted from that answer only when the person has seen the
 *   codes, so nothing on the page reacts to a sign-in while they are still on screen.
 *
 *   The token is held in a closure and dropped when the step closes. A wrong code keeps the step
 *   open; the node counts it toward the account's code lock.
 * @structure twoStepViewHtml(i, field) · wireTwoStepStep(ctx) → { open(setupToken) }
 * @usage import { twoStepViewHtml, wireTwoStepStep } from './modal-two-step.js';
 * @version-history
 *   v1.1.0 — 2026-11-02 — The key shows in groups of four and wraps between groups; a copy gives it
 *     without the spaces (browser check at 375 px).
 *   v1.0.0 — 2026-11-02 — Initial (IT review: an operator can require two-step sign-in).
 */
import { escHtml } from './theme.js';
import { api } from './http.js';

/** Keep a six-digit field to digits, so a pasted "123 456" still submits. */
function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

/** Go where the emailed link was asked from, unless that is the page already open. http(s) only. */
function goTo(redirect) {
  var target;
  try { target = new URL(redirect, location.href); } catch { return; }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return;
  if (target.href === location.href) return;
  location.assign(target.href);
}

/**
 * The step's markup. Hidden until a sign-in asks for it.
 * @param {Record<string, string>} i Modal strings.
 * @param {(label: string, input: string, hint?: string) => string} field The modal's field wrapper.
 */
export function twoStepViewHtml(i, field) {
  return '<div id="aimeat-two-step-view" class="aimeat-body" style="display:none">'
    + '<div id="aimeat-ts-setup">'
    + '<h3 class="aimeat-sub-title">' + escHtml(i.twoStepTitle || 'Set up two-step sign-in') + '</h3>'
    + '<p class="aimeat-sub-desc">' + escHtml(i.twoStepWhy || 'The operator of this server requires two-step sign-in for your account.') + '</p>'
    + '<p class="aimeat-sub-desc">' + escHtml(i.twoStepScan || 'Scan the QR code with your authenticator app, or type the key into the app.') + '</p>'
    + '<img id="aimeat-ts-qr" class="aimeat-ts-qr" alt="' + escHtml(i.twoStepQrAlt || 'QR code for your authenticator app') + '" style="display:none">'
    + '<p class="aimeat-hint">' + escHtml(i.twoStepKeyLabel || 'Key') + ': <code id="aimeat-ts-secret" class="aimeat-ts-secret"></code></p>'
    + field(i.twoStepCodeLabel || 'Code from the app',
      '<input id="aimeat-ts-code" class="aimeat-inp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">')
    + '<div class="aimeat-actions">'
    + '<button id="aimeat-ts-go" class="aimeat-go">' + escHtml(i.twoStepConfirm || 'Confirm') + '</button>'
    + '<button id="aimeat-ts-back" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
    + '</div>'
    + '</div>'
    + '<div id="aimeat-ts-done" style="display:none">'
    + '<h3 class="aimeat-sub-title">' + escHtml(i.twoStepCodesTitle || 'Save your backup codes') + '</h3>'
    + '<p class="aimeat-sub-desc">' + escHtml(i.twoStepCodesDesc || 'Each code signs you in once if you cannot use your phone. You see them only now, so save them somewhere safe.') + '</p>'
    + '<ul id="aimeat-ts-codes" class="aimeat-ts-codes"></ul>'
    + '<div class="aimeat-actions">'
    + '<button id="aimeat-ts-continue" class="aimeat-go">' + escHtml(i.twoStepCodesDone || 'I saved them, continue') + '</button>'
    + '</div>'
    + '</div>'
    + '<p id="aimeat-ts-err" class="aimeat-err"></p>'
    + '</div>';
}

/**
 * Wire the step. Called once per modal render, alongside the other views' wiring.
 *
 * @param {object} ctx
 * @param {Record<string, string>} ctx.i Modal strings.
 * @param {(view: string) => void} ctx.showView The modal's view switcher.
 * @param {(data: any) => Promise<any>} ctx.adopt Makes the session from the finish answer (session.js).
 * @param {(session: any) => void} ctx.onSuccess What the modal does when a session comes back.
 * @returns {{ open: (setupToken: string) => void }}
 */
export function wireTwoStepStep(ctx) {
  var i = ctx.i;
  /** @type {string | null} */ var token = null;
  /** @type {any} */ var finished = null;
  var $ = function (id) { return /** @type {any} */ (document.getElementById(id)); };
  var setupEl = $('aimeat-ts-setup'), doneEl = $('aimeat-ts-done'), qrEl = $('aimeat-ts-qr'), secretEl = $('aimeat-ts-secret');
  var codeEl = $('aimeat-ts-code'), goBtn = $('aimeat-ts-go'), backBtn = $('aimeat-ts-back'), errEl = $('aimeat-ts-err');
  var codesEl = $('aimeat-ts-codes'), continueBtn = $('aimeat-ts-continue');
  if (!setupEl || !doneEl || !codeEl || !goBtn || !backBtn || !errEl || !codesEl || !continueBtn) return { open: function () {} };

  function fail(message) { errEl.textContent = message; errEl.style.display = 'block'; }
  function expiredText() { return i.twoStepExpired || 'The time to set up two-step sign-in has run out. Sign in again.'; }

  /** The key as the node gave it, without the display's spaces. */
  var rawSecret = '';
  if (secretEl) secretEl.addEventListener('copy', function (e) {
    var sel = String((window.getSelection && window.getSelection()) || '');
    if (!rawSecret || !e.clipboardData) return;
    // The selected part, spaces taken out: most apps take a key with spaces too, and some do not.
    e.clipboardData.setData('text/plain', sel.replace(/\s+/g, '') || rawSecret);
    e.preventDefault();
  });

  codeEl.addEventListener('input', function () { codeEl.value = onlyDigits(codeEl.value); });
  codeEl.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!goBtn.disabled) goBtn.click();
  });

  backBtn.addEventListener('click', function () {
    token = null;
    errEl.style.display = 'none';
    ctx.showView('login');
  });

  goBtn.addEventListener('click', async function () {
    if (!token) { ctx.showView('login'); return; }
    var code = onlyDigits(codeEl.value);
    errEl.style.display = 'none';
    if (code.length !== 6) { fail(i.errTotpSix || 'The code is six digits.'); return; }
    var label = i.twoStepConfirm || 'Confirm';
    goBtn.textContent = i.working || 'Working...';
    goBtn.disabled = true;
    try {
      finished = await api('/v1/ghii/login/two-step/finish', {
        method: 'POST', credentials: 'include', body: JSON.stringify({ setup_token: token, code: code }),
      });
      token = null;
      var codes = (finished.data && finished.data.backup_codes) || [];
      codesEl.innerHTML = codes.map(function (c) { return '<li><code>' + escHtml(String(c)) + '</code></li>'; }).join('');
      setupEl.style.display = 'none';
      doneEl.style.display = '';
      setTimeout(function () { continueBtn.focus(); }, 50);
    } catch (e) {
      if (e.code === 'SETUP_TOKEN_EXPIRED') { token = null; fail(expiredText()); }
      else if (e.code === 'TOTP_LOCKED') fail(e.message);
      else if (e.code === 'INVALID_TOTP') fail(i.errTotpWrong || 'That code does not match. Check the app and try again.');
      else fail(e.message);
      codeEl.value = '';
    } finally {
      goBtn.textContent = label;
      goBtn.disabled = false;
    }
  });

  continueBtn.addEventListener('click', async function () {
    if (!finished) { ctx.showView('login'); return; }
    var answer = finished;
    finished = null;
    continueBtn.disabled = true;
    try {
      var session = await ctx.adopt(answer);
      ctx.onSuccess(session);
      var back = answer.data && answer.data.redirect;
      if (back) goTo(back);
    } catch (e) {
      continueBtn.disabled = false;
      fail(e.message);
    }
  });

  return {
    /** A checked sign-in that stops at the enrolment: ask the node for the secret and show it. */
    open: function (setupToken) {
      token = setupToken;
      finished = null;
      codeEl.value = '';
      errEl.style.display = 'none';
      setupEl.style.display = '';
      doneEl.style.display = 'none';
      if (qrEl) qrEl.style.display = 'none';
      if (secretEl) secretEl.textContent = '';
      rawSecret = '';
      ctx.showView('two-step');
      api('/v1/ghii/login/two-step/start', { method: 'POST', body: JSON.stringify({ setup_token: setupToken }) })
        .then(function (r) {
          var d = r.data || {};
          if (qrEl && typeof d.qr_data_url === 'string' && d.qr_data_url.indexOf('data:image/') === 0) {
            qrEl.src = d.qr_data_url;
            qrEl.style.display = '';
          }
          // In groups of four, as authenticator apps print a key, so it wraps between groups on a
          // phone. A copy gives the key without the spaces (the copy listener below).
          rawSecret = String(d.secret || '');
          if (secretEl) secretEl.textContent = rawSecret.replace(/(.{4})(?=.)/g, '$1 ');
          setTimeout(function () { codeEl.focus(); }, 50);
        })
        .catch(function (e) {
          if (e.code === 'SETUP_TOKEN_EXPIRED') { token = null; fail(expiredText()); }
          else fail(e.message);
        });
    },
  };
}
