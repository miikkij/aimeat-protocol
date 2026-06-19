/**
 * @file Modal.js
 * @description Reusable modal and confirm dialog components (Preact + HTM).
 * @structure
 *   - Modal: generic overlay dialog (Escape / backdrop close)
 *   - ConfirmDialog: confirmation dialog with message + confirm/cancel buttons
 *   - useConfirm: hook wrapping ConfirmDialog state — returns { confirm, ConfirmUI }
 * @usage
 *   import { Modal, ConfirmDialog, useConfirm } from '/components/Modal.js';
 * @version-history
 *   v1.0.0 — 2026-03-10 — Initial Modal component
 *   v1.1.0 — 2026-03-14 — Add ConfirmDialog with danger variant
 *   v1.2.0 — 2026-03-16 — Add useConfirm hook for easy confirm() replacement
 *   v1.3.0 — 2026-06-02 — Fix: memoise useConfirm's ConfirmUI (useCallback) so it
 *     keeps a stable component identity. Previously it was redefined every render,
 *     so any re-render of the host (e.g. the agents list polling) unmounted +
 *     remounted the open dialog, causing it to strobe/flicker.
 *   v1.4.0 — 2026-06-02 — Add optional `className` prop on Modal (applied to the
 *     .modal box) so views can pass width modifiers (e.g. scope-modal,
 *     ext-modal-narrow) when migrating their inline overlays to <Modal> (#2).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

/**
 * Modal — overlay dialog with close on Escape and backdrop click.
 * @param {{ open: boolean, onClose: () => void, title?: string, className?: string, children: any }} props
 *   - className: optional extra class on the .modal box (e.g. a width modifier)
 */
export function Modal({ open, onClose, title, className = '', children }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const onBackdrop = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!open) return null;
  return html`
    <div class="modal-overlay" onClick=${onBackdrop}>
      <div class="modal ${className}">
        <div class="modal-header">
          ${title && html`<h3>${title}</h3>`}
          <button class="modal-close" onClick=${onClose}>✕</button>
        </div>
        <div class="modal-body">${children}</div>
      </div>
    </div>`;
}

/**
 * ConfirmDialog — modal asking for user confirmation before a destructive or important action.
 * @param {{ open, onClose, onConfirm, title, message, confirmLabel, cancelLabel, danger }} props
 *   - danger: if true, confirm button is styled red (for destructive actions)
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, cancelLabel, danger }) {
  // Hooks must run unconditionally before any early return (Rules of Hooks).
  const onBackdrop = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return html`
    <div class="modal-overlay" onClick=${onBackdrop}>
      <div class="modal">
        ${title && html`<div class="modal-header"><h3>${title}</h3></div>`}
        <div class="modal-body">
          <p class="modal-confirm-message">${message}</p>
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" onClick=${onClose}>${cancelLabel || t('common.cancel') || 'Cancel'}</button>
          <button class="${danger ? 'btn-danger-solid' : 'btn-primary'}" onClick=${onConfirm}>
            ${confirmLabel || t('common.confirm') || 'Confirm'}
          </button>
        </div>
      </div>
    </div>`;
}

/**
 * useConfirm — hook that wraps ConfirmDialog state management.
 * Returns { confirm, ConfirmUI } where:
 *   - confirm(message, onConfirm, opts?) opens the dialog
 *   - ConfirmUI is a component to render in your JSX (renders the dialog)
 * @example
 *   const { confirm, ConfirmUI } = useConfirm();
 *   // Replace: if (!confirm('Delete?')) return; doDelete();
 *   // With:   confirm('Delete?', () => doDelete(), { danger: true });
 *   // Render: <${ConfirmUI} />
 */
export function useConfirm() {
  const [state, setState] = useState(null);

  const confirm = useCallback((message, onConfirm, opts = {}) => {
    setState({ message, onConfirm, ...opts });
  }, []);

  const close = useCallback(() => setState(null), []);

  // ConfirmUI MUST keep a stable identity across unrelated re-renders of the
  // host component (e.g. the agents list polls every ~5-10s and refreshes on
  // SSE live-updates while a delete confirm is open). When ConfirmUI was a plain
  // function redefined on every render, Preact saw a new component *type* each
  // time and unmounted+remounted the whole dialog — re-initialising its
  // backdrop-filter overlay and making it strobe (appear/disappear rapidly
  // during a burst of re-renders). Memoising on [state, close] means the
  // reference only changes when the dialog actually opens/closes, so polling no
  // longer remounts it.
  const ConfirmUI = useCallback(() => {
    if (!state) return null;
    return html`<${ConfirmDialog}
      open=${true}
      onClose=${close}
      onConfirm=${() => { close(); state.onConfirm(); }}
      message=${state.message}
      title=${state.title}
      confirmLabel=${state.confirmLabel}
      cancelLabel=${state.cancelLabel}
      danger=${state.danger}
    />`;
  }, [state, close]);

  return { confirm, ConfirmUI };
}
