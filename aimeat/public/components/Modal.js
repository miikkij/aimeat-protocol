/**
 * @file Modal.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The site's one dialog component (Preact + HTM), on the browser's own <dialog>:
 *   a header with the title and, unless turned off, the X; a body that is the only part to scroll;
 *   a footer for the actions. The look is /css/dialog.css, the closing rules /js/dialog.js, and the
 *   app catalog uses those same two files, so a dialog reads and behaves the same on every page.
 * @structure
 *   - Modal: a dialog with header, body and optional footer
 *   - ConfirmDialog: a question with Cancel and a confirm action in the footer
 *   - useConfirm: hook wrapping ConfirmDialog state — returns { confirm, ConfirmUI }
 * @usage
 *   import { Modal, ConfirmDialog, useConfirm } from '/components/Modal.js';
 *   <${Modal} open=${open} onClose=${close} title="Change password"
 *     footer=${html`<button class="btn-ghost" onClick=${close}>Cancel</button>
 *                   <button class="btn-primary" onClick=${save}>Save</button>`}>
 *     …fields…
 *   <//>
 *   Props: open, onClose, title, children, footer, footerStart (a side door at the footer's other
 *   end), showClose (default true), size ('sm' 440 | 'md' 560 | 'lg' 840 | 'xl' 1080), guard
 *   (default true: Escape and the page behind do not close once something has been typed),
 *   className (extra class on the <dialog>, e.g. a width modifier).
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
 *   v1.5.0 — 2026-09-12 — ConfirmDialog takes the same `className` Modal has (useConfirm forwards
 *     it), so one page can wear its own face without restyling every dialog, and it draws the
 *     close X its header was missing. The design language gives a dialog three ways out — the X,
 *     Escape and the backdrop — and this one had two, with nothing in the corner people look at
 *     first. Additive: no dialog loses a route, and every caller's appearance is unchanged.
 *   v2.0.0 — 2026-09-13 — One dialog for the whole site (wish "Yksi dialogikomponentti kaikille
 *     dialogeille"). Renders a native <dialog> opened with showModal() instead of a fixed div, so no
 *     stacking context can put it under the site bar and the browser traps focus and hands it back.
 *     New `footer`, `footerStart`, `showClose`, `size` and `guard` props; the body scrolls between a
 *     header and a footer that stay put; on a phone the dialog is a sheet at the bottom edge. The
 *     old props keep their meaning, so the 89 views that use this file need no change to open,
 *     close or size their dialogs. The account dialogs and the inbox overlays that had been built
 *     beside this component, because it had no footer and no guard for a half-written form, move
 *     onto it.
 */
import { h } from 'preact';
import { useState, useCallback, useRef, useLayoutEffect, useId } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { wireDialog, CLOSE_ICON } from '/js/dialog.js';

/** The X, as markup once, so every dialog draws the same two strokes. */
function CloseButton({ onClose }) {
  return html`<button type="button" class="dlg-close" onClick=${() => onClose()}
    aria-label=${t('common.close') || 'Close'} dangerouslySetInnerHTML=${{ __html: CLOSE_ICON }}></button>`;
}

/**
 * The open dialog itself. Mounted only while open: it calls showModal() as it mounts and close()
 * as it unmounts, so the parent's `open` flag stays the one source of truth.
 */
function DialogFrame({ onClose, title, className, children, footer, footerStart, showClose, size, guard, bodyClass }) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const guardRef = useRef(guard);
  guardRef.current = guard;
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    const wiring = wireDialog(dialog, {
      guard: () => guardRef.current,
      onRequestClose: () => { if (onCloseRef.current) onCloseRef.current(); },
    });
    if (!dialog.open) dialog.showModal();
    return () => {
      wiring.unwire();
      if (dialog.open) dialog.close();
    };
  }, []);

  const requestClose = () => { if (onCloseRef.current) onCloseRef.current(); };
  const sizeClass = size ? `dlg--${size}` : '';
  return html`
    <dialog ref=${ref} class=${`dlg modal ${sizeClass} ${className || ''}`.trim()}
      aria-labelledby=${title ? titleId : undefined}>
      ${title
        ? html`<header class="dlg-head">
            <h2 class="dlg-title" id=${titleId}>${title}</h2>
            ${showClose && html`<${CloseButton} onClose=${requestClose} />`}
          </header>`
        : showClose && html`<${CloseButton} onClose=${requestClose} />`}
      <div class=${`dlg-body ${bodyClass || ''}`.trim()}>${children}</div>
      ${(footer || footerStart) && html`<footer class="dlg-foot">
        ${footerStart && html`<div class="dlg-foot-start">${footerStart}</div>`}
        ${footer}
      </footer>`}
    </dialog>`;
}

/**
 * Modal — a dialog with a header (title, X), a scrolling body and an optional footer.
 * @param {{ open: boolean, onClose: () => void, title?: any, footer?: any, footerStart?: any,
 *   showClose?: boolean, size?: ''|'sm'|'md'|'lg'|'xl', guard?: boolean, className?: string,
 *   bodyClass?: string, children: any }} props
 */
export function Modal({ open, onClose, title, className = '', children, footer, footerStart, showClose = true, size = '', guard = true, bodyClass = '' }) {
  if (!open) return null;
  return html`<${DialogFrame} onClose=${onClose} title=${title} className=${className} footer=${footer}
    footerStart=${footerStart} showClose=${showClose} size=${size} guard=${guard} bodyClass=${bodyClass}>${children}<//>`;
}

/**
 * ConfirmDialog — a question before a destructive or important action.
 * @param {{ open, onClose, onConfirm, title, message, confirmLabel, cancelLabel, danger, className? }} props
 *   - danger: if true, the confirm action is the coral slab and Cancel takes the focus
 *   - className: optional extra class on the <dialog>, so one page can dress its own question
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, cancelLabel, danger, className = '' }) {
  if (!open) return null;
  const footer = html`
    <button type="button" class="btn-ghost" autofocus=${!!danger} onClick=${() => onClose()}>${cancelLabel || t('common.cancel') || 'Cancel'}</button>
    <button type="button" class=${danger ? 'btn-danger-solid' : 'btn-primary'} autofocus=${!danger} onClick=${onConfirm}>
      ${confirmLabel || t('common.confirm') || 'Confirm'}
    </button>`;
  return html`<${DialogFrame} onClose=${onClose} title=${title} className=${className} size="sm"
    footer=${footer} showClose=${true} guard=${true}>
    <p class="modal-confirm-message">${message}</p>
  <//>`;
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
      className=${state.className}
    />`;
  }, [state, close]);

  return { confirm, ConfirmUI };
}
