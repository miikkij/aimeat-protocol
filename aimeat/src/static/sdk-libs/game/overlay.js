/**
 * @file game/overlay.js
 * @description The three things that appear over a view: the modal dialog, the transient toast,
 *   and the promise-returning confirm for anything irreversible.
 *
 *   CORRECT AT A SHORT VIEWPORT. The dialog centres with `margin: auto` inside a scrolling
 *   container instead of `align-items: center`, so at 1280x460 its top edge stays on screen and
 *   the close control stays reachable. The stylesheet carries that rule; this file only makes
 *   sure the structure it needs exists.
 *
 *   FOCUS is taken on open and given back on close, Escape closes a dismissible dialog, and Tab
 *   is kept inside it — a dialog you can Tab out of behind the scrim is worse than no dialog.
 * @structure modal(spec) · toast(msg, kind, opts) · confirm(spec) → Promise<boolean>
 * @usage  const ok = await AIMEAT.game.confirm({ title: 'Delete run?', danger: true });
 *         AIMEAT.game.toast('Saved', 'ok');
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 01).
 */
import { el, append, clear, uid } from './dom.js';
import { t } from './i18n.js';

/** Elements that can hold focus inside a dialog. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** The mark shown on a toast, per kind. Functional glyphs only. */
const TOAST_MARK = { ok: '✓', err: '✗', warn: '!', info: 'i' };

/**
 * @typedef {object} OverlayAction
 * @property {string} id
 * @property {string} label
 * @property {'primary'|'ghost'|'danger'|'plain'} [kind]
 * @property {(action: OverlayAction) => void} [onClick]
 */

/**
 * An overlay dialog.
 * @param {{
 *   title: string, body?: any, actions?: OverlayAction[], onClose?: () => void,
 *   dismissible?: boolean, closeLabel?: string
 * }} spec
 * @returns {{ el: HTMLElement, body: HTMLElement, set: (patch: any) => void, close: () => void, destroy: () => void }}
 */
export function modal(spec) {
  const dismissible = spec.dismissible !== false;
  const titleId = uid('ag-modal-title');
  const returnTo = /** @type {HTMLElement|null} */ (document.activeElement);

  const heading = el('h2', { class: 'ag-title', id: titleId, text: spec.title });
  const closeBtn = el('button', {
    type: 'button', class: 'ag-btn ag-btn--ghost', 'aria-label': spec.closeLabel || t('close'),
    on: { click: function () { api.close(); } },
  }, '✗');
  const head = el('div', { class: 'ag-modal__head' }, [heading, dismissible ? closeBtn : null]);

  const body = el('div', { class: 'ag-modal__body ag-scroll' });
  if (spec.body != null) append(body, spec.body);

  const bar = el('div', { class: 'ag-modal__actions' });

  const dialog = el('div', {
    class: 'ag-modal__dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1',
  }, [head, body, bar]);

  const root = el('div', {
    class: 'ag-root ag-modal',
    on: {
      mousedown: function (ev) { if (dismissible && ev.target === root) api.close(); },
      keydown: onKey,
    },
  }, dialog);

  document.body.appendChild(root);
  dialog.focus();

  /** @param {KeyboardEvent} ev */
  function onKey(ev) {
    if (ev.key === 'Escape' && dismissible) { ev.preventDefault(); api.close(); return; }
    if (ev.key !== 'Tab') return;
    const items = /** @type {HTMLElement[]} */ (Array.prototype.slice.call(dialog.querySelectorAll(FOCUSABLE)))
      .filter(function (n) { return !(/** @type {HTMLButtonElement} */ (n).disabled); });
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  /** @param {OverlayAction[]} actions */
  function renderActions(actions) {
    clear(bar);
    for (const action of actions) {
      const kind = action.kind || 'plain';
      bar.appendChild(el('button', {
        type: 'button',
        class: 'ag-btn' + (kind === 'plain' ? '' : ' ag-btn--' + kind),
        'data-ag-id': action.id,
        on: { click: function () { if (action.onClick) action.onClick(action); } },
      }, action.label));
    }
  }

  renderActions(spec.actions || []);

  const api = {
    el: root,
    body: body,

    /** @param {{ title?: string, body?: any, actions?: OverlayAction[] }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.title != null) heading.textContent = patch.title;
      if (patch.body !== undefined) { clear(body); append(body, patch.body); }
      if (patch.actions) renderActions(patch.actions);
    },

    close() {
      api.destroy();
      if (spec.onClose) spec.onClose();
    },

    destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
      if (returnTo && typeof returnTo.focus === 'function') returnTo.focus();
    },
  };

  return api;
}

/** The lazily created stack every toast lands in. @returns {HTMLElement} */
function toastHost() {
  let host = document.getElementById('ag-toasts');
  if (!host) {
    host = el('div', { class: 'ag-root ag-toasts', id: 'ag-toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  return /** @type {HTMLElement} */ (host);
}

/**
 * Transient feedback.
 * @param {string} msg
 * @param {'info'|'ok'|'warn'|'err'} [kind]
 * @param {{ ms?: number }} [opts]  Time on screen (default 3200ms; 0 keeps it until closed).
 * @returns {{ el: HTMLElement, close: () => void }}
 */
export function toast(msg, kind, opts) {
  const k = kind || 'info';
  const node = el('div', { class: 'ag-toast ag-toast--' + k }, [
    el('span', { class: 'ag-toast__mark', text: TOAST_MARK[k] || 'i', 'aria-hidden': 'true' }),
    el('span', { text: msg }),
  ]);
  toastHost().appendChild(node);
  const close = function () { if (node.parentNode) node.parentNode.removeChild(node); };
  const ms = opts && opts.ms != null ? opts.ms : 3200;
  if (ms > 0) setTimeout(close, ms);
  return { el: node, close: close };
}

/**
 * Ask before something irreversible. Resolves true on confirm, false on cancel/dismiss.
 * @param {{
 *   title: string, body?: any, confirmLabel?: string, cancelLabel?: string, danger?: boolean
 * }} spec
 * @returns {Promise<boolean>}
 */
export function confirm(spec) {
  return new Promise(function (resolveWith) {
    let settled = false;
    /** @param {boolean} answer */
    const finish = function (answer) {
      if (settled) return;
      settled = true;
      resolveWith(answer);
    };
    const dialog = modal({
      title: spec.title,
      body: spec.body,
      onClose: function () { finish(false); },
      actions: [
        {
          id: 'cancel', label: spec.cancelLabel || t('cancel'), kind: 'ghost',
          onClick: function () { finish(false); dialog.destroy(); },
        },
        {
          id: 'confirm', label: spec.confirmLabel || t('confirm'), kind: spec.danger ? 'danger' : 'primary',
          onClick: function () { finish(true); dialog.destroy(); },
        },
      ],
    });
  });
}
