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
 *   v0.50.0 — 2026-09-05 — THE CHANGE IS A MOVE, not three separate ones. The whole reconcile runs
 *     inside `settle`, so a row that arrived rises in on the LOOK's distance and pace, a row that
 *     left fades out where it stood instead of blinking away, and a row that moved glides from
 *     where it was standing. The 200 ms / 8 px pair frozen in this file since 0.3.0 is gone: it
 *     was the one place in the kit where a look could not change the feel of its own rows.
 *   v0.46.0 — 2026-09-02 — The morph is the kit's own now: `morph` from mosaic-motion.js drives
 *     it, and the pair is the two TITLES (the row's words and the detail's heading), so the
 *     name travels out of the list into the pane instead of a whole row growing into a panel.
 *     The pane itself is still the partner when the detail has no heading of its own.
 *   v0.5.0 — 2026-08-28 — The row-to-detail MORPH: the picked row opens into the detail pane via
 *     a shared view-transition-name (plain swap without View Transitions or under reduced motion).
 *   v0.4.0 — 2026-08-28 — A pick is visible: the clicked row keeps a selected mark (class +
 *     aria-current) in the plain list too, and listDetail scrolls its detail pane into view when
 *     the pane sits outside the viewport — the first AEB review clicked a row, saw nothing change,
 *     and concluded nothing happened while the detail filled 700px below the fold.
 *   v0.3.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 3).
 */
import { el, append, clear, resolve, reducedMotion } from './dom.js';
import { settle } from './arrive.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';
import { morph } from './mosaic-motion.js';

/** The host writes the detail, so the kit LOOKS for its title rather than dictating one: the
 *  element the host marked, and failing that the first heading in the pane. */
const DETAIL_MARKED = '.ak-listdetail__title';
const DETAIL_HEADING = 'h1, h2, h3';

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
      on: pickable ? { click: function () {
        // The pick leaves a mark: without it, a click whose detail renders elsewhere (or below
        // the fold) reads as "nothing happened" — the first AEB review's exact words.
        for (const other of root.querySelectorAll('.ak-list__row--selected')) {
          other.classList.remove('ak-list__row--selected');
          other.removeAttribute('aria-current');
        }
        row.classList.add('ak-list__row--selected');
        row.setAttribute('aria-current', 'true');
        if (spec.onPick) spec.onPick(shown.get(item.id)?.item || item);
      } } : null,
    });
    fillRow(row, item);
    return row;
  }

  /**
   * The reconcile, and nothing about motion inside it. `settle` measures the rows around this
   * work and gives each one the move its own change earned — arrived, moved, or gone — on the
   * look's own distance and pace.
   * @param {ListItem[]} items
   */
  function reconcile(items) {
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

  /** @param {ListItem[]} items */
  function render(items) {
    settle(root, function () { reconcile(items); });
  }

  render(spec.items || []);

  return {
    el: root,
    /** @param {{ items: ListItem[] }} patch */
    set(patch) {
      if (!patch || !patch.items) return;
      render(patch.items);
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

  /** The element on the detail side wearing the shared name right now, and the timer that takes
   *  it off again. `morph` keeps the transition handle, so the release is a bounded wait set
   *  well past the end of the move rather than a promise this module was given. */
  let held = /** @type {HTMLElement|null} */ (null);
  let holdTimer = /** @type {any} */ (null);

  /** Take the shared name off the detail side, whether the move has landed or been overtaken. */
  function release() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (held) { held.style.viewTransitionName = ''; held = null; }
  }

  /** How long the name is held: six of the look's own beats, which is well past any one move. */
  function holdFor(node) {
    return (parseFloat(getComputedStyle(node).getPropertyValue('--ak-motion')) || 200) * 6;
  }

  /** The detail's own title: what the host marked, else its first heading, else the whole pane
   *  (which is what this move did before it travelled by title). @returns {HTMLElement} */
  function detailTitle() {
    return /** @type {HTMLElement} */ (detailBody.querySelector(DETAIL_MARKED)
      || detailBody.querySelector(DETAIL_HEADING)
      || detail);
  }

  /** @param {string|null} id */
  function select(id) {
    selected = id;
    const mark = function () {
      for (const row of root.querySelectorAll('.ak-list__row')) {
        const on = row.getAttribute('data-ak-id') === id;
        row.classList.toggle('ak-list__row--selected', on);
        if (on) row.setAttribute('aria-current', 'true');
        else row.removeAttribute('aria-current');
      }
      renderDetail();
    };
    // THE TITLE TRAVELS. The picked row's own words wear the shared name in the old state, the
    // detail's heading wears it in the new one, and the browser carries the first into the
    // second, so the row opens into its detail instead of the detail merely appearing. The row
    // hands the name over INSIDE the change, because two elements may not wear one name in the
    // same state. Plain swap without View Transitions or under reduced motion.
    const picked = /** @type {HTMLElement|null} */ (id != null
      ? Array.from(root.querySelectorAll('.ak-list__row')).find(function (r) { return r.getAttribute('data-ak-id') === id; }) ?? null
      : null);
    const moving = /** @type {HTMLElement|null} */ (picked
      ? (picked.querySelector('.ak-list__title') || picked) : null);
    release();
    if (moving && typeof document.startViewTransition === 'function' && !reducedMotion()) {
      morph(moving, function () {
        moving.style.viewTransitionName = '';
        mark();
        held = detailTitle();
        held.style.viewTransitionName = 'ak-morph';
      });
      holdTimer = setTimeout(release, holdFor(detail));
    } else {
      mark();
    }
    // The detail must be seen to have answered the click. When the pane sits outside the
    // viewport (wide layout, detail below the fold), bring it in; when it is visible, leave the
    // scroll position alone.
    if (id != null) {
      requestAnimationFrame(function () {
        const box = detail.getBoundingClientRect();
        const viewH = window.innerHeight || document.documentElement.clientHeight;
        if (box.top >= viewH || box.bottom <= 0) {
          detail.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
        }
      });
    }
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
      release();
      if (detailEmptyCard) detailEmptyCard.destroy();
      master.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
