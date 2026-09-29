/**
 * @file atelier/menu.js
 * @description The things that open FROM something: a menu under a button, a context menu at the
 *   pointer, a popover with anything in it, and a tooltip on hover or focus.
 *
 *   Each one grows out of the point it was opened from (its transform origin is that point, so a
 *   menu under a button unfolds from the button, and a context menu from the pointer), on the
 *   look's spring, and shrinks back quickly when it closes. A menu's rows arrive a beat apart, and
 *   the highlight is the ink (ink.js): it travels from row to row under the pointer and the arrow
 *   keys, and when a row is chosen it blinks once before the menu closes, so the choice is seen
 *   to land. Under reduced motion everything appears and goes at once and the choice runs at once.
 *
 *   Keyboard: the arrow keys walk the rows, Home and End jump, a letter jumps to the next row that
 *   starts with it, Enter or Space picks, Escape closes and gives focus back to the button, Tab
 *   closes. A pointer down anywhere outside closes. Nothing here fetches.
 * @structure placeAt · openMotion · closeMotion · menu · contextMenu · popover · tooltip
 * @parts menu root · item · label · hint · separator · ink
 * @parts popover root · body
 * @parts tooltip root
 * @tokens menu --ak-menu-min-w · --ak-menu-row-pad
 * @fork menu Build a list of buttons in a positioned box; you give up the growing entrance, the travelling highlight, the pick blink and the keyboard model.
 * @fork popover Put your content in a positioned box; you give up the entrance from the anchor, the outside-click close and the focus return.
 * @usage
 *   AIMEAT.atelier.menu({ anchor: button, items: [{ id: 'rename', label: 'Rename', hint: 'F2' }, '-', { id: 'del', label: 'Delete', danger: true }], onPick(id) {} });
 *   AIMEAT.atelier.contextMenu(row, { items: [...], onPick(id) {} });
 *   AIMEAT.atelier.tooltip(button, 'Copy link');
 * @version-history
 *   v0.59.0 — 2026-09-29 — A menu, a popover and a tooltip wear the look of what opened them
 *     (wearLook): they sit on the body, outside the frame that carries the look's tokens.
 *   v0.55.0 — 2026-09-28 — Initial (the ten motion parts).
 */
import { el, resolve, motionOff, wearLook } from './dom.js';
import { springFrames } from './motion.js';
import { paceOf } from './arrive.js';
import { ink } from './ink.js';

/** The gap between the anchor and what opens from it. */
const GAP = 6;

/** Keep this far from the window's edges. */
const EDGE = 8;

/**
 * Put a floating box beside an anchor box (or at a point), flipped above when it does not fit
 * below, and held inside the window. Returns the transform origin: the point it opened from, in
 * the box's own coordinates.
 * @param {HTMLElement} box
 * @param {{ left: number, top: number, right: number, bottom: number }} at
 * @param {{ align?: 'start'|'end'|'center', placement?: 'below'|'above' }} [o]
 * @returns {string}
 */
export function placeAt(box, at, o) {
  const opts = o || {};
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = opts.placement === 'above' ? at.top - GAP - h : at.bottom + GAP;
  if (top + h > vh - EDGE && at.top - GAP - h >= EDGE) top = at.top - GAP - h;
  if (top < EDGE && at.bottom + GAP + h <= vh - EDGE) top = at.bottom + GAP;
  let left = opts.align === 'end' ? at.right - w : opts.align === 'center' ? (at.left + at.right) / 2 - w / 2 : at.left;
  left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
  top = Math.max(EDGE, Math.min(top, vh - h - EDGE));
  box.style.left = Math.round(left) + 'px';
  box.style.top = Math.round(top) + 'px';
  const ox = Math.max(0, Math.min(w, (at.left + at.right) / 2 - left));
  const oy = top >= at.bottom ? 0 : top + h <= at.top ? h : h / 2;
  return ox.toFixed(0) + 'px ' + oy.toFixed(0) + 'px';
}

/**
 * The entrance: from a little smaller and transparent at the origin to full size, on the look's
 * spring. The overshoot is the look's; the kit adds none.
 * @param {HTMLElement} box @param {string} origin
 * @returns {void}
 */
export function openMotion(box, origin) {
  box.style.transformOrigin = origin;
  if (motionOff(box) || typeof box.animate !== 'function') return;
  const sf = springFrames({ el: box });
  const frames = sf.samples.map(function (at, i) {
    const s = 0.9 + 0.1 * at;
    return { offset: i / (sf.samples.length - 1), transform: 'scale(' + s.toFixed(4) + ')', opacity: Math.min(1, at * 1.6) };
  });
  box.animate(frames, { duration: sf.duration, easing: 'linear' });
}

/**
 * The exit: a short shrink and fade toward the origin, then `done`.
 * @param {HTMLElement} box @param {() => void} done
 * @returns {void}
 */
export function closeMotion(box, done) {
  if (motionOff(box) || typeof box.animate !== 'function') { done(); return; }
  const pace = paceOf(box);
  const anim = box.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.95)' }],
    { duration: Math.max(90, pace.span * 0.6), easing: 'ease-in', fill: 'forwards' });
  anim.onfinish = done;
  anim.oncancel = done;
}

/** Close anything open when a pointer lands outside it. @returns {() => void} the unhook */
function outside(nodes, close) {
  const hit = function (e) {
    for (const n of nodes) if (n && n.contains(/** @type {Node} */ (e.target))) return;
    close();
  };
  document.addEventListener('pointerdown', hit, true);
  return function () { document.removeEventListener('pointerdown', hit, true); };
}

/**
 * @typedef {{ id: string, label: string, hint?: string, danger?: boolean, disabled?: boolean,
 *   run?: () => void }} MenuItem
 */

/**
 * The menu. With `anchor` it opens from that button (the button gets aria-haspopup and
 * aria-expanded and toggles it on click); with `open({ x, y })` it opens at a point.
 * @param {{ anchor?: string|Element, items: Array<MenuItem|'-'>, onPick?: (id: string, item: MenuItem) => void,
 *   align?: 'start'|'end', label?: string }} spec
 * @returns {{ open: (at?: { x: number, y: number }, fromKeys?: boolean) => void, close: (focusBack?: boolean) => void,
 *   isOpen: () => boolean, set: (patch: { items?: Array<MenuItem|'-'> }) => void, destroy: () => void }}
 */
export function menu(spec) {
  const s = spec || { items: [] };
  const anchor = s.anchor ? /** @type {HTMLElement} */ (resolve(s.anchor)) : null;
  let items = s.items || [];
  let box = null;
  let mark = null;
  let unhook = null;
  let cursor = -1;
  let picking = false;

  if (anchor) {
    anchor.setAttribute('aria-haspopup', 'menu');
    anchor.setAttribute('aria-expanded', 'false');
  }

  function rows() {
    return box ? /** @type {HTMLElement[]} */ (Array.prototype.slice.call(box.querySelectorAll('.ak-menu__item:not([aria-disabled="true"])'))) : [];
  }
  function focusRow(i) {
    const list = rows();
    if (!list.length) return;
    cursor = (i + list.length) % list.length;
    list.forEach(function (r, j) { r.classList.toggle('ak-menu__item--on', j === cursor); });
    list[cursor].focus({ preventScroll: true });
    if (mark) mark.sync();
  }
  function choose(item) {
    if (picking || !item || item.disabled) return;
    picking = true;
    const finish = function () {
      picking = false;
      close(true);
      if (item.run) item.run();
      if (s.onPick) s.onPick(item.id, item);
    };
    if (!box || motionOff(box) || !mark || typeof mark.el.animate !== 'function') { finish(); return; }
    // THE BLINK: the highlight goes out and comes back once, the way a desktop menu confirms a
    // choice, so the person sees their pick land before the menu is gone.
    const blink = mark.el.animate([{ opacity: 1 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: 150, easing: 'linear' });
    blink.onfinish = finish;
    blink.oncancel = finish;
  }
  function onKey(e) {
    const list = rows();
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(cursor + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(cursor < 0 ? list.length - 1 : cursor - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusRow(0); }
    else if (e.key === 'End') { e.preventDefault(); focusRow(list.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') { close(false); }
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const ch = e.key.toLowerCase();
      for (let k = 1; k <= list.length; k++) {
        const j = (cursor + k) % list.length;
        if ((list[j].textContent || '').trim().toLowerCase().indexOf(ch) === 0) { focusRow(j); break; }
      }
    }
  }
  function build() {
    const root = el('div', { class: 'ak-root ak-menu', role: 'menu', 'data-ak-part': 'root', 'aria-label': s.label || null, tabindex: '-1', on: { keydown: onKey } });
    items.forEach(function (it) {
      if (it === '-') { root.appendChild(el('div', { class: 'ak-menu__sep', role: 'separator', 'data-ak-part': 'separator' })); return; }
      root.appendChild(el('button', {
        type: 'button', role: 'menuitem', class: 'ak-menu__item' + (it.danger ? ' ak-menu__item--danger' : ''),
        'data-ak-part': 'item', 'data-ak-id': it.id, tabindex: '-1', 'data-ak-noguard': true,
        'aria-disabled': it.disabled ? 'true' : null,
        on: {
          click: function () { choose(it); },
          pointermove: function (e) {
            if (it.disabled) return;
            const i = rows().indexOf(/** @type {HTMLElement} */ (e.currentTarget));
            if (i >= 0 && i !== cursor) focusRow(i);
          },
        },
      }, [
        el('span', { class: 'ak-menu__label', 'data-ak-part': 'label', text: it.label }),
        it.hint ? el('span', { class: 'ak-menu__hint', 'data-ak-part': 'hint', text: it.hint }) : null,
      ]));
    });
    return root;
  }
  /** @param {{ x: number, y: number }} [at] @param {boolean} [fromKeys] a keyboard opened it: the first row takes focus */
  function open(at, fromKeys) {
    if (box) return;
    box = build();
    document.body.appendChild(wearLook(box, anchor));
    const r = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y }
      : anchor ? anchor.getBoundingClientRect() : { left: EDGE, right: EDGE, top: EDGE, bottom: EDGE };
    const origin = placeAt(box, r, { align: s.align });
    mark = ink(box, { axis: 'y', active: '.ak-menu__item--on', className: 'ak-menu__ink' });
    openMotion(box, origin);
    // The rows arrive a beat apart, top to bottom, inside the box's own entrance.
    if (!motionOff(box)) {
      const pace = paceOf(box);
      rows().forEach(function (row, i) {
        if (typeof row.animate === 'function') {
          row.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }],
            { duration: pace.span, delay: 20 + i * 18, easing: pace.ease, fill: 'backwards' });
        }
      });
    }
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    unhook = outside([box, anchor], function () { close(false); });
    cursor = -1;
    box.focus({ preventScroll: true });
    if (fromKeys) focusRow(0);
  }
  function close(focusBack) {
    if (!box) return;
    const gone = box;
    box = null;
    if (mark) { mark.destroy(); mark = null; }
    if (unhook) { unhook(); unhook = null; }
    if (anchor) anchor.setAttribute('aria-expanded', 'false');
    closeMotion(gone, function () { if (gone.parentNode) gone.parentNode.removeChild(gone); });
    if (focusBack && anchor) anchor.focus({ preventScroll: true });
  }
  // A click with detail 0 came from Enter or Space on the button, not from a pointer.
  const onAnchor = function (e) { if (box) close(true); else open(undefined, !!e && e.detail === 0); };
  const onAnchorKey = function (e) {
    if (e.key === 'ArrowDown' && !box) { e.preventDefault(); open(undefined, true); }
  };
  if (anchor) {
    anchor.addEventListener('click', onAnchor);
    anchor.addEventListener('keydown', onAnchorKey);
  }
  return {
    open,
    close,
    isOpen() { return !!box; },
    set(patch) { if (patch && patch.items) { items = patch.items; if (box) { close(false); open(); } } },
    destroy() {
      close(false);
      if (anchor) { anchor.removeEventListener('click', onAnchor); anchor.removeEventListener('keydown', onAnchorKey); }
    },
  };
}

/**
 * The context menu: the same menu, opened at the pointer by a right click or a long press
 * (the browser's contextmenu event covers both), and by Shift+F10 at the element's corner.
 * @param {string|Element} target
 * @param {{ items: Array<MenuItem|'-'>, onPick?: (id: string, item: MenuItem) => void, label?: string }} spec
 * @returns {{ close: () => void, destroy: () => void }}
 */
export function contextMenu(target, spec) {
  const node = /** @type {HTMLElement} */ (resolve(target));
  const m = menu({ items: spec.items, onPick: spec.onPick, label: spec.label });
  const onCtx = function (e) { e.preventDefault(); m.close(false); m.open({ x: e.clientX, y: e.clientY }); };
  const onKey = function (e) {
    if (e.key === 'F10' && e.shiftKey) {
      e.preventDefault();
      const r = node.getBoundingClientRect();
      m.close(false);
      m.open({ x: r.left + 12, y: r.top + 12 }, true);
    }
  };
  node.addEventListener('contextmenu', onCtx);
  node.addEventListener('keydown', onKey);
  return {
    close() { m.close(false); },
    destroy() { m.destroy(); node.removeEventListener('contextmenu', onCtx); node.removeEventListener('keydown', onKey); },
  };
}

/**
 * The popover: any content in a box that opens from its anchor on click, and closes on Escape,
 * on a click outside, or on close().
 * @param {{ anchor: string|Element, content: string|Node|(() => Node), align?: 'start'|'end'|'center',
 *   label?: string, onOpen?: () => void, onClose?: () => void }} spec
 * @returns {{ open: () => void, close: () => void, isOpen: () => boolean, destroy: () => void }}
 */
export function popover(spec) {
  const anchor = /** @type {HTMLElement} */ (resolve(spec.anchor));
  let box = null;
  let unhook = null;
  anchor.setAttribute('aria-expanded', 'false');
  function open() {
    if (box) return;
    const body = typeof spec.content === 'function' ? spec.content() : spec.content;
    box = el('div', { class: 'ak-root ak-popover', role: 'dialog', 'aria-label': spec.label || null, 'data-ak-part': 'root', tabindex: '-1',
      on: { keydown: function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); anchor.focus(); } } } },
    [el('div', { class: 'ak-popover__body', 'data-ak-part': 'body' }, body)]);
    document.body.appendChild(wearLook(box, anchor));
    openMotion(box, placeAt(box, anchor.getBoundingClientRect(), { align: spec.align || 'center' }));
    anchor.setAttribute('aria-expanded', 'true');
    unhook = outside([box, anchor], close);
    box.focus({ preventScroll: true });
    if (spec.onOpen) spec.onOpen();
  }
  function close() {
    if (!box) return;
    const gone = box;
    box = null;
    if (unhook) { unhook(); unhook = null; }
    anchor.setAttribute('aria-expanded', 'false');
    closeMotion(gone, function () { if (gone.parentNode) gone.parentNode.removeChild(gone); });
    if (spec.onClose) spec.onClose();
  }
  const onClick = function () { if (box) close(); else open(); };
  anchor.addEventListener('click', onClick);
  return { open, close, isOpen() { return !!box; }, destroy() { close(); anchor.removeEventListener('click', onClick); } };
}

/**
 * The tooltip: a short line that grows from the element after a short wait on hover, at once on
 * keyboard focus, and goes when the pointer or the focus leaves. The element is described by it.
 * @param {string|Element} target
 * @param {string} text
 * @param {{ delay?: number, placement?: 'above'|'below' }} [opts]
 * @returns {{ set: (text: string) => void, destroy: () => void }}
 */
export function tooltip(target, text, opts) {
  const node = /** @type {HTMLElement} */ (resolve(target));
  const o = opts || {};
  const tip = el('div', { class: 'ak-root ak-tooltip', role: 'tooltip', 'data-ak-part': 'root', id: 'ak-tip-' + Math.random().toString(36).slice(2, 8), text: text });
  let timer = null;
  let shown = false;
  node.setAttribute('aria-describedby', tip.id);
  function show() {
    clearTimeout(timer);
    if (shown) return;
    shown = true;
    document.body.appendChild(wearLook(tip, node));
    openMotion(tip, placeAt(tip, node.getBoundingClientRect(), { align: 'center', placement: o.placement || 'above' }));
  }
  function hide() {
    clearTimeout(timer);
    if (!shown) return;
    shown = false;
    closeMotion(tip, function () { if (!shown && tip.parentNode) tip.parentNode.removeChild(tip); });
  }
  const enter = function () { clearTimeout(timer); timer = setTimeout(show, o.delay != null ? o.delay : 450); };
  const key = function (e) { if (e.key === 'Escape') hide(); };
  node.addEventListener('pointerenter', enter);
  node.addEventListener('pointerleave', hide);
  node.addEventListener('focus', show);
  node.addEventListener('blur', hide);
  node.addEventListener('keydown', key);
  return {
    set(next) { tip.textContent = next; },
    destroy() {
      hide();
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', hide);
      node.removeEventListener('focus', show);
      node.removeEventListener('blur', hide);
      node.removeEventListener('keydown', key);
      node.removeAttribute('aria-describedby');
    },
  };
}
