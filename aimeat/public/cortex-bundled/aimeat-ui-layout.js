/**
 * aimeat-ui-layout — Responsive layout components with container queries.
 *
 * Components: MainDetail, Portrait, Landscape, Fibonacci, HolyGrail, Split, Stacked, DashboardGrid, Header, Footer
 * Zero external dependencies — pure DOM API.
 *
 * Usage:
 *   <script src="/v1/cortex/aimeat-ui-layout/libs/aimeat-ui-layout.js"></script>
 *   <script>
 *     var ctrl = AIMEAT.ui.layout.MainDetail({ target: '#app', list: listEl, detail: detailEl });
 *     ctrl.destroy();
 *   </script>
 */
(function (AIMEAT) {
  'use strict';

  // ── CSS ───────────────────────────────────────────────
  var stylesInjected = false;
  var CSS = [
    '/* Layout shared */',
    '.aui-layout { font-family: "DM Sans", system-ui, sans-serif; color: var(--text, #1A1A2E); box-sizing: border-box; }',
    '.aui-layout *, .aui-layout *::before, .aui-layout *::after { box-sizing: border-box; }',

    '/* MainDetail */',
    '.aui-main-detail { display: flex; container-type: inline-size; min-height: 200px; }',
    '.aui-main-detail-list { width: 300px; flex-shrink: 0; overflow-y: auto; border-right: 1px solid var(--border, #E5E7EB); background: var(--bg-surface, #F3F4F6); }',
    '.aui-main-detail-detail { flex: 1; overflow-y: auto; padding: 1rem; }',
    '.aui-main-detail-back { display: none; background: none; border: none; cursor: pointer; padding: 0.5rem 0.75rem; font-size: 0.875rem; color: var(--accent, #E8564A); font-family: inherit; font-weight: 500; }',
    '@container (max-width: 767px) { .aui-main-detail-list { display: none; } .aui-main-detail-back { display: inline-flex; align-items: center; gap: 0.25rem; margin-bottom: 0.5rem; } }',
    '.aui-main-detail.aui-md-show-list .aui-main-detail-list { display: block !important; }',
    '.aui-main-detail.aui-md-show-list .aui-main-detail-detail { display: none !important; }',

    '/* Portrait */',
    '.aui-portrait { container-type: inline-size; max-width: var(--aui-portrait-max, 640px); margin: 0 auto; padding: 1.5rem; }',
    '@container (max-width: 479px) { .aui-portrait { padding: 0.75rem; } }',

    '/* Landscape */',
    '.aui-landscape { container-type: inline-size; width: 100%; overflow-x: auto; padding: 1rem; }',

    '/* Fibonacci */',
    '.aui-fibonacci { display: flex; gap: 1rem; container-type: inline-size; }',
    '.aui-fibonacci-primary { flex: 0 0 61.8%; overflow-y: auto; }',
    '.aui-fibonacci-secondary { flex: 1; overflow-y: auto; }',
    '@container (max-width: 767px) { .aui-fibonacci { flex-direction: column; } .aui-fibonacci-primary { flex: none; } }',

    '/* HolyGrail */',
    '.aui-holy-grail { display: grid; grid-template-areas: "header header header" "left main right" "footer footer footer"; grid-template-rows: auto 1fr auto; grid-template-columns: 220px 1fr 220px; min-height: 100%; container-type: inline-size; }',
    '.aui-holy-grail-header { grid-area: header; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border, #E5E7EB); }',
    '.aui-holy-grail-left { grid-area: left; overflow-y: auto; border-right: 1px solid var(--border, #E5E7EB); padding: 1rem; background: var(--bg-surface, #F3F4F6); }',
    '.aui-holy-grail-main { grid-area: main; overflow-y: auto; padding: 1rem; }',
    '.aui-holy-grail-right { grid-area: right; overflow-y: auto; border-left: 1px solid var(--border, #E5E7EB); padding: 1rem; background: var(--bg-surface, #F3F4F6); }',
    '.aui-holy-grail-footer { grid-area: footer; padding: 0.75rem 1rem; border-top: 1px solid var(--border, #E5E7EB); text-align: center; font-size: 0.8rem; color: var(--text-muted, #9CA3AF); }',
    '.aui-hg-toggle { display: none; background: none; border: none; cursor: pointer; font-size: 1.25rem; padding: 4px 8px; }',
    '@container (max-width: 767px) { .aui-holy-grail { grid-template-areas: "header" "main" "footer"; grid-template-columns: 1fr; } .aui-holy-grail-left, .aui-holy-grail-right { display: none; } .aui-hg-toggle { display: inline-block; } .aui-holy-grail.aui-hg-sidebar-open .aui-holy-grail-left { display: block; position: fixed; top: 0; left: 0; bottom: 0; width: 260px; z-index: 9999; } }',

    '/* Split */',
    '.aui-split { display: flex; gap: 1rem; container-type: inline-size; }',
    '.aui-split-left, .aui-split-right { overflow-y: auto; }',
    '@container (max-width: 767px) { .aui-split { flex-direction: column; } .aui-split-left, .aui-split-right { flex: none !important; } }',

    '/* Stacked */',
    '.aui-stacked { display: flex; flex-direction: column; gap: 1.5rem; container-type: inline-size; }',

    '/* DashboardGrid */',
    '.aui-dashboard-grid { display: grid; gap: 1rem; container-type: inline-size; }',
    '@container (max-width: 479px) { .aui-dashboard-grid { grid-template-columns: 1fr !important; } }',

    '/* Header */',
    '.aui-header { position: sticky; top: 0; z-index: 100; display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1.25rem; background: var(--bg-card, #fff); border-bottom: 1px solid var(--border, #E5E7EB); font-family: "DM Sans", system-ui, sans-serif; transition: box-shadow 0.2s; }',
    '.aui-header.aui-header-shadow { box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.06)); }',
    '.aui-header-logo { height: 32px; width: auto; }',
    '.aui-header-title { font-size: 1.1rem; font-weight: 600; color: var(--text, #1A1A2E); margin: 0; }',
    '.aui-header-spacer { flex: 1; }',
    '.aui-header-actions { display: flex; align-items: center; gap: 0.5rem; }',

    '/* Footer */',
    '.aui-footer { display: flex; align-items: center; justify-content: center; gap: 1rem; padding: 1rem 1.25rem; border-top: 1px solid var(--border, #E5E7EB); font-size: 0.8rem; color: var(--text-muted, #9CA3AF); font-family: "DM Sans", system-ui, sans-serif; flex-wrap: wrap; }',
    '.aui-footer a { color: var(--accent, #E8564A); text-decoration: none; }',
    '.aui-footer a:hover { text-decoration: underline; }'
  ].join('\n');

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.setAttribute('data-aimeat', 'ui-layout');
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ── Helpers ───────────────────────────────────────────
  function mkEl(tag, className, children) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function(c) {
        if (typeof c === 'string') e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
      });
    }
    return e;
  }

  function resolveTarget(target) {
    if (!target) return null;
    return typeof target === 'string' ? document.querySelector(target) : target;
  }

  function mount(targetSel, el) {
    var t = resolveTarget(targetSel);
    if (t) t.appendChild(el);
    return t;
  }

  // ── MainDetail ─────────────────────────────────────────
  function MainDetail(opts) {
    injectStyles();
    opts = opts || {};
    var wrap = mkEl('div', 'aui-layout aui-main-detail');

    // Back button (hidden on desktop)
    var backBtn = mkEl('button', 'aui-main-detail-back');
    backBtn.innerHTML = '&#8592; Back';
    backBtn.addEventListener('click', function() {
      wrap.classList.add('aui-md-show-list');
    });

    // List pane
    var listPane = mkEl('div', 'aui-main-detail-list');
    if (opts.list) {
      if (typeof opts.list === 'string') listPane.innerHTML = opts.list;
      else listPane.appendChild(opts.list);
    }

    // Detail pane
    var detailPane = mkEl('div', 'aui-main-detail-detail');
    detailPane.appendChild(backBtn);
    if (opts.detail) {
      if (typeof opts.detail === 'string') { var d = mkEl('div'); d.innerHTML = opts.detail; detailPane.appendChild(d); }
      else detailPane.appendChild(opts.detail);
    }

    // List item clicks should show detail
    listPane.addEventListener('click', function() {
      wrap.classList.remove('aui-md-show-list');
    });

    wrap.appendChild(listPane);
    wrap.appendChild(detailPane);
    mount(opts.target, wrap);

    return {
      el: wrap,
      destroy: function() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); },
      listPane: listPane,
      detailPane: detailPane
    };
  }

  // ── Portrait ───────────────────────────────────────────
  function Portrait(opts) {
    injectStyles();
    opts = opts || {};
    var wrap = mkEl('div', 'aui-layout aui-portrait');
    if (opts.maxWidth) wrap.style.setProperty('--aui-portrait-max', typeof opts.maxWidth === 'number' ? opts.maxWidth + 'px' : opts.maxWidth);
    if (opts.content) {
      if (typeof opts.content === 'string') wrap.innerHTML = opts.content;
      else wrap.appendChild(opts.content);
    }
    mount(opts.target, wrap);
    return { el: wrap, destroy: function() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } };
  }

  // ── Landscape ──────────────────────────────────────────
  function Landscape(opts) {
    injectStyles();
    opts = opts || {};
    var wrap = mkEl('div', 'aui-layout aui-landscape');
    if (opts.content) {
      if (typeof opts.content === 'string') wrap.innerHTML = opts.content;
      else wrap.appendChild(opts.content);
    }
    mount(opts.target, wrap);
    return { el: wrap, destroy: function() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } };
  }

  // ── Fibonacci ──────────────────────────────────────────
  function Fibonacci(opts) {
    injectStyles();
    opts = opts || {};
    var wrap = mkEl('div', 'aui-layout aui-fibonacci');
    var primary = mkEl('div', 'aui-fibonacci-primary');
    var secondary = mkEl('div', 'aui-fibonacci-secondary');
    if (opts.primary) {
      if (typeof opts.primary === 'string') primary.innerHTML = opts.primary;
      else primary.appendChild(opts.primary);
    }
    if (opts.secondary) {
      if (typeof opts.secondary === 'string') secondary.innerHTML = opts.secondary;
      else secondary.appendChild(opts.secondary);
    }
    wrap.appendChild(primary);
    wrap.appendChild(secondary);
    mount(opts.target, wrap);
    return { el: wrap, destroy: function() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } };
  }

  // ── HolyGrail ─────────────────────────────────────────
  function HolyGrail(opts) {
    injectStyles();
    opts = opts || {};
    var wrap = mkEl('div', 'aui-layout aui-holy-grail');

    var header = mkEl('div', 'aui-holy-grail-header');
    var toggleBtn = mkEl('button', 'aui-hg-toggle');
    toggleBtn.textContent = '\u2630'; // ☰
    toggleBtn.addEventListener('click', function() {
      wrap.classList.toggle('aui-hg-sidebar-open');
      toggleBtn.textContent = wrap.classList.contains('aui-hg-sidebar-open') ? '\u2715' : '\u2630';
    });
    header.appendChild(toggleBtn);
    if (opts.header) {
      if (typeof opts.header === 'string') { var s = mkEl('span'); s.innerHTML = opts.header; header.appendChild(s); }
      else header.appendChild(opts.header);
    }

    var left = mkEl('div', 'aui-holy-grail-left');
    if (opts.left) {
      if (typeof opts.left === 'string') left.innerHTML = opts.left;
      else left.appendChild(opts.left);
    }

    var main = mkEl('div', 'aui-holy-grail-main');
    if (opts.main) {
      if (typeof opts.main === 'string') main.innerHTML = opts.main;
      else main.appendChild(opts.main);
    }

    var right = mkEl('div', 'aui-holy-grail-right');
    if (opts.right) {
      if (typeof opts.right === 'string') right.innerHTML = opts.right;
      else right.appendChild(opts.right);
    }

    var footer = mkEl('div', 'aui-holy-grail-footer');
    if (opts.footer) {
      if (typeof opts.footer === 'string') footer.innerHTML = opts.footer;
      else footer.appendChild(opts.footer);
    }

    wrap.appendChild(header);
    wrap.appendChild(left);
    wrap.appendChild(main);
    wrap.appendChild(right);
    wrap.appendChild(footer);
    mount(opts.target, wrap);

    return { el: wrap, destroy: function() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } };
  }

  // ── Split ──────────────────────────────────────────────
  function Split(opts) {
    injectStyles();
    opts = opts || {};
    var wrap = mkEl('div', 'aui-layout aui-split');

    var ratio = (opts.ratio || '50/50').split('/');
    var leftFlex = parseInt(ratio[0], 10) || 50;
    var rightFlex = parseInt(ratio[1], 10) || 50;

    var leftPane = mkEl('div', 'aui-split-left');
    leftPane.style.flex = '0 0 ' + leftFlex + '%';
    if (opts.left) {
      if (typeof opts.left === 'string') leftPane.innerHTML = opts.left;
      else leftPane.appendChild(opts.left);
    }

    var rightPane = mkEl('div', 'aui-split-right');
    rightPane.style.flex = '0 0 ' + rightFlex + '%';
    if (opts.right) {
      if (typeof opts.right === 'string') rightPane.innerHTML = opts.right;
      else rightPane.appendChild(opts.right);
    }

    wrap.appendChild(leftPane);
    wrap.appendChild(rightPane);
    mount(opts.target, wrap);

    return { el: wrap, destroy: function() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } };
  }

  // ── Stacked ────────────────────────────────────────────
  function Stacked(opts) {
    injectStyles();
    opts = opts || {};
    var wrap = mkEl('div', 'aui-layout aui-stacked');
    (opts.sections || []).forEach(function(section) {
      var s = mkEl('div', 'aui-stacked-section');
      if (typeof section === 'string') s.innerHTML = section;
      else if (section) s.appendChild(section);
      wrap.appendChild(s);
    });
    mount(opts.target, wrap);
    return { el: wrap, destroy: function() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } };
  }

  // ── DashboardGrid ──────────────────────────────────────
  function DashboardGrid(opts) {
    injectStyles();
    opts = opts || {};
    var wrap = mkEl('div', 'aui-layout aui-dashboard-grid');
    if (opts.cols) {
      wrap.style.gridTemplateColumns = 'repeat(' + opts.cols + ', 1fr)';
    } else {
      wrap.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
    }
    (opts.widgets || []).forEach(function(widget) {
      var w = mkEl('div', 'aui-dashboard-grid-widget');
      if (typeof widget === 'string') w.innerHTML = widget;
      else if (widget) w.appendChild(widget);
      wrap.appendChild(w);
    });
    mount(opts.target, wrap);
    return { el: wrap, destroy: function() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } };
  }

  // ── Header ─────────────────────────────────────────────
  function Header(opts) {
    injectStyles();
    opts = opts || {};
    var wrap = mkEl('div', 'aui-header');

    if (opts.logo) {
      var logo = document.createElement('img');
      logo.className = 'aui-header-logo';
      logo.src = opts.logo;
      logo.alt = 'Logo';
      wrap.appendChild(logo);
    }

    if (opts.title) {
      var title = mkEl('h1', 'aui-header-title');
      title.textContent = opts.title;
      wrap.appendChild(title);
    }

    wrap.appendChild(mkEl('div', 'aui-header-spacer'));

    if (opts.actions) {
      var actionsWrap = mkEl('div', 'aui-header-actions');
      (Array.isArray(opts.actions) ? opts.actions : [opts.actions]).forEach(function(a) {
        if (typeof a === 'string') { var btn = mkEl('button', 'aui-btn aui-btn-ghost'); btn.textContent = a; actionsWrap.appendChild(btn); }
        else if (a) actionsWrap.appendChild(a);
      });
      wrap.appendChild(actionsWrap);
    }

    // Shadow on scroll via IntersectionObserver
    var sentinel = document.createElement('div');
    sentinel.style.height = '1px';
    sentinel.style.position = 'absolute';
    sentinel.style.top = '0';
    sentinel.style.left = '0';
    sentinel.style.width = '1px';
    sentinel.style.pointerEvents = 'none';

    var observer = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(function(entries) {
        wrap.classList.toggle('aui-header-shadow', !entries[0].isIntersecting);
      }, { threshold: 1.0 });
    }

    mount(opts.target, sentinel);
    mount(opts.target, wrap);
    if (observer) observer.observe(sentinel);

    return {
      el: wrap,
      destroy: function() {
        if (observer) observer.disconnect();
        if (sentinel.parentNode) sentinel.parentNode.removeChild(sentinel);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }
    };
  }

  // ── Footer ─────────────────────────────────────────────
  function Footer(opts) {
    injectStyles();
    opts = opts || {};
    var wrap = mkEl('div', 'aui-footer');

    if (opts.content) {
      if (typeof opts.content === 'string') { var s = mkEl('span'); s.textContent = opts.content; wrap.appendChild(s); }
      else wrap.appendChild(opts.content);
    }

    if (opts.links) {
      opts.links.forEach(function(link) {
        var a = document.createElement('a');
        a.textContent = link.label || link.text || '';
        a.href = link.href || '#';
        if (link.onClick) a.addEventListener('click', function(e) { e.preventDefault(); link.onClick(); });
        wrap.appendChild(a);
      });
    }

    mount(opts.target, wrap);
    return { el: wrap, destroy: function() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } };
  }

  // ── Register ──────────────────────────────────────────
  var exports = {
    MainDetail: MainDetail,
    Portrait: Portrait,
    Landscape: Landscape,
    Fibonacci: Fibonacci,
    HolyGrail: HolyGrail,
    Split: Split,
    Stacked: Stacked,
    DashboardGrid: DashboardGrid,
    Header: Header,
    Footer: Footer
  };

  AIMEAT.ui = AIMEAT.ui || {};
  AIMEAT.ui.layout = exports;

  if (typeof AIMEAT.register !== 'function') {
    AIMEAT.register = function (name, exp) { AIMEAT[name] = exp; };
  }
  AIMEAT.register('aimeat-ui-layout', exports);

})(window.AIMEAT || (window.AIMEAT = {}));
