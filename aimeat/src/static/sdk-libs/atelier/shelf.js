/**
 * @file atelier/shelf.js
 * @description The shelf — pieces to use, on two tabs: what is ready made (a library) and what
 *   was made here (the results). Each piece is a card with a preview, a title, a line under it,
 *   a kind chip and the actions the app offers for it (Use, On the board). A search box filters
 *   the shelf in place. From ORIGAMI 1.2.0's Library and Made windows. The shelf draws and
 *   reports a press; what a piece IS and what using it does are the app's.
 *
 *   THE PREVIEW IS SAFE BY DEFAULT: an image URL draws as a picture, anything else draws as a
 *   monogram wash with the kind, because a piece's own markup is the app's to sanitise and show
 *   through the `preview(item)` slot.
 *
 *   THE SAMPLE STATE. `sample: true` draws six pieces across the two tabs and changes nothing.
 * @parts shelf root · bar · tabs · search · grid · item · preview · monogram · title · sub · kind · acts · act · empty
 * @slots shelf preview(item) · extra(item)
 * @variants shelf dense · plain
 * @tokens shelf --ak-shelf-preview-h
 * @fork shelf Copy .ak-shelf* out of board.css and build the cards yourself; you keep the tabs and the search bar as kit parts and give up the keyed grid and the designed empty state.
 * @structure shelf(spec) → { el, set, value, destroy }
 * @usage
 *   var s = AIMEAT.atelier.shelf({ target: host, items: pieces, onUse: function (item, action) { … } });
 *   s.set({ items: pieces, value: 'made' });
 * @version-history
 *   v0.64.0 — 2026-10-02 — Initial (wish-origami-atelieriin-ja-laudan-osat-kitin-lohkoiksi-ja-design-).
 */
import { el, clear, resolve } from './dom.js';
import { applyVariant } from './parts-model.js';
import { tabs } from './shell.js';
import { searchBar } from './table.js';
import { emptyState } from './state.js';
import { tb } from './board-i18n.js';

const VARIANTS = ['dense', 'plain'];

/**
 * @typedef {{ id: string, tab?: string, title: string, sub?: string, kind?: string, image?: string, [k: string]: any }} ShelfItem
 */

function sampleItems() {
  return [
    { id: 'l1', tab: 'library', title: 'RSVP form', sub: 'four fields, posts without an account', kind: 'form' },
    { id: 'l2', tab: 'library', title: 'Stat strip', sub: 'three figures with a label each', kind: 'stats' },
    { id: 'l3', tab: 'library', title: 'Picture maker', sub: 'describe it, an agent draws it', kind: 'ask' },
    { id: 'm1', tab: 'made', title: 'AI usage, by day', sub: '23 rows', kind: 'table' },
    { id: 'm2', tab: 'made', title: 'Tokens per day', sub: 'bar chart', kind: 'chart' },
    { id: 'm3', tab: 'made', title: 'Invitation', sub: 'published at its own address', kind: 'card' },
  ];
}

/** A stable wash index from an id, so a piece keeps its colour. */
function washOf(id) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 3) + 1;
}
function monogramOf(title) {
  const words = String(title || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
}

/**
 * The shelf.
 * @param {{
 *   target?: string|Element, variant?: string, sample?: boolean,
 *   tabs?: Array<{ id: string, label: string }>, value?: string, items?: ShelfItem[],
 *   actions?: Array<{ id: string, label: string, kind?: 'primary'|'ghost' }>,
 *   search?: boolean, onUse?: (item: ShelfItem, action: string) => void, onTab?: (id: string) => void,
 *   empty?: { title?: string, hint?: string },
 *   parts?: { preview?: (item: ShelfItem) => any, extra?: (item: ShelfItem) => any },
 * }} spec
 */
export function shelf(spec) {
  const sample = spec.sample === true;
  const parts = spec.parts || {};
  const root = el('div', { class: 'ak-root ak-shelf', 'data-ak-part': 'root' });
  applyVariant(root, spec, VARIANTS);
  if (spec.target) resolve(spec.target).appendChild(root);
  const tabList = spec.tabs || [{ id: 'library', label: tb('shelf.library') }, { id: 'made', label: tb('shelf.made') }];
  const actions = spec.actions || [{ id: 'use', label: tb('shelf.use'), kind: 'primary' }, { id: 'board', label: tb('shelf.board'), kind: 'ghost' }];
  /** @type {ShelfItem[]} */
  let items = sample ? sampleItems() : (spec.items || []);
  let value = spec.value || (tabList[0] && tabList[0].id) || '';
  let query = '';
  let emptyCard = null;
  let destroyed = false;
  /** @type {Map<string, HTMLElement>} */
  const shown = new Map();

  const bar = el('div', { class: 'ak-shelf__bar', 'data-ak-part': 'bar' });
  root.appendChild(bar);
  const tabHandle = tabList.length > 1 ? tabs({ target: bar, items: tabList, value: value, onChange: function (id) {
    value = id;
    if (spec.onTab) spec.onTab(id);
    render();
  } }) : null;
  if (tabHandle) tabHandle.el.setAttribute('data-ak-part', 'tabs');
  const searchHandle = spec.search === false ? null : searchBar({ target: bar, placeholder: tb('shelf.search'), onChange: function (q) {
    query = String(q || '').trim().toLowerCase();
    render();
  } });
  if (searchHandle) searchHandle.el.setAttribute('data-ak-part', 'search');
  const grid = el('div', { class: 'ak-shelf__grid', 'data-ak-part': 'grid', role: 'list' });
  root.appendChild(grid);

  function matches(item) {
    if (tabList.length > 1 && (item.tab || tabList[0].id) !== value) return false;
    if (!query) return true;
    return [item.title, item.sub, item.kind].join(' ').toLowerCase().indexOf(query) >= 0;
  }

  function fillSlot(host, v) {
    clear(host);
    if (v == null || v === false) return;
    if (v instanceof Node) host.appendChild(v);
    else if (Array.isArray(v)) v.forEach(function (x) { fillSlot(host, x); });
    else host.textContent = String(v);
  }

  function preview(item) {
    const box = el('div', { class: 'ak-shelf__preview', 'data-ak-part': 'preview', 'data-ak-wash': String(washOf(item.id)) });
    if (parts.preview) { fillSlot(box, parts.preview(item)); return box; }
    if (item.image) { box.appendChild(el('img', { src: item.image, alt: '', loading: 'lazy' })); return box; }
    box.appendChild(el('span', { class: 'ak-shelf__monogram', 'data-ak-part': 'monogram', 'aria-hidden': 'true', text: monogramOf(item.title) }));
    return box;
  }

  function card(item) {
    const node = el('div', { class: 'ak-shelf__item', 'data-ak-part': 'item', 'data-ak-id': item.id, role: 'listitem' });
    node.appendChild(preview(item));
    node.appendChild(el('div', { class: 'ak-shelf__title', 'data-ak-part': 'title', text: item.title || '' }));
    if (item.sub) node.appendChild(el('div', { class: 'ak-shelf__sub', 'data-ak-part': 'sub', text: item.sub }));
    if (item.kind) node.appendChild(el('span', { class: 'ak-shelf__kind', 'data-ak-part': 'kind', text: String(item.kind) }));
    if (parts.extra) { const extra = el('div', { class: 'ak-shelf__extra' }); fillSlot(extra, parts.extra(item)); node.appendChild(extra); }
    const acts = el('div', { class: 'ak-shelf__acts', 'data-ak-part': 'acts' });
    actions.forEach(function (a) {
      acts.appendChild(el('button', {
        type: 'button', class: 'ak-btn ak-btn--sm ' + (a.kind === 'primary' ? 'ak-btn--primary' : 'ak-btn--ghost'),
        'data-ak-part': 'act', 'data-ak-act': a.id, 'data-ak-noguard': true, text: a.label,
        on: { click: function () { if (spec.onUse) spec.onUse(item, a.id); } },
      }));
    });
    node.appendChild(acts);
    return node;
  }

  function render() {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    const want = items.filter(matches);
    const keep = new Set();
    let previous = null;
    want.forEach(function (item) {
      keep.add(item.id);
      let node = shown.get(item.id);
      if (!node) { node = card(item); shown.set(item.id, node); }
      if (previous) { if (previous.nextSibling !== node) previous.after(node); }
      else if (grid.firstChild !== node) grid.prepend(node);
      previous = node;
    });
    // A card on the other tab leaves the grid and keeps its element, so a tab flip is a move and
    // not a rebuild; a card whose record left the shelf is dropped in set().
    shown.forEach(function (node, id) { if (!keep.has(id) && node.parentNode === grid) node.remove(); });
    if (!want.length) {
      const e = spec.empty || {};
      emptyCard = emptyState({ target: grid, tone: 'quiet', title: e.title || tb('shelf.empty'), hint: e.hint || tb('shelf.emptyHint') });
      emptyCard.el.setAttribute('data-ak-part', 'empty');
    }
  }
  render();

  return {
    el: root,
    /** @param {{ items?: ShelfItem[], value?: string }} patch */
    set: function (patch) {
      if (destroyed || !patch) return;
      if (patch.items) {
        // A card is rebuilt when its record changed: the kit cannot know which field a slot reads.
        const byId = new Map(items.map(function (i) { return [i.id, i]; }));
        const next = new Set(patch.items.map(function (i) { return i.id; }));
        patch.items.forEach(function (i) { if (byId.get(i.id) !== i) { const old = shown.get(i.id); if (old) { old.remove(); shown.delete(i.id); } } });
        shown.forEach(function (node, id) { if (!next.has(id)) { node.remove(); shown.delete(id); } });
        items = patch.items;
      }
      if (patch.value && patch.value !== value) { value = patch.value; if (tabHandle) tabHandle.set({ value: value }); }
      render();
    },
    value: function () { return value; },
    destroy: function () {
      destroyed = true;
      if (tabHandle) tabHandle.destroy();
      if (searchHandle) searchHandle.destroy();
      if (emptyCard) emptyCard.destroy();
      root.remove();
    },
  };
}
