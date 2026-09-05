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
 * @parts cardGrid root · card · art · monogram · badge · body · title · sub · extra · aside
 * @slots cardGrid title(item) · sub(item) · extra(item) · badge(item) · aside(item) · art(item)
 * @variants cardGrid dense · wide · plain
 * @tokens cardGrid --ak-card-min · --ak-card-gap · --ak-card-aspect · --ak-card-pad
 * @fork cardGrid Copy .ak-grid and .ak-card* out of content.css; you keep the monogram washes and lose the keyed reconcile that stops the wall re-entering on every change.
 * @parts mediaCard root · card · art · monogram · badge · body · title · sub · extra · actions
 * @slots mediaCard title(item) · sub(item) · extra(item) · badge(item) · art(item)
 * @variants mediaCard dense · plain
 * @tokens mediaCard --ak-card-aspect · --ak-card-pad
 * @fork mediaCard Same as cardGrid; this is one card and its action row.
 * @version-history
 *   v0.51.0 — 2026-09-05 — THE CARD TAKES WHAT THE APP GIVES IT: ten named parts, each stamped
 *     `data-ak-part`; `extra` and `aside` are the two the kit leaves empty; `art` takes the app's
 *     own mark in place of the monogram; three variants (dense, wide, plain) and four tokens.
 *     A card nobody customised has exactly the markup it had.
 *   v0.50.0 — 2026-09-05 — CARDS ARE KEPT BY THEIR ID. The grid was cleared and rebuilt on every
 *     set, which re-ran the entrance over the whole wall each time one card changed. Reconciled
 *     now: a card that arrived rises in, a card that is gone fades out where it stood, and a card
 *     that moved to another place in the grid glides there.
 *   v0.3.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 3).
 */
import { el, clear, resolve, enter } from './dom.js';
import { keyedRows } from './arrive.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';
import { partEl, slotInto, applyVariant, partValue, fillPart } from './parts-model.js';

const CARD_VARIANTS = ['dense', 'wide', 'plain'];

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

/** Which record a kept card is showing right now. A card survives a change of its own contents,
 *  so a pick handler must not close over the record the card was built with. */
const SHOWING = new WeakMap();

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
 * @param {any} [spec]  the component's spec, so the app's own parts reach this card
 * @returns {HTMLElement}
 */
function buildCard(item, pickable, onPick, spec) {
  const layer = imageLayer(item.image);
  const art = partEl('span', 'ak-card__art ak-card__art--w' + washOf(item.id), 'art', {
    'aria-hidden': 'true',
    vars: layer ? { '--ak-card-image': layer } : null,
  });
  const own = layer ? null : partEl('span', 'ak-card__monogram', 'monogram', {
    // Array.from splits by code point: an emoji-led title keeps its emoji instead of showing
    // a broken surrogate half — found in the first real-data experiment run.
    text: (Array.from(item.title || '?')[0] || '?').toUpperCase(),
  });
  // The art area takes the app's own mark when it declares one; the monogram is the default,
  // never a floor an app has to fight. The default is appended AS IT WAS — no wrapper — so a
  // card nobody customised has exactly the markup and the centring it had before.
  const givenArt = partValue(spec, 'art', item);
  if (givenArt !== undefined) fillPart(art, givenArt);
  else if (own) art.appendChild(own);
  if (layer) art.classList.add('ak-card__art--image');
  const body = partEl('span', 'ak-card__body', 'body');
  slotInto(body, spec, 'title', item.title, { cls: 'ak-card__title', args: [item] });
  slotInto(body, spec, 'sub', item.sub == null ? null : item.sub, { cls: 'ak-card__sub', args: [item] });
  slotInto(body, spec, 'extra', null, { cls: 'ak-card__extra', args: [item] });
  const card = el(pickable ? 'button' : 'div', {
    class: 'ak-card',
    type: pickable ? 'button' : null,
    'data-ak-part': 'card',
    'data-ak-noguard': true,
    'data-ak-id': item.id,
    on: pickable && onPick ? { click: function () { onPick(item); } } : null,
  }, art);
  slotInto(card, spec, 'badge', item.badge == null ? null : item.badge, { cls: 'ak-badge ak-card__badge', args: [item] });
  card.appendChild(body);
  slotInto(card, spec, 'aside', null, { cls: 'ak-card__aside', args: [item] });
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
  const root = el('div', { class: 'ak-root ak-grid', 'data-ak-part': 'root' });
  applyVariant(root, spec, CARD_VARIANTS);
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  /** @param {CardItem[]} items */
  function render(items) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    if (!items.length) {
      clear(root);
      const e = spec.empty || {};
      emptyCard = emptyState({
        target: root, tone: 'quiet',
        title: e.title || t('empty'), hint: e.hint || t('emptyHint'), action: e.action || null,
      });
      return;
    }
    keyedRows(root, items, {
      key: function (item, i) { return item.id != null ? String(item.id) : 'card-' + i; },
      build: function (item) {
        // The pick reads the record the card is showing NOW, not the one it was built with: a
        // kept card survives an update, and a handler closed over the old item would report it.
        const card = buildCard(item, pickable, pickable
          ? function () { if (spec.onPick) spec.onPick(SHOWING.get(card)); }
          : undefined, spec);
        SHOWING.set(card, item);
        return card;
      },
      // A card's whole surface is its content, so a changed card is refilled in place: the
      // element stays (no re-entrance), everything inside it is replaced.
      update: function (node, item) {
        SHOWING.set(node, item);
        const next = buildCard(item, pickable, undefined, spec);
        node.className = next.className;
        clear(node);
        while (next.firstChild) node.appendChild(next.firstChild);
      },
    });
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
  let card = buildCard(spec.item, typeof spec.onPick === 'function' && !spec.actions, spec.onPick, spec);
  const actions = spec.actions && spec.actions.length
    ? partEl('span', 'ak-card__actions', 'actions')
    : null;
  if (actions) {
    for (const action of spec.actions) {
      const kind = action.kind || 'plain';
      actions.appendChild(el('button', {
        type: 'button',
        class: 'ak-btn' + (kind === 'plain' ? '' : ' ak-btn--' + kind),
        'data-ak-part': 'action',
        'data-ak-id': action.id,
        on: { click: function () { if (action.onClick) action.onClick(action); } },
      }, action.label));
    }
  }
  const root = el('div', { class: 'ak-root ak-mediacard', 'data-ak-part': 'root' }, [card, actions]);
  applyVariant(root, spec, ['dense', 'plain']);
  if (spec.target) resolve(spec.target).appendChild(root);
  enter(root);

  return {
    el: root,
    /** @param {{ item: CardItem }} patch */
    set(patch) {
      if (!patch || !patch.item) return;
      const next = buildCard(patch.item, typeof spec.onPick === 'function' && !spec.actions, spec.onPick, spec);
      card.replaceWith(next);
      card = next;
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
