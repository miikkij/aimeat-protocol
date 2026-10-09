/**
 * @file auth/auth-error.js
 * @description What the sign-in dialog says when a sign-in came back refused. The emailed sign-in
 *   link (GET /v1/ghii/magic-link/open) and the Google, Entra and SAML callbacks redirect a refused
 *   sign-in to the front page with `?auth_error=<CODE>`, and until 2026-09-29 nothing read it: the
 *   person landed on the front page, signed out, with no word about why.
 *
 *   The answer is the sign-in dialog itself, with the reason in its error line, because the next
 *   step is in that dialog: ask for a new link, or sign in another way. The parameter is removed
 *   from the address so a reload does not repeat the message.
 *
 *   A sign-in that needs one more step comes back the same way, as `?auth_step=<step>`. The one step
 *   today is `second_factor`: an emailed sign-in link on an account with two-step sign-in leaves a
 *   ticket, and the dialog opens on its code view (modal-totp.js, link mode).
 * @structure takeParam(name) · readAuthError() · readAuthStep() · authErrorText(i, code) ·
 *   showAuthErrorIn(i, code)
 * @usage import { readAuthError, readAuthStep, showAuthErrorIn } from './auth-error.js';
 * @version-history
 *   v1.1.0 — 2026-10-09 — readAuthStep() for `?auth_step=second_factor`, and the sentence for
 *     SECOND_FACTOR_EXPIRED (secaudit 2026-10-09, S1).
 *   v1.0.0 — 2026-09-29 — Initial.
 */

/** A query parameter's value, removed from the address so a reload does not repeat it. */
function takeParam(name) {
  var url;
  try { url = new URL(location.href); } catch { return null; }
  var value = url.searchParams.get(name);
  if (!value) return null;
  url.searchParams.delete(name);
  try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch { /* a sandboxed frame may refuse; the message still shows */ }
  return value;
}

/** The refused sign-in's code from the address, removed from it; null when there is none. */
export function readAuthError() {
  var code = takeParam('auth_error');
  if (!code) return null;
  // A code is ours only in its own shape; anything else is shown as the general message.
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'UNKNOWN';
}

/** The sign-in step the server asks for, removed from the address; null for none or an unknown one. */
export function readAuthStep() {
  var step = takeParam('auth_step');
  return step === 'second_factor' ? step : null;
}

/** The sentence for a code, in the dialog's language. */
export function authErrorText(i, code) {
  i = i || {};
  if (code === 'INVALID_TOKEN') return i.authErrorUsedLink || 'This sign-in link has already been used or is not valid. Ask for a new one below, or sign in another way.';
  if (code === 'EXPIRED') return i.authErrorExpired || 'This sign-in link has expired. Ask for a new one below.';
  if (code === 'ACCOUNT_DISABLED') return i.authErrorDisabled || 'This account has been deactivated. Contact the administrator of this service.';
  if (code === 'SECOND_FACTOR_EXPIRED') return i.authErrorSecondFactorExpired || 'This sign-in has expired. Ask for a new sign-in link and open it.';
  return i.authErrorGeneric || 'Sign-in did not go through. Try again, or choose another way to sign in.';
}

/** Put the sentence in the open dialog's error line. */
export function showAuthErrorIn(i, code) {
  var el = document.getElementById('aimeat-error');
  if (!el) return;
  el.textContent = authErrorText(i, code);
  el.style.display = 'block';
}
