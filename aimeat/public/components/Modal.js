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
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

/**
 * Modal — overlay dialog with close on Escape and backdrop click.
 * @param {{ open: boolean, onClose: () => void, title?: string, children: any }} props
 */
export function Modal({ open, onClose, title, children }) {
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
      <div class="modal">
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
  if (!open) return null;

  const onBackdrop = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

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

  function ConfirmUI() {
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
  }

  return { confirm, ConfirmUI };
}
