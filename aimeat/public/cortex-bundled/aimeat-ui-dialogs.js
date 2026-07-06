/**
 * aimeat-ui-dialogs — Modal dialogs, toasts, alerts, context menus, and dropdowns.
 *
 * Components: Modal, Confirm, toast, Alert, ContextMenu, Dropdown
 * Zero external dependencies — pure DOM API.
 *
 * Usage:
 *   <script src="/v1/cortex/aimeat-ui-dialogs/libs/aimeat-ui-dialogs.js"></script>
 *   <script>
 *     var ok = await AIMEAT.ui.dialogs.Confirm({ message: 'Delete?', danger: true });
 *   </script>
 */
(function (AIMEAT) {
  'use strict';

  // ── CSS ───────────────────────────────────────────────
  var stylesInjected = false;
  var CSS = `
    /* Modal overlay */
    .aui-modal-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000;
      animation: auiFadeIn 0.15s ease;
    }
    @keyframes auiFadeIn { from { opacity: 0 } to { opacity: 1 } }
    @keyframes auiSlideUp { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: translateY(0) } }

    /* Modal box */
    .aui-modal {
      background: var(--bg-card, #fff);
      border-radius: var(--radius, 16px);
      box-shadow: var(--shadow-xl, 0 16px 48px rgba(0,0,0,0.12));
      max-width: 90vw; max-height: 85vh;
      display: flex; flex-direction: column;
      animation: auiSlideUp 0.2s ease;
      font-family: 'DM Sans', system-ui, sans-serif;
      color: var(--text, #1A1A2E);
    }
    .aui-modal--sm { width: 360px }
    .aui-modal--md { width: 480px }
    .aui-modal--lg { width: 640px }

    .aui-modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border, #E5E7EB);
    }
    .aui-modal-header h3 {
      margin: 0; font-size: 1.1rem; font-weight: 600;
      color: var(--text, #1A1A2E);
    }
    .aui-modal-close {
      background: none; border: none; cursor: pointer;
      font-size: 1.25rem; color: var(--text-muted, #9CA3AF);
      padding: 4px 8px; border-radius: var(--radius-xs, 6px);
      transition: background 0.15s, color 0.15s;
    }
    .aui-modal-close:hover {
      background: var(--bg-surface, #F3F4F6);
      color: var(--text, #1A1A2E);
    }
    .aui-modal-body {
      padding: 1.25rem;
      overflow-y: auto; flex: 1;
    }
    .aui-modal-footer {
      display: flex; gap: 0.75rem; justify-content: flex-end;
      padding: 1rem 1.25rem;
      border-top: 1px solid var(--border, #E5E7EB);
    }

    /* Confirm message */
    .aui-confirm-message {
      margin: 0 0 0.5rem; line-height: 1.5;
      color: var(--text, #1A1A2E); font-size: 0.94rem;
    }

    /* Buttons */
    .aui-btn {
      padding: 0.5rem 1rem; border-radius: var(--radius-xs, 6px);
      font-size: 0.875rem; font-weight: 500; cursor: pointer;
      border: 1px solid var(--border, #E5E7EB);
      transition: all 0.15s;
      font-family: inherit;
    }
    .aui-btn-ghost {
      background: transparent; color: var(--text-dim, #6B7280);
    }
    .aui-btn-ghost:hover {
      background: var(--bg-surface, #F3F4F6);
    }
    .aui-btn-primary {
      background: var(--accent, #E8564A); color: white; border-color: transparent;
    }
    .aui-btn-primary:hover {
      filter: brightness(1.1); box-shadow: 0 4px 14px rgba(232,86,74,0.3);
    }
    .aui-btn-danger {
      background: var(--danger, #EF4444); color: white; border-color: transparent;
    }
    .aui-btn-danger:hover {
      filter: brightness(1.1); box-shadow: 0 4px 14px rgba(239,68,68,0.3);
    }

    /* Toast. Container gets width:max-content — a fixed box anchored at left:50%
       otherwise shrink-to-fits against the remaining 50vw, capping toasts at half
       the viewport (badly narrow on phones). */
    .aui-toast-container {
      position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
      display: flex; flex-direction: column-reverse; gap: 0.5rem; align-items: center;
      width: max-content; max-width: 92vw;
      z-index: 10001; pointer-events: none;
    }
    .aui-toast {
      padding: 0.75rem 1.25rem; border-radius: var(--radius-sm, 10px);
      font-size: 0.875rem; font-weight: 500;
      box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.08));
      animation: auiSlideUp 0.2s ease;
      pointer-events: auto; cursor: pointer;
      font-family: 'DM Sans', system-ui, sans-serif;
      max-width: min(92vw, 400px); overflow-wrap: anywhere; box-sizing: border-box;
    }
    .aui-toast-success { background: var(--success, #10B981); color: white }
    .aui-toast-error { background: var(--danger, #EF4444); color: white }
    .aui-toast-info { background: var(--blue, #3B82F6); color: white }
    .aui-toast-warn { background: var(--warn, #F59E0B); color: #1A1A2E }

    /* Alert banner */
    .aui-alert {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.75rem 1rem; border-radius: var(--radius-xs, 6px);
      font-size: 0.875rem; font-family: 'DM Sans', system-ui, sans-serif;
      margin-bottom: 0.75rem;
    }
    .aui-alert-success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0 }
    .aui-alert-error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5 }
    .aui-alert-warn { background: #fef3c7; color: #92400e; border: 1px solid #fde68a }
    .aui-alert-info { background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd }
    .aui-alert-dismiss {
      background: none; border: none; cursor: pointer;
      font-size: 1.1rem; margin-left: auto; opacity: 0.6;
      color: inherit;
    }
    .aui-alert-dismiss:hover { opacity: 1 }

    /* Context menu + Dropdown */
    .aui-context-menu, .aui-dropdown {
      position: fixed;
      background: var(--bg-card, #fff);
      border: 1px solid var(--border, #E5E7EB);
      border-radius: var(--radius-sm, 10px);
      box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.08));
      min-width: 160px; padding: 4px 0;
      z-index: 10002;
      animation: auiSlideUp 0.1s ease;
      font-family: 'DM Sans', system-ui, sans-serif;
    }
    .aui-context-menu-item, .aui-dropdown-item {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.5rem 0.75rem; cursor: pointer;
      font-size: 0.875rem; color: var(--text, #1A1A2E);
      transition: background 0.1s;
      border: none; background: none; width: 100%; text-align: left;
      font-family: inherit;
    }
    .aui-context-menu-item:hover, .aui-dropdown-item:hover {
      background: var(--bg-surface, #F3F4F6);
    }
    .aui-context-menu-item--danger, .aui-dropdown-item--danger {
      color: var(--danger, #EF4444);
    }
    .aui-context-menu-separator, .aui-dropdown-separator {
      height: 1px; background: var(--border, #E5E7EB);
      margin: 4px 0;
    }
    .aui-dropdown-submenu {
      position: relative;
    }
    .aui-dropdown-submenu-items {
      position: absolute; left: 100%; top: 0;
      background: var(--bg-card, #fff);
      border: 1px solid var(--border, #E5E7EB);
      border-radius: var(--radius-sm, 10px);
      box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.08));
      min-width: 140px; padding: 4px 0;
      display: none;
    }
    .aui-dropdown-submenu:hover .aui-dropdown-submenu-items {
      display: block;
    }
  `;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.setAttribute('data-aimeat', 'ui-dialogs');
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

  function mkBtn(label, className, onClick) {
    var b = document.createElement('button');
    b.className = 'aui-btn ' + (className || '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  // Focus trap: tab cycles within container
  function trapFocus(container) {
    function handler(e) {
      if (e.key !== 'Tab') return;
      var focusable = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) { e.preventDefault(); return; }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    container.addEventListener('keydown', handler);
    return function() { container.removeEventListener('keydown', handler); };
  }

  // ── Modal ─────────────────────────────────────────────
  /**
   * Modal({ title?, content, onClose, width? })
   * Returns { el, destroy() }
   */
  function Modal(opts) {
    injectStyles();
    opts = opts || {};
    var sizeClass = 'aui-modal--' + (opts.width || 'md');

    // Overlay
    var overlay = mkEl('div', 'aui-modal-overlay');
    var modal = mkEl('div', 'aui-modal ' + sizeClass);

    // Header (if title given)
    if (opts.title) {
      var header = mkEl('div', 'aui-modal-header');
      var h3 = mkEl('h3', null); h3.id = 'aui-modal-title-' + Date.now(); h3.textContent = opts.title;
      var closeBtn = document.createElement('button');
      closeBtn.className = 'aui-modal-close';
      closeBtn.textContent = '\u2715'; // ✕
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.addEventListener('click', close);
      header.appendChild(h3);
      header.appendChild(closeBtn);
      modal.appendChild(header);
    }

    // Body
    var body = mkEl('div', 'aui-modal-body');
    if (typeof opts.content === 'string') body.innerHTML = opts.content;
    else if (opts.content) body.appendChild(opts.content);
    modal.appendChild(body);

    overlay.appendChild(modal);
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    if (opts.title) overlay.setAttribute('aria-labelledby', h3.id);

    // Backdrop click
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) close();
    });

    // Escape key
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    // Scroll lock
    var prevOverflow = document.body.style.overflow;
    var prevPosition = document.body.style.position;
    var scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + scrollY + 'px';
    document.body.style.width = '100%';

    // Focus trap
    var releaseTrap = trapFocus(modal);

    // Mount
    document.body.appendChild(overlay);
    var firstFocusable = modal.querySelector('button, [href], input, select, textarea');
    if (firstFocusable) firstFocusable.focus();

    var destroyed = false;
    function close() {
      if (destroyed) return;
      destroy();
      if (opts.onClose) opts.onClose();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener('keydown', onKey);
      releaseTrap();
      // Restore scroll
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollY);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    return { el: overlay, destroy: destroy, body: body };
  }

  // ── Confirm ───────────────────────────────────────────
  /**
   * Confirm({ message, title?, confirmLabel?, cancelLabel?, danger? })
   * Returns Promise<boolean>
   */
  function Confirm(opts) {
    opts = opts || {};
    return new Promise(function(resolve) {
      var msg = mkEl('p', 'aui-confirm-message');
      msg.textContent = opts.message || '';

      var footer = mkEl('div', 'aui-modal-footer');
      var cancelBtn = mkBtn(opts.cancelLabel || 'Cancel', 'aui-btn-ghost', function() {
        m.destroy(); resolve(false);
      });
      var confirmBtn = mkBtn(
        opts.confirmLabel || 'Confirm',
        opts.danger ? 'aui-btn-danger' : 'aui-btn-primary',
        function() { m.destroy(); resolve(true); }
      );
      footer.appendChild(cancelBtn);
      footer.appendChild(confirmBtn);

      var content = mkEl('div', null, [msg, footer]);

      var m = Modal({
        title: opts.title,
        content: content,
        onClose: function() { resolve(false); },
        width: 'sm'
      });
    });
  }

  // ── Toast ─────────────────────────────────────────────
  var toastContainer = null;
  var toastQueue = [];
  var activeToasts = [];
  var MAX_VISIBLE = 3;

  function ensureToastContainer() {
    if (toastContainer && toastContainer.parentNode) return;
    toastContainer = mkEl('div', 'aui-toast-container');
    document.body.appendChild(toastContainer);
  }

  function showNextQueued() {
    while (activeToasts.length < MAX_VISIBLE && toastQueue.length > 0) {
      var item = toastQueue.shift();
      showToastEl(item.message, item.type, item.duration);
    }
  }

  function showToastEl(message, type, duration) {
    injectStyles();
    ensureToastContainer();

    var t = mkEl('div', 'aui-toast aui-toast-' + type);
    t.textContent = message;
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');

    t.addEventListener('click', function() { removeToast(t); });
    toastContainer.appendChild(t);
    activeToasts.push(t);

    var timer = setTimeout(function() { removeToast(t); }, duration);
    t._timer = timer;
  }

  function removeToast(t) {
    if (t._timer) clearTimeout(t._timer);
    var idx = activeToasts.indexOf(t);
    if (idx !== -1) activeToasts.splice(idx, 1);
    if (t.parentNode) t.parentNode.removeChild(t);
    showNextQueued();
  }

  /**
   * toast(message, type?)
   * type: 'success' (default) | 'error' | 'info' | 'warn'
   */
  function toast(message, type, duration) {
    type = type || 'success';
    duration = duration || 3000;
    if (activeToasts.length >= MAX_VISIBLE) {
      toastQueue.push({ message: message, type: type, duration: duration });
    } else {
      showToastEl(message, type, duration);
    }
  }

  // ── Alert ─────────────────────────────────────────────
  /**
   * Alert({ message, type, dismissible?, target? })
   * Returns { el, destroy() }
   */
  function Alert(opts) {
    injectStyles();
    opts = opts || {};
    var type = opts.type || 'info';

    var alert = mkEl('div', 'aui-alert aui-alert-' + type);
    alert.setAttribute('role', 'alert');

    var msgSpan = mkEl('span'); msgSpan.textContent = opts.message || '';
    alert.appendChild(msgSpan);

    if (opts.dismissible !== false) {
      var dismiss = document.createElement('button');
      dismiss.className = 'aui-alert-dismiss';
      dismiss.textContent = '\u2715';
      dismiss.setAttribute('aria-label', 'Dismiss');
      dismiss.addEventListener('click', destroy);
      alert.appendChild(dismiss);
    }

    // Mount
    var target = opts.target ? document.querySelector(opts.target) : null;
    if (target) {
      target.insertBefore(alert, target.firstChild);
    }

    function destroy() {
      if (alert.parentNode) alert.parentNode.removeChild(alert);
    }

    return { el: alert, destroy: destroy };
  }

  // ── ContextMenu ───────────────────────────────────────
  /**
   * ContextMenu({ target, items })
   * items: [{ label, icon?, onClick, danger?, type? }]
   * Returns { el, destroy() }
   */
  function ContextMenu(opts) {
    injectStyles();
    opts = opts || {};
    var targetEl = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target;
    if (!targetEl) { console.error('aui: ContextMenu target not found'); return null; }

    var menu = null;
    var longPressTimer = null;

    function buildMenu(x, y) {
      closeMenu();
      menu = mkEl('div', 'aui-context-menu');
      menu.setAttribute('role', 'menu');

      (opts.items || []).forEach(function(item) {
        if (item.type === 'separator') {
          menu.appendChild(mkEl('div', 'aui-context-menu-separator'));
          return;
        }
        var btn = document.createElement('button');
        btn.className = 'aui-context-menu-item' + (item.danger ? ' aui-context-menu-item--danger' : '');
        btn.setAttribute('role', 'menuitem');
        if (item.icon) {
          var iconSpan = mkEl('span'); iconSpan.textContent = item.icon;
          btn.appendChild(iconSpan);
        }
        var labelSpan = mkEl('span'); labelSpan.textContent = item.label;
        btn.appendChild(labelSpan);
        btn.addEventListener('click', function() {
          closeMenu();
          if (item.onClick) item.onClick();
        });
        menu.appendChild(btn);
      });

      // Position: keep within viewport
      document.body.appendChild(menu);
      var rect = menu.getBoundingClientRect();
      if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
      if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
      menu.style.left = Math.max(0, x) + 'px';
      menu.style.top = Math.max(0, y) + 'px';

      // Close handlers
      setTimeout(function() {
        document.addEventListener('click', onDocClick);
        document.addEventListener('keydown', onDocKey);
      }, 0);
    }

    function closeMenu() {
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      menu = null;
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onDocKey);
    }

    function onDocClick() { closeMenu(); }
    function onDocKey(e) { if (e.key === 'Escape') closeMenu(); }

    // Right-click
    function onContext(e) {
      e.preventDefault();
      buildMenu(e.clientX, e.clientY);
    }

    // Long-press (touch)
    function onTouchStart(e) {
      longPressTimer = setTimeout(function() {
        var touch = e.touches[0];
        buildMenu(touch.clientX, touch.clientY);
      }, 500);
    }
    function onTouchEnd() { if (longPressTimer) clearTimeout(longPressTimer); }

    targetEl.addEventListener('contextmenu', onContext);
    targetEl.addEventListener('touchstart', onTouchStart, { passive: true });
    targetEl.addEventListener('touchend', onTouchEnd);
    targetEl.addEventListener('touchmove', onTouchEnd);

    function destroy() {
      closeMenu();
      targetEl.removeEventListener('contextmenu', onContext);
      targetEl.removeEventListener('touchstart', onTouchStart);
      targetEl.removeEventListener('touchend', onTouchEnd);
      targetEl.removeEventListener('touchmove', onTouchEnd);
    }

    return { el: targetEl, destroy: destroy };
  }

  // ── Dropdown ──────────────────────────────────────────
  /**
   * Dropdown({ trigger, items, align? })
   * items: [{ label, onClick, children? }]
   * Returns { el, destroy() }
   */
  function Dropdown(opts) {
    injectStyles();
    opts = opts || {};
    var triggerEl = typeof opts.trigger === 'string' ? document.querySelector(opts.trigger) : opts.trigger;
    if (!triggerEl) { console.error('aui: Dropdown trigger not found'); return null; }

    var menu = null;

    function buildItem(item) {
      if (item.type === 'separator') return mkEl('div', 'aui-dropdown-separator');

      if (item.children && item.children.length) {
        var sub = mkEl('div', 'aui-dropdown-submenu aui-dropdown-item');
        sub.textContent = item.label + ' \u25B8';
        var subItems = mkEl('div', 'aui-dropdown-submenu-items');
        item.children.forEach(function(child) { subItems.appendChild(buildItem(child)); });
        sub.appendChild(subItems);
        return sub;
      }

      var btn = document.createElement('button');
      btn.className = 'aui-dropdown-item';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = item.label;
      btn.addEventListener('click', function() {
        closeMenu();
        if (item.onClick) item.onClick();
      });
      return btn;
    }

    function openMenu() {
      closeMenu();
      menu = mkEl('div', 'aui-dropdown');
      menu.setAttribute('role', 'menu');
      (opts.items || []).forEach(function(item) { menu.appendChild(buildItem(item)); });
      document.body.appendChild(menu);

      // Position relative to trigger
      var tr = triggerEl.getBoundingClientRect();
      var align = opts.align || 'left';
      menu.style.top = (tr.bottom + 4) + 'px';
      if (align === 'right') {
        menu.style.right = (window.innerWidth - tr.right) + 'px';
      } else {
        menu.style.left = tr.left + 'px';
      }

      // Auto-flip if near bottom
      var mr = menu.getBoundingClientRect();
      if (mr.bottom > window.innerHeight) {
        menu.style.top = (tr.top - mr.height - 4) + 'px';
      }

      setTimeout(function() {
        document.addEventListener('click', onDocClick);
        document.addEventListener('keydown', onDocKey);
      }, 0);
    }

    function closeMenu() {
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      menu = null;
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onDocKey);
    }

    function onDocClick(e) {
      if (menu && !menu.contains(e.target) && !triggerEl.contains(e.target)) closeMenu();
    }
    function onDocKey(e) { if (e.key === 'Escape') closeMenu(); }

    function onTriggerClick(e) {
      e.stopPropagation();
      if (menu) closeMenu(); else openMenu();
    }
    triggerEl.addEventListener('click', onTriggerClick);

    function destroy() {
      closeMenu();
      triggerEl.removeEventListener('click', onTriggerClick);
    }

    return { el: triggerEl, destroy: destroy };
  }

  // ── Register ──────────────────────────────────────────
  var exports = {
    Modal: Modal,
    Confirm: Confirm,
    toast: toast,
    Alert: Alert,
    ContextMenu: ContextMenu,
    Dropdown: Dropdown
  };

  AIMEAT.ui = AIMEAT.ui || {};
  AIMEAT.ui.dialogs = exports;

  if (typeof AIMEAT.register !== 'function') {
    AIMEAT.register = function (name, exp) { AIMEAT[name] = exp; };
  }
  AIMEAT.register('aimeat-ui-dialogs', exports);

})(window.AIMEAT || (window.AIMEAT = {}));
