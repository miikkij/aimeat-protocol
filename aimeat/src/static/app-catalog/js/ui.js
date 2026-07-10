/**
 * @file ui.js
 * @description Shared UI primitives with DOM side effects — the in-page toast stack
 *   (showNotice/dismissNotice) and the Promise-based confirm dialog (showConfirm/closeConfirm)
 *   that every feature reuses instead of native alert()/confirm(). Pure DOM + one module-private
 *   resolve; no i18n, no feature state. Depends only on template ids: #confirm-overlay /
 *   #confirm-message (confirm) and #notice-stack (toasts); the OK/Cancel buttons are wired to
 *   closeConfirm() in main.js bootstrap. Carved out of the former monolithic main.js.
 * @usage import { showConfirm, closeConfirm, showNotice, dismissNotice } from './ui.js'
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 3).
 */

// In-page confirm dialog (replaces native confirm()). Promise-based so call sites stay linear:
//   if (!(await showConfirm(msg))) return;   (make the enclosing handler `async`).
// OK resolves true, Cancel/backdrop resolves false. Wired in main.js bootstrap.
let _confirmResolve = null;

export function showConfirm(message) {
  return new Promise(function (resolve) {
    _confirmResolve = resolve;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-overlay').hidden = false;
  });
}

export function closeConfirm(result) {
  document.getElementById('confirm-overlay').hidden = true;
  var r = _confirmResolve; _confirmResolve = null;
  if (r) r(!!result);
}

// In-page toast notice — replaces alert() (no native boxes). Non-blocking, auto-dismisses
// (errors linger), click to close. Type is auto-detected from the message when omitted.
export function showNotice(message, type) {
  message = String(message == null ? '' : message);
  if (!type) {
    if (/\b(fail|failed|error|invalid|denied|unable|not found|wrong|expired)\b/i.test(message)) type = 'error';
    else if (/\b(copied|done|success|saved|cleared|removed|imported|updated|added)\b/i.test(message)) type = 'success';
    else type = 'info';
  }
  var stack = document.getElementById('notice-stack');
  if (!stack) { return; }
  var el = document.createElement('div');
  el.className = 'notice notice-' + type;
  el.setAttribute('role', 'status');
  el.textContent = message;
  el.addEventListener('click', function () { dismissNotice(el); });
  stack.appendChild(el);
  requestAnimationFrame(function () { el.classList.add('show'); });
  el._timer = setTimeout(function () { dismissNotice(el); }, type === 'error' ? 6500 : 3500);
  return el;
}

export function dismissNotice(el) {
  if (!el || el._dismissed) return;
  el._dismissed = true;
  if (el._timer) clearTimeout(el._timer);
  el.classList.remove('show');
  el.classList.add('hide');
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
}
