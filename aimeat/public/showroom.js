/**
 * @file showroom.js
 * @description Logic for the AIMEAT Cortex Library Showroom. Loads the 7 bundled
 *   cortex UI libraries (with a /v1/cortex → /cortex-bundled fallback) and renders a
 *   live demo of each, on top of self-hosted Tailwind v4 + daisyUI 5. Kept external
 *   (same-origin) so the apex CSP ('self') runs it without an inline nonce; the
 *   published single-file app inlines this into a <script> block.
 * @version-history
 *   v0.1.0 — 2026-06-26 — Initial showroom for vendored-styling verification.
 */
(function () {
  'use strict';

  var CORTEX = [
    { name: 'aimeat-ui-forms', ns: ['ui', 'forms'] },
    { name: 'aimeat-ui-dialogs', ns: ['ui', 'dialogs'] },
    { name: 'aimeat-ui-viewers', ns: ['ui', 'viewers'] },
    { name: 'aimeat-ui-nav', ns: ['ui', 'nav'] },
    { name: 'aimeat-ui-layout', ns: ['ui', 'layout'] },
    { name: 'aimeat-charts', ns: ['charts'] },
    { name: 'aimeat-canvas', ns: ['canvas'] },
  ];

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(src); };
      s.onerror = function () { reject(new Error('failed ' + src)); };
      document.head.appendChild(s);
    });
  }

  // Canonical path first, then the static bundled copy (works before activation).
  function loadCortex(name) {
    var canonical = '/v1/cortex/' + name + '/libs/' + name + '.js';
    var fallback = '/cortex-bundled/' + name + '.js';
    return loadScript(canonical)
      .then(function () { return { name: name, ok: true, via: 'v1/cortex' }; })
      .catch(function () {
        return loadScript(fallback)
          .then(function () { return { name: name, ok: true, via: 'cortex-bundled' }; })
          .catch(function () { return { name: name, ok: false, via: 'none' }; });
      });
  }

  function nsPresent(path) {
    var o = window.AIMEAT || {};
    for (var i = 0; i < path.length; i++) { o = o && o[path[i]]; }
    return !!o;
  }

  function badge(text, kind) {
    var b = document.createElement('span');
    b.className = 'badge badge-sm ' + (kind || '');
    b.textContent = text;
    return b;
  }

  function note(target, msg, kind) {
    var d = document.createElement('div');
    d.className = 'alert ' + (kind || 'alert-warning') + ' mt-2 text-sm';
    d.textContent = msg;
    target.appendChild(d);
  }

  function demo(label, fn) {
    try { fn(); }
    catch (e) {
      var host = document.getElementById('demo-' + label);
      if (host) note(host, label + ' demo error: ' + (e && e.message ? e.message : e), 'alert-error');
      // eslint-disable-next-line no-console
      console.error('[showroom] ' + label, e);
    }
  }

  function renderForms() {
    if (!nsPresent(['ui', 'forms'])) return;
    var host = document.getElementById('demo-forms');
    AIMEAT.ui.forms.FormGroup({
      target: host,
      submitLabel: 'Submit',
      fields: [
        { name: 'email', type: 'email', label: 'Email', required: true },
        { name: 'role', type: 'select', label: 'Role', options: [
          { value: 'admin', label: 'Admin' }, { value: 'user', label: 'User' } ] },
        { name: 'live', type: 'toggle', label: 'Notifications' },
        { name: 'bio', type: 'textarea', label: 'Bio', autoGrow: true },
      ],
      onSubmit: function (data) {
        if (nsPresent(['ui', 'dialogs'])) AIMEAT.ui.dialogs.toast('Submitted: ' + JSON.stringify(data), 'success');
      },
    });
  }

  function renderDialogs() {
    if (!nsPresent(['ui', 'dialogs'])) return;
    var host = document.getElementById('demo-dialogs');
    var d = AIMEAT.ui.dialogs;
    function mk(text, fn) {
      var b = document.createElement('button');
      b.className = 'btn btn-sm btn-outline';
      b.textContent = text;
      b.onclick = fn;
      host.appendChild(b);
    }
    mk('Toast', function () { d.toast('Hello from aimeat-ui-dialogs', 'info', 2500); });
    mk('Modal', function () { d.Modal({ title: 'Demo modal', content: 'This modal is rendered by the cortex library.', width: 'md' }); });
    mk('Confirm', function () {
      var p = d.Confirm({ message: 'Proceed with the demo action?', title: 'Confirm', danger: false });
      if (p && p.then) p.then(function (ok) { d.toast('You chose: ' + ok, ok ? 'success' : 'warning'); });
    });
  }

  function renderViewers() {
    if (!nsPresent(['ui', 'viewers'])) return;
    var host = document.getElementById('demo-viewers');
    AIMEAT.ui.viewers.DataTable({
      target: host,
      sortable: true,
      filterable: true,
      pageSize: 5,
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'role', label: 'Role' },
        { key: 'score', label: 'Score' },
      ],
      rows: [
        { name: 'Alice', role: 'Admin', score: 92 },
        { name: 'Bob', role: 'User', score: 71 },
        { name: 'Carol', role: 'User', score: 85 },
        { name: 'Dave', role: 'Editor', score: 64 },
        { name: 'Erin', role: 'Admin', score: 78 },
        { name: 'Frank', role: 'User', score: 55 },
      ],
    });
  }

  function renderNav() {
    if (!nsPresent(['ui', 'nav'])) return;
    var host = document.getElementById('demo-nav');
    if (AIMEAT.ui.nav.Breadcrumbs) {
      AIMEAT.ui.nav.Breadcrumbs({ target: host, items: [
        { label: 'Home' }, { label: 'Libraries' }, { label: 'Nav' } ] });
    }
    if (AIMEAT.ui.nav.Tabs) {
      var out = document.createElement('div');
      out.className = 'mt-2 text-sm opacity-70';
      AIMEAT.ui.nav.Tabs({
        target: host,
        active: 'a',
        tabs: [ { id: 'a', label: 'Overview' }, { id: 'b', label: 'Details' }, { id: 'c', label: 'Settings' } ],
        onChange: function (id) { out.textContent = 'active tab: ' + id; },
      });
      host.appendChild(out);
    }
  }

  function renderLayout() {
    if (!nsPresent(['ui', 'layout'])) return;
    var host = document.getElementById('demo-layout');
    var left = document.createElement('div');
    left.className = 'p-3'; left.textContent = 'Left panel';
    var right = document.createElement('div');
    right.className = 'p-3'; right.textContent = 'Right panel';
    AIMEAT.ui.layout.Split({ target: host, left: left, right: right, ratio: '60/40' });
  }

  function renderCharts() {
    if (!nsPresent(['charts'])) return;
    if (!window.Chart) { note(document.getElementById('demo-charts'), 'Chart.js not loaded', 'alert-error'); return; }
    AIMEAT.charts.ChartBuilder({
      elementId: 'chart-host',
      type: 'bar',
      data: {
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        datasets: [{ label: 'Plays', data: [12, 19, 8, 15, 22] }],
      },
    });
  }

  function renderCanvas() {
    if (!nsPresent(['canvas'])) return;
    AIMEAT.canvas.DrawingCanvas({ elementId: 'canvas-host' });
  }

  function renderStatus(results) {
    var host = document.getElementById('load-status');
    var okCount = 0;
    results.forEach(function (r) {
      var kind = r.ok ? 'badge-success' : 'badge-error';
      var b = badge(r.name + (r.ok ? ' · ' + r.via : ' · missing'), kind);
      host.appendChild(b);
      if (r.ok) okCount++;
    });
    var sum = document.getElementById('load-summary');
    sum.textContent = okCount + '/' + results.length + ' loaded';
    sum.className = 'badge badge-sm ' + (okCount === results.length ? 'badge-success' : 'badge-warning');
  }

  function setupChrome() {
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.onclick = function () {
      var el = document.documentElement;
      el.setAttribute('data-theme', el.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    };
  }

  function init() {
    setupChrome();
    window.AIMEAT = window.AIMEAT || {};
    Promise.all(CORTEX.map(function (c) { return loadCortex(c.name); })).then(function (results) {
      renderStatus(results);
      demo('forms', renderForms);
      demo('dialogs', renderDialogs);
      demo('viewers', renderViewers);
      demo('nav', renderNav);
      demo('layout', renderLayout);
      demo('charts', renderCharts);
      demo('canvas', renderCanvas);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
