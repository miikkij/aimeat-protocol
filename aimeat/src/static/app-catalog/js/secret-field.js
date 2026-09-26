/**
 * @file secret-field.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A field whose value stays hidden until the person presses the eye beside it. Used for
 *   the access code, in the publish dialog and in an app's detail view, so a code typed or read on a
 *   shared screen is not shown to whoever stands behind the person.
 *
 *   The input is `type="password"` and the eye button switches it to text and back. The button
 *   carries its own name ("Show the access code" / "Hide the access code") and `aria-pressed`, so a
 *   screen reader says what it does and whether the code shows now. One delegated click listener
 *   serves every field, the static one in the page template and the ones the detail view writes
 *   later, so no field needs its own wiring.
 * @structure EYE · EYE_OFF · secretToggleHtml(inputId) · initSecretFields()
 * @usage
 *   import { secretToggleHtml, initSecretFields } from './secret-field.js';
 *   '<div class="secret-field"><input type="password" id="x">' + secretToggleHtml('x') + '</div>'
 *   initSecretFields(); // once, at start
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the access code is hidden until the eye is pressed (Jouni).
 */
import { t } from './i18n.js';
import { escapeHtml } from './util.js';

var SVG_OPEN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
var ALMOND = '<path d="M2 12c2.5-4.5 6-7 10-7s7.5 2.5 10 7c-2.5 4.5-6 7-10 7S4.5 16.5 2 12z"/><circle cx="12" cy="12" r="3"/>';

/** The eye: press to show. */
export var EYE = SVG_OPEN + ALMOND + '</svg>';
/** The eye struck through: press to hide. */
export var EYE_OFF = SVG_OPEN + ALMOND + '<path d="M4 4l16 16"/></svg>';

/** The eye button for the input with this id. The input itself is `type="password"`. */
export function secretToggleHtml(inputId) {
  var label = escapeHtml(t('secret.show'));
  return '<button type="button" class="secret-eye" data-secret-toggle="' + escapeHtml(inputId) + '"'
    + ' aria-controls="' + escapeHtml(inputId) + '" aria-pressed="false"'
    + ' aria-label="' + label + '" title="' + label + '">' + EYE + '</button>';
}

function setShown(btn, input, shown) {
  input.type = shown ? 'text' : 'password';
  var label = t(shown ? 'secret.hide' : 'secret.show');
  btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
  btn.innerHTML = shown ? EYE_OFF : EYE;
}

var wired = false;

/**
 * Wire every eye button, present and future, with one listener. Also names the buttons already in
 * the page, because the template's button is written before the language is known.
 */
export function initSecretFields() {
  var btns = document.querySelectorAll('[data-secret-toggle]');
  for (var i = 0; i < btns.length; i++) {
    var input = document.getElementById(btns[i].getAttribute('data-secret-toggle'));
    if (input) setShown(btns[i], input, input.type === 'text');
  }
  if (wired) return;
  wired = true;
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-secret-toggle]') : null;
    if (!btn) return;
    var field = document.getElementById(btn.getAttribute('data-secret-toggle'));
    if (!field) return;
    // Focus stays on the eye, so a keyboard user can press it again and a screen reader hears
    // the new state.
    setShown(btn, field, field.type === 'password');
  });
}
