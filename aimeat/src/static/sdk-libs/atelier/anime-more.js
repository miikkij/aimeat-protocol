/**
 * @file atelier/anime-more.js
 * @description The four anime.js pieces that were left out of anime-show.js, each one a thing an
 *   app puts on a page AND a moment worth watching:
 *
 *     morph      one shape becomes another. A logo turns into a menu, a state chip turns into a
 *                tick, a blob turns into a star, and the SVG keeps being one path the whole way.
 *     draggable  an element the hand carries, with real physics behind the release: bounds it
 *                cannot leave, a grid it lands on, a spring that either holds it where it was
 *                dropped or carries it home.
 *     burst      the celebration. Particles are born at a point, thrown outward, pulled down,
 *                and then GONE — the nodes are removed when the timeline ends.
 *     scrub      a declared choreography whose clock is the scrollbar. Scroll down and the beats
 *                play; scroll back and they un-play.
 *
 *   anime@4 is vendored on this node (/lib/anime@4.min.js, MIT) and lazy-loaded, one shared load
 *   for whoever asks first — the loader idiom is anime-show.js's, kept local here because that
 *   file exports its parts and not its plumbing. Nothing here needs the library to be CORRECT:
 *   before the script lands, after it fails to land, and whenever the viewer asks for less
 *   motion, every part still does what it says. `morph` swaps the shape, `draggable` still drags
 *   (the kit's own no-dependency `drag` is the floor it stands on until anime arrives), `burst`
 *   answers with one ring pulse, and `scrub` puts its beats at their end state.
 *
 *   MOTION IS FINITE. Nothing here loops, and nothing here idles. `burst` runs once per call and
 *   takes its own nodes off the page; `morph` runs once per `to()`; `scrub` moves only while the
 *   reader is moving; `draggable` moves only while the hand is on it.
 * @structure ensureAnime · withAnime · warmAnime · onCue · nearestScroller · toElements · settle ·
 *   morph(target, opts) · draggable(target, opts) · burst(target, opts) · scrub(target, steps, opts)
 * @usage
 *   const shape = AIMEAT.atelier.morph(svgEl, { duration: 700 });
 *   await shape.to('star');
 *   const puck = AIMEAT.atelier.draggable(handle, { container: box, snap: 40 });
 *   await AIMEAT.atelier.burst(button, { count: 30, tones: ['accent', 'ok'] });
 *   AIMEAT.atelier.scrub(well, [
 *     { targets: chipA, props: { y: [40, 0], opacity: [0, 1] } },
 *     { targets: chipB, props: { y: [40, 0], opacity: [0, 1] }, at: '<<+=200' },
 *   ], { container: well, enter: 'top bottom', leave: 'bottom top' });
 * @version-history
 *   v0.46.0 — 2026-09-02 — Initial: morph, draggable, burst and scrub.
 */
import { el, resolve, reducedMotion } from './dom.js';
import { NODE_URL } from '../_core/config.js';
import { drag } from './motion.js';

/** `window` has no declared `anime`; one cast here beats a cast at every call site. */
const W = /** @type {any} */ (window);

/** One shared load of anime@4, whoever asks first. */
let animePromise = null;
/** Set once the node would not serve the script: stop asking, the parts stand without it. */
let animeOff = false;

/** The window in which an entrance is still an entrance. Later than this and it is a flash. */
const LATE = 400;

/**
 * Load anime@4 from this node, once. The idiom is anime-show.js's, copied rather than shared
 * because the loader is that file's private plumbing and a second module may not reach into it.
 * @returns {Promise<any>}
 */
function ensureAnime() {
  if (W.anime && W.anime.animate) return Promise.resolve(W.anime);
  if (animePromise) return animePromise;
  animePromise = new Promise(function (ok, fail) {
    const s = document.createElement('script');
    s.src = NODE_URL + '/lib/anime@4.min.js';
    s.onload = function () { ok(W.anime); };
    s.onerror = function () { animePromise = null; fail(new Error('anime failed to load')); };
    document.head.appendChild(s);
  });
  return animePromise;
}

/**
 * Run one piece of travel when the library is there and the viewer wants movement.
 * @param {(anime: any) => void} run
 * @param {() => void} [without] what to do instead when there will be no library and no motion
 * @returns {void}
 */
function withAnime(run, without) {
  if (animeOff || reducedMotion()) { if (without) without(); return; }
  ensureAnime().then(run, function () {
    animeOff = true;
    if (without) without();
  });
}

/** Ask for the library ahead of the cue that will want it. A refusal costs only the motion. */
function warmAnime() {
  if (animeOff || reducedMotion()) return;
  ensureAnime().then(null, function () { animeOff = true; });
}

/**
 * A cued piece of travel, dropped when the library's arrival is late enough that animating now
 * would read as a fault rather than as an answer. The `without` branch runs in its place, so the
 * caller's promise still settles and the end state still lands.
 * @param {(anime: any) => void} run
 * @param {() => void} [without]
 * @returns {void}
 */
function onCue(run, without) {
  const asked = Date.now();
  withAnime(function (a) {
    if (Date.now() - asked > LATE) { if (without) without(); return; }
    run(a);
  }, without);
}

/** The nearest ancestor whose overflow scrolls, or the window (motion.js's rule, kept local). */
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
 * Anything a caller may name as targets, as a real array of elements.
 * @param {any} targets
 * @returns {HTMLElement[]}
 */
function toElements(targets) {
  if (!targets) return [];
  if (typeof targets === 'string') return Array.prototype.slice.call(document.querySelectorAll(targets));
  if (targets instanceof Element) return [/** @type {HTMLElement} */ (targets)];
  if (typeof targets.length === 'number') return Array.prototype.slice.call(targets);
  return [];
}

/** The properties a beat's end state can be read from without the library. */
const END_KEYS = ['x', 'y', 'scale', 'rotate', 'opacity'];

/** The last value a property is asked to reach: `[from, to]` ends at `to`, a bare value at itself. */
function endOf(value) {
  if (Array.isArray(value)) return value.length ? endOf(value[value.length - 1]) : null;
  if (value && typeof value === 'object' && 'to' in value) return /** @type {any} */ (value).to;
  return value;
}

/** Put one element where the beat would have left it. Transform and opacity only, on purpose. */
function settle(node, props) {
  let moved = false;
  const at = { x: 0, y: 0, scale: 1, rotate: 0 };
  END_KEYS.forEach(function (key) {
    const end = endOf(props[key]);
    if (end == null) return;
    moved = true;
    if (key === 'opacity') node.style.opacity = String(end);
    else at[key] = parseFloat(String(end)) || 0;
  });
  if (!moved) return;
  if (props.x !== undefined || props.y !== undefined || props.scale !== undefined || props.rotate !== undefined) {
    node.style.transform = 'translate(' + at.x + 'px, ' + at.y + 'px) scale('
      + (props.scale === undefined ? 1 : at.scale) + ') rotate(' + at.rotate + 'deg)';
  }
}

/* ── The shape that becomes another shape ───────────────────────────────────────────────── */

/** The SVG elements anime can morph. Anything else in the drawing is left alone. */
const MORPHABLE = 'path, polygon, polyline';

/** Which attribute carries a shape's geometry, by what the shape is. */
function geometryProp(shape) {
  return (shape.tagName || '').toLowerCase() === 'path' ? 'd' : 'points';
}

/**
 * THE SHAPE THAT BECOMES ANOTHER SHAPE. The `<svg>` holds one visible shape and a spare per
 * named alternative — either `<path data-shape="star">` elements the author drew, or `d` strings
 * handed in as `opts.shapes`, which this call turns into spares of its own. `to('star')` carries
 * the visible shape into the named one; `cycle()` goes to the next name in the list.
 *
 * WHAT THE AUTHOR OWES: with the default precision, anime resamples BOTH shapes to a shared
 * number of points before interpolating, so a blob and a star morph cleanly whatever their point
 * counts — at the cost of the travel running as a fine polyline rather than as the author's own
 * curves. Pass `precision: 0` to interpolate the `d` strings themselves, which is exact and
 * cheap, and which then does require the two shapes to carry the same commands in the same order
 * with the same point count. Anything but a `<path>`, `<polygon>` or `<polyline>` is refused by
 * anime with a message naming the tag.
 *
 * Under reduced motion, before the library lands and after it fails to, the geometry is SWAPPED:
 * the named shape is on the screen the moment `to()` resolves, with no travel between them.
 *
 * @param {Element|string} target the `<svg>`, or the visible shape itself
 * @param {{ duration?: number, ease?: string, precision?: number,
 *   shapes?: Record<string, string> }} [opts]
 * @returns {{ el: Element, to: (name: string) => Promise<void>, cycle: () => Promise<void>,
 *   current: () => string|null, names: () => string[], destroy: () => void }}
 */
export function morph(target, opts) {
  const o = opts || {};
  const root = resolve(target);
  const duration = o.duration || 720;
  const isSvg = (root.tagName || '').toLowerCase() === 'svg';
  root.classList.add('ak-morph');

  /** The shape the viewer sees: the first morphable one without a name of its own. */
  const shown = /** @type {any} */ (isSvg
    ? (root.querySelector(MORPHABLE + ':not([data-shape])') || root.querySelector(MORPHABLE))
    : root);
  if (shown) shown.classList.add('ak-morph__shape');

  /** name → the spare shape holding that geometry. */
  /** @type {Record<string, any>} */
  const spares = {};
  /** The spares this call built, so destroy takes back only its own work. */
  /** @type {any[]} */
  const made = [];

  if (isSvg) {
    Array.prototype.slice.call(root.querySelectorAll(MORPHABLE + '[data-shape]')).forEach(function (s) {
      s.classList.add('ak-morph__spare');
      spares[s.getAttribute('data-shape')] = s;
    });
  }
  if (o.shapes && isSvg) {
    Object.keys(o.shapes).forEach(function (name) {
      if (spares[name]) return;
      const spare = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      spare.setAttribute('class', 'ak-morph__spare');
      spare.setAttribute('data-shape', name);
      spare.setAttribute('d', String(o.shapes[name]));
      root.appendChild(spare);
      spares[name] = spare;
      made.push(spare);
    });
  }

  const names = Object.keys(spares);
  /** Where the visible shape stands now. A shape the author left unnamed starts as null. */
  let at = shown && shown.getAttribute ? shown.getAttribute('data-shape') : null;
  warmAnime();

  /**
   * Carry the visible shape into the named one. The promise settles when the shape has arrived,
   * whether it travelled there or was swapped.
   * @param {string} name
   * @returns {Promise<void>}
   */
  function to(name) {
    const spare = spares[name];
    if (!shown || !spare) return Promise.resolve();
    const prop = geometryProp(shown);
    at = name;
    return new Promise(function (done) {
      const swap = function () {
        shown.setAttribute(prop, spare.getAttribute(prop) || '');
        done();
      };
      onCue(function (a) {
        const props = /** @type {any} */ ({ duration: duration, ease: o.ease || 'inOutQuad' });
        props[prop] = a.svg.morphTo(spare, o.precision);
        props.onComplete = function () { done(); };
        try {
          a.animate(shown, props);
        } catch {
          // anime refuses a shape it cannot morph, by name. The swap is still the right answer.
          swap();
        }
      }, swap);
    });
  }

  /** The next name in the list, wrapping. With one name it re-runs that one. */
  function cycle() {
    if (!names.length) return Promise.resolve();
    const i = at === null ? 0 : (names.indexOf(at) + 1) % names.length;
    return to(names[i]);
  }

  return {
    el: root,
    to: to,
    cycle: cycle,
    /** The name of the shape on the screen, or null while the author's own shape is showing. */
    current: function () { return at; },
    /** Every name this call can reach, in the order `cycle` walks them. */
    names: function () { return names.slice(); },
    destroy: function () {
      made.forEach(function (spare) { spare.remove(); });
      made.length = 0;
      Object.keys(spares).forEach(function (name) {
        if (spares[name].parentNode) spares[name].classList.remove('ak-morph__spare');
      });
      if (shown) shown.classList.remove('ak-morph__shape');
      root.classList.remove('ak-morph');
    },
  };
}

/* ── The element the hand carries ───────────────────────────────────────────────────────── */

/** How long a spring-back takes, and how long an instant one takes under reduced motion. */
const HOME_MS = 420;

/**
 * THE ELEMENT THE HAND CARRIES. anime's draggable gives it what a hand-written one cannot: a
 * container it may not leave (an element, or `[top, right, bottom, left]` pixel bounds), a grid
 * it lands on, momentum off the throw, and a release spring the caller can stiffen.
 *
 * `release: 'stay'` (the default) leaves it where it was dropped, which is what a puck on a
 * board, a token on a grid and a card in a column all want. `release: 'spring'` carries it back
 * to where it started, which is what a swipe-to-answer wants.
 *
 * The kit's own `drag` is the floor underneath: from the first frame, before anime has landed
 * and after it refuses to, the element follows the hand through that primitive, with the axis
 * and the spring-back honoured and snapping left out (the floor has none). The handover happens
 * the moment the library arrives and the element is not under the hand, and it carries the
 * element's position across, so nothing jumps.
 *
 * DRAG RUNS UNDER REDUCED MOTION, because the element is under the hand and following it is not
 * a decoration. What is dropped there is the travel that is NOT under the hand: no momentum
 * coast off the throw, and a spring-back that lands at once instead of swinging home.
 *
 * @param {Element|string} target
 * @param {{ container?: Element|number[], axis?: 'x'|'y'|'both', snap?: number|number[]|{ x?: number|number[], y?: number|number[] },
 *   release?: 'spring'|'stay', stiffness?: number, onGrab?: () => void,
 *   onDrag?: (x: number, y: number) => void, onRelease?: (x: number, y: number) => void,
 *   onSnap?: (x: number, y: number) => void }} [opts]
 * @returns {{ el: Element, x: () => number, y: () => number, set: (x: number, y: number) => void,
 *   reset: () => void, destroy: () => void }}
 */
export function draggable(target, opts) {
  const o = opts || {};
  const node = /** @type {HTMLElement} */ (resolve(target));
  const axis = o.axis === 'x' || o.axis === 'y' ? o.axis : 'both';
  const home = o.release === 'spring';
  const quiet = reducedMotion();
  node.classList.add('ak-tug');

  /** anime's draggable, once the library has landed. */
  /** @type {any} */
  let dg = null;
  /** The kit's own drag, holding the element up until then. */
  /** @type {{ destroy: () => void }|null} */
  let floor = null;
  /** Where the element stands while the floor is carrying it, in pixels from its origin. */
  const seat = { x: 0, y: 0 };
  /** Where it stood when THIS carry began: the floor reports a delta from the grab, not a place. */
  const base = { x: 0, y: 0 };
  /** True between pointerdown and release: a handover mid-carry would drop the element. */
  let held = false;
  let gone = false;

  const say = function (fn) { if (fn) fn(x(), y()); };

  function x() { return dg ? dg.x : seat.x; }
  function y() { return dg ? dg.y : seat.y; }

  /* ── The floor: the no-dependency drag, wired at once so the element is never dead ── */

  floor = drag(node, {
    onStart: function () {
      held = true;
      base.x = seat.x;
      base.y = seat.y;
      node.classList.add('ak-tug--held');
      if (o.onGrab) o.onGrab();
    },
    onMove: function (dx, dy) {
      seat.x = axis === 'y' ? 0 : base.x + dx;
      seat.y = axis === 'x' ? 0 : base.y + dy;
      say(o.onDrag);
    },
    onEnd: function () {
      held = false;
      node.classList.remove('ak-tug--held');
      say(o.onRelease);
      // The floor's own spring carries it home when `back` is on, so the seat follows it there.
      if (home) { seat.x = 0; seat.y = 0; }
      handover();
    },
  }, { axis: axis, back: home, stiffness: o.stiffness });

  /* ── The library's draggable, once it is there ── */

  /** One axis's parameters: `false` when the axis is locked, a snap object when it snaps. */
  function axisParam(which) {
    if ((axis === 'x' && which === 'y') || (axis === 'y' && which === 'x')) return false;
    const s = o.snap;
    if (s && typeof s === 'object' && !Array.isArray(s)) {
      const own = /** @type {any} */ (s)[which];
      if (own !== undefined) return { snap: own };
    }
    return true;
  }

  function build(a) {
    if (gone || dg || held) return;
    const at = { x: seat.x, y: seat.y };
    // The floor's destroy takes back its own classes and leaves ours; the transform goes because
    // anime's animatable writes its own, and two of them on one element fight.
    if (floor) { floor.destroy(); floor = null; }
    node.style.transform = '';
    const params = /** @type {any} */ ({
      x: axisParam('x'),
      y: axisParam('y'),
      onGrab: function () { held = true; node.classList.add('ak-tug--held'); if (o.onGrab) o.onGrab(); },
      onDrag: function () { say(o.onDrag); },
      onRelease: function () {
        held = false;
        node.classList.remove('ak-tug--held');
        say(o.onRelease);
        if (home) set(0, 0);
      },
      onSnap: function () { say(o.onSnap); },
    });
    if (o.container) params.container = o.container;
    if (typeof o.stiffness === 'number') params.releaseStiffness = o.stiffness;
    if (typeof o.snap === 'number' || Array.isArray(o.snap)) params.snap = o.snap;
    if (quiet) {
      // Under the hand it still tracks the hand; off the hand it goes nowhere it was not put.
      params.velocityMultiplier = 0;
      params.maxVelocity = 0;
      params.minVelocity = 0;
    }
    dg = a.createDraggable(node, params);
    if (at.x || at.y) { dg.setX(at.x, true); dg.setY(at.y, true); }
  }

  /** Take the element from the floor to the library, when it is safe to. */
  function handover() {
    if (gone || dg || held) return;
    withAnime(build);
  }

  /**
   * Put the element at a position, in pixels from where it started. Under reduced motion, and
   * before the library lands, it arrives there rather than travelling.
   * @param {number} nx
   * @param {number} ny
   */
  function set(nx, ny) {
    const tx = axis === 'y' ? 0 : Number(nx) || 0;
    const ty = axis === 'x' ? 0 : Number(ny) || 0;
    seat.x = tx;
    seat.y = ty;
    if (!dg) { node.style.transform = 'translate(' + tx + 'px, ' + ty + 'px)'; return; }
    if (quiet) { dg.setX(tx); dg.setY(ty); return; }
    dg.animate.translateX(tx, HOME_MS);
    dg.animate.translateY(ty, HOME_MS);
  }

  handover();

  return {
    el: node,
    /** How far right of its origin the element stands, in pixels. */
    x: x,
    /** How far below its origin the element stands, in pixels. */
    y: y,
    set: set,
    /** Back to where it started. */
    reset: function () { set(0, 0); },
    destroy: function () {
      gone = true;
      if (floor) { floor.destroy(); floor = null; }
      if (dg) { dg.revert(); dg = null; }
      node.style.transform = '';
      node.classList.remove('ak-tug', 'ak-tug--held');
    },
  };
}

/* ── The celebration ────────────────────────────────────────────────────────────────────── */

/** The three particle shapes. The clothes are the stylesheet's; this only names them. */
const BURST_KINDS = ['dot', 'confetti', 'spark'];

/** The tones a particle may wear, every one of them a --ak-* token in the stylesheet. */
const BURST_TONES = ['accent', 'ok', 'warn', 'err', 'ch1', 'ch2', 'ch3', 'ch4'];

/** How long the ring pulse stands in for the whole burst when less motion was asked for. */
const RING_MS = 440;

/**
 * THE CELEBRATION. Particles are born at one point inside the target, thrown outward across the
 * spread, pulled down by gravity, spun, faded, and then taken off the page. The promise settles
 * when the last of them is gone, so an app can await the celebration before moving on.
 *
 * ONE burst per call. Nothing here loops, nothing here is left behind, and a target that is
 * celebrated twice gets two finite bursts rather than a running one.
 *
 * Colour comes only from the contract: `tones` names `--ak-accent`, `--ak-ok`, `--ak-warn`,
 * `--ak-err` or one of the four channel colours `--ak-crt-ch1` to `--ak-crt-ch4`, and the
 * stylesheet is where each one is read. Nothing in this file writes a colour.
 *
 * Under reduced motion the answer is ONE ring pulse through a Web Animation: the moment is
 * still marked, at the right place, without thirty things flying across the screen.
 *
 * @param {Element|string} target
 * @param {{ count?: number, kinds?: ('dot'|'confetti'|'spark')[], spread?: number,
 *   distance?: number, duration?: number, from?: { x: number, y: number },
 *   tones?: ('accent'|'ok'|'warn'|'err'|'ch1'|'ch2'|'ch3'|'ch4')[] }} [opts]
 * @returns {Promise<void>}
 */
export function burst(target, opts) {
  const o = opts || {};
  const host = /** @type {HTMLElement} */ (resolve(target));
  const count = Math.max(1, Math.min(200, Math.round(o.count || 24)));
  const kinds = (o.kinds || BURST_KINDS).filter(function (k) { return BURST_KINDS.indexOf(k) >= 0; });
  const tones = (o.tones || ['accent', 'ch1', 'ch2', 'ch3']).filter(function (t) { return BURST_TONES.indexOf(t) >= 0; });
  const spread = typeof o.spread === 'number' ? Math.max(1, Math.min(360, o.spread)) : 360;
  const distance = o.distance || 140;
  const duration = o.duration || 1100;

  const box = host.getBoundingClientRect();
  const at = o.from || { x: box.width / 2, y: box.height / 2 };

  // The layer needs a positioned host to sit in. A host that already has one is left alone; one
  // that does not is lent a class for the length of the burst and gets it back at the end.
  const lend = getComputedStyle(host).position === 'static';
  if (lend) host.classList.add('ak-burst-host');
  const layer = el('div', { class: 'ak-burst', 'aria-hidden': 'true' });
  layer.style.setProperty('--ak-burst-x', (Number(at.x) || 0) + 'px');
  layer.style.setProperty('--ak-burst-y', (Number(at.y) || 0) + 'px');
  host.appendChild(layer);

  const clean = function () {
    layer.remove();
    if (lend) host.classList.remove('ak-burst-host');
  };

  if (reducedMotion() || animeOff) {
    const ring = el('span', { class: 'ak-burst__ring' });
    layer.appendChild(ring);
    if (typeof ring.animate !== 'function') { clean(); return Promise.resolve(); }
    const pulse = ring.animate(
      [{ transform: 'scale(0.25)', opacity: 0.85 }, { transform: 'scale(1)', opacity: 0 }],
      { duration: RING_MS, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' },
    );
    return pulse.finished.then(clean, clean);
  }

  return new Promise(function (done) {
    const finish = function () { clean(); done(); };
    onCue(function (a) {
      const rand = a.utils.random;
      const bits = [];
      for (let i = 0; i < count; i++) {
        const kind = kinds.length ? kinds[i % kinds.length] : 'dot';
        const tone = tones.length ? tones[i % tones.length] : 'accent';
        bits.push(el('span', { class: 'ak-burst__bit ak-burst__bit--' + kind + ' ak-burst__bit--' + tone }));
      }
      bits.forEach(function (bit) { layer.appendChild(bit); });

      const tl = a.createTimeline({ defaults: { ease: 'outQuad' } });
      bits.forEach(function (bit) {
        // A full spread is a ring; a narrow one fans upward from the point, which is what a
        // celebration coming out of a button looks like.
        const deg = spread >= 360 ? rand(0, 359) : -90 + rand(-spread / 2, spread / 2);
        const rad = (deg * Math.PI) / 180;
        const reach = rand(distance * 0.45, distance);
        const rise = Math.round(duration * 0.42);
        const dx = Math.cos(rad) * reach;
        const dy = Math.sin(rad) * reach;
        tl.add(bit, {
          x: [0, dx],
          // Out, then down: the second beat is gravity, and it always ends below the first.
          y: [
            { to: dy, duration: rise, ease: 'outCubic' },
            { to: dy + reach * 1.35, duration: duration - rise, ease: 'inCubic' },
          ],
          rotate: [0, rand(-540, 540)],
          scale: [
            { to: rand(80, 115) / 100, duration: Math.round(duration * 0.16), ease: 'outBack' },
            { to: 0.2, duration: duration - Math.round(duration * 0.16), ease: 'inQuad' },
          ],
          opacity: [
            { to: 1, duration: 60 },
            { to: 0, duration: duration - 60, ease: 'inQuad' },
          ],
          duration: duration,
        }, 0);
      });
      tl.then(finish);
    }, finish);
  });
}

/* ── The choreography the reader plays ──────────────────────────────────────────────────── */

/**
 * THE CHOREOGRAPHY THE READER PLAYS. The beats are written exactly as `sequence` takes them, and
 * they become ONE timeline whose clock is not a clock: it is how far the target has travelled
 * through its scroller. Scroll down and the beats play in order; scroll back up and they
 * un-play. Nothing runs while the reader is still.
 *
 * `enter` and `leave` are anime's own scroll thresholds, two words each — the target's edge
 * first, then the scroller's: `'top bottom'` starts when the target's top reaches the bottom of
 * the view, `'bottom top'` ends when its bottom leaves the top. Left out, the whole passage of
 * the element through the scroller is the range.
 *
 * `container` is the scroller. Left out, the nearest ancestor that actually scrolls is used, and
 * failing that the window — the same rule the kit's own scroll pieces follow.
 *
 * When the library has no scroll observer (an older build), the fallback is a scroll listener on
 * the same container, coalesced into one frame, that seeks the timeline to the same fraction. It
 * is the same picture with a coarser hand.
 *
 * Under reduced motion nothing is built and nothing is bound: every beat's target is put at its
 * END state, which is where the choreography was always going to leave it.
 *
 * @param {Element|string} target the element whose travel through the scroller IS the clock
 * @param {Array<{ targets: Element|Element[]|string, props: Record<string, any>,
 *   at?: number|string }>} steps
 * @param {{ container?: Element, enter?: string, leave?: string, axis?: 'x'|'y' }} [opts]
 * @returns {{ el: Element, timeline: any, progress: () => number, destroy: () => void }}
 */
export function scrub(target, steps, opts) {
  const o = opts || {};
  const node = /** @type {HTMLElement} */ (resolve(target));
  const list = (Array.isArray(steps) ? steps : []).filter(function (s) { return s && s.targets && s.props; });
  /** @type {any} */
  let tl = null;
  /** anime's scroll observer, when the library has one. */
  /** @type {any} */
  let watcher = null;
  /** Undo for the hand-rolled fallback, when it is what got used. */
  /** @type {(() => void)|null} */
  let bound = null;
  let last = 0;
  let gone = false;

  if (reducedMotion()) {
    list.forEach(function (step) {
      toElements(step.targets).forEach(function (n) { settle(n, step.props); });
    });
    return {
      el: node,
      get timeline() { return null; },
      progress: function () { return 1; },
      destroy: function () { /* nothing was bound: there is nothing to take back */ },
    };
  }

  /** The fallback clock: the element's travel through the scroller, read on a scroll event. */
  function bindByHand() {
    const scroller = o.container || nearestScroller(node);
    let rafId = 0;
    const tick = function () {
      const r = node.getBoundingClientRect();
      const h = scroller === window ? window.innerHeight : /** @type {Element} */ (scroller).clientHeight;
      const top = scroller === window ? 0 : /** @type {Element} */ (scroller).getBoundingClientRect().top;
      last = Math.max(0, Math.min(1, (top + h - r.top) / Math.max(h + r.height, 1)));
      if (tl) tl.seek(tl.duration * last);
    };
    const onScrolled = function () {
      if (!rafId) rafId = requestAnimationFrame(function () { rafId = 0; tick(); });
    };
    scroller.addEventListener('scroll', onScrolled, { passive: true });
    window.addEventListener('resize', onScrolled);
    tick();
    bound = function () {
      scroller.removeEventListener('scroll', onScrolled);
      window.removeEventListener('resize', onScrolled);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }

  withAnime(function (a) {
    if (gone) return;
    if (typeof a.onScroll === 'function') {
      watcher = a.onScroll(/** @type {any} */ ({
        target: node,
        container: o.container,
        axis: o.axis === 'x' ? 'x' : 'y',
        enter: o.enter,
        leave: o.leave,
        // The observer's progress IS the timeline's clock, 1:1, rather than a play/pause cue.
        sync: true,
        onUpdate: function (w) { last = w.progress; },
      }));
      // The observer links at the timeline's init, when the timeline is still empty; it reads
      // the duration live on every scroll tick, so the beats added below are picked up.
      tl = a.createTimeline({ autoplay: watcher });
    } else {
      tl = a.createTimeline({ autoplay: false });
    }
    list.forEach(function (step) { tl.add(step.targets, step.props, step.at); });
    if (!watcher) bindByHand();
  }, function () {
    // No library and no scroll clock: the beats stand where the choreography ends, which is the
    // same picture a reader who scrolled all the way through would have.
    list.forEach(function (step) {
      toElements(step.targets).forEach(function (n) { settle(n, step.props); });
    });
    last = 1;
  });

  return {
    el: node,
    /** The anime timeline itself, once the library has landed. Null until then. */
    get timeline() { return tl; },
    /** How far the reader has carried the choreography, 0 to 1. */
    progress: function () { return last; },
    destroy: function () {
      gone = true;
      if (bound) { bound(); bound = null; }
      if (watcher) { watcher.revert(); watcher = null; }
      if (tl) { tl.revert(); tl = null; }
    },
  };
}
