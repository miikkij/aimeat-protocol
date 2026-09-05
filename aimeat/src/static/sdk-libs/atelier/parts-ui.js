/**
 * @file atelier/parts-ui.js
 * @description Four of the nine parts the Atelier Next canvas found the kit lacked (accepted
 *   2026-09-01) — the behaviour-shaped ones, component-only on purpose (a modal is behaviour,
 *   not layout, the dialog family's own rule):
 *     toast    the stacked confirmation with an undo, finite by timer
 *     palette  the command palette — one keystroke to every declared action
 *     compare  two states under one handle (pointer or arrow keys)
 *     tour     a few steps over the real screen, then gone
 *   Nothing here fetches; every part renders what it is given and reports what happens.
 * @structure toast · palette · compare · tour
 * @usage
 *   AIMEAT.atelier.toast({ title: 'Part adopted', sub: 'shop.html', action: { label: 'Undo', onPick } });
 *   AIMEAT.atelier.palette({ items: [{ id: 'adopt', label: 'Adopt…', run() {} }], hotkey: 'k' });
 * @version-history
 *   v0.50.0 — 2026-09-05 — A toast arrives and LEAVES: it rose in only by way of its own
 *     children before, and vanished with no exit at all — a confirmation that blinks out mid-read
 *     reads as a bug rather than as a message ending.
 *   v0.42.0 — 2026-09-01 — Initial (wish-atelier-night-gallery, stage 3).
 */
import { el, clear, resolve, enter, reducedMotion, motionOff } from './dom.js';
import { fadeIn, paceOf } from './arrive.js';

let toastHost = null;

/**
 * A toast on the stack, bottom right. Leaves on its own after `ttl` ms (0 keeps it until
 * dismissed), or when the action is taken.
 * @param {{ title: string, sub?: string, tone?: 'ok'|'warn'|'err', ttl?: number,
 *   action?: { label: string, onPick: () => void } }} spec
 * @returns {{ el: HTMLElement, close: () => void }}
 */
export function toast(spec) {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = el('div', { class: 'ak-root ak-toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  let timer = null;
  const node = el('div', { class: 'ak-toast' + (spec.tone ? ' ak-toast--' + spec.tone : '') }, [
    el('div', { class: 'ak-toast__body' }, [
      el('div', { class: 'ak-toast__title' }, spec.title),
      spec.sub ? el('div', { class: 'ak-toast__sub' }, spec.sub) : null,
    ].filter(Boolean)),
    spec.action ? el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', on: {
      click: function () { spec.action.onPick(); close(); },
    } }, spec.action.label) : null,
  ].filter(Boolean));
  // A toast ARRIVES and LEAVES. It appeared out of nothing and vanished the same way until
  // 0.50.0, which is the one shape where motion is not decoration: a confirmation nobody saw
  // arrive reads as a page glitch, and one that blinks out mid-read reads as a bug.
  const pace = paceOf(node);
  function close() {
    if (timer) clearTimeout(timer);
    const drop = function () { if (node.parentNode) node.parentNode.removeChild(node); };
    if (motionOff(node) || typeof node.animate !== 'function') { drop(); return; }
    const anim = node.animate(
      [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(' + (pace.dist || 8) + 'px)' }],
      { duration: pace.span, easing: 'ease-in' },
    );
    anim.onfinish = drop;
    anim.oncancel = drop;
  }
  toastHost.appendChild(node);
  fadeIn(node, pace, 0);
  enter(node);
  const ttl = spec.ttl == null ? 6000 : spec.ttl;
  if (ttl > 0) timer = setTimeout(close, ttl);
  return { el: node, close };
}

/**
 * The command palette: opens on the hotkey (Ctrl/⌘ + `hotkey`, default k) or on `open()`,
 * filters the declared items as the person types, runs the chosen one, and closes. Escape and
 * a click on the scrim close it; the list is walked with the arrow keys.
 * @param {{ items: Array<{ id: string, label: string, hint?: string, run: () => void }>,
 *   placeholder?: string, hotkey?: string|false, empty?: string }} spec
 * @returns {{ open: () => void, close: () => void, destroy: () => void }}
 */
export function palette(spec) {
  const s = spec || { items: [] };
  let root = null;
  let cursor = 0;
  let shown = [];

  function close() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
  }
  function paintList(list) {
    clear(list);
    if (!shown.length) { list.appendChild(el('li', { class: 'ak-palette__empty' }, s.empty || 'Nothing matches.')); return; }
    shown.forEach(function (it, i) {
      list.appendChild(el('li', { class: 'ak-palette__item', role: 'option', 'aria-selected': i === cursor ? 'true' : 'false', on: {
        click: function () { close(); it.run(); },
        mousemove: function () { if (cursor !== i) { cursor = i; paintList(list); } },
      } }, [el('span', {}, it.label), it.hint ? el('span', { class: 'ak-palette__hint' }, it.hint) : null].filter(Boolean)));
    });
  }
  function open() {
    if (root) return;
    cursor = 0;
    shown = s.items.slice();
    const list = el('ul', { class: 'ak-palette__list', role: 'listbox' });
    const input = el('input', { class: 'ak-palette__input', type: 'text', placeholder: s.placeholder || 'go to, run, adopt…', autocomplete: 'off', on: {
      input: function () {
        const q = /** @type {HTMLInputElement} */ (input).value.trim().toLowerCase();
        shown = s.items.filter(function (it) { return !q || (it.label + ' ' + (it.hint || '')).toLowerCase().indexOf(q) >= 0; });
        cursor = 0;
        paintList(list);
      },
      keydown: function (e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(cursor + 1, shown.length - 1); paintList(list); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(cursor - 1, 0); paintList(list); }
        else if (e.key === 'Enter') { e.preventDefault(); const it = shown[cursor]; if (it) { close(); it.run(); } }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
      },
    } });
    root = el('div', { class: 'ak-root ak-palette', on: { click: function (e) { if (e.target === root) close(); } } }, [
      el('div', { class: 'ak-palette__box', role: 'dialog', 'aria-modal': 'true', 'aria-label': s.placeholder || 'Commands' }, [input, list]),
    ]);
    paintList(list);
    document.body.appendChild(root);
    input.focus();
  }
  const key = s.hotkey === undefined ? 'k' : s.hotkey;
  const onKey = function (e) {
    if (!key) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === key) { e.preventDefault(); if (root) close(); else open(); }
  };
  window.addEventListener('keydown', onKey);
  return { open, close, destroy() { close(); window.removeEventListener('keydown', onKey); } };
}

/**
 * The compare slider: the `before` and `after` layers (each an element, an image URL, or a
 * text label) under one handle the pointer drags and the arrow keys nudge.
 * @param {{ target?: string|Element, before: { label?: string, el?: Element, image?: string },
 *   after: { label?: string, el?: Element, image?: string }, value?: number,
 *   onChange?: (pct: number) => void }} spec
 * @returns {{ el: HTMLElement, set: (pct: number) => void, destroy: () => void }}
 */
export function compare(spec) {
  const s = spec || { before: {}, after: {} };
  function layer(side, cls) {
    const body = side.el ? side.el : side.image ? el('img', { src: side.image, alt: side.label || '' }) : el('span', {}, side.label || '');
    return el('div', { class: 'ak-compare__layer ' + cls }, [body]);
  }
  const handle = el('button', { type: 'button', class: 'ak-compare__handle', 'aria-label': 'Compare', role: 'slider', 'aria-valuemin': '0', 'aria-valuemax': '100' }, '⇄');
  const root = el('div', { class: 'ak-root ak-compare' }, [
    layer(s.before || {}, 'ak-compare__before'),
    layer(s.after || {}, 'ak-compare__after'),
    (s.before && s.before.label) ? el('span', { class: 'ak-compare__label ak-compare__label--before' }, s.before.label) : null,
    (s.after && s.after.label) ? el('span', { class: 'ak-compare__label ak-compare__label--after' }, s.after.label) : null,
    el('div', { class: 'ak-compare__bar' }),
    handle,
  ].filter(Boolean));
  if (s.target) resolve(s.target).appendChild(root);
  let pct = typeof s.value === 'number' ? s.value : 50;
  function set(v) {
    pct = Math.max(0, Math.min(Number(v) || 0, 100));
    root.style.setProperty('--ak-compare', pct + '%');
    handle.setAttribute('aria-valuenow', String(Math.round(pct)));
    if (s.onChange) s.onChange(pct);
  }
  let dragging = false;
  function at(e) {
    const r = root.getBoundingClientRect();
    set(((e.clientX - r.left) / Math.max(r.width, 1)) * 100);
  }
  root.addEventListener('pointerdown', function (e) { dragging = true; root.setPointerCapture(e.pointerId); at(e); });
  root.addEventListener('pointermove', function (e) { if (dragging) at(e); });
  root.addEventListener('pointerup', function () { dragging = false; });
  root.addEventListener('pointercancel', function () { dragging = false; });
  handle.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); set(pct - 5); }
    if (e.key === 'ArrowRight') { e.preventDefault(); set(pct + 5); }
  });
  set(pct);
  return { el: root, set, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

/**
 * The tour: each step marks one element on the real screen and says one thing beside it;
 * Next walks on, Escape or Done ends it, and nothing of it remains afterwards.
 * @param {{ steps: Array<{ target: string|Element, text: string }>, onDone?: () => void,
 *   labels?: { next?: string, done?: string, skip?: string } }} spec
 * @returns {{ start: () => void, end: () => void }}
 */
export function tour(spec) {
  const s = spec || { steps: [] };
  const L = Object.assign({ next: 'Next', done: 'Done', skip: 'Skip' }, s.labels || {});
  let i = -1;
  let note = null;
  let marked = null;

  function place() {
    if (!note || !marked) return;
    const r = marked.getBoundingClientRect();
    const w = note.offsetWidth || 260;
    const top = r.bottom + 12;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    note.style.top = (top + (note.offsetHeight || 0) > window.innerHeight ? Math.max(8, r.top - (note.offsetHeight || 0) - 12) : top) + 'px';
    note.style.left = left + 'px';
  }
  function show(n) {
    clearStep();
    const step = s.steps[n];
    if (!step) { end(); return; }
    i = n;
    const target = typeof step.target === 'string' ? document.querySelector(step.target) : step.target;
    if (!target) { show(n + 1); return; }
    marked = /** @type {HTMLElement} */ (target);
    marked.classList.add('ak-tour__mark');
    if (!reducedMotion()) marked.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const last = n === s.steps.length - 1;
    note = el('div', { class: 'ak-root ak-tour__note', role: 'dialog', 'aria-live': 'polite' }, [
      el('div', {}, [el('span', { class: 'ak-tour__step' }, (n + 1) + '/' + s.steps.length), el('span', {}, step.text)]),
      el('div', { class: 'ak-tour__nav' }, [
        el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', on: { click: function () { if (last) end(); else show(n + 1); } } }, last ? L.done : L.next),
        last ? null : el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', on: { click: end } }, L.skip),
      ].filter(Boolean)),
    ]);
    document.body.appendChild(note);
    place();
  }
  function clearStep() {
    if (marked) marked.classList.remove('ak-tour__mark');
    if (note && note.parentNode) note.parentNode.removeChild(note);
    marked = null; note = null;
  }
  function onKey(e) { if (e.key === 'Escape') end(); }
  function end() {
    clearStep();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', place);
    if (i >= 0 && s.onDone) s.onDone();
    i = -1;
  }
  function start() {
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    show(0);
  }
  return { start, end };
}
