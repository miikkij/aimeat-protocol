/**
 * @file atelier/island.js
 * @description ONE SHAPE THAT BECOMES THE NEXT THING. The island is a single element that changes
 *   its size, its corner rounding and its colour on the look's spring while its content changes
 *   inside it: the old content leaves with a short fade and blur, the new one arrives a moment
 *   later the same way, so the two never overlap as text. Nothing is cut and nothing is replaced;
 *   the eye follows one object from one state to the next.
 *
 *   What it is for: showing work in progress where the person is looking. A small pill says
 *   "Agent is writing…", grows into a card with the result and an Approve button, and shrinks
 *   back to a pill that says it is done.
 *
 *   The state button is the same shape used as a button: pressing it turns the label into a
 *   spinner (the button becomes a circle), then into a check mark that draws itself, then back
 *   into the label. A failure shakes it once and says so in words before it returns.
 *
 *   Under reduced motion the shape and the content change at once. The spinner is the one part
 *   that moves while nothing is touched, and only while the work runs; it has a finite count.
 * @structure island(spec) → { el, set, destroy } · stateButton(spec) → { el, press, set, destroy }
 * @parts island root · content
 * @parts stateButton root · content · spinner · check · status
 * @variants stateButton ghost
 * @tokens island --ak-island-pad · --ak-island-radius
 * @fork island Animate width, height and border-radius yourself and swap the content; you give up the spring, the separate enter and exit timing of the content, and the interruption that continues from where it was.
 * @fork stateButton Use a button with busy(); you give up the spinner, the check and the morph between them.
 * @usage
 *   const isl = AIMEAT.atelier.island({ target: host, content: 'Agent is writing…', shape: 'pill', tone: 'ink' });
 *   isl.set({ content: card, shape: 'card', tone: 'surface' });
 *   AIMEAT.atelier.stateButton({ target: host, label: 'Save', run: () => save(), done: 'Saved' });
 * @version-history
 *   v0.55.0 — 2026-09-28 — Initial (the ten motion parts).
 */
import { el, resolve, motionOff, attention } from './dom.js';
import { paceOf } from './arrive.js';
import { liveSpring } from './springs.js';
import { svg } from './chart-core.js';
import { t } from './i18n.js';

const SHAPES = ['pill', 'bar', 'card', 'circle'];
const TONES = ['ink', 'surface', 'accent', 'ok', 'err'];

/** How long the done and the failed states stay before the button returns to its label. */
const DONE_HOLD = 1600;
const FAIL_HOLD = 2600;

/** Turn a string, a node or a list of them into one content wrapper (a span, so it may sit in a button). */
function wrap(content) {
  return el('span', { class: 'ak-island__content', 'data-ak-part': 'content' }, content == null ? [] : content);
}

/** The corner rounding a shape asks for at a height: a pill and a circle are round. */
function radiusFor(node, h) {
  let r;
  try { r = parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0; } catch { r = 0; }
  return Math.min(r, h / 2);
}

/**
 * The island.
 * @param {{ target?: string|Element, content?: any, shape?: 'pill'|'bar'|'card'|'circle',
 *   tone?: 'ink'|'surface'|'accent'|'ok'|'err', as?: 'div'|'button', label?: string,
 *   live?: boolean, onClick?: (e: Event) => void }} spec
 *   `live` makes the island a polite live region, so a screen reader hears each new state.
 * @returns {{ el: HTMLElement, set: (patch: { content?: any, shape?: string, tone?: string }) => void,
 *   destroy: () => void }}
 */
export function island(spec) {
  const s = spec || {};
  const root = el(s.as === 'button' ? 'button' : 'div', {
    class: 'ak-root ak-island', 'data-ak-part': 'root', type: s.as === 'button' ? 'button' : null,
    'aria-label': s.label || null, 'aria-live': s.live ? 'polite' : null, 'data-ak-noguard': s.as === 'button' ? true : null,
    on: s.onClick ? { click: s.onClick } : null,
  });
  let current = wrap(s.content);
  root.appendChild(current);
  shapeAndTone(s.shape, s.tone);

  const box = { w: 0, h: 0, r: 0 };
  let morphing = false;
  function draw() {
    root.style.width = box.w.toFixed(2) + 'px';
    root.style.height = box.h.toFixed(2) + 'px';
    root.style.borderRadius = Math.max(0, box.r).toFixed(2) + 'px';
  }
  function landed() {
    if (w.moving() || h.moving() || r.moving()) return;
    morphing = false;
    // At rest the island is sized by its content again, so a later change inside the content
    // (a line wrapping, a font arriving) is not held to the last measured box.
    root.style.removeProperty('width');
    root.style.removeProperty('height');
    root.style.removeProperty('border-radius');
  }
  const frame = function (key) {
    return function (x, v) { box[key] = x; if (morphing) draw(); if (v === 0) landed(); };
  };
  const w = liveSpring(frame('w'), { el: root, precision: 0.1 });
  const h = liveSpring(frame('h'), { el: root, precision: 0.1 });
  const r = liveSpring(frame('r'), { el: root, precision: 0.1 });

  function shapeAndTone(shape, tone) {
    if (shape) root.setAttribute('data-ak-shape', SHAPES.indexOf(shape) >= 0 ? shape : 'pill');
    else if (!root.hasAttribute('data-ak-shape')) root.setAttribute('data-ak-shape', 'pill');
    if (tone) root.setAttribute('data-ak-tone', TONES.indexOf(tone) >= 0 ? tone : 'ink');
    else if (!root.hasAttribute('data-ak-tone')) root.setAttribute('data-ak-tone', 'ink');
  }

  /** The old content leaves where it stood: lifted out of the flow, faded and blurred away. */
  function leave(node, pace) {
    const top = node.offsetTop;
    const left = node.offsetLeft;
    const width = node.offsetWidth;
    node.classList.add('ak-island__leaving');
    node.setAttribute('aria-hidden', 'true');
    node.style.top = top + 'px';
    node.style.left = left + 'px';
    node.style.width = width + 'px';
    const drop = function () { if (node.parentNode) node.parentNode.removeChild(node); };
    if (typeof node.animate !== 'function') { drop(); return; }
    const anim = node.animate([
      { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
      { opacity: 0, filter: 'blur(4px)', transform: 'scale(0.96)' },
    ], { duration: Math.max(100, pace.span * 0.7), easing: 'ease-in', fill: 'forwards' });
    anim.onfinish = drop;
    anim.oncancel = drop;
  }
  /** The new content arrives a moment after the old one started to leave, never on top of it. */
  function arrive(node, pace) {
    if (typeof node.animate !== 'function') return;
    node.animate([
      { opacity: 0, filter: 'blur(4px)', transform: 'scale(0.96)' },
      { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
    ], { duration: Math.max(140, pace.span * 1.1), delay: Math.max(60, pace.span * 0.4), easing: pace.ease, fill: 'backwards' });
  }

  function set(patch) {
    const p = patch || {};
    const still = motionOff(root) || !root.isConnected;
    const from = still ? null : { w: root.offsetWidth, h: root.offsetHeight, r: radiusFor(root, root.offsetHeight) };
    const pace = paceOf(root);
    if (Object.prototype.hasOwnProperty.call(p, 'content')) {
      const next = wrap(p.content);
      if (still) { root.replaceChild(next, current); }
      else { leave(current, pace); root.appendChild(next); arrive(next, pace); }
      current = next;
    }
    shapeAndTone(p.shape, p.tone);
    if (still) {
      w.jump(0); h.jump(0); r.jump(0);
      morphing = false;
      root.style.removeProperty('width'); root.style.removeProperty('height'); root.style.removeProperty('border-radius');
      return;
    }
    // Measure where the shape is going: its natural size with the new content and shape.
    root.style.removeProperty('width');
    root.style.removeProperty('height');
    root.style.removeProperty('border-radius');
    const to = { w: root.offsetWidth, h: root.offsetHeight };
    const toR = radiusFor(root, to.h);
    // Then put it back where it was and let the three springs carry it. An island interrupted
    // mid-morph starts from the box it is drawn at, with the speed it had.
    const was = /** @type {{ w: number, h: number, r: number }} */ (from);
    if (!morphing) { w.jump(was.w); h.jump(was.h); r.jump(was.r); }
    box.w = w.value(); box.h = h.value(); box.r = r.value();
    morphing = true;
    draw();
    w.set(to.w); h.set(to.h); r.set(toR);
  }

  if (s.target) resolve(s.target).appendChild(root);
  return {
    el: root,
    set,
    destroy() { w.destroy(); h.destroy(); r.destroy(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/** The check mark, drawn as one stroke that draws itself when it arrives. */
function check() {
  const mark = svg('svg', { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true', class: 'ak-island__check', 'data-ak-part': 'check' });
  mark.appendChild(svg('path', { d: 'M5 12.5l4.2 4.2L19 7', pathLength: 1 }));
  return mark;
}

/**
 * The state button: label → spinner → check mark → label, as one shape. `run` does the work and
 * may return a promise; a rejection or a thrown error is the failed state.
 * @param {{ target?: string|Element, label: string, run: () => any, done?: string, fail?: string,
 *   variant?: 'ghost', disabled?: boolean }} spec
 * @returns {{ el: HTMLElement, press: () => Promise<boolean>, set: (state: 'idle'|'busy'|'done'|'error') => void,
 *   destroy: () => void }}
 */
export function stateButton(spec) {
  const s = spec || { label: '', run() {} };
  let state = 'idle';
  let timer = null;
  const status = el('span', { class: 'ak-sr-only', role: 'status', 'data-ak-part': 'status' });
  const isl = island({ as: 'button', label: s.label, content: s.label, shape: 'pill', tone: s.variant === 'ghost' ? 'surface' : 'accent', onClick: function () { press(); } });
  const root = isl.el;
  root.classList.add('ak-statebtn');
  if (s.variant === 'ghost') root.setAttribute('data-ak-variant', 'ghost');
  if (s.disabled) root.setAttribute('aria-disabled', 'true');
  root.appendChild(status);

  function set(next) {
    clearTimeout(timer);
    state = next;
    const base = s.variant === 'ghost' ? 'surface' : 'accent';
    // The button's name is the state in words, so the status line inside it is not read twice.
    root.setAttribute('aria-label', next === 'busy' ? t('working') : next === 'done' ? (s.done || t('done'))
      : next === 'error' ? (s.fail || t('checkFail')) : s.label);
    if (next === 'busy') {
      root.setAttribute('aria-busy', 'true');
      status.textContent = t('working');
      isl.set({ content: el('span', { class: 'ak-island__spinner', 'data-ak-part': 'spinner', 'aria-hidden': 'true' }), shape: 'circle', tone: base });
      return;
    }
    root.removeAttribute('aria-busy');
    if (next === 'done') {
      status.textContent = s.done || t('done');
      isl.set({ content: s.done ? [check(), el('span', { text: s.done })] : check(), shape: s.done ? 'pill' : 'circle', tone: 'ok' });
      timer = setTimeout(function () { set('idle'); }, DONE_HOLD);
      return;
    }
    if (next === 'error') {
      status.textContent = s.fail || t('checkFail');
      isl.set({ content: s.fail || t('checkFail'), shape: 'pill', tone: 'err' });
      setTimeout(function () { attention(root, 'shake'); }, 60);
      timer = setTimeout(function () { set('idle'); }, FAIL_HOLD);
      return;
    }
    status.textContent = '';
    isl.set({ content: s.label, shape: 'pill', tone: base });
  }

  /** Run the work once; a press while it runs, or while disabled, does nothing. */
  function press() {
    if (state === 'busy' || root.getAttribute('aria-disabled') === 'true') return Promise.resolve(false);
    set('busy');
    let result;
    try { result = s.run(); } catch (err) { result = Promise.reject(err); }
    return Promise.resolve(result).then(function () { set('done'); return true; }, function () { set('error'); return false; });
  }

  if (s.target) resolve(s.target).appendChild(root);
  return {
    el: root,
    press,
    set,
    destroy() { clearTimeout(timer); isl.destroy(); },
  };
}
