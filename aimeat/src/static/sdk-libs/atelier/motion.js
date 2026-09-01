/**
 * @file atelier/motion.js
 * @description The kit's own motion primitives, on the Web Animations API and nothing else
 *   (wish-atelier-motion-libraries-and-parts, stage 2). Five moves every part can ride without a
 *   dependency; each one is finite, runs under the hand or on a change, and is a no-op under
 *   reduced motion (the final state is set, the travel is skipped):
 *
 *     spring(el, to, opts)         the element travels to a transform/opacity on a real spring
 *     stagger(els, opts)           the entrance for a SET of elements, each a beat after the last
 *     inView(el, fn, opts)         run once when the element scrolls into view
 *     scrollLink(el, frames, opts) keyframes bound to scroll progress, not to time
 *     drag(el, handlers, opts)     pointer drag with the spring return
 *
 *   The spring is sampled into keyframes, so it plays on every browser the kit supports, and
 *   its feel (stiffness, damping, mass) is a number an app can name — the same three the
 *   vendored Motion pack uses, so a value tuned here reads the same there.
 * @structure springFrames · spring · stagger · inView · scrollLink · drag
 * @usage
 *   AIMEAT.atelier.spring(card, { x: 0, scale: 1 }, { stiffness: 220, damping: 18 });
 *   AIMEAT.atelier.stagger(list.children, { from: 'up', each: 40 });
 *   AIMEAT.atelier.inView(section, function (el) { el.classList.add('is-seen'); });
 *   AIMEAT.atelier.scrollLink(hero, [{ opacity: 1 }, { opacity: 0 }], { range: [0, 0.6] });
 *   AIMEAT.atelier.drag(handle, { onEnd(dx, dy) { if (dx > 80) accept(); } });
 * @version-history
 *   v0.44.0 — 2026-09-02 — Initial.
 */
import { resolve, reducedMotion } from './dom.js';

/** The transform state the spring keeps per element (a transform string cannot be read back). */
const STATE = new WeakMap();

const REST = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };

function stateOf(node) {
  let s = STATE.get(node);
  if (!s) { s = Object.assign({}, REST); STATE.set(node, s); }
  return s;
}

function transformOf(s) {
  return 'translate(' + s.x + 'px, ' + s.y + 'px) scale(' + s.scale + ') rotate(' + s.rotate + 'deg)';
}

/**
 * Sample a damped spring from 0 to 1. Returns the progress samples and the time they span, so
 * the caller can turn them into keyframes (each sample is one frame at a fixed step).
 * @param {{ stiffness?: number, damping?: number, mass?: number, velocity?: number }} [opts]
 * @returns {{ samples: number[], duration: number }}
 */
export function springFrames(opts) {
  const o = opts || {};
  const k = o.stiffness || 170;
  const c = o.damping || 20;
  const m = o.mass || 1;
  const v0 = o.velocity || 0;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  const step = 1 / 60;
  const samples = [];
  let t = 0;
  let x;
  let settled = 0;
  while (t < 4) {
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      const decay = Math.exp(-zeta * w0 * t);
      x = 1 - decay * (Math.cos(wd * t) + ((zeta * w0 - v0) / wd) * Math.sin(wd * t));
    } else {
      const decay = Math.exp(-w0 * t);
      x = 1 - decay * (1 + (w0 - v0) * t);
    }
    samples.push(x);
    settled = Math.abs(1 - x) < 0.001 ? settled + 1 : 0;
    if (settled > 6) break;
    t += step;
  }
  samples.push(1);
  return { samples, duration: Math.round(samples.length * step * 1000) };
}

/**
 * The spring: travel to a target transform/opacity from wherever the element is now. The next
 * call cancels the one in flight and starts from the interrupted state, so a hand that changes
 * its mind gets a new spring, not a jump.
 * @param {Element|string} target
 * @param {{ x?: number, y?: number, scale?: number, rotate?: number, opacity?: number }} to
 * @param {{ stiffness?: number, damping?: number, mass?: number, velocity?: number }} [opts]
 * @returns {{ el: Element, finished: Promise<void>, cancel: () => void }}
 */
export function spring(target, to, opts) {
  const node = /** @type {HTMLElement} */ (resolve(target));
  const from = Object.assign({}, stateOf(node));
  const dest = Object.assign({}, from, to || {});
  const prior = /** @type {any} */ (node).__akSpring;
  if (prior) {
    // Read the interrupted position off the running animation before cancelling it.
    const p = prior.effect && prior.effect.getComputedTiming ? prior.effect.getComputedTiming().progress : null;
    if (typeof p === 'number') {
      const at = prior.__frames[Math.min(prior.__frames.length - 1, Math.round(p * (prior.__frames.length - 1)))];
      Object.keys(from).forEach(function (key) { from[key] = prior.__from[key] + (prior.__to[key] - prior.__from[key]) * at; });
    }
    prior.cancel();
  }
  STATE.set(node, dest);
  if (reducedMotion() || typeof node.animate !== 'function') {
    node.style.transform = transformOf(dest);
    node.style.opacity = String(dest.opacity);
    return { el: node, finished: Promise.resolve(), cancel() { /* nothing in flight */ } };
  }
  const sf = springFrames(opts);
  const frames = sf.samples.map(function (at, i) {
    const s = {};
    Object.keys(from).forEach(function (key) { s[key] = from[key] + (dest[key] - from[key]) * at; });
    return { offset: i / (sf.samples.length - 1), transform: transformOf(s), opacity: s.opacity };
  });
  const anim = /** @type {any} */ (node.animate(frames, { duration: sf.duration, easing: 'linear', fill: 'forwards' }));
  anim.__frames = sf.samples; anim.__from = from; anim.__to = dest;
  /** @type {any} */ (node).__akSpring = anim;
  const finished = anim.finished.then(function () {
    node.style.transform = transformOf(dest);
    node.style.opacity = String(dest.opacity);
    anim.cancel();
    if (/** @type {any} */ (node).__akSpring === anim) /** @type {any} */ (node).__akSpring = null;
  }, function () { /* cancelled by the next spring */ });
  return { el: node, finished, cancel() { anim.cancel(); } };
}

/**
 * The staggered entrance for a set of elements (not only one parent's children, which `enter`
 * covers): each one rises, slides or grows into place a beat after the last. Distance and pace
 * come from the look's tokens unless the call names them.
 * @param {ArrayLike<Element>|Element|string} targets
 * @param {{ from?: 'up'|'down'|'left'|'right'|'scale', each?: number, distance?: number,
 *   duration?: number, spring?: boolean, max?: number }} [opts]
 * @returns {{ finished: Promise<void> }}
 */
export function stagger(targets, opts) {
  const o = opts || {};
  const list = typeof targets === 'string' ? Array.prototype.slice.call(document.querySelectorAll(targets))
    : (/** @type {any} */ (targets)).length !== undefined ? Array.prototype.slice.call(/** @type {any} */ (targets))
      : [targets];
  const kids = list.slice(0, o.max || 40);
  if (!kids.length || reducedMotion() || typeof kids[0].animate !== 'function') return { finished: Promise.resolve() };
  const cs = getComputedStyle(kids[0]);
  const dist = o.distance !== undefined ? o.distance : (parseFloat(cs.getPropertyValue('--ak-enter-distance')) || 12);
  const each = o.each !== undefined ? o.each : (parseFloat(cs.getPropertyValue('--ak-enter-stagger')) || 40);
  const span = o.duration || (parseFloat(cs.getPropertyValue('--ak-motion')) || 200) * 1.5;
  const ease = (cs.getPropertyValue('--ak-ease') || '').trim() || 'cubic-bezier(0.2, 0.7, 0.3, 1)';
  const start = o.from === 'down' ? 'translateY(-' + dist + 'px)'
    : o.from === 'left' ? 'translateX(-' + dist + 'px)'
      : o.from === 'right' ? 'translateX(' + dist + 'px)'
        : o.from === 'scale' ? 'scale(0.92)'
          : 'translateY(' + dist + 'px)';
  const end = o.from === 'scale' ? 'scale(1)' : 'translate(0, 0)';
  let frames = [{ opacity: 0, transform: start }, { opacity: 1, transform: end }];
  let timing = { duration: span, easing: ease, fill: 'backwards' };
  if (o.spring) {
    const sf = springFrames({ stiffness: 200, damping: 16 });
    frames = sf.samples.map(function (at, i) {
      return { offset: i / (sf.samples.length - 1), opacity: Math.min(1, at * 1.4),
        transform: o.from === 'scale' ? 'scale(' + (0.92 + 0.08 * at) + ')' : start.replace(/[-\d.]+px/, function (px) { return (parseFloat(px) * (1 - at)).toFixed(2) + 'px'; }) };
    });
    timing = { duration: sf.duration, easing: 'linear', fill: 'backwards' };
  }
  const runs = kids.map(function (kid, i) {
    return kid.animate(frames, Object.assign({}, timing, { delay: i * each })).finished;
  });
  return { finished: Promise.all(runs).then(function () { /* settled */ }, function () { /* cancelled */ }) };
}

/**
 * Run something once (by default) when the element comes into view: the counter that starts
 * counting, the section that plays its entrance, the image that loads. `fn` gets the element and
 * the intersection entry. Returns a handle to stop watching.
 * @param {Element|string} target
 * @param {(el: Element, entry: IntersectionObserverEntry) => void} fn
 * @param {{ once?: boolean, margin?: string, threshold?: number, onLeave?: (el: Element) => void }} [opts]
 * @returns {{ el: Element, destroy: () => void }}
 */
export function inView(target, fn, opts) {
  const node = resolve(target);
  const o = opts || {};
  if (typeof IntersectionObserver !== 'function') {
    fn(node, /** @type {any} */ ({ isIntersecting: true, target: node }));
    return { el: node, destroy() { /* nothing to stop */ } };
  }
  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        fn(node, entry);
        if (o.once !== false) io.disconnect();
      } else if (o.onLeave) {
        o.onLeave(node);
      }
    });
  }, { rootMargin: o.margin || '0px 0px -10% 0px', threshold: o.threshold || 0.15 });
  io.observe(node);
  return { el: node, destroy() { io.disconnect(); } };
}

/** The nearest ancestor whose overflow scrolls, or the window. */
function nearestScroller(node) {
  let p = node.parentElement;
  while (p && p !== document.body) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return window;
}

/**
 * Keyframes driven by scroll instead of time: the element's animation is paused and its clock
 * is set from how far the element has travelled through the viewport (0 = its top enters at
 * the bottom, 1 = its bottom leaves at the top), or through the range the call names. Works on
 * every browser through a paused Web Animation; under reduced motion the element stays at the
 * first frame.
 * @param {Element|string} target
 * @param {Keyframe[]} frames
 * @param {{ range?: [number, number], scroller?: Element|Window, subject?: Element }} [opts]
 * @returns {{ el: Element, progress: () => number, destroy: () => void }}
 */
export function scrollLink(target, frames, opts) {
  const node = /** @type {HTMLElement} */ (resolve(target));
  const o = opts || {};
  const subject = o.subject || node;
  // The scroller is the nearest ancestor that scrolls, unless the call names one: an app shell's
  // main pane is its own scroll box, and a window listener would never hear it move.
  const scroller = o.scroller || nearestScroller(subject);
  const lo = o.range ? o.range[0] : 0;
  const hi = o.range ? o.range[1] : 1;
  let last = 0;
  if (reducedMotion() || typeof node.animate !== 'function') {
    return { el: node, progress() { return 0; }, destroy() { /* nothing bound */ } };
  }
  const anim = node.animate(frames, { duration: 1000, easing: 'linear', fill: 'both' });
  anim.pause();
  const viewportH = function () {
    return scroller === window ? window.innerHeight : (/** @type {Element} */ (scroller)).clientHeight;
  };
  const viewportTop = function () {
    return scroller === window ? 0 : (/** @type {Element} */ (scroller)).getBoundingClientRect().top;
  };
  const tick = function () {
    const r = subject.getBoundingClientRect();
    const h = viewportH();
    const raw = (viewportTop() + h - r.top) / Math.max(h + r.height, 1);
    let p = (raw - lo) / Math.max(hi - lo, 0.0001);
    p = Math.max(0, Math.min(1, p));
    if (p !== last) { last = p; anim.currentTime = p * 1000; }
  };
  let rafId = 0;
  const onScroll = function () { if (!rafId) rafId = requestAnimationFrame(function () { rafId = 0; tick(); }); };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  tick();
  return {
    el: node,
    progress() { return last; },
    destroy() {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId) cancelAnimationFrame(rafId);
      anim.cancel();
    },
  };
}

/**
 * Pointer drag on one element: it follows the hand (translate, on the axis named), the handlers
 * hear how far and how fast, and on release it springs back unless `back` is false — the swipe
 * to accept, the card you pull out, the row you carry. Touch, mouse and pen alike, through
 * pointer capture. Drag is under the hand, so it runs under reduced motion too; only the return
 * travel is skipped there.
 * @param {Element|string} target
 * @param {{ onStart?: (el: Element) => void, onMove?: (dx: number, dy: number, el: Element) => void,
 *   onEnd?: (dx: number, dy: number, velocity: { x: number, y: number }, el: Element) => void }} [handlers]
 * @param {{ axis?: 'x'|'y'|'both', back?: boolean, threshold?: number, bounds?: { x?: [number, number], y?: [number, number] },
 *   stiffness?: number, damping?: number }} [opts]
 * @returns {{ el: Element, destroy: () => void }}
 */
export function drag(target, handlers, opts) {
  const node = /** @type {HTMLElement} */ (resolve(target));
  const h = handlers || {};
  const o = opts || {};
  const axis = o.axis || 'both';
  const threshold = o.threshold !== undefined ? o.threshold : 4;
  node.classList.add('ak-drag');
  let active = null;
  const clamp = function (v, range) { return range ? Math.max(range[0], Math.min(range[1], v)) : v; };
  const down = function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    const s = stateOf(node);
    active = { id: e.pointerId, x0: e.clientX, y0: e.clientY, bx: s.x, by: s.y, moved: false, t: performance.now(), lx: e.clientX, ly: e.clientY, vx: 0, vy: 0 };
    if (/** @type {any} */ (node).__akSpring) /** @type {any} */ (node).__akSpring.cancel();
    try { node.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
  };
  const move = function (e) {
    if (!active || e.pointerId !== active.id) return;
    let dx = e.clientX - active.x0;
    let dy = e.clientY - active.y0;
    if (!active.moved) {
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      active.moved = true;
      node.classList.add('ak-dragging');
      if (h.onStart) h.onStart(node);
    }
    if (axis === 'x') dy = 0;
    if (axis === 'y') dx = 0;
    const now = performance.now();
    const dt = Math.max(now - active.t, 1);
    active.vx = (e.clientX - active.lx) / dt * 1000;
    active.vy = (e.clientY - active.ly) / dt * 1000;
    active.t = now; active.lx = e.clientX; active.ly = e.clientY;
    const s = stateOf(node);
    s.x = clamp(active.bx + dx, o.bounds && o.bounds.x);
    s.y = clamp(active.by + dy, o.bounds && o.bounds.y);
    node.style.transform = transformOf(s);
    if (h.onMove) h.onMove(s.x - active.bx, s.y - active.by, node);
    e.preventDefault();
  };
  const up = function (e) {
    if (!active || e.pointerId !== active.id) return;
    const was = active;
    active = null;
    node.classList.remove('ak-dragging');
    try { node.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!was.moved) return;
    const s = stateOf(node);
    const dx = s.x - was.bx;
    const dy = s.y - was.by;
    if (h.onEnd) h.onEnd(dx, dy, { x: was.vx, y: was.vy }, node);
    if (o.back !== false) spring(node, { x: was.bx, y: was.by }, { stiffness: o.stiffness || 260, damping: o.damping || 22 });
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  return {
    el: node,
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.classList.remove('ak-drag', 'ak-dragging');
    },
  };
}
