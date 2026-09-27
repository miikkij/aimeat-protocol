/**
 * @file public/views/appcat/dialogs/confirm.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description appcat's question: the old catalogue's confirm dialog (features F144), which every act
 *   that deletes, restores or replaces asks first. A small dialog with no title and the X in its
 *   corner, the question, and Cancel and OK; OK has the focus when it opens. confirmAsk(text) answers
 *   true for OK, and false for Cancel, the X, Escape and a press on the page behind. It is a layer of
 *   its own over whatever dialog is open (the old confirm opened over the source editor), drawn by the
 *   host's DialogHost; several questions asked at once are answered one after another.
 *   The frame is ConfirmDialog of components/Modal.js, the site's question.
 * @structure confirmAsk(text, opts) → Promise<boolean> · ConfirmLayer() · confirmPending() ·
 *   subscribeConfirm(fn) · default ConfirmDialogView({ message, onAnswer, close })
 * @usage import { confirmAsk } from '/views/appcat/dialogs/confirm.js';
 *        if (!(await confirmAsk(x('confirm.deleteApp', { name })))) return;
 *   opts: { danger (the loud action in its danger tone, Cancel takes the focus), confirmLabel, cancelLabel, title }
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the question reads as the old one (leading="normal": the browser's
 *     own spacing, the words at .95rem).
 *   v1.0.0 — 2026-09-27 — Initial (appcat).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { ConfirmDialog } from '/components/Modal.js';
import { x } from '/views/appcat/i18n.js';

const html = htm.bind(h);

/** @type {Array<{ id: number, text: string, opts: any, resolve: (yes: boolean) => void }>} */
const queue = [];
let asked = 0;
const listeners = new Set();
function emit() { for (const fn of listeners) fn(); }

/**
 * Ask a question. Resolves true for OK; false for Cancel, the X, Escape and the page behind.
 * @param {string} text
 * @param {{ danger?: boolean, confirmLabel?: string, cancelLabel?: string, title?: string }} [opts]
 * @returns {Promise<boolean>}
 */
export function confirmAsk(text, opts = {}) {
  return new Promise((resolve) => {
    queue.push({ id: ++asked, text: String(text ?? ''), opts: opts || {}, resolve });
    emit();
  });
}

/** Whether a question is waiting for its answer. */
export function confirmPending() { return queue.length > 0; }

/** Hear when a question is asked or answered. Returns the unsubscribe. */
export function subscribeConfirm(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function answer(yes) {
  const q = queue.shift();
  emit();
  if (q) q.resolve(!!yes);
}

/** The question that waits, drawn over any open dialog. The host draws it. */
export function ConfirmLayer() {
  const [, tick] = useState(0);
  useEffect(() => subscribeConfirm(() => tick((n) => n + 1)), []);
  const q = queue[0];
  if (!q) return null;
  // The key makes each question its own dialog, so the next one opens fresh with OK in focus.
  return html`<${Question} key=${q.id} q=${q} />`;
}

function Question({ q }) {
  return html`<${ConfirmDialog} open=${true} message=${q.text} title=${q.opts.title} leading="normal"
    danger=${!!q.opts.danger}
    confirmLabel=${q.opts.confirmLabel || x('common.confirm')}
    cancelLabel=${q.opts.cancelLabel || x('common.cancel')}
    onConfirm=${() => answer(true)} onClose=${() => answer(false)} />`;
}

/**
 * The same question opened as a named dialog (openDialog('confirm', { message, onAnswer })), for a part
 * that wants it in the dialog slot rather than as a layer. onAnswer(true | false), then it closes.
 */
export default function ConfirmDialogView({ message, onAnswer, close, danger, confirmLabel, cancelLabel, title }) {
  const done = (yes) => { close?.(); onAnswer?.(!!yes); };
  return html`<${ConfirmDialog} open=${true} message=${message} title=${title} danger=${!!danger} leading="normal"
    confirmLabel=${confirmLabel || x('common.confirm')} cancelLabel=${cancelLabel || x('common.cancel')}
    onConfirm=${() => done(true)} onClose=${() => done(false)} />`;
}
