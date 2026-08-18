/**
 * @file front-demo.js
 * @description The demo front page's only script (front-demo.html + front-demo.fi.html):
 *   refreshes the numbers strip from GET /v1/public/node-totals, fills the arcade grid from
 *   GET /v1/apps (most opened first), and turns the Sign in chip into "Your home" for a
 *   signed-in visitor. Plain same-origin script, no modules, no importmap entry needed.
 *   Every step degrades to the static HTML: a fetch that fails leaves the baked-in numbers
 *   and the baked-in arcade line exactly as they are.
 * @version-history
 *   v1.0.0 - 2026-08-19 - Initial: numbers strip, arcade wall (8 apps), signed-in chip.
 */
(function () {
  'use strict';

  var FI = document.documentElement.lang === 'fi';

  function txt(id, value) {
    var el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.textContent = String(value);
  }

  // Live numbers: the baked-in strip carries the last probed figures and their date, so a
  // visitor with no JS (or a dead API) still reads true, dated numbers rather than blanks.
  fetch('/v1/public/node-totals')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var d = j && j.data;
      if (!d) return;
      var fmt = function (n) { return Number(n).toLocaleString(FI ? 'fi-FI' : 'en-US'); };
      txt('fd-n-apps', fmt(d.apps));
      txt('fd-n-opens', fmt(d.downloads));
      txt('fd-n-agents', fmt(d.agents));
      txt('fd-n-online', fmt(d.agents_online));
      txt('fd-strip-note', FI
        ? 'Laskettu tältä samalta koneelta juuri äsken. Luvut vain kasvavat.'
        : 'Counted on this very machine just now. They only go up.');
    })
    .catch(function (err) { console.warn('[front-demo] totals not refreshed, the baked-in numbers stand:', err.message); });

  // The arcade: real apps, most opened first. Cards link to the app itself (inline mode, the
  // same address the portal wall uses), so a visitor is one click from a running machine.
  fetch('/v1/apps?sort=popular&limit=8')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var apps = (j && j.data && j.data.apps) || [];
      var grid = document.getElementById('fd-apps');
      if (!grid || apps.length === 0) return;
      grid.textContent = '';
      apps.forEach(function (a) {
        var m = a.manifest || {};
        var card = document.createElement('a');
        card.className = 'fd-app';
        card.href = '/v1/apps/' + encodeURIComponent(a.owner) + '/' + encodeURIComponent(a.filename) + '?mode=inline';
        card.target = '_blank';
        card.rel = 'noopener';
        var name = document.createElement('span');
        name.className = 'fd-app-name';
        name.textContent = m.name || a.filename;
        var desc = document.createElement('span');
        desc.className = 'fd-app-desc';
        var d = m.description || '';
        desc.textContent = d.length > 110 ? d.slice(0, 107) + '…' : d;
        var meta = document.createElement('span');
        meta.className = 'fd-app-meta';
        var opens = a.downloads || a.opens || 0;
        meta.textContent = opens > 0
          ? (FI ? (opens + ' avausta') : (opens + ' opens'))
          : (FI ? 'uusi kone' : 'fresh machine');
        card.appendChild(name); card.appendChild(desc); card.appendChild(meta);
        grid.appendChild(card);
      });
    })
    .catch(function (err) { console.warn('[front-demo] apps not loaded, the baked-in arcade line stands:', err.message); });

  // A signed-in visitor gets a door home instead of a sign-in chip. Deliberately no automatic
  // redirect: this page is the shop window, and being signed in is not a reason to be pushed
  // past it.
  try {
    var raw = localStorage.getItem('aimeat_session');
    if (raw && JSON.parse(raw).jwt) {
      var chip = document.getElementById('fd-enter');
      if (chip) {
        chip.textContent = FI ? 'Kotiisi' : 'Your home';
        chip.setAttribute('href', '/v1/home');
      }
    }
  } catch (err) { console.warn('[front-demo] session not readable, staying a guest:', err.message); }
})();
