/**
 * @file front-os.js
 * @description The OS front page's behaviour (front-os.html + front-os.fi.html): the skippable
 *   sub-2s boot sequence (first visit only, localStorage-remembered), the menubar clock, and
 *   the live fills — the desktop's applications window, the node-status window, the proof
 *   strip and the app carousel, all from this node's own public API. Plain same-origin script.
 *   Everything degrades to the baked-in HTML: a dead fetch leaves true, dated numbers.
 * @version-history
 *   v1.0.0 - 2026-08-19 - Initial: boot, clock, apps window, status window, proof, carousel.
 */
(function () {
  'use strict';

  var FI = document.documentElement.lang === 'fi';
  var BOOT_KEY = 'aimeat.os.booted';

  /* ── Boot sequence: under two seconds, skippable, first visit only. ── */
  var boot = document.getElementById('fos-boot');
  var bootDone = false;
  function endBoot() {
    if (bootDone || !boot) return;
    bootDone = true;
    boot.classList.add('fos-boot-off');
    try { localStorage.setItem(BOOT_KEY, '1'); } catch (err) { console.warn('[front-os] boot flag not saved:', err.message); }
    document.removeEventListener('keydown', endBoot);
  }
  var seen = false;
  try { seen = localStorage.getItem(BOOT_KEY) === '1'; } catch (err) { console.warn('[front-os] boot flag not read:', err.message); }
  if (!boot || seen) {
    if (boot) boot.classList.add('fos-boot-off');
  } else {
    var LINES = FI ? [
      'AIMEAT BIOS v4.0 — muisti kunnossa',
      'liitetään työtilat........ ok',
      'herätetään agentit........ ok',
      'avataan appikatalogi...... ok',
      'sinun nodesi, sinun datasi: käynnistetään työpöytä',
    ] : [
      'AIMEAT BIOS v4.0 — memory check ok',
      'mounting workspaces....... ok',
      'waking agents............. ok',
      'opening the app catalog... ok',
      'your node, your data: starting desktop',
    ];
    var out = document.getElementById('fos-boot-lines');
    var i = 0;
    var tick = window.setInterval(function () {
      if (bootDone) { window.clearInterval(tick); return; }
      if (i < LINES.length && out) out.textContent += LINES[i] + '\n';
      i++;
      if (i > LINES.length) { window.clearInterval(tick); endBoot(); }
    }, 320);
    boot.addEventListener('click', endBoot);
    document.addEventListener('keydown', endBoot);
  }

  /* ── The menubar clock: a desktop with a stopped clock reads as a screenshot. ── */
  var clock = document.getElementById('fos-clock');
  function tickClock() {
    if (!clock) return;
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    clock.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  tickClock();
  window.setInterval(tickClock, 1000);

  function txt(id, value) {
    var el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.textContent = String(value);
  }

  /* ── Live numbers: node status window + proof strip + carousel heading. ── */
  fetch('/v1/public/node-totals')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var d = j && j.data;
      if (!d) return;
      var fmt = function (n) { return Number(n).toLocaleString(FI ? 'fi-FI' : 'en-US'); };
      txt('fos-p-apps', fmt(d.apps));
      txt('fos-p-agents', fmt(d.agents));
      txt('fos-c-count', fmt(d.apps));
      var st = document.getElementById('fos-win-status');
      if (st) {
        st.innerHTML = '';
        var line = function (k, v, cls) {
          var s = document.createElement('span');
          s.className = cls || 'g';
          s.textContent = k;
          st.appendChild(s);
          st.appendChild(document.createTextNode(' ' + v));
          st.appendChild(document.createElement('br'));
        };
        line('$ aimeat status', '', 'd');
        line(FI ? 'appeja:' : 'apps:', fmt(d.apps) + (FI ? ' käynnissä' : ' running'));
        line(FI ? 'agentteja:' : 'agents:', fmt(d.agents) + (FI ? ', hereillä ' + fmt(d.agents_online) : ', ' + fmt(d.agents_online) + ' awake'));
        line(FI ? 'avauksia:' : 'opens:', fmt(d.downloads));
        line('uptime:', FI ? 'koko ajan, se on koko pointti' : 'always, that is the point', 'a');
      }
    })
    .catch(function (err) { console.warn('[front-os] totals not refreshed, the baked-in numbers stand:', err.message); });

  /* ── The applications window (6 most opened) + the carousel (up to 40, doubled so the
        CSS marquee can loop seamlessly). Real apps, really clickable. ── */
  fetch('/v1/apps?sort=popular&limit=40')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var apps = (j && j.data && j.data.apps) || [];
      if (apps.length === 0) return;
      var href = function (a) {
        return '/v1/apps/' + encodeURIComponent(a.owner) + '/' + encodeURIComponent(a.filename) + '?mode=inline';
      };
      var win = document.getElementById('fos-win-apps');
      if (win) {
        win.textContent = '';
        apps.slice(0, 6).forEach(function (a) {
          var m = a.manifest || {};
          var li = document.createElement('li');
          var name = document.createElement('b');
          name.textContent = (m.name || a.filename) + '  ';
          var desc = document.createElement('span');
          var dd = m.description || '';
          desc.textContent = dd.length > 60 ? dd.slice(0, 57) + '…' : dd;
          li.appendChild(name); li.appendChild(desc);
          win.appendChild(li);
        });
      }
      var track = document.getElementById('fos-track');
      if (track) {
        track.textContent = '';
        var addCard = function (a) {
          var m = a.manifest || {};
          var card = document.createElement('a');
          card.className = 'fos-card';
          card.href = href(a);
          card.target = '_blank';
          card.rel = 'noopener';
          var name = document.createElement('b');
          name.textContent = m.name || a.filename;
          var desc = document.createElement('span');
          var dd = m.description || '';
          desc.textContent = dd.length > 80 ? dd.slice(0, 77) + '…' : dd;
          card.appendChild(name); card.appendChild(desc);
          track.appendChild(card);
        };
        apps.forEach(addCard);
        apps.forEach(addCard); // the second copy is what lets translateX(-50%) loop without a seam
      }
    })
    .catch(function (err) { console.warn('[front-os] apps not loaded, the baked-in lines stand:', err.message); });
})();
