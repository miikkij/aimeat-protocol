/**
 * @file atelier/cart.js
 * @description The shopping cart part: a line per item with a quantity stepper, a removal that
 *   folds the line away, and a total that ROLLS to its new value instead of blinking. A line with
 *   more than one of an item says its unit price under its title ("2 × 5,90 €").
 *
 *   Every travel here is finite and under the hand or a change: `odometer` from ./materials.js and
 *   the one collapse the cart owns. Under reduced motion each lands the end state with no travel.
 *   Nothing fetches; the cart renders what it is given and reports what happened. Its own words
 *   (Remove, Checkout, Total, the stepper's names, the empty state) come from the kit dictionary,
 *   so i18n.use() overrides any of them.
 * @structure pictureOf · money · pace · cart(spec) → { el, set, destroy }
 * @usage
 *   AIMEAT.atelier.cart({ target, data: { lines, currency: '€' }, onChange(id, qty) {},
 *     onCheckout(lines) {} });   // commerce micro-units: unit: 'micros' or priceMicros per line
 * @version-history
 *   v0.62.1 — 2026-10-01 — Moved out of flow-parts.js unchanged (that file was at its line limit),
 *     then: the words come from ./i18n.js (en/fi/es), and a line with qty over 1 shows its unit
 *     price in the sub line, after the line's own `sub` text when it has one.
 *   v0.62.0 — 2026-10-01 — cart reads commerce amounts (`unit: 'micros'`, `priceMicros`) and
 *     currency 'morsels' through ./money-units.js. Plain numbers unchanged.
 *   v0.43.0 — 2026-09-02 — Initial, in flow-parts.js (wish-atelier-motion-libraries-and-parts, stage 3).
 */
import { el, clear, resolve, reducedMotion } from './dom.js';
import { emptyState } from './state.js';
import { odometer } from './materials.js';
import { t } from './i18n.js';
import { num, money as fmtMoney } from '../_core/format.js';
import { isMorsels, speaksMicros, readAmount, roundMicros, fractionDigits, morselText } from './money-units.js';

/** One beat of the look's own pace (the same reading flow-parts.js makes for its travels). */
function pace(node, multiple) {
  return (parseFloat(getComputedStyle(node).getPropertyValue('--ak-motion')) || 200) * multiple;
}

/** The line's picture is a URL the stylesheet paints; a data: URI is refused in words. */
function pictureOf(url) {
  if (!url) return null;
  const v = String(url);
  if (/^data:/i.test(v)) {
    console.warn('aimeat-atelier: cart line image data: URIs are refused. Upload the image and pass its URL.');
    return null;
  }
  return 'url("' + v.replace(/"/g, '%22') + '")';
}

/** Money in the viewer's conventions; from micro-units 2 to 6 decimals; morsels are never money. */
function money(amount, currency, micros) {
  if (isMorsels(currency)) return morselText(amount);
  const unit = currency || '€';
  const n = micros ? roundMicros(amount) : Number(amount) || 0;
  const d = micros ? fractionDigits(n) : 2;
  const hasIntl = typeof Intl === 'object' && Intl && typeof Intl.NumberFormat === 'function';
  if (hasIntl && /^[A-Za-z]{3}$/.test(unit)) {
    return fmtMoney(n, unit, { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  if (hasIntl) {
    return num(n, { minimumFractionDigits: d, maximumFractionDigits: d }) + ' ' + unit;
  }
  return n.toFixed(d) + ' ' + unit;
}

/**
 * The cart: a line per item with a quantity stepper, a removal that folds the line away, and a
 * total that rolls to its new value.
 *
 * The stepper answers at once, repainting the line and the total before the app hears, and then
 * reports through `onChange`, the way the kanban board moves its own card and then tells. The
 * quantity floor is 1; Remove is the way out, and it collapses the line (height and opacity on
 * one finite Web Animation) before the node goes. Component-only: the cart is not a mosaic block,
 * because a stored layout has no business arranging somebody's checkout.
 *
 * @param {{ target?: string|Element, title?: string,
 *   data: { lines: Array<{ id: string, title: string, sub?: string, price?: number, priceMicros?: number,
 *             qty: number, image?: string }>,
 *           currency?: string, unit?: 'micros', note?: string },
 *   onChange?: (id: string, qty: number) => void,
 *   onRemove?: (id: string) => void,
 *   onCheckout?: (lines: any[]) => void,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data?: any }) => void, destroy: () => void }}
 */
export function cart(spec) {
  const s = spec || /** @type {any} */ ({});
  const root = el('div', { class: 'ak-root ak-cart' });
  if (s.target) resolve(s.target).appendChild(root);
  const lines = el('div', { class: 'ak-cart__lines' });
  const totalValue = el('span', { class: 'ak-cart__totalvalue' });
  const note = el('div', { class: 'ak-cart__note' });
  const foot = el('div', { class: 'ak-cart__foot' }, [
    el('div', { class: 'ak-cart__total' }, [
      el('span', { class: 'ak-cart__totallabel', text: t('total') }), totalValue,
    ]),
    el('button', {
      type: 'button', class: 'ak-btn ak-btn--primary ak-cart__checkout', text: t('cartCheckout'),
      on: { click: function () { if (s.onCheckout) s.onCheckout(current.slice()); } },
    }, null),
  ]);
  /** @type {Map<string, any>} */
  const shown = new Map();
  let current = [];
  let unit = '€';
  let shape = null; // the data's unit and currency, for readAmount
  let mu = false; // the data speaks micro-units
  let emptyCard = null;

  function each(line) { return readAmount(line, 'price', shape); }
  function totalOf() {
    return current.reduce(function (n, l) { return n + each(l) * (Number(l.qty) || 0); }, 0);
  }
  function rollTotal() { odometer(totalValue, money(totalOf(), unit, mu)); }

  /**
   * The sub line: the line's own `sub`, then "2 × 5,90 €" when there is more than one. Empty for
   * one item without a `sub`, so that line looks as it always did.
   */
  function subOf(line, qty) {
    const own = line.sub != null && line.sub !== '' ? String(line.sub) : '';
    const unitPrice = qty > 1 ? qty + ' × ' + money(each(line), unit, mu) : '';
    return own && unitPrice ? own + ' · ' + unitPrice : (own || unitPrice);
  }

  function paintSub(rec, line, qty) {
    const text = subOf(line, qty);
    rec.sub.textContent = text;
    rec.sub.hidden = !text;
  }

  function setQty(line, next) {
    const q = Math.max(1, Math.round(Number(next) || 1));
    if (q === Number(line.qty)) return;
    line.qty = q;
    const rec = shown.get(String(line.id));
    if (rec) {
      rec.count.textContent = String(q);
      rec.price.textContent = money(each(line) * q, unit, mu);
      paintSub(rec, line, q);
    }
    rollTotal();
    if (s.onChange) s.onChange(line.id, q);
  }

  /** Fold a line away, then let the node go. Reduced motion drops it at once. */
  function collapse(node, after) {
    const done = function () {
      if (node.parentNode) node.parentNode.removeChild(node);
      if (after) after();
    };
    if (reducedMotion() || typeof node.animate !== 'function') { done(); return; }
    const box = node.getBoundingClientRect();
    const seen = getComputedStyle(node);
    const anim = node.animate([
      { height: box.height + 'px', opacity: 1, paddingTop: seen.paddingTop, paddingBottom: seen.paddingBottom },
      { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' },
    ], { duration: pace(node, 1.4), easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' });
    anim.addEventListener('finish', done);
    anim.addEventListener('cancel', done);
  }

  function remove(line) {
    const id = String(line.id);
    const rec = shown.get(id);
    current = current.filter(function (l) { return String(l.id) !== id; });
    shown.delete(id);
    if (rec) collapse(rec.node, current.length ? null : function () { render({ lines: [], currency: unit, note: '' }); });
    rollTotal();
    if (s.onRemove) s.onRemove(line.id);
  }

  function buildLine(line) {
    const picture = pictureOf(line.image);
    const rec = /** @type {any} */ ({
      node: null, line: line,
      art: el('span', {
        class: 'ak-cart__art' + (picture ? ' ak-cart__art--image' : ''), 'aria-hidden': 'true',
        vars: picture ? { '--ak-cart-image': picture } : null,
      }, picture ? null : el('span', { class: 'ak-cart__monogram' })),
      title: el('span', { class: 'ak-cart__linetitle' }),
      sub: el('span', { class: 'ak-cart__linesub' }),
      count: el('span', { class: 'ak-cart__count', 'aria-live': 'polite' }),
      price: el('span', { class: 'ak-cart__price' }),
    });
    const step = function (by) {
      return function () { setQty(rec.line, (Number(rec.line.qty) || 1) + by); };
    };
    rec.node = el('div', { class: 'ak-cart__line', 'data-id': String(line.id) }, [
      rec.art,
      el('span', { class: 'ak-cart__body' }, [rec.title, rec.sub]),
      el('span', { class: 'ak-cart__qty' }, [
        el('button', { type: 'button', class: 'ak-cart__step', 'aria-label': t('cartFewer'), on: { click: step(-1) } }, '-'),
        rec.count,
        el('button', { type: 'button', class: 'ak-cart__step', 'aria-label': t('cartMore'), on: { click: step(1) } }, '+'),
      ]),
      rec.price,
      el('button', {
        type: 'button', class: 'ak-btn ak-cart__remove', text: t('cartRemove'),
        on: { click: function () { remove(rec.line); } },
      }, null),
    ]);
    fillLine(rec, line);
    return rec;
  }

  function fillLine(rec, line) {
    rec.line = line;
    const qty = Math.max(1, Math.round(Number(line.qty) || 1));
    rec.title.textContent = String(line.title || line.id);
    paintSub(rec, line, qty);
    rec.count.textContent = String(qty);
    rec.price.textContent = money(each(line) * qty, unit, mu);
    const mono = rec.art.querySelector('.ak-cart__monogram');
    if (mono) mono.textContent = (Array.from(String(line.title || '?'))[0] || '?').toUpperCase();
  }

  function render(data) {
    const list = (data && Array.isArray(data.lines) ? data.lines : []).filter(function (l) { return l && l.id != null; });
    unit = (data && data.currency) || '€';
    shape = data || null;
    mu = speaksMicros(shape, list, ['price']);
    current = list;
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    if (!list.length) {
      clear(root);
      clear(lines);
      shown.clear();
      emptyCard = emptyState({
        target: root, tone: 'quiet',
        title: t('cartEmpty'), hint: t('cartEmptyHint'),
      });
      return;
    }
    clear(root);
    if (s.title) root.appendChild(el('div', { class: 'ak-cart__title', text: s.title }));
    root.appendChild(lines);
    note.textContent = (data && data.note) ? String(data.note) : '';
    note.hidden = !note.textContent;
    root.appendChild(foot);
    root.appendChild(note);
    const live = {};
    list.forEach(function (l) { live[String(l.id)] = 1; });
    Array.from(shown.keys()).forEach(function (id) {
      if (live[id]) return;
      const rec = shown.get(id);
      shown.delete(id);
      if (rec.node.parentNode) rec.node.parentNode.removeChild(rec.node);
    });
    list.forEach(function (line) {
      const id = String(line.id);
      let rec = shown.get(id);
      if (!rec) { rec = buildLine(line); shown.set(id, rec); } else { fillLine(rec, line); }
      lines.appendChild(rec.node);
    });
    rollTotal();
  }

  render(s.data);
  return {
    el: root,
    set(patch) { if (patch && 'data' in patch) render(patch.data); },
    destroy() {
      if (emptyCard) emptyCard.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
