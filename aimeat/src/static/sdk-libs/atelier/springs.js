/**
 * @file atelier/springs.js
 * @description The LIVE spring: a number that travels toward a target on a damped spring, and
 *   keeps its velocity when the target changes mid-flight. motion.js samples a spring into
 *   keyframes, which is right for a move that is decided once; a control under a hand changes its
 *   mind every frame (a tab picked while the last pick is still travelling, a knob pressed and
 *   released, a slider pulled past its end), and a keyframe list cannot be retargeted without a
 *   jump. This one integrates per animation frame instead, and stops asking for frames the moment
 *   it settles, so an idle surface still repaints zero times.
 *
 *   THE EDGE PAIR is the indicator trick: a box drawn from two edges, each on its own spring. The
 *   edge in the direction of travel is stiffer than the one behind it, so the box stretches toward
 *   where it is going and closes up when it gets there. The tab ink, the segmented control, the
 *   menu highlight and the toggle knob all ride it.
 *
 *   THE FEEL BELONGS TO THE LOOK, as in motion.js: stiffness, damping and mass come from the
 *   element's --ak-spring-* tokens unless the call names them. Under reduced motion, the Less
 *   motion switch, or an app's or block's motion opt-out, every set() is a jump.
 * @structure feelOf · stepSpring · liveSpring · edgePair
 * @usage
 *   const s = AIMEAT.atelier.liveSpring(function (x) { box.style.width = x + 'px'; }, { el: box, value: 40 });
 *   s.set(220);
 * @version-history
 *   v0.55.0 — 2026-09-28 — Initial (the ten motion parts).
 */
import { motionOff } from './dom.js';

/** The house hand, when neither the call nor the look names one (motion.js uses the same). */
const HOUSE = { stiffness: 170, damping: 20, mass: 1 };

/** The integration step. Small enough that a stiff lead edge stays stable. */
const STEP = 1 / 240;

/** The longest frame gap integrated as elapsed time; a hidden tab resumes where it paused. */
const MAX_GAP = 1 / 15;

/**
 * The spring numbers for an element: what the call names, then the look's --ak-spring-* tokens,
 * then the house 170/20/1.
 * @param {Element|null|undefined} node
 * @param {{ stiffness?: number, damping?: number, mass?: number }} [opts]
 * @returns {{ stiffness: number, damping: number, mass: number }}
 */
export function feelOf(node, opts) {
  const o = opts || {};
  let cs = null;
  if (node && typeof getComputedStyle === 'function' && !(o.stiffness && o.damping && o.mass)) {
    try { cs = getComputedStyle(/** @type {Element} */ (node)); } catch { cs = null; }
  }
  const token = function (name) {
    if (!cs) return undefined;
    const v = parseFloat(cs.getPropertyValue(name));
    return isFinite(v) && v > 0 ? v : undefined;
  };
  return {
    stiffness: o.stiffness || token('--ak-spring-stiffness') || HOUSE.stiffness,
    damping: o.damping || token('--ak-spring-damping') || HOUSE.damping,
    mass: o.mass || token('--ak-spring-mass') || HOUSE.mass,
  };
}

/**
 * One integration step of a damped spring (semi-implicit Euler), pure so a test can drive it.
 * @param {{ x: number, v: number }} state
 * @param {number} target
 * @param {{ stiffness: number, damping: number, mass: number }} feel
 * @param {number} dt  seconds
 * @returns {{ x: number, v: number }}
 */
export function stepSpring(state, target, feel, dt) {
  let x = state.x;
  let v = state.v;
  let left = Math.min(dt, MAX_GAP);
  while (left > 1e-9) {
    const h = Math.min(STEP, left);
    const a = (-feel.stiffness * (x - target) - feel.damping * v) / feel.mass;
    v += a * h;
    x += v * h;
    left -= h;
  }
  return { x, v };
}

/** requestAnimationFrame, or a timer where there is none (a worker, a test stub). */
function nextFrame(fn) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
  return /** @type {any} */ (setTimeout(function () { fn(Date.now()); }, 16));
}
function cancelFrame(id) {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
}

/**
 * A value on a live spring. `onFrame(value, velocity)` runs on every frame while it travels, and
 * once more with the exact target when it lands.
 * @param {(value: number, velocity: number) => void} onFrame
 * @param {{ value?: number, el?: Element|null, stiffness?: number, damping?: number, mass?: number,
 *   precision?: number }} [opts]
 *   `precision` is how close counts as landed, in the value's own unit (default 0.01).
 * @returns {{ set: (target: number, o?: { velocity?: number, feel?: { stiffness?: number, damping?: number, mass?: number } }) => void,
 *   jump: (value: number) => void, value: () => number, velocity: () => number, target: () => number,
 *   moving: () => boolean, destroy: () => void }}
 */
export function liveSpring(onFrame, opts) {
  const o = opts || {};
  const precision = o.precision || 0.01;
  let x = typeof o.value === 'number' ? o.value : 0;
  let v = 0;
  let goal = x;
  let feel = null;
  let raf = 0;
  let last = 0;

  function stop() { if (raf) cancelFrame(raf); raf = 0; }
  function tick(now) {
    raf = 0;
    const dt = last ? Math.max(0, (now - last) / 1000) : 1 / 60;
    last = now;
    const s = stepSpring({ x, v }, goal, feel || HOUSE, dt);
    x = s.x; v = s.v;
    if (Math.abs(x - goal) < precision && Math.abs(v) < precision * 10) {
      x = goal; v = 0; last = 0;
      onFrame(x, 0);
      return;
    }
    onFrame(x, v);
    raf = nextFrame(tick);
  }
  function jump(value) {
    stop();
    x = goal = value; v = 0; last = 0;
    onFrame(x, 0);
  }
  return {
    set(target, so) {
      if (!isFinite(target)) return;
      const s = so || {};
      if (motionOff(o.el || null)) { jump(target); return; }
      goal = target;
      if (typeof s.velocity === 'number') v = s.velocity;
      // The feel is read when a travel starts, so a look changed mid-session is honoured on the
      // next move and not re-read on every frame.
      feel = feelOf(o.el, Object.assign({ stiffness: o.stiffness, damping: o.damping, mass: o.mass }, s.feel || {}));
      if (Math.abs(x - goal) < precision && Math.abs(v) < precision * 10) { jump(goal); return; }
      if (!raf) { last = 0; raf = nextFrame(tick); }
    },
    jump,
    value() { return x; },
    velocity() { return v; },
    target() { return goal; },
    moving() { return raf !== 0; },
    destroy: stop,
  };
}

/**
 * A box drawn from two edges on two springs: the edge in the direction of travel leads on a
 * stiffer spring, so the box stretches toward where it is going and closes up when it arrives.
 * `onFrame(start, end)` gets both edges; `set(start, end)` sends the box somewhere new.
 * @param {(start: number, end: number) => void} onFrame
 * @param {{ el?: Element|null, start?: number, end?: number, lead?: number,
 *   stiffness?: number, damping?: number, mass?: number }} [opts]
 *   `lead` is how much stiffer the leading edge is (default 2.4). The damping scales with it, so
 *   both edges keep the look's damping ratio and neither one bounces more than the look allows.
 * @returns {{ set: (start: number, end: number) => void, jump: (start: number, end: number) => void,
 *   edges: () => [number, number], moving: () => boolean, destroy: () => void }}
 */
export function edgePair(onFrame, opts) {
  const o = opts || {};
  const lead = o.lead || 2.4;
  let a = typeof o.start === 'number' ? o.start : 0;
  let b = typeof o.end === 'number' ? o.end : a;
  let queued = false;
  function paint() {
    if (queued) return;
    queued = true;
    // Both edges report in the same frame; the box is drawn once per frame, not once per edge.
    Promise.resolve().then(function () { queued = false; onFrame(a, b); });
  }
  const startEdge = liveSpring(function (x) { a = x; paint(); }, { el: o.el, value: a, precision: 0.05 });
  const endEdge = liveSpring(function (x) { b = x; paint(); }, { el: o.el, value: b, precision: 0.05 });
  return {
    set(start, end) {
      const base = feelOf(o.el, o);
      const fast = { stiffness: base.stiffness * lead, damping: base.damping * Math.sqrt(lead), mass: base.mass };
      const forward = (start + end) / 2 >= (startEdge.target() + endEdge.target()) / 2;
      startEdge.set(start, { feel: forward ? base : fast });
      endEdge.set(end, { feel: forward ? fast : base });
    },
    jump(start, end) { startEdge.jump(start); endEdge.jump(end); },
    edges() { return [a, b]; },
    moving() { return startEdge.moving() || endEdge.moving(); },
    destroy() { startEdge.destroy(); endEdge.destroy(); },
  };
}
