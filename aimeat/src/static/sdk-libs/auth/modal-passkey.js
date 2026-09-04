/**
 * @file auth/modal-passkey.js
 * @description The passkey button in the sign-in modal, and what happens when it is pressed.
 *
 *   IT SITS ABOVE THE USERNAME FIELD, not under the password, because it is a way IN rather than an
 *   extra step on the way in. Pressed with the username field empty it starts a discoverable
 *   ceremony: the device offers whatever it holds for this domain and its answer names the account,
 *   so the person types nothing at all. Pressed with a name filled in, that name narrows the offer,
 *   which is what an older authenticator needs.
 *
 *   IT IS NOT RENDERED WHERE IT CANNOT WORK. A browser without WebAuthn, or a page on an insecure
 *   origin, gets no button rather than a button that fails — an offer that cannot be taken is worse
 *   than no offer.
 *
 *   CANCELLING IS NOT AN ERROR. Closing the device prompt is the person changing their mind, and it
 *   leaves the form exactly as it was with nothing in red.
 *
 * @structure passkeyButtonHtml(i) · wirePasskeyButton(ctx)
 * @usage import { passkeyButtonHtml, wirePasskeyButton } from './modal-passkey.js';
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, with passkeys.
 */
import { escHtml } from './theme.js';
import { passkeySupported } from './passkey.js';

/** A key, drawn rather than typed: the modal carries no emoji. */
const KEY_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" aria-hidden="true">'
  + '<circle cx="8" cy="12" r="4"></circle><path d="M12 12h9M18 12v3M15 12v2"></path></svg>';

/** The button, or nothing at all when this browser cannot do it. */
export function passkeyButtonHtml(i) {
  if (!passkeySupported()) return '';
  return '<button type="button" id="aimeat-passkey-btn" class="aimeat-oauth-btn">'
    + KEY_SVG + escHtml(i.passkeySignIn || 'Sign in with a passkey') + '</button>'
    + '<p id="aimeat-passkey-hint" class="aimeat-hint">'
    + escHtml(i.passkeyHint || 'Your fingerprint, face or screen lock. No password to remember.')
    + '</p>';
}

/**
 * Wire the button. Called once per modal render, alongside the other views' wiring.
 *
 * @param {object} ctx
 * @param {Record<string, string>} ctx.i Modal strings.
 * @param {(username: string|undefined) => Promise<any>} ctx.signIn Runs the ceremony and the login.
 * @param {(session: any) => void} ctx.onSuccess What the modal does with a finished session.
 */
export function wirePasskeyButton(ctx) {
  var i = ctx.i;
  var btn = /** @type {any} */ (document.getElementById('aimeat-passkey-btn'));
  if (!btn) return;
  var errEl = document.getElementById('aimeat-error');

  btn.addEventListener('click', async function () {
    var label = i.passkeySignIn || 'Sign in with a passkey';
    // A name in the field narrows the offer; an empty field means "let the device decide".
    var nameEl = /** @type {any} */ (document.getElementById('aimeat-username'));
    var typed = nameEl && !/[@]/.test(nameEl.value) ? nameEl.value.trim().toLowerCase() : '';
    if (errEl) errEl.style.display = 'none';
    btn.textContent = i.working || 'Working...';
    btn.disabled = true;
    try {
      var session = await ctx.signIn(typed || undefined);
      ctx.onSuccess(session);
    } catch (e) {
      // Closing the prompt is not a failure. Put the button back and say nothing.
      if (e && e.code !== 'PASSKEY_CANCELLED' && errEl) {
        errEl.textContent = e.code === 'PASSKEY_UNKNOWN'
          ? (i.errPasskeyUnknown || 'This device is not registered here yet. Sign in another way, then add it under Account security.')
          : e.message;
        errEl.style.display = 'block';
      }
      btn.innerHTML = KEY_SVG + escHtml(label);
      btn.disabled = false;
    }
  });
}
