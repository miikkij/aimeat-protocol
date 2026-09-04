/**
 * @file auth/modal-totp.js
 * @description The second-factor step of the sign-in modal: the account has two-step sign-in on, the
 *   password was right, and the server asked for the code. One view, two ways to answer it — the
 *   six digits from the authenticator app, or one backup code for the person whose phone is not in
 *   the room.
 *
 *   WHY IT IS A SEPARATE FILE. modal.js was 775 lines against a 800-line ceiling, so this step's
 *   markup and wiring live here and modal.js calls two functions. Nothing else is different: the
 *   view is one more sibling of the forgot-password and email-completion views, shown by the same
 *   showView().
 *
 *   The password is held in a closure for the second call and dropped the moment the step closes or
 *   the modal goes away. The server keeps no partial-login state between the two calls, so the
 *   second call is a whole login carrying the code — there is no intermediate token to steal.
 *
 * @structure totpViewHtml(i, field) → the view's markup · wireTotpStep(ctx) → { openTotpStep, close }
 * @usage import { totpViewHtml, wireTotpStep } from './modal-totp.js';
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial. Before this the modal had no code step at all: an account with
 *     TOTP armed got TOTP_REQUIRED rendered as a red error line and could not sign in from any
 *     AIMEAT front end.
 */
import { escHtml } from './theme.js';

/** Keep a six-digit field to digits, so a pasted "123 456" still submits. */
function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

/**
 * The code view's markup. Hidden until the login attempt asks for it.
 * @param {Record<string, string>} i Modal strings.
 * @param {(label: string, input: string, hint?: string) => string} field The modal's field wrapper.
 */
export function totpViewHtml(i, field) {
  return '<div id="aimeat-totp-view" class="aimeat-body" style="display:none">'
    + '<h3 class="aimeat-sub-title">' + escHtml(i.totpTitle || 'One more step') + '</h3>'
    + '<p class="aimeat-sub-desc">' + escHtml(i.totpDesc || 'Your account asks for a code. Open your authenticator app and enter the six digits it shows.') + '</p>'
    + field(i.totpCodeLabel || 'Code',
      '<input id="aimeat-totp-code" class="aimeat-inp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">')
    + field(i.totpBackupLabel || 'Backup code',
      '<input id="aimeat-totp-backup" class="aimeat-inp" autocomplete="off" maxlength="16" placeholder="' + escHtml(i.totpBackupPlaceholder || 'One of your backup codes') + '">',
      '<p class="aimeat-hint">' + escHtml(i.totpBackupHint || 'Use this if you cannot reach the app. Each code works once.') + '</p>')
    + '<div class="aimeat-actions">'
    + '<button id="aimeat-totp-go" class="aimeat-go">' + escHtml(i.totpSubmit || 'Sign in') + '</button>'
    + '<button id="aimeat-totp-back" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
    + '</div>'
    + '<p id="aimeat-totp-err" class="aimeat-err"></p>'
    + '</div>';
}

/**
 * Wire the code view. Called once per modal render, alongside the other views' wiring.
 *
 * @param {object} ctx
 * @param {Record<string, string>} ctx.i Modal strings.
 * @param {(view: string) => void} ctx.showView The modal's view switcher.
 * @param {(username: string, password: string, secondFactor: object) => Promise<any>} ctx.submit
 *   Runs the login with the second factor and resolves with the session.
 * @param {(session: any) => void} ctx.onSuccess What the modal does when a session comes back.
 * @returns {{ openTotpStep: (username: string, password: string) => void }}
 */
export function wireTotpStep(ctx) {
  var i = ctx.i;
  /** @type {{ username: string, password: string } | null} */
  var pending = null;

  var codeEl = /** @type {any} */ (document.getElementById('aimeat-totp-code'));
  var backupEl = /** @type {any} */ (document.getElementById('aimeat-totp-backup'));
  var errEl = document.getElementById('aimeat-totp-err');
  var goBtn = /** @type {any} */ (document.getElementById('aimeat-totp-go'));
  var backBtn = document.getElementById('aimeat-totp-back');
  if (!codeEl || !backupEl || !errEl || !goBtn || !backBtn) return { openTotpStep: function () {} };

  function fail(message) {
    errEl.textContent = message;
    errEl.style.display = 'block';
  }

  function forget() {
    pending = null;
    codeEl.value = '';
    backupEl.value = '';
  }

  codeEl.addEventListener('input', function () {
    codeEl.value = onlyDigits(codeEl.value);
    // Two fields, one answer. Typing in either clears the other so the request carries exactly one.
    if (codeEl.value) backupEl.value = '';
  });
  backupEl.addEventListener('input', function () {
    if (backupEl.value) codeEl.value = '';
  });

  [codeEl, backupEl].forEach(function (el) {
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!goBtn.disabled) goBtn.click();
    });
  });

  backBtn.addEventListener('click', function () {
    forget();
    errEl.style.display = 'none';
    ctx.showView('login');
  });

  goBtn.addEventListener('click', async function () {
    if (!pending) { ctx.showView('login'); return; }
    var code = onlyDigits(codeEl.value);
    var backup = backupEl.value.trim();
    errEl.style.display = 'none';

    if (!code && !backup) { fail(i.errTotpRequired || 'Enter the code from your app, or one backup code.'); return; }
    if (code && code.length !== 6) { fail(i.errTotpSix || 'The code is six digits.'); return; }

    var label = i.totpSubmit || 'Sign in';
    goBtn.textContent = i.working || 'Working...';
    goBtn.disabled = true;
    try {
      var session = await ctx.submit(pending.username, pending.password,
        code ? { totpCode: code } : { backupCode: backup });
      forget();
      ctx.onSuccess(session);
    } catch (e) {
      // The lockout is the one refusal that is not about this code, so it says how to get out of it
      // rather than inviting another attempt.
      if (e.code === 'TOTP_LOCKED') fail(e.message);
      else if (e.code === 'TOTP_REPLAY') fail(i.errTotpReplay || 'That code was already used. Wait for your app to show the next one.');
      else if (e.code === 'INVALID_TOTP') fail(i.errTotpWrong || 'That code does not match. Check the app and try again.');
      else fail(e.message);
      codeEl.value = '';
      goBtn.textContent = label;
      goBtn.disabled = false;
    }
  });

  return {
    /** The password was right and the server asked for the second factor. */
    openTotpStep: function (username, password) {
      pending = { username: username, password: password };
      codeEl.value = '';
      backupEl.value = '';
      errEl.style.display = 'none';
      goBtn.textContent = i.totpSubmit || 'Sign in';
      goBtn.disabled = false;
      ctx.showView('totp');
      setTimeout(function () { codeEl.focus(); }, 50);
    },
  };
}
