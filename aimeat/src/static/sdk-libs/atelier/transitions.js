/**
 * @file atelier/transitions.js
 * @description THE TRANSITIONS DEPARTMENT. The moves an app makes between whole SCREENS and
 *   between the PANELS inside one, so a change of view reads as travel rather than as a repaint.
 *   Three doors, no dependency:
 *
 *     screenTransition(kind, run, opts)      the whole screen changes: fade, wipe, curtain,
 *                                            zoom, iris, slide
 *     panelTransition(from, to, kind, opts)  one panel gives way to another in the same slot:
 *                                            crossfade, slide, flip, morph, push
 *     curtain(opts)                          the manual cover: cover(), swap, uncover()
 *
 *   THE SCREEN MOVE IS THE BROWSER'S. Where document.startViewTransition exists, the kind is a
 *   data attribute on the root element and transitions.css owns the choreography through
 *   ::view-transition-old(root) / ::view-transition-new(root), so a look retunes a move by
 *   changing --ak-motion and --ak-ease, and the JavaScript here only names the kind, hands over
 *   the origin (--ak-iris-x / --ak-iris-y) and clears up when the browser says it is finished.
 *   mosaic-motion's `transition` is the same idea one level simpler; this needs the transition
 *   HANDLE to resolve its promise and to clear the attribute, so it drives the API directly.
 *   `morph` IS imported and is what the panel morph rides: the shared element carries one
 *   view-transition-name and the browser moves it from where it was to where it is.
 *
 *   WHERE THE BROWSER HAS NO VIEW TRANSITIONS the screen move falls back to the curtain: cover,
 *   run the change behind it, uncover. Nothing is lost but the cross-fade, and the app's code
 *   does not change. Under reduced motion every door here does the swap and nothing else.
 *
 *   FINITE, LIKE THE REST OF THE KIT. Every animation is one Web Animation or one View
 *   Transition, each one is cancelled once it has landed, the curtain layer is removed on
 *   destroy, and nothing loops. An idle surface repaints zero times after a transition, which is
 *   what the finish gate measures.
 *
 *   NO COLOUR LIVES HERE. The curtain's tint is --ak-curtain-tint, chosen by a class; the JS
 *   sets geometry (a transform, a clip radius, a height) and never a colour.
 * @structure screenTransition(kind, run, opts) → Promise · panelTransition(from, to, kind, opts)
 *   → Promise · curtain(opts) → { cover, uncover, destroy }
 * @usage
 *   await AIMEAT.atelier.screenTransition('iris', function () { host.replaceChildren(next); });
 *   await AIMEAT.atelier.panelTransition(oldPanel, newPanel, 'slide', { direction: 'left' });
 *   const c = AIMEAT.atelier.curtain({ kind: 'halves', colour: 'accent' });
 *   await c.cover(); rebuild(); await c.uncover(); c.destroy();
 * @version-history
 *   v0.45.1 — 2026-09-02 — curtain takes a `host`: the cover over ONE element (a stage, a card)
 *     instead of the screen, so a showcase can demonstrate the shapes without covering the page.
 *   v0.45.0 — 2026-09-02 — Initial (the transitions module: screen moves on View Transitions,
 *     panel moves on the Web Animations API, the curtain for both the manual cover and the
 *     no-View-Transitions fallback).
 */
import { el, resolve, reducedMotion } from './dom.js';
import { morph } from './mosaic-motion.js';

/** The screen moves, and the panel moves. An unknown name falls back to the first of its set. */
const SCREEN_KINDS = ['fade', 'wipe', 'curtain', 'zoom', 'iris', 'slide'];
const PANEL_KINDS = ['crossfade', 'slide', 'flip', 'morph', 'push'];
const CURTAIN_KINDS = ['band', 'halves', 'iris'];
/** The tints a curtain may carry, each one a token and never a literal. */
const TINTS = ['accent', 'ink', 'surface'];
const DIRECTIONS = ['left', 'right', 'up', 'down'];

/** Where the outgoing thing goes, and where the incoming thing comes from, per direction. */
const AWAY = { left: 'translateX(-100%)', right: 'translateX(100%)', up: 'translateY(-100%)', down: 'translateY(100%)' };
const TOWARD = { left: 'translateX(100%)', right: 'translateX(-100%)', up: 'translateY(100%)', down: 'translateY(-100%)' };

/** Which screen move the curtain stands in for when the browser has no View Transitions. */
const STAND_IN = { fade: 'band', wipe: 'band', slide: 'band', zoom: 'halves', curtain: 'halves', iris: 'iris' };

/**
 * The last place a pointer went down, which is where an iris opens from when the call does not
 * say. One passive capture listener for the life of the page: it reads two numbers off an event
 * that was going to happen anyway, touches no DOM and cannot repaint.
 * @type {{ x: number, y: number }|null}
 */
let lastPoint = null;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pointerdown', function (ev) {
    lastPoint = { x: ev.clientX, y: ev.clientY };
  }, { capture: true, passive: true });
}

/** @param {{ x?: number, y?: number }} [from] @returns {{ x: number, y: number }} */
function originOf(from) {
  if (from && typeof from.x === 'number' && typeof from.y === 'number') return { x: from.x, y: from.y };
  if (lastPoint) return { x: lastPoint.x, y: lastPoint.y };
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  return { x: w / 2, y: h / 2 };
}

/**
 * How long a move takes: the call's own number, or twice the look's --ak-motion. A screen is a
 * bigger change than a button, and it earns a longer beat.
 * @param {Element} node @param {number} [ms] @returns {number}
 */
function spanOf(node, ms) {
  if (ms) return ms;
  const cs = getComputedStyle(node);
  return (parseFloat(cs.getPropertyValue('--ak-motion')) || 200) * 2;
}

/** The look's curve, with the house curve as the floor. @param {Element} node @returns {string} */
function easeOf(node) {
  const cs = getComputedStyle(node);
  return (cs.getPropertyValue('--ak-ease') || '').trim() || 'cubic-bezier(0.2, 0.7, 0.3, 1)';
}

/** @param {string[]} set @param {any} value @returns {string} */
function oneOf(set, value) {
  return set.indexOf(value) >= 0 ? String(value) : set[0];
}

/**
 * Play a set of finite Web Animations and settle when the last has landed. Each animation is
 * cancelled the moment it finishes, so nothing is left holding a state or a layer.
 * @param {Array<{ node: Element, frames: Keyframe[], timing: KeyframeAnimationOptions }>} runs
 * @returns {Promise<void>}
 */
function playAll(runs) {
  const settled = runs.map(function (r) {
    if (typeof r.node.animate !== 'function') return Promise.resolve();
    const anim = r.node.animate(r.frames, r.timing);
    return anim.finished.then(function () { anim.cancel(); }, function () { /* cancelled elsewhere */ });
  });
  return Promise.all(settled).then(function () { /* every move has landed */ });
}

/** The distance from a point to the furthest corner of the viewport: an iris that covers it all. */
function reachOf(point) {
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  const dx = Math.max(point.x, w - point.x);
  const dy = Math.max(point.y, h - point.y);
  return Math.ceil(Math.sqrt(dx * dx + dy * dy));
}

/** The origin inside a host's own box: a viewport point translated, or the host's centre. */
function originIn(host, from) {
  const r = host.getBoundingClientRect();
  const src = from && typeof from.x === 'number' ? from : lastPoint;
  if (src) {
    const x = src.x - r.left;
    const y = src.y - r.top;
    if (x >= 0 && y >= 0 && x <= r.width && y <= r.height) return { x, y };
  }
  return { x: r.width / 2, y: r.height / 2 };
}

/**
 * THE CURTAIN. A fixed layer over everything that covers on request, holds while the app
 * rebuilds behind it, and uncovers. Three shapes: a `band` sweeping across, two `halves` closing
 * from the edges, and an `iris` growing from a point. While it covers it also takes the pointer,
 * so nothing is clicked mid-swap; after it uncovers it is inert, and `destroy` removes it.
 * With a `host` the curtain covers that ONE element instead of the screen (a stage, a card, a
 * panel): the layer sits inside it, the origin is read in the host's own box, and the host is
 * marked .ak-curtain-host for the positioning context.
 * @param {{ kind?: 'band'|'halves'|'iris', colour?: 'accent'|'ink'|'surface',
 *   from?: { x: number, y: number }, direction?: 'left'|'right'|'up'|'down', duration?: number,
 *   host?: Element|string }} [opts]
 * @returns {{ cover: () => Promise<void>, uncover: () => Promise<void>, destroy: () => void }}
 */
export function curtain(opts) {
  const o = opts || {};
  const kind = oneOf(CURTAIN_KINDS, o.kind);
  const tint = o.colour && TINTS.indexOf(o.colour) >= 0 ? o.colour : 'ink';
  const dir = oneOf(DIRECTIONS, o.direction);
  const axis = dir === 'up' || dir === 'down' ? 'y' : 'x';
  const host = o.host ? /** @type {HTMLElement} */ (resolve(o.host)) : null;
  const point = host ? originIn(host, o.from) : originOf(o.from);
  const reach = host ? Math.ceil(Math.hypot(host.clientWidth, host.clientHeight)) : reachOf(point);

  const layer = el('div', {
    class: 'ak-root ak-curtain ak-curtain--' + kind + ' ak-curtain--' + tint + ' ak-curtain--axis-' + axis,
    'aria-hidden': 'true',
  });
  /** @type {HTMLElement[]} */
  const leaves = [];
  if (kind === 'halves') {
    leaves.push(el('div', { class: 'ak-curtain__half ak-curtain__half--a' }));
    leaves.push(el('div', { class: 'ak-curtain__half ak-curtain__half--b' }));
  } else {
    leaves.push(el('div', { class: kind === 'iris' ? 'ak-curtain__iris' : 'ak-curtain__band' }));
  }

  // The open state is set inline BEFORE the layer is appended: an animation's first frame is one
  // paint away, and without this the tint flashes over the screen for that frame.
  const open = kind === 'iris'
    ? ['circle(0px at ' + point.x + 'px ' + point.y + 'px)']
    : kind === 'halves' ? [AWAY[axis === 'y' ? 'up' : 'left'], AWAY[axis === 'y' ? 'down' : 'right']] : [TOWARD[dir]];
  const shut = kind === 'iris' ? ['circle(' + reach + 'px at ' + point.x + 'px ' + point.y + 'px)'] : ['none', 'none'];
  // A band SWEEPS: it leaves by the far edge rather than retreating the way it came. Halves part
  // back to their own edges and an iris shrinks back to its origin, so for those two the way out
  // is the way in.
  const past = kind === 'band' ? [AWAY[dir]] : open;
  let parked = open;
  leaves.forEach(function (leaf, i) {
    if (kind === 'iris') leaf.style.clipPath = open[i];
    else leaf.style.transform = open[i];
    layer.appendChild(leaf);
  });
  if (host) {
    host.classList.add('ak-curtain-host');
    layer.classList.add('ak-curtain--inset');
    host.appendChild(layer);
  } else {
    document.body.appendChild(layer);
  }

  const ms = spanOf(layer, o.duration);
  const ease = easeOf(layer);
  let covered = false;
  let gone = false;

  /** @param {string[]} from @param {string[]} to @returns {Promise<void>} */
  function travel(from, to) {
    if (gone) return Promise.resolve();
    const land = function () {
      leaves.forEach(function (leaf, i) {
        if (kind === 'iris') leaf.style.clipPath = to[i];
        else leaf.style.transform = to[i];
      });
    };
    if (reducedMotion() || typeof leaves[0].animate !== 'function') { land(); return Promise.resolve(); }
    const runs = leaves.map(function (leaf, i) {
      return {
        node: leaf,
        frames: kind === 'iris'
          ? [{ clipPath: from[i] }, { clipPath: to[i] }]
          : [{ transform: from[i] }, { transform: to[i] }],
        timing: { duration: ms, easing: ease, fill: /** @type {FillMode} */ ('both') },
      };
    });
    return playAll(runs).then(land);
  }

  return {
    cover() {
      if (covered) return Promise.resolve();
      covered = true;
      layer.classList.add('ak-curtain--on');
      const was = parked;
      parked = shut;
      return travel(was, shut);
    },
    uncover() {
      if (!covered) return Promise.resolve();
      covered = false;
      parked = past;
      return travel(shut, past).then(function () { layer.classList.remove('ak-curtain--on'); });
    },
    destroy() {
      gone = true;
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      if (host && !host.querySelector('.ak-curtain')) host.classList.remove('ak-curtain-host');
    },
  };
}

/**
 * THE SCREEN CHANGES. `run` is the app's own DOM change (it swaps its screen inside it) and the
 * kind is how that change is seen: a cross-`fade`, a `wipe` clipping the new screen in from an
 * edge, a `curtain` that darkens the old under a band while the new rises, a `zoom` that pushes
 * the old back and brings the new forward, an `iris` opening from where the finger landed, or a
 * `slide` where one screen leaves as the other arrives.
 *
 * The promise settles when the screen has SETTLED, not when the DOM changed, so an app can wait
 * for it before it moves focus or measures anything.
 * @param {'fade'|'wipe'|'curtain'|'zoom'|'iris'|'slide'} kind
 * @param {() => void|Promise<any>} run
 * @param {{ from?: { x: number, y: number }, direction?: 'left'|'right'|'up'|'down',
 *   duration?: number, colour?: 'accent'|'ink'|'surface' }} [opts]
 * @returns {Promise<void>}
 */
export function screenTransition(kind, run, opts) {
  const o = opts || {};
  const move = oneOf(SCREEN_KINDS, kind);
  const root = document.documentElement;

  // Reduced motion is the swap and nothing else: no cover, no travel, no waiting.
  if (reducedMotion()) return Promise.resolve(run()).then(function () { /* the screen is there */ });

  // No View Transitions (Firefox, and Safari before 18): the curtain covers, the app rebuilds
  // behind it, the curtain opens. The app's call does not change; only the move does.
  if (typeof document.startViewTransition !== 'function') {
    const cover = curtain({
      kind: /** @type {'band'|'halves'|'iris'} */ (STAND_IN[move]),
      colour: o.colour, from: o.from, direction: o.direction, duration: o.duration,
    });
    return cover.cover()
      .then(function () { return run(); })
      .then(function () { return cover.uncover(); })
      .then(function () { cover.destroy(); }, function (err) { cover.destroy(); throw err; });
  }

  const point = originOf(o.from);
  root.setAttribute('data-ak-transition', move);
  if (o.direction && DIRECTIONS.indexOf(o.direction) >= 0) root.setAttribute('data-ak-transition-dir', o.direction);
  if (o.colour && TINTS.indexOf(o.colour) >= 0) root.setAttribute('data-ak-transition-colour', o.colour);
  root.style.setProperty('--ak-iris-x', point.x + 'px');
  root.style.setProperty('--ak-iris-y', point.y + 'px');
  if (o.duration) root.style.setProperty('--ak-transition-span', o.duration + 'ms');

  const clear = function () {
    root.removeAttribute('data-ak-transition');
    root.removeAttribute('data-ak-transition-dir');
    root.removeAttribute('data-ak-transition-colour');
    root.style.removeProperty('--ak-iris-x');
    root.style.removeProperty('--ak-iris-y');
    root.style.removeProperty('--ak-transition-span');
  };
  // A dropped transition (a hidden tab, a second change on top of this one) must still clear the
  // attribute, or every later change on the page wears this kind.
  return document.startViewTransition(run).finished.then(clear, clear);
}

/**
 * The height a parent would need on its OWN box model to look the size it looks now. A parent
 * sized border-box and one sized content-box want different numbers for the same box, and
 * animating the wrong one makes the page jump by exactly its padding.
 * @param {HTMLElement} node @returns {number}
 */
function heightOf(node) {
  const cs = getComputedStyle(node);
  const box = node.getBoundingClientRect().height;
  if (cs.boxSizing === 'border-box') return box;
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const edge = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
  return Math.max(0, box - pad - edge);
}

/**
 * Settle when a shared-element morph has finished. `morph` owns the View Transition and does not
 * hand back its handle, so the tell is its own last act: it clears the element's
 * view-transition-name when the browser reports the transition finished. Watching that is exact
 * and duplicates none of it; the cap is the floor for a browser that drops the transition.
 * @param {HTMLElement} moving @param {number} cap @returns {Promise<void>}
 */
function whenMorphDone(moving, cap) {
  return new Promise(function (settle) {
    let done = false;
    const finish = function () {
      if (done) return;
      done = true;
      if (obs) obs.disconnect();
      clearTimeout(timer);
      settle();
    };
    const obs = typeof MutationObserver === 'function' ? new MutationObserver(function () {
      if (!moving.style.viewTransitionName) finish();
    }) : null;
    if (obs) obs.observe(moving, { attributes: true, attributeFilter: ['style'] });
    const timer = setTimeout(finish, cap);
  });
}

/**
 * ONE PANEL GIVES WAY TO ANOTHER, in the same slot: `to` lands exactly where `from` stood (it may
 * arrive detached and is inserted there), the outgoing panel is lifted out of the flow so the two
 * overlap for the length of the move, and the container's height travels between the two so the
 * page does not jump under the reader's eye.
 *
 * Five moves: `crossfade` (the quiet one), `slide` (travel with a fade), `push` (both panels move
 * as one, no fade, the carousel feel), `flip` (the card turns on its own axis) and `morph`, the
 * shared-element move where `opts.moving` exists on BOTH sides and the browser carries it from
 * where it was to where it is. Under reduced motion, and where a browser lacks what a move needs,
 * the swap happens and nothing travels.
 * @param {Element} from @param {Element} to
 * @param {'crossfade'|'slide'|'flip'|'morph'|'push'} kind
 * @param {{ direction?: 'left'|'right'|'up'|'down', duration?: number, moving?: Element }} [opts]
 * @returns {Promise<void>}
 */
export function panelTransition(from, to, kind, opts) {
  const o = opts || {};
  const move = oneOf(PANEL_KINDS, kind);
  const parent = /** @type {HTMLElement|null} */ (from && from.parentElement);
  if (!parent || !to || from === to) return Promise.resolve();

  // `to` lands immediately before `from`; taking `from` away then leaves it at from's own place.
  const swap = function () {
    parent.insertBefore(to, from);
    if (from.parentNode) from.parentNode.removeChild(from);
  };

  if (reducedMotion() || typeof from.animate !== 'function') { swap(); return Promise.resolve(); }

  const ms = spanOf(from, o.duration);
  const ease = easeOf(from);
  const dir = oneOf(DIRECTIONS, o.direction);
  const moving = /** @type {HTMLElement|null} */ (o.moving || null);

  // The shared element carries the move: the browser animates it from its old box to its new one,
  // and everything else cross-fades under it. Without a shared element, or without View
  // Transitions, the crossfade is the honest answer rather than a half-morph.
  if (move === 'morph') {
    if (!moving || typeof document.startViewTransition !== 'function') {
      return panelTransition(from, to, 'crossfade', o);
    }
    const done = whenMorphDone(moving, ms * 6);
    morph(moving, swap);
    return done;
  }

  const outgoing = /** @type {HTMLElement} */ (from);
  const incoming = /** @type {HTMLElement} */ (to);
  const box = outgoing.getBoundingClientRect();
  const seat = parent.getBoundingClientRect();
  const pcs = getComputedStyle(parent);
  const startH = heightOf(parent);
  const kept = { position: parent.style.position, overflow: parent.style.overflow };

  if (pcs.position === 'static') parent.style.position = 'relative';
  parent.style.overflow = 'hidden';
  if (move === 'flip') parent.classList.add('ak-swap--flip');

  parent.insertBefore(incoming, outgoing);
  // The outgoing panel leaves the flow, pinned over the box it already occupied, so the incoming
  // one takes the slot and the two are seen in the same place at the same time.
  outgoing.style.position = 'absolute';
  outgoing.style.boxSizing = 'border-box';
  outgoing.style.margin = '0';
  outgoing.style.top = (box.top - seat.top - (parseFloat(pcs.borderTopWidth) || 0) + parent.scrollTop) + 'px';
  outgoing.style.left = (box.left - seat.left - (parseFloat(pcs.borderLeftWidth) || 0) + parent.scrollLeft) + 'px';
  outgoing.style.width = box.width + 'px';
  outgoing.style.height = box.height + 'px';

  const endH = heightOf(parent);
  /** @type {Array<{ node: Element, frames: Keyframe[], timing: KeyframeAnimationOptions }>} */
  const runs = [];
  if (Math.abs(endH - startH) > 1) {
    runs.push({
      node: parent,
      frames: [{ height: startH + 'px' }, { height: endH + 'px' }],
      timing: { duration: ms, easing: ease, fill: /** @type {FillMode} */ ('backwards') },
    });
  }

  if (move === 'flip') {
    // Two halves of one turn: the old card shows its edge, the new card comes round from its own.
    const half = Math.round(ms / 2);
    runs.push({
      node: outgoing,
      frames: [{ transform: 'rotateY(0deg)', opacity: 1 }, { transform: 'rotateY(-90deg)', opacity: 0 }],
      timing: { duration: half, easing: 'ease-in', fill: /** @type {FillMode} */ ('forwards') },
    });
    runs.push({
      node: incoming,
      frames: [{ transform: 'rotateY(90deg)', opacity: 0 }, { transform: 'rotateY(0deg)', opacity: 1 }],
      timing: { duration: half, delay: half, easing: 'ease-out', fill: /** @type {FillMode} */ ('backwards') },
    });
  } else if (move === 'crossfade') {
    runs.push({ node: outgoing, frames: [{ opacity: 1 }, { opacity: 0 }], timing: { duration: ms, easing: ease, fill: /** @type {FillMode} */ ('forwards') } });
    runs.push({ node: incoming, frames: [{ opacity: 0 }, { opacity: 1 }], timing: { duration: ms, easing: ease, fill: /** @type {FillMode} */ ('backwards') } });
  } else {
    // slide travels and fades; push travels only, so the two panels read as one strip moving.
    const fade = move === 'slide';
    runs.push({
      node: outgoing,
      frames: [{ transform: 'none', opacity: 1 }, { transform: AWAY[dir], opacity: fade ? 0 : 1 }],
      timing: { duration: ms, easing: ease, fill: /** @type {FillMode} */ ('forwards') },
    });
    runs.push({
      node: incoming,
      frames: [{ transform: TOWARD[dir], opacity: fade ? 0 : 1 }, { transform: 'none', opacity: 1 }],
      timing: { duration: ms, easing: ease, fill: /** @type {FillMode} */ ('backwards') },
    });
  }

  return playAll(runs).then(function () {
    if (outgoing.parentNode) outgoing.parentNode.removeChild(outgoing);
    incoming.style.removeProperty('transform');
    incoming.style.removeProperty('opacity');
    parent.classList.remove('ak-swap--flip');
    parent.style.position = kept.position;
    parent.style.overflow = kept.overflow;
    parent.style.removeProperty('height');
  });
}
