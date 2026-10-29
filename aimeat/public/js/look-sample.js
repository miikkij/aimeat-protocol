/**
 * @file public/js/look-sample.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sets the look, the theme and the title of /look-sample.html from its hash
 *   (#look=<id>&theme=light|dark&title=<words>), which components/LookSample.js writes. A look id is
 *   held to the form the look registry uses; the title is set as text.
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */
(function () {
  var p = new URLSearchParams(location.hash.slice(1));
  var look = p.get('look') || '';
  var root = document.documentElement;
  if (/^[a-z0-9][a-z0-9-]{0,40}$/.test(look)) root.setAttribute('data-ak-look', look);
  root.setAttribute('data-theme', p.get('theme') === 'dark' ? 'dark' : 'light');
  var title = (p.get('title') || '').trim();
  var el = document.getElementById('ls-title');
  if (el && title) el.textContent = title.slice(0, 40);
})();
