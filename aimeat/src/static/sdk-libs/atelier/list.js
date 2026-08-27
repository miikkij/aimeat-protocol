/**
 * @file atelier/list.js
 * @description The list and the master–detail view — the two shapes most app screens reduce to.
 *   Rows are keyed by id, so `set()` adds, removes and updates rows instead of rebuilding the
 *   world: a new row slides in on its own, a removed one leaves, an updated one repaints in
 *   place — the live-data motion arrives with the data, not from app code.
 *
 *   EVERY ROW IS A BUTTON when the list has an onPick, so the keyboard and the screen reader get
 *   rows for free. An empty list is never blank: it renders the kit's designed empty state.
 *
 *   listDetail is the same list with a detail pane beside it. The split is a CONTAINER query:
 *   narrow containers get one pane at a time with a back affordance, wide ones get both — the
 *   component adapts to the box it was given, not to the viewport.
 * @structure list(spec) → { el, set, destroy } · listDetail(spec) → { el, set, select, destroy }
 * @usage  AIMEAT.atelier.list({ target: a.main, items, onPick(item) { open(item); } });
 * @version-history
 *   v0.3.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 3).
 */
import { el, append, clear, resolve, enter, reducedMotion } from './dom.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';

/**
 * @typedef {object} ListItem
 * @property {string} id
 * @property {string} title
 * @property {string} [sub]
 * @property {string} [meta]
 * @property {string} [badge]
 */

/**
 * Render one row's inner content (shared by add and update, so the two can never drift).
 * @param {HTMLElement} row
 * @param {ListItem} item
 */
function fillRow(row, item) {
  clear(row);
  const text = el('span', { class: 'ak-list__text' }, [
    el('span', { class: 'ak-list__title', text: item.title }),
    item.sub != null ? el('span', { class: 'ak-list__sub', text: item.sub }) : null,
  ]);
  const side = (item.meta != null || item.badge != null)
    ? el('span', { class: 'ak-list__side' }, [
      item.badge != null ? el('span', { class: 'ak-badge', text: item.badge }) : null,
      item.meta != null ? el('span', { class: 'ak-list__meta', text: item.meta }) : null,
    ])
    : null;
  append(row, side ? [text, side] : [text]);
}

/**
 * The keyed list.
 * @param {{
 *   target?: string|Element, items: ListItem[],
 *   onPick?: (item: ListItem) => void,
 *   empty?: { title?: string, hint?: string, action?: { label: string, onClick?: () => void } },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { items: ListItem[] }) => void, destroy: () => void }}
 */
export function list(spec) {
  /** @type {Map<string, { row: HTMLElement, item: ListItem }>} */
  const shown = new Map();
  const pickable = typeof spec.onPick === 'function';
  const root = el('div', { class: 'ak-root ak-list', role: pickable ? 'list' : null });
  if (spec.target) resolve(spec.target).appendChild(root);

  let emptyCard = null;

  /** @param {ListItem} item @returns {HTMLElement} */
  function buildRow(item) {
    const row = el(pickable ? 'button' : 'div', {
      class: 'ak-list__row',
      type: pickable ? 'button' : null,
      role: pickable ? 'listitem' : null,
      'data-ak-noguard': true,
      'data-ak-id': item.id,
      on: pickable ? { click: function () { if (spec.onPick) spec.onPick(shown.get(item.id)?.item || item); } } : null,
    });
    fillRow(row, item);
    return row;
  }

  /** @param {ListItem[]} items @param {boolean} first */
  function render(items, first) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    if (!items.length) {
      for (const [, entry] of shown) entry.row.remove();
      shown.clear();
      const e = spec.empty || {};
      emptyCard = emptyState({
        target: root, tone: 'quiet',
        title: e.title || t('empty'), hint: e.hint || t('emptyHint'), action: e.action || null,
      });
      return;
    }
    const seen = new Set();
    let previous = null;
    for (const item of items) {
      seen.add(item.id);
      let entry = shown.get(item.id);
      if (!entry) {
        const row = buildRow(item);
        // Insert in order: after the previous item's row, or first.
        if (previous) previous.after(row);
        else root.prepend(row);
        if (!first && !reducedMotion() && typeof row.animate === 'function') {
          row.animate(
            [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
            { duration: 200, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
          );
        }
        entry = { row, item };
        shown.set(item.id, entry);
      } else {
        const changed = entry.item.title !== item.title || entry.item.sub !== item.sub
          || entry.item.meta !== item.meta || entry.item.badge !== item.badge;
        if (changed) {
          fillRow(entry.row, item);
          entry.row.classList.remove('ak-list__row--changed');
          void entry.row.offsetWidth;
          entry.row.classList.add('ak-list__row--changed');
        }
        entry.item = item;
        if (previous) previous.after(entry.row);
        else root.prepend(entry.row);
      }
      previous = entry.row;
    }
    for (const [id, entry] of shown) {
      if (!seen.has(id)) { entry.row.remove(); shown.delete(id); }
    }
  }

  render(spec.items || [], true);
  enter(root);

  return {
    el: root,
    /** @param {{ items: ListItem[] }} patch */
    set(patch) {
      if (!patch || !patch.items) return;
      render(patch.items, false);
    },
    destroy() {
      if (emptyCard) emptyCard.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/**
 * The master–detail view: the keyed list beside a detail pane the host fills per selection.
 * @param {{
 *   target?: string|Element, items: ListItem[],
 *   renderDetail: (item: ListItem, body: HTMLElement) => void,
 *   empty?: { title?: string, hint?: string },
 *   detailEmpty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { items: ListItem[] }) => void,
 *   select: (id: string|null) => void, destroy: () => void }}
 */
export function listDetail(spec) {
  let selected = null;
  /** @type {ListItem[]} */
  let items = spec.items || [];

  const detailBody = el('div', { class: 'ak-listdetail__body' });
  const backBtn = el('button', {
    type: 'button', class: 'ak-btn ak-btn--ghost ak-listdetail__back', 'data-ak-noguard': true,
    on: { click: function () { select(null); } },
  }, '↩ ' + t('back'));
  const detail = el('div', { class: 'ak-listdetail__detail' }, [backBtn, detailBody]);

  const master = list({
    items: items,
    empty: spec.empty,
    onPick: function (item) { select(item.id); },
  });

  const root = el('div', { class: 'ak-root ak-listdetail' }, [
    el('div', { class: 'ak-listdetail__master' }, master.el),
    detail,
  ]);
  if (spec.target) resolve(spec.target).appendChild(root);

  let detailEmptyCard = null;

  function renderDetail() {
    if (detailEmptyCard) { detailEmptyCard.destroy(); detailEmptyCard = null; }
    clear(detailBody);
    const item = items.find(function (i) { return i.id === selected; }) || null;
    root.classList.toggle('ak-listdetail--open', !!item);
    if (!item) {
      const e = spec.detailEmpty || {};
      detailEmptyCard = emptyState({
        target: detailBody, tone: 'quiet',
        title: e.title || t('open'), hint: e.hint,
      });
      return;
    }
    spec.renderDetail(item, detailBody);
  }

  /** @param {string|null} id */
  function select(id) {
    selected = id;
    for (const row of root.querySelectorAll('.ak-list__row')) {
      row.classList.toggle('ak-list__row--selected', row.getAttribute('data-ak-id') === id);
    }
    renderDetail();
  }

  renderDetail();

  return {
    el: root,
    /** @param {{ items: ListItem[] }} patch */
    set(patch) {
      if (!patch || !patch.items) return;
      items = patch.items;
      master.set({ items: items });
      if (selected && !items.some(function (i) { return i.id === selected; })) selected = null;
      select(selected);
    },
    select: select,
    destroy() {
      if (detailEmptyCard) detailEmptyCard.destroy();
      master.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
