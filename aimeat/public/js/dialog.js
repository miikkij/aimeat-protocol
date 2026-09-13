/**
 * @file dialog.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How every dialog on the site behaves, on the browser's own <dialog> element. One
 *   module for the SPA (components/Modal.js wraps it) and for the app catalog (bundled into its
 *   page), so a dialog closes, keeps a half-written form and returns focus the same way everywhere.
 *   The look is public/css/dialog.css; this file is only behaviour and has no framework in it.
 *
 *   What the browser gives by opening with showModal(): the top layer (no z-index or stacking
 *   context can put a dialog under the site bar), an inert page behind it, focus moved in and
 *   handed back on close, Escape and the Android back gesture as a `cancel` event.
 *
 *   What this adds, from the design language's rule for a dialog's three ways out: the X always
 *   closes; Escape and a press on the dim page behind close only while nothing has been typed, so a
 *   half-filled form is not lost to a stray key or click. A press that starts inside the dialog and
 *   ends outside it (selecting text, dragging) is not a press on the page behind.
 * @structure wireDialog(dialog, { onRequestClose, guard }) → { reset, isDirty, unwire } ·
 *   openDialog(dialog) · closeDialog(dialog) · raiseAboveDialogs(el) · CLOSE_ICON
 * @usage import { wireDialog, openDialog, closeDialog, CLOSE_ICON } from '/js/dialog.js';
 * @version-history
 *   v1.1.0 — 2026-09-13 — raiseAboveDialogs: a toast shown while a dialog is open goes into the top
 *     layer after it, instead of under the dialog's dimmed backdrop.
 *   v1.0.0 — 2026-09-13 — Initial (wish "Yksi dialogikomponentti kaikille dialogeille").
 */

/** The X, drawn rather than typed: two 2.5px strokes the colour of the header it sits in. */
export const CLOSE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">'
  + '<path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"/></svg>';

const TYPED = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Attach the closing rules to a <dialog>. onRequestClose(reason) is called when the person asks
 * to close ('escape' | 'backdrop' | 'native'); the caller decides and closes. `guard` (default on)
 * keeps Escape and the backdrop from closing once something has been typed in the dialog.
 * @param {HTMLDialogElement} dialog
 * @param {{ onRequestClose?: (reason: string) => void, guard?: boolean | (() => boolean) }} [options]
 */
export function wireDialog(dialog, { onRequestClose, guard = true } = {}) {
  let dirty = false;
  let downOutside = false;
  const ask = (reason) => { if (onRequestClose) onRequestClose(reason); };
  // `guard` may be a function, so a component can change it without rewiring the open dialog.
  const guarded = () => (typeof guard === 'function' ? guard() : guard) && dirty;

  const outside = (e) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  const onInput = (e) => { if (e.target && e.target.matches && e.target.matches(TYPED)) dirty = true; };
  const onCancel = (e) => {
    e.preventDefault();
    if (guarded()) return;
    ask('escape');
  };
  const onPointerDown = (e) => { downOutside = e.target === dialog && outside(e); };
  const onClick = (e) => {
    const wasOutside = downOutside;
    downOutside = false;
    if (e.target !== dialog || !wasOutside || !outside(e)) return;
    if (guarded()) return;
    ask('backdrop');
  };
  // A browser may still close a dialog on a repeated Escape it no longer lets us refuse; the owner
  // of the open state has to hear about that too.
  const onClose = () => ask('native');

  dialog.addEventListener('input', onInput);
  dialog.addEventListener('change', onInput);
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('pointerdown', onPointerDown);
  dialog.addEventListener('click', onClick);
  dialog.addEventListener('close', onClose);

  return {
    reset() { dirty = false; },
    isDirty() { return dirty; },
    unwire() {
      dialog.removeEventListener('input', onInput);
      dialog.removeEventListener('change', onInput);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('click', onClick);
      dialog.removeEventListener('close', onClose);
    },
  };
}

/** Open as a modal dialog. Opening one that is already open does nothing. */
export function openDialog(dialog) {
  if (dialog && !dialog.open) dialog.showModal();
}

/** Close, if open. */
export function closeDialog(dialog) {
  if (dialog && dialog.open) dialog.close();
}

/**
 * Put a floating notice (a toast) above any open dialog. A modal dialog is in the browser's top
 * layer, which no z-index reaches, so a toast raised while one is open would sit under its dimmed
 * backdrop. As a manual popover the toast enters that layer too, and showing it again puts it on
 * top. A browser without popovers keeps the element's own z-index.
 * @param {HTMLElement | null} el
 */
export function raiseAboveDialogs(el) {
  if (!el || typeof el.showPopover !== 'function' || !el.isConnected) return;
  if (!el.hasAttribute('popover')) el.setAttribute('popover', 'manual');
  try {
    if (el.matches(':popover-open')) el.hidePopover();
    el.showPopover();
    // eslint-disable-next-line aimeat/no-silent-catch -- a popover the browser refuses to show keeps its z-index, which is where every toast was before; there is nothing to report.
  } catch {
    /* the toast still shows, under an open dialog as it did before */
  }
}
