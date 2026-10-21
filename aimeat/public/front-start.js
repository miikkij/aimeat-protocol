/**
 * @file front-start.js
 * @description The only script of the "accelerate your AI" front page (front-start.html and
 *   front-start.fi.html). Three things, each of which degrades to the static HTML:
 *   1. The five level buttons: pressing one marks it pressed and writes its example prompt and
 *      its McKinsey match (the button's data-example and data-mck attributes) into the panel
 *      under the row. Without the script the panel keeps the level 1 text baked into the page.
 *   2. The copy button of the install prompt writes the prompt text to the clipboard.
 *   3. A signed-in visitor gets a "Your home" link (/v1/home) in place of "Sign in". No
 *      automatic redirect: this page is the public front page, and a signed-in visitor may
 *      still want to read it.
 *   Plain same-origin script, no modules, no importmap entry needed.
 * @version-history
 *   v1.0.0 - 2026-10-21 - Initial: level picker (scrolls its answer into view on a phone, quote
 *     marks by language), copy button, signed-in link.
 */
(function () {
  'use strict';

  var FI = document.documentElement.lang === 'fi';

  // 1. Level picker.
  var levels = Array.prototype.slice.call(document.querySelectorAll('.fs-level'));
  var tryN = document.getElementById('fs-try-n');
  var tryMck = document.getElementById('fs-try-mck');
  var tryQuote = document.getElementById('fs-try-quote');
  var tryPanel = document.querySelector('.fs-try');
  // Finnish quotes with the right double quote on both sides, English with the left and right pair.
  var OPEN = FI ? '”' : '“';
  levels.forEach(function (btn) {
    btn.addEventListener('click', function () {
      levels.forEach(function (other) { other.setAttribute('aria-pressed', other === btn ? 'true' : 'false'); });
      if (tryN) tryN.textContent = btn.getAttribute('data-n') || '';
      if (tryMck) tryMck.textContent = btn.getAttribute('data-mck') || '';
      if (tryQuote) tryQuote.textContent = OPEN + (btn.getAttribute('data-example') || '') + '”';
      // On a phone the five cards stack and the panel sits below them, out of sight: bring it
      // into view so the press shows its answer. On a wide screen it is already visible.
      if (tryPanel) {
        var r = tryPanel.getBoundingClientRect();
        if (r.bottom > window.innerHeight || r.top < 0) tryPanel.scrollIntoView({ block: 'end', behavior: 'smooth' });
      }
    });
  });

  // 2. Copy the install prompt.
  var copyBtn = document.getElementById('fs-copy');
  var prompt = document.getElementById('fs-prompt');
  if (copyBtn && prompt) {
    copyBtn.addEventListener('click', function () {
      var done = function () { copyBtn.textContent = FI ? 'Kopioitu ✓' : 'Copied ✓'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(prompt.textContent.trim()).then(done, function (err) {
          console.warn('[front-start] clipboard refused, the prompt stays selectable on the page:', err && err.message);
        });
      }
    });
  }

  // 3. Signed-in visitor: a link home instead of "Sign in".
  try {
    var raw = localStorage.getItem('aimeat_session');
    if (raw && JSON.parse(raw).jwt) {
      var enter = document.getElementById('fs-enter');
      if (enter) {
        enter.textContent = FI ? 'Kotiisi' : 'Your home';
        enter.setAttribute('href', '/v1/home');
      }
    }
  } catch (err) { console.warn('[front-start] session not readable, staying a guest:', err.message); }
})();
