/**
 * @file Modal.js
 * @description Reusable modal and confirm dialog components (Preact + HTM).
 * @structure
 *   - Modal: generic overlay dialog (Escape / backdrop close)
 *   - ConfirmDialog: confirmation dialog with message + confirm/cancel buttons
 * @usage
 *   import { Modal, ConfirmDialog } from '/components/Modal.js';
 * @version-history
 *   v1.0.0 — 2026-03-10 — Initial Modal component
 *   v1.1.0 — 2026-03-14 — Add ConfirmDialog with danger variant
 */
import { h } from 'preact';
import { useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

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
  return html`
    <${Modal} open=${open} onClose=${onClose} title=${title}>
      <p class="modal-confirm-message">${message}</p>
      <div class="modal-footer">
        <button class="btn btn-ghost" onClick=${onClose}>${cancelLabel || 'Cancel'}</button>
        <button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" onClick=${onConfirm}>
          ${confirmLabel || 'Confirm'}
        </button>
      </div>
    <//>`;
}
