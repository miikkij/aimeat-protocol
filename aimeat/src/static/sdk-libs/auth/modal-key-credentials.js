/**
 * @file src/static/sdk-libs/auth/modal-key-credentials.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sign-in details step of the sign-in dialog: a code key's first sign-in.
 *
 *   WHY. An organism owner mints a code key, and its code is the new account's password until the
 *   holder's first sign-in, so the person who minted it knows it. At that sign-in the node replaces
 *   the code with a new password. The developer's ruling 1 of 2026-11-08: the new details are shown on
 *   screen to the person who completed the first sign-in, and on the same screen that person can add
 *   a passkey and confirm an email address of their own (secaudit2026nov08 round 14).
 *
 *   TWO WAYS IN. A password or passkey sign-in carries the details in its answer (session
 *   `_keyCredentials`), and the dialog opens this step in place of closing. An emailed link or an
 *   identity provider redirects to `/?auth_step=key_credentials`; index.js restores the session, asks
 *   POST /v1/ghii/key-credentials once and opens the dialog here with the answer.
 *
 *   ONE VIEW: the username and the password with a copy button, a passkey for this device (when the
 *   browser has WebAuthn), and the account's address: the address that receives sign-in links and
 *   password resets now, and a field for the person's own (POST /v1/ghii/email/verify, then
 *   /v1/ghii/email/confirm with the code). The password stays on screen until the person presses Done.
 * @structure keyCredentialsViewHtml(i, field) · wireKeyCredentialsStep(ctx) → { open(details), keep(), resume(state) }
 * @usage import { keyCredentialsViewHtml, wireKeyCredentialsStep } from './modal-key-credentials.js';
 * @version-history
 *   v1.2.0 -- 2026-11-08 -- keep() and resume(): the language switch draws the step again in the new
 *     language with the username, the password, the address step and the passkey line it showed
 *     (modal-view-keep.js; secaudit2026nov08b round 15b).
 *   v1.1.0 — 2026-11-08 — A line says when an agent key handed out with the code before this sign-in
 *     stopped at it (`agent_keys_ended`; secaudit2026nov08b round 15).
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14; the developer's ruling 1 of 2026-11-08).
 */
import { escHtml } from './theme.js';
import { authApi } from './http.js';
import { passkeySupported, passkeyAdd } from './passkey.js';

/** Go to `target` on this node or an address the node named, http(s) only, unless it is this page. */
function goTo(target) {
  var url;
  try { url = new URL(target, location.href); } catch (e) {
    console.warn('[aimeat-auth] The place to continue to is not an address:', e && /** @type {Error} */ (e).message);
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.href === location.href) return false;
  location.assign(url.href);
  return true;
}

/**
 * The step's markup. Hidden until a first sign-in opens it.
 * @param {Record<string, string>} i Modal strings.
 * @param {(label: string, input: string, hint?: string) => string} field The modal's field wrapper.
 */
export function keyCredentialsViewHtml(i, field) {
  var copy = escHtml(i.keyCredCopy || 'Copy');
  return '<div id="aimeat-key-view" class="aimeat-body" style="display:none">'
    + '<h3 class="aimeat-sub-title">' + escHtml(i.keyCredTitle || 'Your sign-in details') + '</h3>'
    + '<p class="aimeat-sub-desc">' + escHtml(i.keyCredDesc || 'The access code you received no longer works. From now on, sign in with this username and password. Save the password now: it is shown only here.') + '</p>'
    + '<p id="aimeat-kc-agents" class="aimeat-hint" style="display:none">' + escHtml(i.keyCredAgentKeys || 'Before this sign-in, an email address was confirmed with the access code, and an agent key for this account was given out then. That key no longer works.') + '</p>'
    + '<p class="aimeat-hint">' + escHtml(i.usernameLabel || 'Username') + ': <code id="aimeat-kc-user" class="aimeat-ts-secret"></code> '
    + '<button type="button" class="aimeat-cancel" data-kc-copy="aimeat-kc-user">' + copy + '</button></p>'
    + '<p class="aimeat-hint">' + escHtml(i.passwordLabel || 'Password') + ': <code id="aimeat-kc-pass" class="aimeat-ts-secret" style="font-size:16px"></code> '
    + '<button type="button" class="aimeat-cancel" data-kc-copy="aimeat-kc-pass">' + copy + '</button></p>'
    + '<div id="aimeat-kc-passkey"' + (passkeySupported() ? '' : ' style="display:none"') + '>'
    + '<h4 class="aimeat-sub-title" style="margin-top:28px">' + escHtml(i.keyCredPasskeyTitle || 'Sign in without a password') + '</h4>'
    + '<p class="aimeat-sub-desc">' + escHtml(i.keyCredPasskeyDesc || 'Add this device, and you sign in with your fingerprint, face or screen lock.') + '</p>'
    + '<div class="aimeat-actions"><button type="button" id="aimeat-kc-passkey-add" class="aimeat-cancel">' + escHtml(i.keyCredPasskeyAdd || 'Add this device') + '</button></div>'
    + '<p id="aimeat-kc-passkey-msg" class="aimeat-hint" style="display:none"></p>'
    + '</div>'
    + '<h4 class="aimeat-sub-title" style="margin-top:28px">' + escHtml(i.keyCredEmailTitle || 'Your email address') + '</h4>'
    + '<p id="aimeat-kc-email-now" class="aimeat-sub-desc"></p>'
    + '<div id="aimeat-kc-email-ask">'
    + field(i.emailLabel || 'Email', '<input id="aimeat-kc-email" class="aimeat-inp" type="email" autocomplete="email">')
    + '<div class="aimeat-actions"><button type="button" id="aimeat-kc-email-send" class="aimeat-cancel">' + escHtml(i.sendVerificationCode || 'Send Verification Code') + '</button></div>'
    + '</div>'
    + '<div id="aimeat-kc-email-code-step" style="display:none">'
    + field(i.keyCredEmailCode || 'Code from the email', '<input id="aimeat-kc-email-code" class="aimeat-inp" inputmode="numeric" autocomplete="one-time-code" maxlength="6">')
    + '<div class="aimeat-actions"><button type="button" id="aimeat-kc-email-confirm" class="aimeat-cancel">' + escHtml(i.keyCredEmailConfirm || 'Confirm address') + '</button></div>'
    + '</div>'
    + '<p id="aimeat-kc-email-msg" class="aimeat-hint" style="display:none"></p>'
    + '<div class="aimeat-actions"><button type="button" id="aimeat-kc-done" class="aimeat-go">' + escHtml(i.keyCredDone || 'I saved the password, continue') + '</button></div>'
    + '<p id="aimeat-kc-err" class="aimeat-err"></p>'
    + '</div>';
}

/**
 * Wire the step. Called once per modal render, alongside the other views' wiring.
 *
 * @param {object} ctx
 * @param {Record<string, string>} ctx.i Modal strings.
 * @param {(view: string) => void} ctx.showView The modal's view switcher.
 * @param {() => void} ctx.onDone What the modal does when the person has seen the details.
 * @returns {{ open: (details: { credentials: { username: string, password: string, agent_keys_ended?: number }, jwt: string, continueTo?: string | null }) => void,
 *   keep?: () => any, resume?: (state: any) => void }}
 */
export function wireKeyCredentialsStep(ctx) {
  var i = ctx.i;
  var $ = function (id) { return /** @type {any} */ (document.getElementById(id)); };
  var view = $('aimeat-key-view');
  if (!view) return { open: function () {} };
  var jwt = '', continueTo = /** @type {string | null} */ (null), verificationId = '';
  var errEl = $('aimeat-kc-err'), emailMsg = $('aimeat-kc-email-msg');

  function say(el, message) { el.textContent = message; el.style.display = 'block'; }

  view.querySelectorAll('[data-kc-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = ($(btn.getAttribute('data-kc-copy')) || {}).textContent || '';
      // When the clipboard refuses, the text stays on screen to copy by hand.
      Promise.resolve().then(function () { return navigator.clipboard.writeText(text); })
        .then(function () { btn.textContent = i.keyCredCopied || 'Copied'; })
        .catch(function (e) { console.warn('[aimeat-auth] Copy to the clipboard failed:', e && e.message); });
    });
  });

  /** The address that receives sign-in links and resets now, from the account's own profile. */
  function showAddress() {
    authApi('/v1/ghii/me', jwt).then(function (me) {
      var d = (me && me.data) || {};
      var email = d.notification_email || '';
      var proven = !!d.email_verified_at && email;
      $('aimeat-kc-email-now').textContent = proven
        ? String(i.keyCredEmailNow || 'Sign-in links and password resets go to {email}. If this address is not yours, enter your own.').replace('{email}', email)
        : (i.keyCredEmailNone || 'This account has no confirmed email address. Enter yours, so you can sign in with an emailed link and reset the password if you forget it.');
      if (!proven && email) $('aimeat-kc-email').value = email;
    }).catch(function (e) {
      // The field still works without the current address.
      console.warn('[aimeat-auth] The account address could not be read:', e && e.message);
    });
  }

  $('aimeat-kc-passkey-add').addEventListener('click', function () {
    var btn = $('aimeat-kc-passkey-add'), msg = $('aimeat-kc-passkey-msg');
    btn.disabled = true;
    passkeyAdd(jwt, '').then(function () {
      say(msg, i.keyCredPasskeyAdded || 'Added. Next time you can sign in with this device.');
      btn.style.display = 'none';
    }).catch(function (e) {
      if (e && e.code !== 'PASSKEY_CANCELLED') say(msg, e.message);
      btn.disabled = false;
    });
  });

  $('aimeat-kc-email-send').addEventListener('click', function () {
    var email = String($('aimeat-kc-email').value || '').trim();
    if (!email) { $('aimeat-kc-email').focus(); return; }
    var btn = $('aimeat-kc-email-send');
    btn.disabled = true;
    authApi('/v1/ghii/email/verify', jwt, { method: 'POST', body: JSON.stringify({ email: email }) }).then(function (r) {
      verificationId = (r.data && r.data.verification_id) || '';
      $('aimeat-kc-email-ask').style.display = 'none';
      $('aimeat-kc-email-code-step').style.display = '';
      emailMsg.style.display = 'none';
      setTimeout(function () { $('aimeat-kc-email-code').focus(); }, 50);
    }).catch(function (e) { say(emailMsg, e.message); }).finally(function () { btn.disabled = false; });
  });

  $('aimeat-kc-email-confirm').addEventListener('click', function () {
    var code = String($('aimeat-kc-email-code').value || '').replace(/\D/g, '');
    if (!code) { $('aimeat-kc-email-code').focus(); return; }
    var btn = $('aimeat-kc-email-confirm');
    btn.disabled = true;
    authApi('/v1/ghii/email/confirm', jwt, { method: 'POST', body: JSON.stringify({ verification_id: verificationId, code: code }) }).then(function () {
      $('aimeat-kc-email-code-step').style.display = 'none';
      say(emailMsg, i.keyCredEmailDone || 'Confirmed. This is now your address.');
      showAddress();
    }).catch(function (e) { say(emailMsg, e.message); }).finally(function () { btn.disabled = false; });
  });

  $('aimeat-kc-done').addEventListener('click', function () {
    var target = continueTo;
    jwt = ''; continueTo = null; shown = null;
    $('aimeat-kc-pass').textContent = '';
    ctx.onDone();
    if (target) goTo(target);
  });

  /** The details the step was opened with, until Done: keep() hands them to the next drawing. */
  var shown = /** @type {any} */ (null);

  /** @param {{ credentials: { username: string, password: string, agent_keys_ended?: number }, jwt: string, continueTo?: string | null }} details */
  function open(details) {
    shown = details;
    jwt = details.jwt;
    continueTo = details.continueTo || null;
    errEl.style.display = 'none';
    $('aimeat-kc-user').textContent = details.credentials.username;
    $('aimeat-kc-pass').textContent = details.credentials.password;
    // An agent key handed out with the code before this sign-in stopped at it (agent_keys_ended).
    $('aimeat-kc-agents').style.display = details.credentials.agent_keys_ended > 0 ? '' : 'none';
    ctx.showView('key');
    showAddress();
  }

  return {
    open: open,
    /** What the step holds while it is on screen, for the language switch (modal-view-keep.js). */
    keep: function () {
      if (!shown || view.style.display === 'none') return null;
      var hidden = function (id) { return $(id).style.display === 'none'; };
      return {
        details: { credentials: shown.credentials, jwt: jwt, continueTo: continueTo },
        verificationId: verificationId,
        email: $('aimeat-kc-email').value, code: $('aimeat-kc-email-code').value,
        // 'ask' before a code was sent, 'code' while one is awaited, 'done' once the address is confirmed.
        phase: !hidden('aimeat-kc-email-code-step') ? 'code' : (hidden('aimeat-kc-email-ask') ? 'done' : 'ask'),
        passkeyAdded: hidden('aimeat-kc-passkey-add'),
      };
    },
    /** Draw the step again with what keep() returned, in this drawing's words. Sends nothing. */
    resume: function (state) {
      open(state.details);
      verificationId = state.verificationId || '';
      $('aimeat-kc-email').value = state.email || '';
      $('aimeat-kc-email-code').value = state.code || '';
      if (state.phase !== 'ask') $('aimeat-kc-email-ask').style.display = 'none';
      if (state.phase === 'code') $('aimeat-kc-email-code-step').style.display = '';
      if (state.phase === 'done') say(emailMsg, i.keyCredEmailDone || 'Confirmed. This is now your address.');
      if (state.passkeyAdded) {
        $('aimeat-kc-passkey-add').style.display = 'none';
        say($('aimeat-kc-passkey-msg'), i.keyCredPasskeyAdded || 'Added. Next time you can sign in with this device.');
      }
    },
  };
}
