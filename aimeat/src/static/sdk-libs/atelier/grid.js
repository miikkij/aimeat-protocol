/**
 * @file atelier/grid.js
 * @description The card grid and the single media card — the browsing shapes. Every card has an
 *   art area even with no image: the stylesheet paints a deterministic monogram ground (one of
 *   three token-mixed washes, picked by a stable hash of the id), so a grid with zero pictures
 *   still reads as designed, never as a wall of grey boxes.
 *
 *   The imagery rule holds here as it does in the hero: an image is a URL painted by the
 *   stylesheet, a data: URI is refused with words, and the fallback is the design.
 * @structure cardGrid(spec) → { el, set, destroy } · mediaCard(spec) → { el, set, destroy }
 * @usage  AIMEAT.atelier.cardGrid({ target: a.main, items, onPick(item) { open(item); } });
 * @version-history
 *   v0.3.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 3).
 */
import { el, clear, resolve, enter } from './dom.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';

/**
 * @typedef {object} CardItem
 * @property {string} id
 * @property {string} title
 * @property {string} [sub]
 * @property {string} [image]
 * @property {string} [badge]
 */

/** The stylesheet-painted image layer for a card, or null (monogram ground shows instead). */
function imageLayer(url) {
  if (!url) return null;
  const v = String(url);
  if (/^data:/i.test(v)) {
    console.warn('aimeat-atelier: card image data: URIs are refused — upload the image to storage and pass its URL.');
    return null;
  }
  return 'url("' + v.replace(/"/g, '%22') + '")';
}

/** A stable 1..3 from an id, so the same item keeps the same monogram wash forever. */
function washOf(id) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 3) + 1;
}

/**
 * Build one card's inner content (shared by grid and mediaCard).
 * @param {CardItem} item
 * @param {boolean} pickable
 * @param {(item: CardItem) => void} [onPick]
 * @returns {HTMLElement}
 */
function buildCard(item, pickable, onPick) {
  const layer = imageLayer(item.image);
  const art = el('span', {
    class: 'ak-card__art ak-card__art--w' + washOf(item.id),
    'aria-hidden': 'true',
    vars: layer ? { '--ak-card-image': layer } : null,
  }, layer ? null : el('span', { class: 'ak-card__monogram',
    // Array.from splits by code point: an emoji-led title keeps its emoji instead of showing
    // a broken surrogate half — found in the first real-data experiment run.
    text: (Array.from(item.title || '?')[0] || '?').toUpperCase() }));
  if (layer) art.classList.add('ak-card__art--image');
  const body = el('span', { class: 'ak-card__body' }, [
    el('span', { class: 'ak-card__title', text: item.title }),
    item.sub != null ? el('span', { class: 'ak-card__sub', text: item.sub }) : null,
  ]);
  const card = el(pickable ? 'button' : 'div', {
    class: 'ak-card',
    type: pickable ? 'button' : null,
    'data-ak-noguard': true,
    'data-ak-id': item.id,
    on: pickable && onPick ? { click: function () { onPick(item); } } : null,
  }, [art, item.badge != null ? el('span', { class: 'ak-badge ak-card__badge', text: item.badge }) : null, body]);
  return card;
}

/**
 * The card grid.
 * @param {{
 *   target?: string|Element, items: CardItem[],
 *   onPick?: (item: CardItem) => void,
 *   empty?: { title?: string, hint?: string, action?: { label: string, onClick?: () => void } },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { items: CardItem[] }) => void, destroy: () => void }}
 */
export function cardGrid(spec) {
  const pickable = typeof spec.onPick === 'function';
  const root = el('div', { class: 'ak-root ak-grid' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  /** @param {CardItem[]} items */
  function render(items) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    if (!items.length) {
      const e = spec.empty || {};
      emptyCard = emptyState({
        target: root, tone: 'quiet',
        title: e.title || t('empty'), hint: e.hint || t('emptyHint'), action: e.action || null,
      });
      return;
    }
    for (const item of items) root.appendChild(buildCard(item, pickable, spec.onPick));
    enter(root);
  }

  render(spec.items || []);

  return {
    el: root,
    /** @param {{ items: CardItem[] }} patch */
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
 * One media card on its own — a feature, a highlight, a link-out.
 * @param {{
 *   target?: string|Element, item: CardItem,
 *   onPick?: (item: CardItem) => void,
 *   actions?: Array<{ id: string, label: string, kind?: 'primary'|'ghost'|'plain', onClick?: (a: any) => void }>,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { item: CardItem }) => void, destroy: () => void }}
 */
export function mediaCard(spec) {
  let card = buildCard(spec.item, typeof spec.onPick === 'function' && !spec.actions, spec.onPick);
  const actions = spec.actions && spec.actions.length
    ? el('span', { class: 'ak-card__actions' }, spec.actions.map(function (action) {
      const kind = action.kind || 'plain';
      return el('button', {
        type: 'button',
        class: 'ak-btn' + (kind === 'plain' ? '' : ' ak-btn--' + kind),
        'data-ak-id': action.id,
        on: { click: function () { if (action.onClick) action.onClick(action); } },
      }, action.label);
    }))
    : null;
  const root = el('div', { class: 'ak-root ak-mediacard' }, [card, actions]);
  if (spec.target) resolve(spec.target).appendChild(root);
  enter(root);

  return {
    el: root,
    /** @param {{ item: CardItem }} patch */
    set(patch) {
      if (!patch || !patch.item) return;
      const next = buildCard(patch.item, typeof spec.onPick === 'function' && !spec.actions, spec.onPick);
      card.replaceWith(next);
      card = next;
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
