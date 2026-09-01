/**
 * @file atelier/flow-parts.js
 * @description The four parts that carry a FLOW rather than a figure: the kit-primitives
 *   section of the Design Book, and the proof that motion.js carries real components with no
 *   vendored library underneath:
 *
 *     sortable  a list a hand reorders: the carried row rides the kit's own `drag`, the rows it
 *               crosses spring out of its way, and the new order reaches the app on release
 *     cart      the shopping cart: a stepper per line, a removal that folds the line away, and
 *               a total that ROLLS to its new value instead of blinking
 *     notices   the notification centre: items under day headings, unread ones marked, a tap
 *               opens, "Mark all read" settles the dots, and arriving items stagger in
 *     facets    filters over a list: chips per facet, counts that roll when they change, and
 *               one summary line that says how many filters stand and offers to clear them
 *
 *   Every travel here is finite and under the hand or a change: `drag`, `spring` and `stagger`
 *   from ./motion.js, `odometer` from ./materials.js, and the one collapse the cart owns. Under
 *   reduced motion each of those lands the end state with no travel, so the parts still work.
 *   Nothing fetches; a component renders what it is given and reports what happened.
 * @structure flipFrom · sortable · cart · notices · facets
 * @usage
 *   AIMEAT.atelier.sortable({ target, data: { items: [{ id: 'a', label: 'Flour' }] },
 *     onReorder(ids) { save(ids); } });
 *   AIMEAT.atelier.cart({ target, data: { lines, currency: '€' }, onChange(id, qty) {},
 *     onCheckout(lines) {} });
 *   AIMEAT.atelier.notices({ target, data: { items }, onOpen(item) {}, onRead(ids) {} });
 *   AIMEAT.atelier.facets({ target, data: { facets }, onChange(selection) {} });
 * @version-history
 *   v0.43.0 — 2026-09-02 — Initial (wish-atelier-motion-libraries-and-parts, stage 3).
 */
import { el, clear, resolve, enter, reducedMotion } from './dom.js';
import { emptyState } from './state.js';
import { spring, stagger, drag } from './motion.js';
import { odometer } from './materials.js';

/** The hand's spring: quick enough to feel attached to the pointer, soft enough to read. */
const CARRY = { stiffness: 320, damping: 28 };

const TONES = ['ok', 'warn', 'err', 'accent'];
const KINDS = ['info', 'ok', 'warn', 'err'];

/** Rows out of either shape a part accepts: a bare array, or a record with `items`. */
function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

/** One beat of the look's own pace, for the two travels this file owns. */
function pace(node, multiple) {
  return (parseFloat(getComputedStyle(node).getPropertyValue('--ak-motion')) || 200) * multiple;
}

/**
 * FLIP on the kit's spring: the element is standing (dx, dy) away from where the layout has
 * just put it, and it travels from there to identity.
 *
 * The spring keeps its own idea of where an element stands (a transform string cannot be read
 * back), and the only way to hand it a STARTING point is to name that point as a target and
 * cancel before the travel plays: a cancelled animation reports no progress, so the next call
 * reads the seeded state whole and starts there. Both calls happen in one block, so no frame is
 * painted in between. Under reduced motion both land instantly and nothing travels.
 * @param {Element} node
 * @param {number} dx  where the element stands now, horizontally, against its new layout box
 * @param {number} dy  the same vertically
 * @param {{ stiffness?: number, damping?: number, mass?: number }} [opts]
 * @returns {{ el: Element, finished: Promise<void>, cancel: () => void }}
 */
export function flipFrom(node, dx, dy, opts) {
  spring(node, { x: dx, y: dy }, opts).cancel();
  return spring(node, { x: 0, y: 0 }, opts || CARRY);
}

/**
 * The sortable list: a vertical list a hand can reorder.
 *
 * The carried row rides `drag` (axis 'y', no spring back), the rows it crosses spring out of its
 * way as the pointer passes their middles, and the DOM move happens once, on release, where
 * every row that ends up somewhere else travels there from where it was standing. The grip is the keyboard
 * control too: Alt+ArrowUp / Alt+ArrowDown move a focused row one slot.
 *
 * @param {{ target?: string|Element,
 *   data?: { items: Array<{ id: string, label: string, sub?: string, tone?: string }> }|Array<any>,
 *   title?: string, handle?: boolean,
 *   onReorder?: (ids: string[]) => void,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data?: any }) => void, destroy: () => void }}
 */
export function sortable(spec) {
  const s = spec || {};
  const root = el('div', { class: 'ak-root ak-sortable' });
  if (s.target) resolve(s.target).appendChild(root);
  const body = el('div', { class: 'ak-sortable__rows' });
  /** @type {Array<{ destroy: () => void }>} */
  let hands = [];
  /** How far each row is currently held from its layout box, so a release can undo it. */
  const held = new Map();
  let emptyCard = null;

  function rows() { return /** @type {HTMLElement[]} */ (Array.prototype.slice.call(body.children)); }
  function gap() { return parseFloat(getComputedStyle(body).rowGap) || 0; }
  function tell() {
    if (s.onReorder) s.onReorder(rows().map(function (r) { return r.getAttribute('data-id'); }));
  }

  /**
   * Put a row at an index among the others and let everything that moved travel there.
   * @param {HTMLElement} row
   * @param {number} index  the slot among the OTHER rows
   */
  function place(row, index) {
    const all = rows();
    const before = all.map(function (r) { return r.offsetTop; });
    const others = all.filter(function (r) { return r !== row; });
    body.insertBefore(row, others[index] || null);
    all.forEach(function (r, i) {
      const stood = held.get(r) || 0;
      const travel = before[i] - r.offsetTop + stood;
      if (travel || stood) flipFrom(r, 0, travel, CARRY);
    });
    held.clear();
  }

  /** The slot the pointer is asking for, counted in the other rows' own layout boxes. */
  function wanted(row, dy) {
    const middle = row.offsetTop + dy + row.offsetHeight / 2;
    let index = 0;
    rows().forEach(function (r) {
      if (r !== row && middle > r.offsetTop + r.offsetHeight / 2) index += 1;
    });
    return index;
  }

  /** @param {HTMLElement} row */
  function carry(row) {
    return drag(row, {
      onStart: function () { row.classList.add('is-carried'); },
      onMove: function (dx, dy) {
        const all = rows();
        const at = all.indexOf(row);
        const others = all.filter(function (r) { return r !== row; });
        const want = Math.max(0, Math.min(wanted(row, dy), others.length));
        const step = row.offsetHeight + gap();
        others.forEach(function (r, i) {
          let to = 0;
          if (want > at && i >= at && i < want) to = -step;
          else if (want < at && i >= want && i < at) to = step;
          if ((held.get(r) || 0) === to) return;
          held.set(r, to);
          spring(r, { y: to }, CARRY);
        });
      },
      onEnd: function (dx, dy) {
        row.classList.remove('is-carried');
        const all = rows();
        const at = all.indexOf(row);
        const want = Math.max(0, Math.min(wanted(row, dy), all.length - 1));
        held.set(row, dy);
        place(row, want);
        if (want !== at) tell();
      },
    }, { axis: 'y', back: false });
  }

  /** @param {HTMLElement} row @param {number} dir */
  function nudge(row, dir) {
    const all = rows();
    const to = all.indexOf(row) + dir;
    if (to < 0 || to >= all.length) return;
    place(row, to);
    tell();
  }

  function onGripKey(ev) {
    if (!ev.altKey) return;
    const dir = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
    if (!dir) return;
    const grip = /** @type {HTMLElement} */ (ev.currentTarget);
    const row = /** @type {HTMLElement} */ (grip.closest('.ak-sortable__row'));
    if (!row) return;
    ev.preventDefault();
    nudge(row, dir);
    grip.focus();
  }

  function buildRow(item) {
    const kids = [];
    if (s.handle !== false) {
      kids.push(el('button', {
        type: 'button', class: 'ak-sortable__grip', 'data-ak-noguard': true,
        'aria-label': 'Move ' + String(item.label || item.id),
        on: { keydown: onGripKey },
      }, [el('span', { class: 'ak-sortable__gripmark', 'aria-hidden': 'true' })]));
    }
    kids.push(el('span', { class: 'ak-sortable__text' }, [
      el('span', { class: 'ak-sortable__label', text: String(item.label || item.id) }),
      item.sub != null ? el('span', { class: 'ak-sortable__sub', text: String(item.sub) }) : null,
    ].filter(Boolean)));
    return el('div', {
      class: 'ak-sortable__row' + (TONES.indexOf(item.tone) >= 0 ? ' ak-sortable__row--' + item.tone : ''),
      'data-id': String(item.id),
    }, kids);
  }

  function render(data) {
    hands.forEach(function (h) { h.destroy(); });
    hands = [];
    held.clear();
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    clear(body);
    const items = rowsOf(data).filter(function (it) { return it && it.id != null; });
    if (!items.length) {
      const e = s.empty || {};
      emptyCard = emptyState({
        target: root, tone: 'quiet',
        title: e.title || s.title || 'Nothing to put in order', hint: e.hint,
      });
      return;
    }
    if (s.title) root.appendChild(el('div', { class: 'ak-sortable__title', text: s.title }));
    root.appendChild(body);
    items.forEach(function (item) { body.appendChild(buildRow(item)); });
    rows().forEach(function (r) { hands.push(carry(r)); });
    enter(body);
  }

  render(s.data);
  return {
    el: root,
    set(patch) { if (patch && 'data' in patch) render(patch.data); },
    destroy() {
      hands.forEach(function (h) { h.destroy(); });
      if (emptyCard) emptyCard.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
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

/** Money in the viewer's own conventions: a three-letter code gets the real currency shape. */
function money(amount, currency) {
  const unit = currency || '€';
  const n = Number(amount) || 0;
  const hasIntl = typeof Intl === 'object' && Intl && typeof Intl.NumberFormat === 'function';
  if (hasIntl && /^[A-Za-z]{3}$/.test(unit)) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: unit.toUpperCase() }).format(n);
  }
  if (hasIntl) {
    return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ' + unit;
  }
  return n.toFixed(2) + ' ' + unit;
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
 *   data: { lines: Array<{ id: string, title: string, sub?: string, price: number, qty: number, image?: string }>,
 *           currency?: string, note?: string },
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
      el('span', { class: 'ak-cart__totallabel', text: 'Total' }), totalValue,
    ]),
    el('button', {
      type: 'button', class: 'ak-btn ak-btn--primary ak-cart__checkout', text: 'Checkout',
      on: { click: function () { if (s.onCheckout) s.onCheckout(current.slice()); } },
    }, null),
  ]);
  /** @type {Map<string, any>} */
  const shown = new Map();
  let current = [];
  let unit = '€';
  let emptyCard = null;

  function totalOf() {
    return current.reduce(function (n, l) { return n + (Number(l.price) || 0) * (Number(l.qty) || 0); }, 0);
  }
  function rollTotal() { odometer(totalValue, money(totalOf(), unit)); }

  function setQty(line, next) {
    const q = Math.max(1, Math.round(Number(next) || 1));
    if (q === Number(line.qty)) return;
    line.qty = q;
    const rec = shown.get(String(line.id));
    if (rec) {
      rec.count.textContent = String(q);
      rec.price.textContent = money((Number(line.price) || 0) * q, unit);
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
        el('button', { type: 'button', class: 'ak-cart__step', 'aria-label': 'One fewer', on: { click: step(-1) } }, '-'),
        rec.count,
        el('button', { type: 'button', class: 'ak-cart__step', 'aria-label': 'One more', on: { click: step(1) } }, '+'),
      ]),
      rec.price,
      el('button', {
        type: 'button', class: 'ak-btn ak-cart__remove', text: 'Remove',
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
    rec.sub.textContent = line.sub != null ? String(line.sub) : '';
    rec.sub.hidden = line.sub == null || line.sub === '';
    rec.count.textContent = String(qty);
    rec.price.textContent = money((Number(line.price) || 0) * qty, unit);
    const mono = rec.art.querySelector('.ak-cart__monogram');
    if (mono) mono.textContent = (Array.from(String(line.title || '?'))[0] || '?').toUpperCase();
  }

  function render(data) {
    const list = (data && Array.isArray(data.lines) ? data.lines : []).filter(function (l) { return l && l.id != null; });
    unit = (data && data.currency) || '€';
    current = list;
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    if (!list.length) {
      clear(root);
      clear(lines);
      shown.clear();
      emptyCard = emptyState({
        target: root, tone: 'quiet',
        title: 'Your cart is empty', hint: 'Anything you add shows up here.',
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

/** Midnight of a date, so two of them can be compared as days. */
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

/** Today, Yesterday, then the date itself. */
function dayLabel(when) {
  if (!when) return 'Earlier';
  const days = Math.round((startOfDay(new Date()) - startOfDay(when)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (typeof when.toLocaleDateString !== 'function') return when.toISOString().slice(0, 10);
  const sameYear = when.getFullYear() === new Date().getFullYear();
  return when.toLocaleDateString(undefined, sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

function clockOf(when) {
  if (!when) return '';
  if (typeof when.toLocaleTimeString !== 'function') return when.toISOString().slice(11, 16);
  return when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * The notification centre: items under day headings, unread ones marked, a tap opens.
 *
 * Items keep their nodes across a `set` (they are matched by id and moved into the new grouping),
 * so only the ones that just arrived stagger in; the rest stand still, which is what tells a
 * reader that something is new. "Mark all read" reports the unread ids and settles their dots.
 * An item carrying `href` renders as a link, so the middle click and the context menu work.
 *
 * @param {{ target?: string|Element, title?: string,
 *   data?: { items: Array<{ id: string, title: string, text?: string, at: string,
 *     kind?: 'info'|'ok'|'warn'|'err', read?: boolean, href?: string }> }|Array<any>,
 *   onOpen?: (item: any) => void,
 *   onRead?: (ids: string[]) => void,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data?: any }) => void, destroy: () => void }}
 */
export function notices(spec) {
  const s = spec || {};
  const root = el('div', { class: 'ak-root ak-notices' });
  if (s.target) resolve(s.target).appendChild(root);
  const head = el('div', { class: 'ak-notices__head' });
  const body = el('div', { class: 'ak-notices__body' });
  const markAll = el('button', {
    type: 'button', class: 'ak-btn ak-notices__markall', text: 'Mark all read',
    on: { click: function () { markRead(); } },
  }, null);
  /** @type {Map<string, any>} */
  const shown = new Map();
  let dated = [];
  let mounted = false;
  let emptyCard = null;

  function kindOf(kind) { return KINDS.indexOf(kind) >= 0 ? kind : 'info'; }

  /** The dot fades and the item loses its unread face; both end, neither loops. */
  function settle(dot) {
    if (!dot || dot.hidden) return;
    const done = function () { dot.hidden = true; };
    if (reducedMotion() || typeof dot.animate !== 'function') { done(); return; }
    const anim = dot.animate([
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(0.4)' },
    ], { duration: pace(dot, 1.2), easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' });
    anim.addEventListener('finish', done);
    anim.addEventListener('cancel', done);
  }

  function markRead() {
    const ids = dated.filter(function (u) { return !u.item.read; }).map(function (u) { return u.item.id; });
    if (!ids.length) return;
    ids.forEach(function (id) {
      const rec = shown.get(String(id));
      if (!rec) return;
      rec.item.read = true;
      rec.node.classList.remove('is-unread');
      settle(rec.dot);
    });
    if (markAll.parentNode) markAll.parentNode.removeChild(markAll);
    if (s.onRead) s.onRead(ids);
  }

  function fillItem(rec, u) {
    rec.item = u.item;
    rec.title.textContent = String(u.item.title || u.item.id);
    rec.text.textContent = u.item.text != null ? String(u.item.text) : '';
    rec.text.hidden = u.item.text == null || u.item.text === '';
    rec.time.textContent = clockOf(u.when);
    rec.node.className = 'ak-notices__item ak-notices__item--' + kindOf(u.item.kind) + (u.item.read ? '' : ' is-unread');
    rec.dot.hidden = !!u.item.read;
  }

  function buildItem(u) {
    const rec = /** @type {any} */ ({
      node: null, item: u.item,
      dot: el('span', { class: 'ak-notices__dot', 'aria-hidden': 'true' }),
      title: el('span', { class: 'ak-notices__itemtitle' }),
      text: el('span', { class: 'ak-notices__text' }),
      time: el('span', { class: 'ak-notices__time' }),
    });
    rec.node = el(u.item.href ? 'a' : 'button', {
      class: 'ak-notices__item', type: u.item.href ? null : 'button',
      href: u.item.href || null, 'data-ak-noguard': true,
      on: { click: function () { if (s.onOpen) s.onOpen(rec.item); } },
    }, [
      el('span', { class: 'ak-notices__mark', 'aria-hidden': 'true' }),
      el('span', { class: 'ak-notices__words' }, [rec.title, rec.text]),
      el('span', { class: 'ak-notices__side' }, [rec.time, rec.dot]),
    ]);
    fillItem(rec, u);
    return rec;
  }

  function render(data) {
    dated = rowsOf(data)
      .filter(function (it) { return it && it.id != null; })
      .map(function (it) {
        const when = new Date(it.at);
        return { item: it, when: isNaN(when.getTime()) ? null : when };
      })
      .sort(function (a, b) { return (b.when ? b.when.getTime() : 0) - (a.when ? a.when.getTime() : 0); });
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    clear(head);
    clear(body);
    if (!dated.length) {
      shown.clear();
      const e = s.empty || {};
      emptyCard = emptyState({
        target: root, tone: 'quiet',
        title: e.title || 'Nothing new', hint: e.hint || 'Notices land here as they arrive.',
      });
      return;
    }
    if (s.title) head.appendChild(el('div', { class: 'ak-notices__title', text: s.title }));
    if (dated.some(function (u) { return !u.item.read; })) head.appendChild(markAll);
    root.appendChild(head);
    root.appendChild(body);
    const live = {};
    dated.forEach(function (u) { live[String(u.item.id)] = 1; });
    Array.from(shown.keys()).forEach(function (id) { if (!live[id]) shown.delete(id); });
    const fresh = [];
    let heading = null;
    dated.forEach(function (u) {
      const label = dayLabel(u.when);
      if (label !== heading) {
        body.appendChild(el('div', { class: 'ak-notices__day', text: label }));
        heading = label;
      }
      const id = String(u.item.id);
      let rec = shown.get(id);
      if (!rec) { rec = buildItem(u); shown.set(id, rec); fresh.push(rec.node); } else { fillItem(rec, u); }
      body.appendChild(rec.node);
    });
    if (!mounted) enter(body);
    else if (fresh.length) stagger(fresh, { from: 'up' });
    mounted = true;
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

/**
 * The facets: filters over a list.
 *
 * Each facet is a labelled group of chips; a multi facet toggles, a single one holds the last
 * pick. Chips are `<button aria-pressed>`, so the keyboard and the screen reader get the state
 * for free. A count that changes through `set({ data })` ROLLS to its new figure rather than
 * blinking, because the same chip node stays in place across a repaint. Every change reports the
 * WHOLE selection, so the app never has to reassemble it.
 *
 * @param {{ target?: string|Element, title?: string,
 *   data?: { facets: Array<{ id: string, label: string, multi?: boolean,
 *     options: Array<{ id: string, label: string, count?: number }> }> },
 *   selected?: Record<string, string[]>,
 *   onChange?: (selection: Record<string, string[]>) => void,
 *   onClear?: () => void,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data?: any, selected?: Record<string, string[]> }) => void,
 *   destroy: () => void }}
 */
export function facets(spec) {
  const s = spec || {};
  const root = el('div', { class: 'ak-root ak-facets' });
  if (s.target) resolve(s.target).appendChild(root);
  const groups = el('div', { class: 'ak-facets__groups' });
  const summary = el('div', { class: 'ak-facets__summary' });
  const tally = el('span', { class: 'ak-facets__tally' });
  const clearAll = el('button', {
    type: 'button', class: 'ak-btn ak-facets__clear', text: 'Clear',
    on: { click: function () { reset(); } },
  }, null);
  /** @type {Map<string, any>} */
  const chips = new Map();
  /** @type {Record<string, string[]>} */
  let picked = {};
  let mounted = false;
  let emptyCard = null;

  function adopt(source) {
    picked = {};
    Object.keys(source || {}).forEach(function (key) {
      const list = source[key];
      if (Array.isArray(list) && list.length) picked[key] = list.slice();
    });
  }
  adopt(s.selected);

  /** @returns {Record<string, string[]>} */
  function selection() {
    /** @type {Record<string, string[]>} */
    const out = {};
    Object.keys(picked).forEach(function (key) { out[key] = picked[key].slice(); });
    return out;
  }

  function paint() {
    chips.forEach(function (rec) {
      const on = (picked[rec.facet.id] || []).indexOf(rec.option.id) >= 0;
      rec.chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const n = Object.keys(picked).reduce(function (sum, key) { return sum + picked[key].length; }, 0);
    clear(summary);
    tally.textContent = n === 0 ? 'No filters' : n === 1 ? '1 filter' : n + ' filters';
    summary.appendChild(tally);
    if (n) {
      summary.appendChild(el('span', { class: 'ak-facets__sep', 'aria-hidden': 'true' }, '·'));
      summary.appendChild(clearAll);
    }
  }

  function toggle(rec) {
    const facet = rec.facet;
    const list = picked[facet.id] ? picked[facet.id].slice() : [];
    const at = list.indexOf(rec.option.id);
    if (facet.multi) {
      if (at >= 0) list.splice(at, 1); else list.push(rec.option.id);
    } else if (at >= 0) {
      list.length = 0;
    } else {
      list.length = 0;
      list.push(rec.option.id);
    }
    if (list.length) picked[facet.id] = list; else delete picked[facet.id];
    paint();
    if (s.onChange) s.onChange(selection());
  }

  function reset() {
    picked = {};
    paint();
    if (s.onClear) s.onClear();
    if (s.onChange) s.onChange(selection());
  }

  function buildChip(facet, option) {
    const rec = /** @type {any} */ ({
      chip: null, facet: facet, option: option,
      label: el('span', { class: 'ak-facets__chiplabel' }),
      count: el('span', { class: 'ak-facets__chipcount' }),
    });
    rec.chip = el('button', {
      type: 'button', class: 'ak-facets__chip', 'aria-pressed': 'false', 'data-ak-noguard': true,
      on: { click: function () { toggle(rec); } },
    }, [rec.label, rec.count]);
    return rec;
  }

  function render(data) {
    const defs = (data && Array.isArray(data.facets) ? data.facets : []).filter(function (f) { return f && f.id; });
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    clear(groups);
    if (!defs.length) {
      chips.clear();
      const e = s.empty || {};
      emptyCard = emptyState({
        target: root, tone: 'quiet',
        title: e.title || 'Nothing to filter by', hint: e.hint,
      });
      return;
    }
    if (s.title) root.appendChild(el('div', { class: 'ak-facets__title', text: s.title }));
    root.appendChild(groups);
    const live = {};
    defs.forEach(function (facet) {
      const row = el('div', { class: 'ak-facets__chips', role: 'group', 'aria-label': String(facet.label || facet.id) });
      (Array.isArray(facet.options) ? facet.options : []).filter(function (o) { return o && o.id; }).forEach(function (option) {
        const key = facet.id + ' ' + option.id;
        live[key] = 1;
        let rec = chips.get(key);
        if (!rec) { chips.set(key, rec = buildChip(facet, option)); } else { rec.facet = facet; rec.option = option; }
        rec.label.textContent = String(option.label || option.id);
        if (typeof option.count === 'number') {
          rec.count.hidden = false;
          odometer(rec.count, option.count);
        } else {
          rec.count.hidden = true;
          rec.count.removeAttribute('data-odo');
          rec.count.textContent = '';
        }
        row.appendChild(rec.chip);
      });
      groups.appendChild(el('div', { class: 'ak-facets__group' }, [
        el('div', { class: 'ak-facets__label', text: String(facet.label || facet.id) }), row,
      ]));
    });
    Array.from(chips.keys()).forEach(function (key) { if (!live[key]) chips.delete(key); });
    root.appendChild(summary);
    paint();
    if (!mounted) enter(groups);
    mounted = true;
  }

  render(s.data);
  return {
    el: root,
    set(patch) {
      if (!patch) return;
      if ('selected' in patch) adopt(patch.selected);
      if ('data' in patch) render(patch.data); else if ('selected' in patch) paint();
    },
    destroy() {
      if (emptyCard) emptyCard.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
