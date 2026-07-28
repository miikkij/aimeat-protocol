/**
 * @file game/screen.js
 * @description The screen — a header, a scrolling body and a fixed action bar. It is what an app
 *   puts a stage, a form or a result into, and it exists so that every such view in every app
 *   scrolls the same way.
 *
 *   THE BODY IS THE ONLY SCROLLING REGION. The header and the action bar never move, the page
 *   never scrolls horizontally, and `<body>` is never turned into a scroll container (which would
 *   break sticky positioning everywhere else on the host page).
 *
 *   Mount it into an element you size yourself, or omit `target` for a full-screen view.
 * @structure screen(spec) → handle { el, body, set, destroy }
 * @usage  const s = AIMEAT.game.screen({ title: 'Round 3', body: node,
 *           actions: [{ id: 'next', label: 'Next', kind: 'primary', onClick }] });
 *         s.body.appendChild(more);   // the body element is yours to fill
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 01).
 */
import { el, append, clear, resolve, uid } from './dom.js';
import { t, i18n } from './i18n.js';

/**
 * @typedef {object} ScreenAction
 * @property {string} id
 * @property {string} label
 * @property {'primary'|'ghost'|'danger'|'plain'} [kind]
 * @property {boolean} [disabled]
 * @property {(action: ScreenAction) => void} [onClick]
 */

/**
 * A header / scrolling body / action bar view.
 * @param {{
 *   target?: string|Element, full?: boolean, title: string, subtitle?: string,
 *   body?: any, actions?: ScreenAction[], onBack?: () => void, backLabel?: string
 * }} spec
 * @returns {{ el: HTMLElement, body: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function screen(spec) {
  const titleId = uid('ag-screen-title');
  const state = {
    title: spec.title,
    subtitle: spec.subtitle,
    actions: spec.actions || [],
  };

  const heading = el('h2', { class: 'ag-title', id: titleId });
  const sub = el('p', { class: 'ag-screen__sub' });
  const titles = el('div', { class: 'ag-screen__titles' }, [heading, sub]);
  const backBtn = spec.onBack
    ? el('button', {
      type: 'button', class: 'ag-btn ag-btn--ghost',
      on: { click: function () { if (spec.onBack) spec.onBack(); } },
    }, '↩ ' + (spec.backLabel || t('back')))
    : null;
  const head = el('div', {
    class: 'ag-screen__head' + (backBtn ? '' : ' ag-screen__head--noback'),
  }, backBtn ? [backBtn, titles] : [titles]);

  const body = el('div', { class: 'ag-screen__body ag-scroll' });
  if (spec.body != null) append(body, spec.body);

  const bar = el('div', { class: 'ag-screen__actions' });

  const full = spec.full != null ? spec.full : !spec.target;
  const root = el('div', {
    class: 'ag-root ag-screen' + (full ? ' ag-screen--full' : ''),
    'aria-labelledby': titleId,
  }, [head, body, bar]);

  resolve(spec.target, document.body).appendChild(root);

  const stopLang = i18n.onChange(function () { renderHead(); });

  function renderHead() {
    heading.textContent = state.title;
    sub.textContent = state.subtitle || '';
    sub.hidden = !state.subtitle;
    if (backBtn) backBtn.textContent = '↩ ' + (spec.backLabel || t('back'));
  }

  function renderActions() {
    clear(bar);
    for (const action of state.actions) {
      const kind = action.kind || 'plain';
      bar.appendChild(el('button', {
        type: 'button',
        class: 'ag-btn' + (kind === 'plain' ? '' : ' ag-btn--' + kind),
        disabled: action.disabled ? true : null,
        'data-ag-id': action.id,
        on: { click: function () { if (action.onClick) action.onClick(action); } },
      }, action.label));
    }
  }

  renderHead();
  renderActions();

  return {
    el: root,
    body: body,

    /**
     * @param {{ title?: string, subtitle?: string, body?: any, actions?: ScreenAction[] }} patch
     */
    set(patch) {
      if (!patch) return;
      if (patch.title != null) state.title = patch.title;
      if (patch.subtitle != null) state.subtitle = patch.subtitle;
      if (patch.title != null || patch.subtitle != null) renderHead();
      if (patch.body !== undefined) { clear(body); append(body, patch.body); }
      if (patch.actions) { state.actions = patch.actions; renderActions(); }
    },

    destroy() {
      stopLang();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
