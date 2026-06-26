/**
 * @file showroom.js
 * @description Comprehensive demo logic for the AIMEAT Cortex Library Showroom. Loads the
 *   7 bundled cortex UI libraries (with a /v1/cortex → /cortex-bundled fallback) and
 *   exercises EVERY exported component, on top of self-hosted Tailwind v4 + daisyUI 5.
 *   Kept external (same-origin) so the apex CSP ('self') runs it without an inline nonce;
 *   the published single-file app inlines this into a <script> block.
 * @version-history
 *   v0.1.0 — 2026-06-26 — Initial showroom for vendored-styling verification.
 *   v0.2.0 — 2026-06-26 — Comprehensive: every component of all 7 libraries.
 */
(function () {
  'use strict';

  var CORTEX = ['aimeat-ui-forms', 'aimeat-i18n', 'aimeat-ui-dialogs', 'aimeat-ui-viewers',
    'aimeat-ui-nav', 'aimeat-ui-layout', 'aimeat-charts', 'aimeat-canvas'];

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = function () { res(src); }; s.onerror = function () { rej(new Error(src)); };
      document.head.appendChild(s);
    });
  }
  function loadCortex(name) {
    return loadScript('/v1/cortex/' + name + '/libs/' + name + '.js')
      .then(function () { return { name: name, ok: true, via: 'v1/cortex' }; })
      .catch(function () {
        return loadScript('/cortex-bundled/' + name + '.js')
          .then(function () { return { name: name, ok: true, via: 'cortex-bundled' }; })
          .catch(function () { return { name: name, ok: false, via: 'none' }; });
      });
  }
  function ns(path) { var o = window.AIMEAT || {}; for (var i = 0; i < path.length; i++) o = o && o[path[i]]; return o; }

  var uid = 0;
  function nextId() { uid += 1; return 'sr-host-' + uid; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svg(color, label) {
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="' + color + '"/>'
      + '<text x="60" y="44" font-size="12" fill="#fff" text-anchor="middle" font-family="sans-serif">' + label + '</text></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(s);
  }

  // A labelled sub-card for one component. fn(mount) renders into mount.
  function sub(host, title, fn) {
    var card = el('div', 'card bg-base-100 border border-base-300');
    var body = el('div', 'card-body p-3 gap-2');
    var h = el('h3', 'font-semibold text-sm opacity-80'); h.textContent = title;
    var mount = el('div', 'min-h-8');
    body.appendChild(h); body.appendChild(mount); card.appendChild(body); host.appendChild(card);
    try { fn(mount); }
    catch (e) {
      var a = el('div', 'alert alert-error text-xs', 'error: ' + (e && e.message ? e.message : e));
      mount.appendChild(a);
      // eslint-disable-next-line no-console
      console.error('[showroom] ' + title, e);
    }
  }
  function btn(label, onClick) { var b = el('button', 'btn btn-sm btn-outline', label); b.onclick = onClick; return b; }

  /* ───────── forms ───────── */
  function renderForms(host) {
    var f = ns(['ui', 'forms']); if (!f) return;
    sub(host, 'Input', function (m) { m.appendChild(f.Input({ label: 'Email', type: 'email' }).el); });
    sub(host, 'Select', function (m) { m.appendChild(f.Select({ label: 'Country', options: [{ value: 'fi', label: 'Finland' }, { value: 'se', label: 'Sweden' }, { value: 'no', label: 'Norway' }] }).el); });
    sub(host, 'Checkbox', function (m) { m.appendChild(f.Checkbox({ label: 'Subscribe', checked: true }).el); });
    sub(host, 'Radio', function (m) { m.appendChild(f.Radio({ label: 'Plan', options: [{ value: 'free', label: 'Free' }, { value: 'pro', label: 'Pro' }] }).el); });
    sub(host, 'Toggle', function (m) { m.appendChild(f.Toggle({ label: 'Notifications' }).el); });
    sub(host, 'Textarea', function (m) { m.appendChild(f.Textarea({ label: 'Bio', autoGrow: true }).el); });
    sub(host, 'FormGroup', function (m) {
      m.appendChild(f.FormGroup({
        submitLabel: 'Save',
        fields: [{ name: 'name', type: 'text', label: 'Name', required: true }, { name: 'agree', type: 'checkbox', label: 'I agree', required: true }],
        onSubmit: function (d) { var t = ns(['ui', 'dialogs']); if (t) t.toast('Saved: ' + JSON.stringify(d), 'success'); },
      }).el);
    });
  }

  /* ───────── i18n ───────── */
  function renderI18n(host) {
    var i = ns(['i18n']); if (!i) return;
    var trans = {
      en: { greet: 'Hello, {name}!', tagline: 'Localized via data-i18n', hint: 'Switch language above — the text updates live.' },
      fi: { greet: 'Hei, {name}!', tagline: 'Lokalisoitu data-i18n:llä', hint: 'Vaihda kieli yltä — teksti päivittyy heti.' },
      sv: { greet: 'Hej, {name}!', tagline: 'Lokaliserad via data-i18n', hint: 'Byt språk ovan — texten uppdateras direkt.' },
    };
    i.init({ locales: ['en', 'fi', 'sv'], default: 'en', translations: trans }).then(function () {
      sub(host, 'LanguageSwitcher + t() + data-i18n', function (m) {
        var greet = el('div', 'text-lg font-semibold');
        var hint = el('div', 'text-sm opacity-70');
        var tag = el('p', 'mt-1 badge badge-soft'); tag.setAttribute('data-i18n', 'tagline');
        function render() { greet.textContent = i.t('greet', { name: 'AIMEAT' }); hint.textContent = i.t('hint'); i.apply(m); }
        i.LanguageSwitcher({ target: m, onChange: render });
        m.appendChild(greet); m.appendChild(hint); m.appendChild(tag); render();
      });
      sub(host, 'locales() / getLocale()', function (m) {
        m.appendChild(el('div', 'text-sm opacity-70', 'available: ' + i.locales().join(', ') + ' · current: ' + i.getLocale()));
      });
    });
  }

  /* ───────── dialogs ───────── */
  function renderDialogs(host) {
    var d = ns(['ui', 'dialogs']); if (!d) return;
    sub(host, 'toast', function (m) { m.appendChild(btn('Show toast', function () { d.toast('Hello from aimeat-ui-dialogs', 'info', 2500); })); });
    sub(host, 'Modal', function (m) { m.appendChild(btn('Open modal', function () { d.Modal({ title: 'Demo modal', content: 'Rendered by the cortex library.', width: 'md' }); })); });
    sub(host, 'Confirm', function (m) { m.appendChild(btn('Confirm…', function () { var p = d.Confirm({ message: 'Proceed?', title: 'Confirm' }); if (p && p.then) p.then(function (ok) { d.toast('Chose: ' + ok, ok ? 'success' : 'warning'); }); })); });
    sub(host, 'Alert', function (m) { m.appendChild(d.Alert({ message: 'Inline alert — informational.', type: 'info', dismissible: true }).el); });
    sub(host, 'ContextMenu', function (m) {
      var box = el('div', 'p-4 rounded border border-dashed border-base-300 text-sm cursor-context-menu', 'Right-click me');
      d.ContextMenu({ target: box, items: [{ label: 'Edit', onClick: function () { d.toast('Edit', 'info'); } }, { label: 'Delete', onClick: function () { d.toast('Delete', 'error'); } }] });
      m.appendChild(box);
    });
    sub(host, 'Dropdown', function (m) {
      var trigger = el('button', 'btn btn-sm', 'Open dropdown ▾');
      m.appendChild(trigger);
      d.Dropdown({ trigger: trigger, items: [{ label: 'Profile', onClick: function () { d.toast('Profile', 'info'); } }, { label: 'Settings', onClick: function () { d.toast('Settings', 'info'); } }] });
    });
  }

  /* ───────── viewers ───────── */
  function renderViewers(host) {
    var v = ns(['ui', 'viewers']); if (!v) return;
    sub(host, 'Carousel', function (m) {
      v.Carousel({ target: m, items: [el('div', 'p-8 text-center', 'Slide 1'), el('div', 'p-8 text-center', 'Slide 2'), el('div', 'p-8 text-center', 'Slide 3')], loop: true });
    });
    sub(host, 'Grid', function (m) {
      v.Grid({ target: m, items: [1, 2, 3, 4], minColWidth: 90, renderItem: function (i) { return el('div', 'p-4 rounded bg-base-200 text-center text-sm', 'Card ' + i); } });
    });
    sub(host, 'List', function (m) {
      v.List({ target: m, items: [{ title: 'Alice', subtitle: 'Admin', badge: 'A' }, { title: 'Bob', subtitle: 'User', badge: 'B' }] });
    });
    sub(host, 'Gallery', function (m) {
      v.Gallery({ target: m, cols: 3, images: [svg('#6366f1', 'one'), svg('#10b981', 'two'), svg('#f59e0b', 'three')] });
    });
    sub(host, 'DataTable', function (m) {
      v.DataTable({
        target: m, sortable: true, filterable: true, pageSize: 4,
        columns: [{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'score', label: 'Score' }],
        rows: [{ name: 'Alice', role: 'Admin', score: 92 }, { name: 'Bob', role: 'User', score: 71 }, { name: 'Carol', role: 'User', score: 85 }, { name: 'Dave', role: 'Editor', score: 64 }, { name: 'Erin', role: 'Admin', score: 78 }],
      });
    });
    sub(host, 'Timeline', function (m) {
      v.Timeline({ target: m, events: [{ title: 'Created', content: 'Project created', date: '2026-06-01' }, { title: 'Shipped', content: 'First release', date: '2026-06-20' }] });
    });
  }

  /* ───────── nav ───────── */
  function renderNav(host) {
    var n = ns(['ui', 'nav']); if (!n) return;
    sub(host, 'Tabs', function (m) {
      var out = el('div', 'text-xs opacity-70 mt-1');
      n.Tabs({ target: m, active: 'a', tabs: [{ id: 'a', label: 'Overview' }, { id: 'b', label: 'Details' }, { id: 'c', label: 'Settings' }], onChange: function (id) { out.textContent = 'active: ' + id; } });
      m.appendChild(out);
    });
    sub(host, 'Breadcrumbs', function (m) { n.Breadcrumbs({ target: m, items: [{ label: 'Home' }, { label: 'Libraries' }, { label: 'Nav' }] }); });
    sub(host, 'Sidebar', function (m) {
      var box = el('div', 'border border-base-300 rounded', null); box.style.height = '160px'; box.style.position = 'relative'; box.style.overflow = 'hidden';
      n.Sidebar({ target: box, items: [{ label: 'Dashboard' }, { label: 'Reports' }, { label: 'Settings' }] });
      m.appendChild(box);
    });
    sub(host, 'BottomNav (mobile-only)', function (m) {
      var box = el('div', 'border border-base-300 rounded', null); box.style.height = '64px'; box.style.position = 'relative'; box.style.overflow = 'hidden';
      n.BottomNav({ target: box, active: 0, items: [{ label: 'Home' }, { label: 'Search' }, { label: 'Profile' }] });
      m.appendChild(box);
      m.appendChild(el('div', 'text-xs opacity-60 mt-1', 'Hidden >768px by design.'));
    });
    sub(host, 'BurgerMenu', function (m) {
      var box = el('div', 'border border-base-300 rounded p-2', null); box.style.minHeight = '56px'; box.style.position = 'relative';
      n.BurgerMenu({ target: box, logo: 'Menu', items: [{ label: 'Home' }, { label: 'About' }, { label: 'Contact' }] });
      m.appendChild(box);
    });
  }

  /* ───────── layout ───────── */
  function renderLayout(host) {
    var L = ns(['ui', 'layout']); if (!L) return;
    function frame(h) { var box = el('div', 'border border-base-300 rounded overflow-hidden'); box.style.height = (h || 140) + 'px'; return box; }
    function pane(t) { return el('div', 'p-3 text-sm', t); }
    sub(host, 'MainDetail', function (m) { var b = frame(); L.MainDetail({ target: b, list: pane('List pane'), detail: pane('Detail pane') }); m.appendChild(b); });
    sub(host, 'Split', function (m) { var b = frame(); L.Split({ target: b, left: pane('Left'), right: pane('Right'), ratio: '60/40' }); m.appendChild(b); });
    sub(host, 'Fibonacci', function (m) { var b = frame(); L.Fibonacci({ target: b, primary: pane('Primary 61.8%'), secondary: pane('Secondary 38.2%') }); m.appendChild(b); });
    sub(host, 'HolyGrail', function (m) { var b = frame(170); L.HolyGrail({ target: b, header: pane('Header'), left: pane('Left'), main: pane('Main'), right: pane('Right'), footer: pane('Footer') }); m.appendChild(b); });
    sub(host, 'DashboardGrid', function (m) { var b = frame(); L.DashboardGrid({ target: b, cols: 2, widgets: [pane('W1'), pane('W2'), pane('W3'), pane('W4')] }); m.appendChild(b); });
    sub(host, 'Stacked', function (m) { var b = frame(); L.Stacked({ target: b, sections: [pane('Section A'), pane('Section B'), pane('Section C')] }); m.appendChild(b); });
    sub(host, 'Portrait', function (m) { var b = frame(); L.Portrait({ target: b, content: pane('Portrait (centred column)'), maxWidth: 360 }); m.appendChild(b); });
    sub(host, 'Landscape', function (m) { var b = frame(); L.Landscape({ target: b, content: pane('Landscape (full width)') }); m.appendChild(b); });
    sub(host, 'Header', function (m) { var b = frame(70); L.Header({ target: b, title: 'App title', actions: ['Action'] }); m.appendChild(b); });
    sub(host, 'Footer', function (m) { var b = frame(70); L.Footer({ target: b, content: 'Footer content', links: [{ label: 'Privacy' }, { label: 'Terms' }] }); m.appendChild(b); });
  }

  /* ───────── charts ───────── */
  function renderCharts(host) {
    var c = ns(['charts']); if (!c) return;
    if (!window.Chart) { sub(host, 'charts', function (m) { m.appendChild(el('div', 'alert alert-error text-xs', 'Chart.js not loaded')); }); return; }
    function chart(title, type, data) {
      sub(host, 'ChartBuilder · ' + type, function (m) {
        var id = nextId(); var div = el('div', null); div.id = id; div.style.height = '220px'; m.appendChild(div);
        c.ChartBuilder({ elementId: id, type: type, data: data });
      });
    }
    var labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    chart('bar', 'bar', { labels: labels, datasets: [{ label: 'Plays', data: [12, 19, 8, 15, 22] }] });
    chart('line', 'line', { labels: labels, datasets: [{ label: 'Trend', data: [5, 9, 7, 12, 14] }] });
    chart('doughnut', 'doughnut', { labels: ['A', 'B', 'C'], datasets: [{ label: 'Share', data: [40, 35, 25] }] });
    sub(host, 'ChartPanel', function (m) { m.appendChild(el('div', 'text-xs opacity-70', 'ChartPanel reads a stored chart:* key from memory (needs nodeUrl + token) — demonstrated live in a logged-in app.')); });
  }

  /* ───────── canvas ───────── */
  function renderCanvas(host) {
    var k = ns(['canvas']); if (!k) return;
    var id = nextId(); var div = el('div', null); div.id = id; host.appendChild(div);
    k.DrawingCanvas({ elementId: id, options: { width: 760, height: 300, autoSave: false } });
  }

  function renderStatus(results) {
    var host = document.getElementById('load-status'); var ok = 0;
    results.forEach(function (r) {
      var b = el('span', 'badge badge-sm ' + (r.ok ? 'badge-success' : 'badge-error'), r.name + (r.ok ? ' · ' + r.via : ' · missing'));
      host.appendChild(b); if (r.ok) ok++;
    });
    var sum = document.getElementById('load-summary');
    sum.textContent = ok + '/' + results.length + ' loaded';
    sum.className = 'badge badge-sm ' + (ok === results.length ? 'badge-success' : 'badge-warning');
  }

  function init() {
    var tg = document.getElementById('theme-toggle');
    if (tg) tg.onclick = function () { var e = document.documentElement; e.setAttribute('data-theme', e.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
    window.AIMEAT = window.AIMEAT || {};
    Promise.all(CORTEX.map(loadCortex)).then(function (results) {
      renderStatus(results);
      renderForms(document.getElementById('demo-forms'));
      renderI18n(document.getElementById('demo-i18n'));
      renderDialogs(document.getElementById('demo-dialogs'));
      renderViewers(document.getElementById('demo-viewers'));
      renderNav(document.getElementById('demo-nav'));
      renderLayout(document.getElementById('demo-layout'));
      renderCharts(document.getElementById('demo-charts'));
      renderCanvas(document.getElementById('demo-canvas'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
