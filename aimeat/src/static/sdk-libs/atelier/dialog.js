/**
 * @file atelier/dialog.js
 * @description THE DIALOG DEPARTMENT — the modal family the kit was missing, so every app had
 *   been hand-rolling its own overlay, its own focus trap and its own Escape key (and getting
 *   at least one of the three wrong).
 *
 *   BUILT ON NATIVE <dialog> + showModal(), deliberately: the browser gives the focus trap, the
 *   Escape key, the top layer above every stacking context, the inert background and the focus
 *   RETURN to whatever opened it. That is the whole accessibility contract for free and correct,
 *   which is what lets the kit keep its promise that an app never writes a line of ARIA. The kit
 *   adds what the browser does not: the entrance, the look's own surface, the button row, the
 *   scrim, and the phone-shaped variant that arrives from the bottom edge.
 *
 *   FOUR DOORS, ONE MECHANISM: dialog() is the surface; confirm() and prompt() are the two
 *   questions an app actually asks, each answering with a PROMISE so the calling code reads
 *   straight down; sheet() is dialog() arriving from the bottom for a phone. Every one of them
 *   is dismissible, and a dismiss is always the safe answer (false / null) — a person closing a
 *   box must never be read as agreement.
 * @structure dialog(spec) → { el, close, destroy } · confirm(spec) → Promise<boolean> ·
 *   prompt(spec) → Promise<string|null> · sheet(spec) → { el, close, destroy }
 * @usage
 *   const ok = await AIMEAT.atelier.confirm({ title: 'Delete the draft?', tone: 'danger' });
 *   const name = await AIMEAT.atelier.prompt({ title: 'Name this list', label: 'Name' });
 * @version-history
 *   v0.25.0 — 2026-08-29 — Initial (TARGET-074: the dialog department).
 */
import { el, reducedMotion } from './dom.js';
import { t } from './i18n.js';
import { mosaic } from './mosaic.js';

/** How far a dialog travels on entry, and from where — the sheet arrives from the edge. */
const ENTER_FROM = { center: '12px', bottom: '100%' };

/** The tones a dialog can carry: what KIND of moment this is, before a word is read. */
const TONES = ['plain', 'danger', 'celebrate', 'ai'];
/** How much room the surface takes — a question is not a form is not a report. */
const SIZES = ['compact', 'roomy', 'wide'];

/**
 * One modal surface. Returns immediately with a handle; the caller decides when it closes.
 *
 * A dialog's SHAPE is design data, not behaviour: `tone`, `size`, `from` and a `layout` body
 * describe what kind of moment this is and what stands in it, which is why the same four
 * fields travel as a Design Book part and can be adopted like any other arrangement.
 * @param {{
 *   title: string, body?: (host: HTMLElement) => void, text?: string,
 *   layout?: object, sources?: Record<string, () => unknown>,
 *   tone?: 'plain'|'danger'|'celebrate'|'ai', size?: 'compact'|'roomy'|'wide',
 *   actions?: Array<{ id: string, label: string, tone?: 'primary'|'ghost'|'danger', run?: () => unknown }>,
 *   from?: 'center'|'bottom', dismissible?: boolean,
 *   onClose?: (reason: string) => void,
 * }} spec
 * @returns {{ el: HTMLDialogElement, close: (reason?: string) => void, destroy: () => void }}
 */
export function dialog(spec) {
  const from = spec.from === 'bottom' ? 'bottom' : 'center';
  const tone = TONES.indexOf(spec.tone || '') >= 0 ? spec.tone : 'plain';
  const size = SIZES.indexOf(spec.size || '') >= 0 ? spec.size : 'compact';
  const dismissible = spec.dismissible !== false;
  const node = /** @type {HTMLDialogElement} */ (el('dialog', {
    class: 'ak-root ak-dialog ak-dialog--' + from + ' ak-dialog--' + tone + ' ak-dialog--' + size,
    'aria-labelledby': 'ak-dlg-title',
  }));

  const head = el('div', { class: 'ak-dialog__head' }, [
    el('h2', { class: 'ak-dialog__title', id: 'ak-dlg-title', text: spec.title }),
    dismissible ? el('button', {
      type: 'button', class: 'ak-btn ak-btn--ghost ak-dialog__x',
      'aria-label': t('close'), on: { click: function () { close('dismiss'); } },
    }, '✕') : null,
  ]);
  const body = el('div', { class: 'ak-dialog__body' });
  if (spec.text) body.appendChild(el('p', { class: 'ak-dialog__text', text: spec.text }));
  // A STORED ARRANGEMENT can be the dialog's body: the same mosaic every screen uses, rendered
  // inside the modal. This is what makes a dialog shape adoptable from the Design Book.
  if (spec.layout) {
    mosaic({ target: body, layout: spec.layout, sources: spec.sources || {} });
  }
  if (spec.body) spec.body(body);

  const foot = el('div', { class: 'ak-dialog__actions' });
  for (const action of spec.actions || []) {
    foot.appendChild(el('button', {
      type: 'button',
      class: 'ak-btn ak-btn--' + (action.tone === 'danger' ? 'danger' : action.tone === 'primary' ? 'primary' : 'ghost'),
      'data-ak-action': action.id,
      on: { click: function () { if (action.run) action.run(); } },
    }, action.label));
  }

  node.appendChild(el('div', { class: 'ak-dialog__panel' },
    [head, body, (spec.actions || []).length ? foot : null]));
  document.body.appendChild(node);

  let closed = false;
  /** @param {string} [reason] */
  function close(reason) {
    if (closed) return;
    closed = true;
    const done = function () {
      if (node.open) node.close();
      if (node.parentNode) node.parentNode.removeChild(node);
      if (spec.onClose) spec.onClose(reason || 'close');
    };
    if (reducedMotion() || typeof node.animate !== 'function') return done();
    const span = parseFloat(getComputedStyle(node).getPropertyValue('--ak-motion')) || 200;
    const anim = node.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(' + ENTER_FROM[from] + ')' }],
      { duration: span, easing: 'ease-in' },
    );
    anim.onfinish = done;
    // A dropped animation (a hidden tab) must never leave the dialog stuck open.
    anim.oncancel = done;
  }

  // The browser's own dismiss paths (Escape, the backdrop) route through the same close.
  node.addEventListener('cancel', function (ev) {
    ev.preventDefault();
    if (dismissible) close('dismiss');
  });
  if (dismissible) {
    node.addEventListener('click', function (ev) {
      if (ev.target === node) close('dismiss');   // the backdrop, never the panel
    });
  }

  node.showModal();
  if (!reducedMotion() && typeof node.animate === 'function') {
    const span = parseFloat(getComputedStyle(node).getPropertyValue('--ak-motion')) || 200;
    const ease = (getComputedStyle(node).getPropertyValue('--ak-ease') || '').trim() || 'cubic-bezier(0.2, 0.7, 0.3, 1)';
    node.animate(
      [{ opacity: 0, transform: 'translateY(' + ENTER_FROM[from] + ')' }, { opacity: 1, transform: 'none' }],
      { duration: span * 1.2, easing: ease },
    );
  }

  return {
    el: node,
    close: close,
    destroy() { close('destroy'); },
  };
}

/**
 * THE ASK. One question, two answers, and a dismiss is always "no" — a person closing a box is
 * never agreement. `tone: 'danger'` colours the confirming button for a destructive answer.
 * @param {{ title: string, text?: string, confirmLabel?: string, cancelLabel?: string, tone?: 'primary'|'danger' }} spec
 * @returns {Promise<boolean>}
 */
export function confirm(spec) {
  return new Promise(function (resolve) {
    let answer = false;
    const handle = dialog({
      title: spec.title,
      text: spec.text,
      from: 'center',
      tone: spec.tone === 'danger' ? 'danger' : 'plain',
      actions: [
        { id: 'cancel', label: spec.cancelLabel || t('cancel'), tone: 'ghost', run: function () { handle.close('cancel'); } },
        {
          id: 'confirm', label: spec.confirmLabel || t('confirm'),
          tone: spec.tone === 'danger' ? 'danger' : 'primary',
          run: function () { answer = true; handle.close('confirm'); },
        },
      ],
      onClose: function () { resolve(answer); },
    });
    const go = handle.el.querySelector('[data-ak-action="confirm"]');
    if (go) /** @type {HTMLElement} */ (go).focus();
  });
}

/**
 * ONE VALUE, ASKED PROPERLY: a labelled field in a modal, Enter submits, dismiss answers null.
 * @param {{ title: string, label: string, text?: string, value?: string, placeholder?: string,
 *   submitLabel?: string, multiline?: boolean }} spec
 * @returns {Promise<string|null>}
 */
export function prompt(spec) {
  return new Promise(function (resolve) {
    let answer = null;
    /** @type {HTMLInputElement|HTMLTextAreaElement|null} */
    let field = null;
    const handle = dialog({
      title: spec.title,
      text: spec.text,
      from: 'center',
      body: function (host) {
        const id = 'ak-prompt-' + Math.random().toString(36).slice(2, 8);
        host.appendChild(el('label', { class: 'ak-form__label', for: id, text: spec.label }));
        field = /** @type {HTMLInputElement} */ (el(spec.multiline ? 'textarea' : 'input', {
          class: 'ak-input ak-dialog__field', id: id,
          ...(spec.placeholder ? { placeholder: spec.placeholder } : {}),
        }));
        if (spec.value != null) field.value = spec.value;
        if (!spec.multiline) {
          field.addEventListener('keydown', function (ev) {
            if (/** @type {KeyboardEvent} */ (ev).key === 'Enter') { ev.preventDefault(); submit(); }
          });
        }
        host.appendChild(field);
      },
      actions: [
        { id: 'cancel', label: t('cancel'), tone: 'ghost', run: function () { handle.close('cancel'); } },
        { id: 'submit', label: spec.submitLabel || t('confirm'), tone: 'primary', run: function () { submit(); } },
      ],
      onClose: function () { resolve(answer); },
    });
    function submit() {
      answer = field ? String(field.value) : null;
      handle.close('submit');
    }
    if (field) /** @type {HTMLElement} */ (field).focus();
  });
}

/**
 * The phone shape: the same modal arriving from the bottom edge, wide and thumb-reachable.
 * @param {Parameters<typeof dialog>[0]} spec
 * @returns {ReturnType<typeof dialog>}
 */
export function sheet(spec) {
  return dialog({ ...spec, from: 'bottom' });
}
