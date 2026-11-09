/**
 * @file src/static/sdk-libs/auth/modal-fields.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sign-in dialog's typed values across a redraw, and the live username rules of the
 *   register tab. Moved out of modal.js unchanged when the two-step enrolment step took it past 800
 *   lines (max-file-lines), a pure extraction: both read only the document.
 * @structure captureInputs() · restoreInputs(vals) · wireUsernameRules() · wireEnterSubmits()
 * @usage import { captureInputs, restoreInputs, wireUsernameRules } from './modal-fields.js';
 * @version-history
 *   v1.1.0 — 2026-11-08 — wireEnterSubmits() moved out of modal.js unchanged when the sign-in details
 *     step took it past 800 lines (max-file-lines).
 *   v1.0.0 — 2026-11-02 — Moved out of modal.js unchanged (max-file-lines).
 */

// Capture typed values so they survive a re-render (language change).
export function captureInputs() {
  var g = function (id) { var el = /** @type {any} */ (document.getElementById(id)); return el ? el.value : ''; };
  return {
    u: g('aimeat-username'), p: g('aimeat-password'),
    ru: g('aimeat-reg-username'), rp: g('aimeat-reg-password'),
    rd: g('aimeat-reg-displayname'), re: g('aimeat-reg-email'),
  };
}
export function restoreInputs(vals) {
  // The input event is what keeps the username rules in step with the value, so a restored value
  // announces itself the way a typed one would.
  var s = function (id, val) {
    var el = /** @type {any} */ (document.getElementById(id));
    if (!el || !val) return;
    el.value = val;
    try { el.dispatchEvent(new Event('input')); } catch { /* no Event constructor */ }
  };
  s('aimeat-username', vals.u); s('aimeat-password', vals.p);
  s('aimeat-reg-username', vals.ru); s('aimeat-reg-password', vals.rp);
  s('aimeat-reg-displayname', vals.rd); s('aimeat-reg-email', vals.re);
}

// The username rules, live. The field keeps only what the server's owner-name rule accepts
// (lowercase a to z, digits and hyphens; capitals are lowered as typed) and the three rules
// under it turn green as they are met, from the first typed character. The person sees what
// the name may be while choosing it rather than in a refusal afterwards.
export function wireUsernameRules() {
  var regUser = /** @type {any} */ (document.getElementById('aimeat-reg-username'));
  var rulesEl = document.getElementById('aimeat-reg-rules');
  function syncUsernameRules() {
    if (!regUser || !rulesEl) return;
    var raw = String(regUser.value || '');
    var clean = raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (clean !== raw) {
      var pos = Math.max(0, (regUser.selectionStart == null ? raw.length : regUser.selectionStart) - (raw.length - clean.length));
      regUser.value = clean;
      try { regUser.setSelectionRange(pos, pos); } catch { /* not a text control */ }
    }
    rulesEl.classList.toggle('on', clean.length > 0);
    var met = {
      len: clean.length >= 3 && clean.length <= 64,
      chars: clean.length > 0,
      edges: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(clean),
    };
    rulesEl.querySelectorAll('.aimeat-rule').forEach(function (r) {
      r.classList.toggle('ok', !!met[r.getAttribute('data-rule') || '']);
    });
  }
  if (regUser) regUser.addEventListener('input', syncUsernameRules);
}

// Enter submits the tab the field belongs to.
export function wireEnterSubmits() {
  [['aimeat-username', 'aimeat-go-btn'], ['aimeat-password', 'aimeat-go-btn'],
    ['aimeat-reg-username', 'aimeat-reg-btn'], ['aimeat-reg-email', 'aimeat-reg-btn'],
    ['aimeat-reg-password', 'aimeat-reg-btn'], ['aimeat-reg-displayname', 'aimeat-reg-btn'],
  ].forEach(function (pair) {
    var el = document.getElementById(pair[0]);
    if (!el) return;
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var btn = /** @type {any} */ (document.getElementById(pair[1]));
      if (btn && !btn.disabled) btn.click();
    });
  });
}
