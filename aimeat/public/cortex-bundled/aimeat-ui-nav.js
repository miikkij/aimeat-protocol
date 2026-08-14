/**
 * aimeat-ui-nav — Navigation components: tabs, breadcrumbs, sidebar, bottom nav, burger menu.
 *
 * Components: Tabs, Breadcrumbs, Sidebar, BottomNav, BurgerMenu
 * Zero external dependencies — pure DOM API.
 *
 * Usage:
 *   <script src="/v1/cortex/aimeat-ui-nav/libs/aimeat-ui-nav.js"></script>
 *   <script>
 *     var tabs = AIMEAT.ui.nav.Tabs({ target: '#app', tabs: [{id:'a', label:'Tab A'}], onChange: fn });
 *   </script>
 */
(function (AIMEAT) {
  'use strict';

  // ── CSS ───────────────────────────────────────────────
  var stylesInjected = false;
  var CSS = [
    /* ── Tabs ─────────────────────────────────────────── */
    '.aui-tabs {',
    '  container-type: inline-size;',
    '  font-family: "DM Sans", system-ui, sans-serif;',
    '}',
    '.aui-tabs-list {',
    '  display: flex; overflow-x: auto; gap: 0;',
    '  border-bottom: 1px solid var(--border, #E5E7EB);',
    '  scrollbar-width: thin;',
    '}',
    '.aui-tabs-list::-webkit-scrollbar { height: 3px }',
    '.aui-tabs-list::-webkit-scrollbar-thumb { background: var(--border, #E5E7EB); border-radius: 3px }',
    '.aui-tab {',
    '  position: relative;',
    '  padding: 0.625rem 1rem; white-space: nowrap;',
    '  background: none; border: none; cursor: pointer;',
    '  font-size: 0.875rem; font-weight: 500;',
    '  color: var(--text-dim, #6B7280);',
    '  font-family: inherit;',
    '  transition: color 0.15s;',
    '  display: flex; align-items: center; gap: 0.375rem;',
    '}',
    '.aui-tab:hover { color: var(--text, #1A1A2E) }',
    '.aui-tab[aria-selected="true"] { color: var(--accent, #E8564A); font-weight: 600 }',
    '.aui-tab[aria-selected="true"]::after {',
    '  content: ""; position: absolute; bottom: -1px; left: 0; right: 0;',
    '  height: 2px; background: var(--accent, #E8564A);',
    '  border-radius: 2px 2px 0 0;',
    '}',
    '.aui-tab-icon { font-size: 1rem }',

    /* ── Breadcrumbs ──────────────────────────────────── */
    '.aui-breadcrumbs {',
    '  container-type: inline-size;',
    '  font-family: "DM Sans", system-ui, sans-serif;',
    '}',
    '.aui-breadcrumbs-list {',
    '  display: flex; align-items: center; flex-wrap: wrap;',
    '  gap: 0.25rem; padding: 0; margin: 0; list-style: none;',
    '  font-size: 0.875rem; color: var(--text-dim, #6B7280);',
    '}',
    '.aui-breadcrumb-item a {',
    '  color: var(--accent, #E8564A); text-decoration: none;',
    '  transition: opacity 0.15s;',
    '}',
    '.aui-breadcrumb-item a:hover { opacity: 0.8 }',
    '.aui-breadcrumb-item--active { font-weight: 600; color: var(--text, #1A1A2E) }',
    '.aui-breadcrumb-sep { color: var(--text-dim, #6B7280); user-select: none }',

    /* ── Sidebar ──────────────────────────────────────── */
    '.aui-sidebar-wrap {',
    '  container-type: inline-size;',
    '  font-family: "DM Sans", system-ui, sans-serif;',
    '}',
    '.aui-sidebar {',
    '  display: flex; flex-direction: column;',
    '  background: var(--bg-card, #fff);',
    '  border-right: 1px solid var(--border, #E5E7EB);',
    '  width: 240px; min-height: 100%;',
    '  transition: width 0.2s ease;',
    '  overflow: hidden;',
    '}',
    '.aui-sidebar--collapsed { width: 56px }',
    '.aui-sidebar-item {',
    '  display: flex; align-items: center; gap: 0.625rem;',
    '  padding: 0.5rem 0.75rem;',
    '  background: none; border: none; cursor: pointer;',
    '  font-size: 0.875rem; color: var(--text, #1A1A2E);',
    '  font-family: inherit; width: 100%; text-align: left;',
    '  transition: background 0.15s;',
    '  white-space: nowrap; position: relative;',
    '}',
    '.aui-sidebar-item:hover { background: var(--bg-surface, #F3F4F6) }',
    '.aui-sidebar-item--active {',
    '  color: var(--accent, #E8564A); font-weight: 600;',
    '  background: rgba(232, 86, 74, 0.06);',
    '}',
    '.aui-sidebar-item-icon { font-size: 1.1rem; flex-shrink: 0; width: 1.25rem; text-align: center }',
    '.aui-sidebar-item-label { overflow: hidden; text-overflow: ellipsis }',
    '.aui-sidebar--collapsed .aui-sidebar-item-label { display: none }',
    '.aui-sidebar--collapsed .aui-sidebar-item {',
    '  justify-content: center; padding: 0.5rem;',
    '}',
    '.aui-sidebar-arrow {',
    '  margin-left: auto; font-size: 0.7rem;',
    '  transition: transform 0.2s; flex-shrink: 0;',
    '}',
    '.aui-sidebar-arrow--open { transform: rotate(90deg) }',
    '.aui-sidebar--collapsed .aui-sidebar-arrow { display: none }',
    '.aui-sidebar-children {',
    '  display: none; padding-left: 1.5rem;',
    '}',
    '.aui-sidebar-children--open { display: block }',
    '.aui-sidebar--collapsed .aui-sidebar-children { display: none }',

    /* Sidebar overlay mode for small containers */
    '.aui-sidebar-overlay {',
    '  position: fixed; inset: 0; z-index: 9999;',
    '  background: rgba(0,0,0,0.4);',
    '  animation: auiNavFadeIn 0.15s ease;',
    '}',
    '.aui-sidebar--overlay {',
    '  position: fixed; left: 0; top: 0; bottom: 0;',
    '  z-index: 10000; width: 260px;',
    '  box-shadow: var(--shadow-xl, 0 16px 48px rgba(0,0,0,0.12));',
    '  animation: auiNavSlideRight 0.2s ease;',
    '}',

    '@keyframes auiNavFadeIn { from { opacity: 0 } to { opacity: 1 } }',
    '@keyframes auiNavSlideRight { from { transform: translateX(-100%) } to { transform: translateX(0) } }',
    '@keyframes auiNavSlideLeft { from { transform: translateX(100%) } to { transform: translateX(0) } }',

    /* ── BottomNav ─────────────────────────────────────── */
    '.aui-bottomnav-wrap {',
    '  container-type: inline-size;',
    '  font-family: "DM Sans", system-ui, sans-serif;',
    '}',
    '.aui-bottomnav {',
    '  display: flex; justify-content: space-around; align-items: center;',
    '  background: var(--bg-card, #fff);',
    '  border-top: 1px solid var(--border, #E5E7EB);',
    '  box-shadow: 0 -4px 12px rgba(0,0,0,0.05);',
    '  padding: 0.375rem 0;',
    '  position: fixed; bottom: 0; left: 0; right: 0;',
    '  z-index: 9000;',
    '}',
    '@container (min-width: 769px) {',
    '  .aui-bottomnav { display: none }',
    '}',
    '.aui-bottomnav-item {',
    '  display: flex; flex-direction: column; align-items: center;',
    '  gap: 0.125rem; padding: 0.25rem 0.5rem;',
    '  background: none; border: none; cursor: pointer;',
    '  color: var(--text-dim, #6B7280); font-family: inherit;',
    '  font-size: 0.625rem; position: relative;',
    '  transition: color 0.15s;',
    '}',
    '.aui-bottomnav-item:hover { color: var(--text, #1A1A2E) }',
    '.aui-bottomnav-item--active { color: var(--accent, #E8564A); font-weight: 600 }',
    '.aui-bottomnav-icon { font-size: 1.25rem }',
    '.aui-bottomnav-label { white-space: nowrap }',
    '.aui-bottomnav-badge {',
    '  position: absolute; top: 0; right: 0;',
    '  background: var(--accent, #E8564A); color: #fff;',
    '  font-size: 0.6rem; font-weight: 700;',
    '  min-width: 16px; height: 16px;',
    '  border-radius: 999px; display: flex; align-items: center; justify-content: center;',
    '  padding: 0 4px; line-height: 1;',
    '}',

    /* ── BurgerMenu ────────────────────────────────────── */
    '.aui-burger-wrap {',
    '  container-type: inline-size;',
    '  font-family: "DM Sans", system-ui, sans-serif;',
    '}',
    '.aui-burger-btn {',
    '  background: none; border: none; cursor: pointer;',
    '  width: 36px; height: 36px;',
    '  display: flex; flex-direction: column; align-items: center; justify-content: center;',
    '  gap: 5px; padding: 6px;',
    '}',
    '.aui-burger-line {',
    '  display: block; width: 22px; height: 2px;',
    '  background: var(--text, #1A1A2E);',
    '  border-radius: 2px;',
    '  transition: transform 0.25s ease, opacity 0.2s ease;',
    '}',
    '.aui-burger-btn--open .aui-burger-line:nth-child(1) {',
    '  transform: translateY(7px) rotate(45deg);',
    '}',
    '.aui-burger-btn--open .aui-burger-line:nth-child(2) {',
    '  opacity: 0;',
    '}',
    '.aui-burger-btn--open .aui-burger-line:nth-child(3) {',
    '  transform: translateY(-7px) rotate(-45deg);',
    '}',
    '.aui-burger-overlay {',
    '  position: fixed; inset: 0; z-index: 9998;',
    '  background: rgba(0,0,0,0.4);',
    '  animation: auiNavFadeIn 0.15s ease;',
    '}',
    '.aui-burger-panel {',
    '  position: fixed; top: 0; bottom: 0;',
    '  width: 280px; max-width: 85vw;',
    '  background: var(--bg-card, #fff);',
    '  box-shadow: var(--shadow-xl, 0 16px 48px rgba(0,0,0,0.12));',
    '  z-index: 9999;',
    '  display: flex; flex-direction: column;',
    '  overflow-y: auto;',
    '}',
    '.aui-burger-panel--left {',
    '  left: 0; animation: auiNavSlideRight 0.2s ease;',
    '}',
    '.aui-burger-panel--right {',
    '  right: 0; animation: auiNavSlideLeft 0.2s ease;',
    '}',
    '.aui-burger-logo {',
    '  padding: 1rem 1.25rem;',
    '  border-bottom: 1px solid var(--border, #E5E7EB);',
    '  font-size: 1.1rem; font-weight: 600;',
    '  color: var(--text, #1A1A2E);',
    '  display: flex; align-items: center; gap: 0.5rem;',
    '}',
    '.aui-burger-item {',
    '  display: flex; align-items: center; gap: 0.625rem;',
    '  padding: 0.625rem 1.25rem;',
    '  background: none; border: none; cursor: pointer;',
    '  font-size: 0.9rem; color: var(--text, #1A1A2E);',
    '  font-family: inherit; width: 100%; text-align: left;',
    '  transition: background 0.15s;',
    '}',
    '.aui-burger-item:hover { background: var(--bg-surface, #F3F4F6) }',
    '.aui-burger-item--active {',
    '  color: var(--accent, #E8564A); font-weight: 600;',
    '  background: rgba(232, 86, 74, 0.06);',
    '}',
    '.aui-burger-item-icon { font-size: 1.1rem; width: 1.25rem; text-align: center }',
    '.aui-burger-arrow {',
    '  margin-left: auto; font-size: 0.7rem;',
    '  transition: transform 0.2s;',
    '}',
    '.aui-burger-arrow--open { transform: rotate(90deg) }',
    '.aui-burger-children {',
    '  display: none; padding-left: 1.5rem;',
    '}',
    '.aui-burger-children--open { display: block }'
  ].join('\n');

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.setAttribute('data-aimeat', 'ui-nav');
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

  // ── Tabs ──────────────────────────────────────────────
  /**
   * Tabs({ target, tabs, active?, onChange? })
   * tabs: [{ id, label, icon? }]
   * Returns { el, destroy() }
   */
  function Tabs(opts) {
    injectStyles();
    opts = opts || {};
    var targetEl = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target;
    var activeId = opts.active || (opts.tabs && opts.tabs.length ? opts.tabs[0].id : null);

    var wrap = mkEl('div', 'aui-tabs');
    var list = mkEl('div', 'aui-tabs-list');
    list.setAttribute('role', 'tablist');

    var tabBtns = [];

    function renderTabs() {
      list.innerHTML = '';
      tabBtns = [];
      (opts.tabs || []).forEach(function(tab) {
        var btn = document.createElement('button');
        btn.className = 'aui-tab';
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', tab.id === activeId ? 'true' : 'false');
        btn.setAttribute('data-tab-id', tab.id);
        if (tab.icon) {
          var iconSpan = mkEl('span', 'aui-tab-icon');
          iconSpan.textContent = tab.icon;
          btn.appendChild(iconSpan);
        }
        var labelSpan = mkEl('span');
        labelSpan.textContent = tab.label;
        btn.appendChild(labelSpan);
        btn.addEventListener('click', function() {
          activeId = tab.id;
          updateActive();
          if (opts.onChange) opts.onChange(tab.id);
        });
        list.appendChild(btn);
        tabBtns.push(btn);
      });
    }

    function updateActive() {
      tabBtns.forEach(function(btn) {
        var id = btn.getAttribute('data-tab-id');
        btn.setAttribute('aria-selected', id === activeId ? 'true' : 'false');
      });
    }

    renderTabs();
    wrap.appendChild(list);

    if (targetEl) targetEl.appendChild(wrap);

    function destroy() {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    return { el: wrap, destroy: destroy };
  }

  // ── Breadcrumbs ───────────────────────────────────────
  /**
   * Breadcrumbs({ target, items, separator? })
   * items: [{ label, href?, onClick? }]
   * Returns { el, destroy() }
   */
  function Breadcrumbs(opts) {
    injectStyles();
    opts = opts || {};
    var targetEl = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target;
    var separator = opts.separator || ' / ';

    var nav = document.createElement('nav');
    nav.className = 'aui-breadcrumbs';
    nav.setAttribute('aria-label', 'Breadcrumb');

    var ol = mkEl('ol', 'aui-breadcrumbs-list');
    var items = opts.items || [];

    items.forEach(function(item, idx) {
      var isLast = idx === items.length - 1;
      var li = mkEl('li', 'aui-breadcrumb-item' + (isLast ? ' aui-breadcrumb-item--active' : ''));

      if (isLast) {
        var span = mkEl('span');
        span.textContent = item.label;
        span.setAttribute('aria-current', 'page');
        li.appendChild(span);
      } else {
        if (item.href || item.onClick) {
          var a = document.createElement('a');
          a.href = item.href || '#';
          a.textContent = item.label;
          if (item.onClick) {
            a.addEventListener('click', function(e) {
              e.preventDefault();
              item.onClick();
            });
          }
          li.appendChild(a);
        } else {
          var txt = mkEl('span');
          txt.textContent = item.label;
          li.appendChild(txt);
        }
      }

      ol.appendChild(li);

      if (!isLast) {
        var sep = mkEl('li', 'aui-breadcrumb-sep');
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = separator;
        ol.appendChild(sep);
      }
    });

    nav.appendChild(ol);
    if (targetEl) targetEl.appendChild(nav);

    function destroy() {
      if (nav.parentNode) nav.parentNode.removeChild(nav);
    }

    return { el: nav, destroy: destroy };
  }

  // ── Sidebar ───────────────────────────────────────────
  /**
   * Sidebar({ target, items, collapsed?, onToggle? })
   * items: [{ label, icon?, href?, onClick?, active?, children? }]
   * Returns { el, destroy(), collapse(bool), openOverlay(), closeOverlay() }
   */
  function Sidebar(opts) {
    injectStyles();
    opts = opts || {};
    var targetEl = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target;
    var collapsed = !!opts.collapsed;
    var overlayEl = null;
    var isOverlay = false;

    var wrap = mkEl('div', 'aui-sidebar-wrap');
    var sidebar = mkEl('div', 'aui-sidebar' + (collapsed ? ' aui-sidebar--collapsed' : ''));
    sidebar.setAttribute('role', 'navigation');

    function buildItems(items, parentEl) {
      (items || []).forEach(function(item) {
        var hasChildren = item.children && item.children.length;
        var btn = document.createElement('button');
        btn.className = 'aui-sidebar-item' + (item.active ? ' aui-sidebar-item--active' : '');

        if (collapsed && item.icon) {
          btn.setAttribute('title', item.label);
        }

        if (item.icon) {
          var iconSpan = mkEl('span', 'aui-sidebar-item-icon');
          iconSpan.textContent = item.icon;
          btn.appendChild(iconSpan);
        }

        var labelSpan = mkEl('span', 'aui-sidebar-item-label');
        labelSpan.textContent = item.label;
        btn.appendChild(labelSpan);

        if (hasChildren) {
          var arrow = mkEl('span', 'aui-sidebar-arrow');
          arrow.textContent = '\u25B8';
          btn.appendChild(arrow);
        }

        parentEl.appendChild(btn);

        if (hasChildren) {
          var childWrap = mkEl('div', 'aui-sidebar-children');
          buildItems(item.children, childWrap);
          parentEl.appendChild(childWrap);

          btn.addEventListener('click', function() {
            var open = childWrap.classList.contains('aui-sidebar-children--open');
            childWrap.classList.toggle('aui-sidebar-children--open', !open);
            arrow.classList.toggle('aui-sidebar-arrow--open', !open);
          });
        } else {
          btn.addEventListener('click', function() {
            if (item.onClick) item.onClick();
            if (item.href) window.location.href = item.href;
            if (isOverlay) closeOverlay();
          });
        }
      });
    }

    function render() {
      sidebar.innerHTML = '';
      buildItems(opts.items, sidebar);
    }

    function closeOverlay() {
      if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
      overlayEl = null;
      sidebar.classList.remove('aui-sidebar--overlay');
      isOverlay = false;
      document.removeEventListener('keydown', onOverlayKey);
      // Re-attach sidebar to wrap
      if (!wrap.contains(sidebar)) wrap.appendChild(sidebar);
    }

    function onOverlayKey(e) {
      if (e.key === 'Escape') closeOverlay();
    }

    function openOverlay() {
      closeOverlay();
      isOverlay = true;
      overlayEl = mkEl('div', 'aui-sidebar-overlay');
      overlayEl.addEventListener('click', closeOverlay);
      document.body.appendChild(overlayEl);
      sidebar.classList.add('aui-sidebar--overlay');
      document.body.appendChild(sidebar);
      document.addEventListener('keydown', onOverlayKey);
    }

    render();
    wrap.appendChild(sidebar);
    if (targetEl) targetEl.appendChild(wrap);

    function destroy() {
      closeOverlay();
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      if (sidebar.parentNode) sidebar.parentNode.removeChild(sidebar);
    }

    return {
      el: wrap,
      destroy: destroy,
      collapse: function(val) {
        collapsed = val;
        sidebar.classList.toggle('aui-sidebar--collapsed', collapsed);
        if (opts.onToggle) opts.onToggle(collapsed);
      },
      openOverlay: openOverlay,
      closeOverlay: closeOverlay
    };
  }

  // ── BottomNav ─────────────────────────────────────────
  /**
   * BottomNav({ target, items, active? })
   * items: [{ label, icon?, onClick?, active?, badge? }] — max 5
   * Returns { el, destroy() }
   */
  function BottomNav(opts) {
    injectStyles();
    opts = opts || {};
    var targetEl = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target;
    var items = (opts.items || []).slice(0, 5);

    var wrap = mkEl('div', 'aui-bottomnav-wrap');
    var bar = mkEl('div', 'aui-bottomnav');
    bar.setAttribute('role', 'navigation');

    items.forEach(function(item) {
      var btn = document.createElement('button');
      btn.className = 'aui-bottomnav-item' + (item.active ? ' aui-bottomnav-item--active' : '');

      if (item.icon) {
        var iconSpan = mkEl('span', 'aui-bottomnav-icon');
        iconSpan.textContent = item.icon;
        btn.appendChild(iconSpan);
      }

      var labelSpan = mkEl('span', 'aui-bottomnav-label');
      labelSpan.textContent = item.label;
      btn.appendChild(labelSpan);

      if (item.badge) {
        var badge = mkEl('span', 'aui-bottomnav-badge');
        badge.textContent = item.badge;
        btn.appendChild(badge);
      }

      btn.addEventListener('click', function() {
        if (item.onClick) item.onClick();
      });

      bar.appendChild(btn);
    });

    wrap.appendChild(bar);
    if (targetEl) targetEl.appendChild(wrap);

    function destroy() {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    return { el: wrap, destroy: destroy };
  }

  // ── BurgerMenu ────────────────────────────────────────
  /**
   * BurgerMenu({ target, items, logo?, side? })
   * items: [{ label, icon?, href?, onClick?, active?, children? }]
   * side: 'left' (default) | 'right'
   * Returns { el, destroy() }
   */
  function BurgerMenu(opts) {
    injectStyles();
    opts = opts || {};
    var targetEl = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target;
    var side = opts.side || 'left';
    var isOpen = false;
    var overlayEl = null;
    var panelEl = null;

    var wrap = mkEl('div', 'aui-burger-wrap');

    // Burger button (3 lines -> X)
    var btn = document.createElement('button');
    btn.className = 'aui-burger-btn';
    btn.setAttribute('aria-label', 'Menu');
    btn.setAttribute('aria-expanded', 'false');
    var line1 = mkEl('span', 'aui-burger-line');
    var line2 = mkEl('span', 'aui-burger-line');
    var line3 = mkEl('span', 'aui-burger-line');
    btn.appendChild(line1);
    btn.appendChild(line2);
    btn.appendChild(line3);

    function buildMenuItems(items, parentEl) {
      (items || []).forEach(function(item) {
        var hasChildren = item.children && item.children.length;
        var itemBtn = document.createElement('button');
        itemBtn.className = 'aui-burger-item' + (item.active ? ' aui-burger-item--active' : '');

        if (item.icon) {
          var iconSpan = mkEl('span', 'aui-burger-item-icon');
          iconSpan.textContent = item.icon;
          itemBtn.appendChild(iconSpan);
        }

        var labelSpan = mkEl('span');
        labelSpan.textContent = item.label;
        itemBtn.appendChild(labelSpan);

        if (hasChildren) {
          var arrow = mkEl('span', 'aui-burger-arrow');
          arrow.textContent = '\u25B8';
          itemBtn.appendChild(arrow);
        }

        parentEl.appendChild(itemBtn);

        if (hasChildren) {
          var childWrap = mkEl('div', 'aui-burger-children');
          buildMenuItems(item.children, childWrap);
          parentEl.appendChild(childWrap);

          itemBtn.addEventListener('click', function() {
            var open = childWrap.classList.contains('aui-burger-children--open');
            childWrap.classList.toggle('aui-burger-children--open', !open);
            arrow.classList.toggle('aui-burger-arrow--open', !open);
          });
        } else {
          itemBtn.addEventListener('click', function() {
            if (item.onClick) item.onClick();
            if (item.href) window.location.href = item.href;
            closePanel();
          });
        }
      });
    }

    function openPanel() {
      if (isOpen) return;
      isOpen = true;
      btn.classList.add('aui-burger-btn--open');
      btn.setAttribute('aria-expanded', 'true');

      overlayEl = mkEl('div', 'aui-burger-overlay');
      overlayEl.addEventListener('click', closePanel);
      document.body.appendChild(overlayEl);

      panelEl = mkEl('div', 'aui-burger-panel aui-burger-panel--' + side);

      if (opts.logo) {
        var logoEl = mkEl('div', 'aui-burger-logo');
        if (typeof opts.logo === 'string') {
          logoEl.textContent = opts.logo;
        } else {
          logoEl.appendChild(opts.logo);
        }
        panelEl.appendChild(logoEl);
      }

      buildMenuItems(opts.items, panelEl);
      document.body.appendChild(panelEl);
      document.addEventListener('keydown', onKey);
    }

    function closePanel() {
      if (!isOpen) return;
      isOpen = false;
      btn.classList.remove('aui-burger-btn--open');
      btn.setAttribute('aria-expanded', 'false');
      if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
      if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
      overlayEl = null;
      panelEl = null;
      document.removeEventListener('keydown', onKey);
    }

    function onKey(e) {
      if (e.key === 'Escape') closePanel();
    }

    btn.addEventListener('click', function() {
      if (isOpen) closePanel(); else openPanel();
    });

    wrap.appendChild(btn);
    if (targetEl) targetEl.appendChild(wrap);

    function destroy() {
      closePanel();
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    return { el: wrap, destroy: destroy };
  }

  // ── Register ──────────────────────────────────────────
  var exports = {
    Tabs: Tabs,
    Breadcrumbs: Breadcrumbs,
    Sidebar: Sidebar,
    BottomNav: BottomNav,
    BurgerMenu: BurgerMenu
  };

  AIMEAT.ui = AIMEAT.ui || {};
  AIMEAT.ui.nav = exports;

  if (typeof AIMEAT.register !== 'function') {
    AIMEAT.register = function (name, exp) { AIMEAT[name] = exp; };
  }
  AIMEAT.register('aimeat-ui-nav', exports);

})(window.AIMEAT || (window.AIMEAT = {}));
