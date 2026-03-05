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
