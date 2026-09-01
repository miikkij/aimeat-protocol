/**
 * @file atelier/anime-show.js
 * @description The SHOW pieces anime.js is worth a dependency for. Five parts, each one a thing
 *   an app can put on a page AND a moment worth watching:
 *
 *     textReveal  a headline arrives piece by piece (words, characters or lines), rising,
 *                 blurring in, flipping or dropping. The text stays the text: selectable, and
 *                 read aloud once as a sentence rather than as thirty fragments.
 *     drawPath    every shape in an SVG draws itself on, in document order. Under `scroll` the
 *                 pen is the scrollbar: the drawing follows the reader down the page.
 *     gridWave    a grid of tiles ripples out from a point, and a click on any tile sends the
 *                 ripple from there. That is the show; the part is the grid.
 *     sequence    a list of beats becomes ONE timeline with play, pause, seek and reverse. The
 *                 piece an app uses to choreograph a hero instead of chaining setTimeout.
 *     orbit       items ride an SVG path once, spread along it, each holding the path's angle.
 *
 *   anime@4 is vendored on this node (/lib/anime@4.min.js, MIT) and lazy-loaded, one shared load
 *   for whoever asks first. Nothing here needs it to be CORRECT: before the script lands, after
 *   it fails to land, and whenever the viewer asks for less motion, every part shows its END
 *   state (the plain headline, the whole drawing, the grid at rest, the hero where it belongs,
 *   the items spread along the path) and every control still does what it says. An entrance that
 *   would arrive more than 400 ms late is dropped rather than flashed, the same rule
 *   anime-parts.js follows.
 *
 *   MOTION IS FINITE. Every part runs once per cue. `orbit` is the only one that can repeat, the
 *   caller has to ask for it by name (`loop: true`), and it is the app's choice to defend, not a
 *   default this kit hands out.
 * @structure ensureAnime · withAnime · warmAnime · onCue · cue · toElements ·
 *   textReveal(target, opts) · drawPath(target, opts) · gridWave(target, opts) ·
 *   sequence(steps, opts) · orbit(target, opts)
 * @usage
 *   AIMEAT.atelier.textReveal(h1, { by: 'words', from: 'rise' });
 *   AIMEAT.atelier.drawPath(svgEl, { when: 'scroll' });
 *   const wave = AIMEAT.atelier.gridWave(host, { cols: 12, rows: 6, kind: 'tint' });
 *   const show = AIMEAT.atelier.sequence([
 *     { targets: chipA, props: { y: [24, 0], opacity: [0, 1], duration: 500 } },
 *     { targets: chipB, props: { y: [24, 0], opacity: [0, 1], duration: 500 }, at: '<<+=90' },
 *   ], { autoplay: false });
 *   AIMEAT.atelier.orbit(host, { path: 'M10 50 C 10 20...', items: 4, duration: 6000 });
 * @version-history
 *   v0.45.1 — 2026-09-02 — textReveal's classes are .ak-textreveal*: .ak-reveal already belongs
 *     to the disclosure component (content.css), whose flex column stacked every word on its
 *     own line. Lines are split only when asked (lines: false otherwise).
 *   v0.45.0 — 2026-09-02 — Initial: the anime.js show module (textReveal, drawPath, gridWave,
 *     sequence, orbit).
 */
import { el, resolve, reducedMotion } from './dom.js';
import { NODE_URL } from '../_core/config.js';
import { inView } from './motion.js';

/** `window` has no declared `anime`; one cast here beats a cast at every call site. */
const W = /** @type {any} */ (window);

/** One shared load of anime@4, whoever asks first. */
let animePromise = null;
/** Set once the node would not serve the script: stop asking, the parts stand without it. */
let animeOff = false;

/** The window in which an entrance is still an entrance. Later than this and it is a flash. */
const LATE = 400;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Load anime@4 from this node, once.
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
 * @returns {void}
 */
function withAnime(run) {
  if (animeOff || reducedMotion()) return;
  ensureAnime().then(run, function () { animeOff = true; });
}

/** Ask for the library ahead of the cue that will want it. A refusal costs only the motion. */
function warmAnime() {
  if (animeOff || reducedMotion()) return;
  ensureAnime().then(null, function () { animeOff = true; });
}

/**
 * An entrance, on the library's arrival — dropped when that arrival is late enough that the end
 * state is already on the screen and animating from nothing would read as a fault.
 * @param {(anime: any) => void} run
 * @returns {void}
 */
function onCue(run) {
  const asked = Date.now();
  withAnime(function (a) {
    if (Date.now() - asked > LATE) return;
    run(a);
  });
}

/**
 * Play now, or the first time the element is seen.
 * @param {Element} node
 * @param {string|undefined} when
 * @param {() => void} play
 * @param {boolean|undefined} once
 * @returns {{ destroy: () => void }|null}
 */
function cue(node, when, play, once) {
  if (when === 'now') { play(); return null; }
  warmAnime();
  return inView(node, play, { once: once !== false });
}

/**
 * Anything a caller may name as targets, as a real array of elements. anime parses these itself;
 * this is for the paths that have no library to lean on (reduced motion, end states).
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

/** The element children of a node, as an array. */
function kidsOf(node) {
  return Array.prototype.slice.call(node.children);
}

/* ── The headline that arrives ──────────────────────────────────────────────────────────── */

/** How far apart the pieces land, by what a piece is. */
const REVEAL_EACH = { words: 34, chars: 16, lines: 70 };

/** The four entrances, as anime property maps. `flip` carries its own perspective. */
const REVEAL_FROM = {
  rise: { opacity: [0, 1], y: [18, 0] },
  blur: { opacity: [0, 1], filter: ['blur(9px)', 'blur(0px)'] },
  flip: { opacity: [0, 1], perspective: ['720px', '720px'], rotateX: [-86, 0], y: [10, 0] },
  drop: { opacity: [0, 1], y: [-24, 0], scale: [0.86, 1] },
};

/**
 * THE HEADLINE THAT ARRIVES. The element's text is split into words, characters or lines and the
 * pieces land one after another. The reading never suffers for it: anime's splitter keeps the
 * original sentence in a screen-reader copy and marks the visible pieces `aria-hidden`, the
 * pieces are selectable text, and the END state is the plain headline — which is also what stands
 * there before the library lands, after it fails to, and under reduced motion.
 *
 * `by: 'lines'` re-splits when the element's width changes (a line is a layout fact, not a text
 * one); the entrance still plays once. Without the library's splitter the fallback splits on
 * words, so `chars` degrades to `words` rather than to nothing.
 *
 * @param {Element|string} target
 * @param {{ by?: 'words'|'chars'|'lines', from?: 'rise'|'blur'|'flip'|'drop', each?: number,
 *   duration?: number, when?: 'now'|'inView', once?: boolean }} [opts]
 * @returns {{ el: HTMLElement, play: () => void, reset: () => void, destroy: () => void }}
 */
export function textReveal(target, opts) {
  const o = opts || {};
  const node = /** @type {HTMLElement} */ (resolve(target));
  const by = o.by === 'chars' || o.by === 'lines' ? o.by : 'words';
  const from = REVEAL_FROM[o.from] ? o.from : 'rise';
  const each = typeof o.each === 'number' ? o.each : REVEAL_EACH[by];
  const duration = o.duration || (by === 'chars' ? 560 : 700);
  const html = node.innerHTML;
  const hasText = !!(node.textContent || '').trim();
  node.classList.add('ak-textreveal', 'ak-textreveal--' + from);

  /** The library's splitter while one is live, so reset can hand the element back intact. */
  let splitter = null;
  /** Set when the fallback split ran instead, which restores by innerHTML rather than by revert. */
  let ownSplit = false;
  let watcher = null;

  /** Split with our own spans when the library has no splitter: words, and pieces that hide. */
  function fallback() {
    const text = node.textContent || '';
    node.setAttribute('aria-label', text.trim());
    node.textContent = '';
    const made = [];
    text.split(/(\s+)/).forEach(function (part) {
      if (!part) return;
      const piece = el('span', { class: 'ak-textreveal__piece', 'aria-hidden': 'true' }, part);
      node.appendChild(piece);
      if (part.trim()) made.push(piece);
    });
    ownSplit = true;
    return made;
  }

  /** The pieces the library made, for the kind asked for. */
  function piecesOf(sp) {
    if (by === 'chars') return sp.chars;
    if (by === 'lines') return sp.lines;
    return sp.words;
  }

  function travel(a, list) {
    if (!list || !list.length) return;
    a.animate(list, Object.assign({}, REVEAL_FROM[from], {
      duration: duration,
      delay: a.stagger(each),
      ease: from === 'flip' ? 'outBack' : 'outExpo',
    }));
  }

  /**
   * Put the element back the way it was found. Safe to call at any time, and called before a
   * replay so the second run starts from the same plain text as the first.
   */
  function reset() {
    if (splitter) {
      try { splitter.revert(); } catch { /* already reverted by the host */ }
      splitter = null;
    }
    if (ownSplit) {
      node.innerHTML = html;
      node.removeAttribute('aria-label');
      ownSplit = false;
    }
  }

  function play() {
    if (!hasText || reducedMotion()) return;
    onCue(function (a) {
      reset();
      const api = a.text || {};
      const make = typeof api.splitText === 'function' ? api.splitText
        : typeof api.split === 'function' ? api.split : null;
      if (!make) { travel(a, fallback()); return; }
      // `class` rides through the splitter's own template, so the pieces wear the kit's clothes
      // (inline-block, and a block line) without this file writing a style.
      // Lines are split ONLY when asked: the splitter's line detection otherwise marks every
      // word as a line of its own once the words are inline-block, and a headline that should
      // wrap as prose arrives one word per line.
      const cfg = /** @type {any} */ ({ accessible: true, lines: false, words: { class: 'ak-textreveal__piece' } });
      if (by === 'chars') cfg.chars = { class: 'ak-textreveal__piece' };
      if (by === 'lines') cfg.lines = { class: 'ak-textreveal__piece' };
      let played = false;
      splitter = make(node, cfg);
      // The effect fires when the split is ready — at once for words and characters, after the
      // fonts settle for lines — and again on every re-split. The entrance is the FIRST one only:
      // a re-split rebuilds the pieces from the stored HTML, so they are already at their end
      // state and a second run would be motion nobody asked for.
      splitter.addEffect(function (sp) {
        if (!played) { played = true; travel(a, piecesOf(sp)); }
        return function () { /* the pieces are the splitter's to take back */ };
      });
    });
  }

  watcher = cue(node, o.when === 'now' ? 'now' : 'inView', play, o.once);

  return {
    el: node,
    play: play,
    reset: reset,
    /** Unwire and hand the element back as plain text. The element itself stays on the page. */
    destroy: function () {
      if (watcher) { watcher.destroy(); watcher = null; }
      reset();
      node.classList.remove('ak-textreveal', 'ak-textreveal--' + from);
    },
  };
}

/* ── The drawing that draws itself ──────────────────────────────────────────────────────── */

/** What a drawable shape is. Anything else in the SVG is left exactly as the author drew it. */
const DRAWABLE = 'path, line, polyline, circle, rect';

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
 * THE DRAWING THAT DRAWS ITSELF. Every path, line, polyline, circle and rect inside the given
 * `<svg>` (or the one shape handed in) is turned into an anime drawable and drawn on in document
 * order, a beat apart. The stroke is the shape's own — give it `stroke="currentColor"` and the
 * `.ak-draw` class carries the ink from `--ak-ink`, or `.ak-draw--accent` from `--ak-accent`.
 *
 * `when: 'scroll'` binds the pen to the reader instead of to a clock: the drawing's progress is
 * how far the element has travelled through its scroller, so scrolling back un-draws it. Every
 * other mode draws once and stops.
 *
 * Before the library lands and under reduced motion the drawing simply stands there whole, which
 * is what a drawing is for.
 *
 * @param {Element|string} target
 * @param {{ when?: 'now'|'inView'|'scroll', duration?: number, each?: number, ease?: string,
 *   scroller?: Element|Window, once?: boolean }} [opts]
 * @returns {{ el: Element, play: () => void, reset: () => void, progress: (p: number) => void,
 *   destroy: () => void }}
 */
export function drawPath(target, opts) {
  const o = opts || {};
  const node = resolve(target);
  const when = o.when === 'now' || o.when === 'scroll' ? o.when : 'inView';
  const duration = o.duration || 1100;
  const each = typeof o.each === 'number' ? o.each : 140;
  node.classList.add('ak-draw');

  const shapes = node.tagName && node.tagName.toLowerCase() === 'svg'
    ? Array.prototype.slice.call(node.querySelectorAll(DRAWABLE))
    : [node];
  shapes.forEach(function (s) { s.classList.add('ak-draw__shape'); });

  /** anime's drawable proxies, made on the library's arrival and kept for reset and progress. */
  let drawables = null;
  let watcher = null;
  let bound = null;

  /** Make the proxies once, hidden (`0 0`), so the first frame of any mode is an empty page. */
  function drawablesOf(a) {
    if (!drawables) drawables = a.svg.createDrawable(shapes, 0, 0);
    return drawables;
  }

  function setDraw(value) {
    if (!drawables) return;
    drawables.forEach(function (d) { d.setAttribute('draw', value); });
  }

  function play() {
    if (reducedMotion() || !shapes.length) return;
    onCue(function (a) {
      a.animate(drawablesOf(a), {
        draw: ['0 0', '0 1'],
        duration: duration,
        delay: a.stagger(each),
        ease: o.ease || 'inOutQuad',
      });
    });
  }

  /**
   * Draw the whole set to a fraction of itself, 0 to 1. A no-op until the library has landed,
   * because a drawable is the library's own proxy; the drawing is whole in the meantime.
   * @param {number} p
   */
  function progress(p) {
    const at = Math.max(0, Math.min(1, Number(p) || 0));
    setDraw('0 ' + at);
  }

  /** Back to an empty page, ready to be drawn again. Like `progress`, it waits for the library. */
  function reset() { setDraw('0 0'); }

  /** The pen follows the reader: the element's travel through its scroller IS the progress. */
  function bindScroll() {
    if (reducedMotion()) return;
    withAnime(function (a) {
      drawablesOf(a);
      reset();
      const scroller = o.scroller || nearestScroller(node);
      let rafId = 0;
      const tick = function () {
        const r = node.getBoundingClientRect();
        const h = scroller === window ? window.innerHeight : /** @type {Element} */ (scroller).clientHeight;
        const top = scroller === window ? 0 : /** @type {Element} */ (scroller).getBoundingClientRect().top;
        progress((top + h - r.top) / Math.max(h + r.height, 1));
      };
      const onScroll = function () {
        if (!rafId) rafId = requestAnimationFrame(function () { rafId = 0; tick(); });
      };
      scroller.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      tick();
      bound = function () {
        scroller.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        if (rafId) cancelAnimationFrame(rafId);
      };
    });
  }

  if (when === 'scroll') bindScroll();
  else watcher = cue(node, when, play, o.once);

  return {
    el: node,
    play: play,
    reset: reset,
    progress: progress,
    destroy: function () {
      if (watcher) { watcher.destroy(); watcher = null; }
      if (bound) { bound(); bound = null; }
      // Whole again: a half-drawn shape left behind would read as a broken picture.
      progress(1);
      drawables = null;
      shapes.forEach(function (s) { s.classList.remove('ak-draw__shape'); });
      node.classList.remove('ak-draw');
    },
  };
}

/* ── The grid that ripples ──────────────────────────────────────────────────────────────── */

/** The four ripples, as anime keyframe pairs. Each ends where it started: the grid at rest. */
const WAVE_BEATS = {
  scale: [{ scale: 1.22 }, { scale: 1 }],
  rise: [{ y: -16 }, { y: 0 }],
  flip: [{ rotateY: 180 }, { rotateY: 360 }],
  tint: [{ '--ak-wave-t': 1 }, { '--ak-wave-t': 0 }],
};

/**
 * THE GRID THAT RIPPLES. Tiles are taken from the element's own children, or built when it is
 * empty, and a wave runs out from a point through anime's grid stagger. A CLICK ON A TILE sends
 * the next wave from that tile, which is the whole show: the surface answers where it was touched.
 *
 * `from` is a named point ('center', 'first', 'last', 'random'), a tile index, or `[column, row]`
 * as zero-based grid coordinates. `kind: 'tint'` moves the accent through the tiles by animating
 * `--ak-wave-t`, which the stylesheet mixes into each tile's ground; the other three move the
 * tile itself. Nothing moves under reduced motion, and the grid at rest is the end state.
 *
 * @param {Element|string} target
 * @param {{ cols?: number, rows?: number, from?: 'center'|'first'|'last'|'random'|number|number[],
 *   each?: number, duration?: number, kind?: 'scale'|'rise'|'flip'|'tint',
 *   when?: 'now'|'inView', once?: boolean, cells?: number }} [opts]
 * @returns {{ el: Element, play: (from?: any) => void, destroy: () => void }}
 */
export function gridWave(target, opts) {
  const o = opts || {};
  const root = /** @type {HTMLElement} */ (resolve(target));
  const cols = Math.max(1, Math.round(o.cols || 8));
  const rows = Math.max(1, Math.round(o.rows || 4));
  const kind = WAVE_BEATS[o.kind] ? o.kind : 'scale';
  const each = typeof o.each === 'number' ? o.each : 34;
  const duration = o.duration || 640;
  root.classList.add('ak-wave', 'ak-wave--' + kind);
  root.style.setProperty('--ak-wave-cols', String(cols));

  let tiles = kidsOf(root);
  const built = !tiles.length;
  if (built) {
    const count = Math.max(1, Math.round(o.cells || cols * rows));
    for (let i = 0; i < count; i++) {
      root.appendChild(el('div', { class: 'ak-wave__tile', 'aria-hidden': 'true' }));
    }
    tiles = kidsOf(root);
  } else {
    tiles.forEach(function (tile) { tile.classList.add('ak-wave__tile'); });
  }

  /** A caller's point, as something anime's grid stagger understands. */
  function pointOf(value) {
    if (Array.isArray(value) && value.length >= 2) {
      const x = Math.max(0, Math.min(cols - 1, Math.round(Number(value[0]) || 0)));
      const y = Math.max(0, Math.min(rows - 1, Math.round(Number(value[1]) || 0)));
      return y * cols + x;
    }
    if (typeof value === 'number') return Math.max(0, Math.round(value));
    if (value === 'first' || value === 'last' || value === 'random' || value === 'center') return value;
    return 'center';
  }

  /**
   * Send a wave. With no argument it runs from the point the call was built with.
   * @param {any} [fromAt]
   */
  function play(fromAt) {
    if (reducedMotion() || !tiles.length) return;
    onCue(function (a) {
      a.animate(tiles, {
        keyframes: WAVE_BEATS[kind],
        duration: duration,
        delay: a.stagger(each, { grid: [cols, rows], from: pointOf(fromAt === undefined ? o.from : fromAt) }),
        ease: 'inOutQuad',
      });
    });
  }

  // One listener on the grid rather than one per tile: a 12 x 6 grid is 72 tiles, and the wave
  // has to know WHICH one was pressed, which is the tile's index among its siblings.
  const onClick = function (ev) {
    const start = /** @type {Element|null} */ (ev.target);
    if (!start || !start.closest) return;
    const tile = start.closest('.ak-wave__tile');
    if (!tile || tile.parentElement !== root) return;
    play(tiles.indexOf(/** @type {any} */ (tile)));
  };
  root.addEventListener('click', onClick);

  const watcher = cue(root, o.when === 'now' ? 'now' : 'inView', function () { play(); }, o.once);

  return {
    el: root,
    play: play,
    destroy: function () {
      if (watcher) watcher.destroy();
      root.removeEventListener('click', onClick);
      if (built) tiles.forEach(function (tile) { tile.remove(); });
      else tiles.forEach(function (tile) { tile.classList.remove('ak-wave__tile'); });
      root.classList.remove('ak-wave', 'ak-wave--' + kind);
      root.style.removeProperty('--ak-wave-cols');
    },
  };
}

/* ── The choreography ───────────────────────────────────────────────────────────────────── */

/** The properties a beat's end state can be read from without the library. */
const END_KEYS = ['x', 'y', 'scale', 'rotate', 'opacity'];

/** The last value a property is asked to reach: `[from, to]` ends at `to`, a bare value at itself. */
function endOf(value) {
  if (Array.isArray(value)) return value.length ? value[value.length - 1] : null;
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

/**
 * THE CHOREOGRAPHY. A declared list of beats becomes one anime timeline, so a hero's three
 * elements move as one piece with one clock: play it, pause it, seek into it, run it backwards.
 *
 * `at` is the beat's position on that clock: a number of milliseconds, `'<'` for straight after
 * the previous beat, `'<<'` for alongside it (both take an offset, `'<<+=90'`), or a label. Left
 * out, the beat lands at the end of what is there so far.
 *
 * Write each beat's properties as `[from, to]` pairs. The elements' resting CSS is then the END
 * of the choreography, which is what a viewer sees before the library lands, after it fails to,
 * and under reduced motion, where the end state is set and no clock ever starts.
 *
 * @param {Array<{ targets: Element|Element[]|string, props: Record<string, any>,
 *   at?: number|string }>} steps
 * @param {{ autoplay?: boolean, loop?: boolean|number }} [opts]
 * @returns {{ timeline: any, play: () => void, pause: () => void, restart: () => void,
 *   seek: (ms: number) => void, reverse: () => void, duration: () => number, destroy: () => void }}
 */
export function sequence(steps, opts) {
  const o = opts || {};
  const list = (Array.isArray(steps) ? steps : []).filter(function (s) { return s && s.targets && s.props; });
  /** @type {any} */
  let tl = null;
  /** What the app asked for before the library landed, replayed in order once it has. */
  const queued = [];
  const asked = Date.now();

  function drive(name, arg) {
    if (tl) { tl[name](arg); return; }
    queued.push([name, arg]);
  }

  if (reducedMotion()) {
    list.forEach(function (step) {
      toElements(step.targets).forEach(function (node) { settle(node, step.props); });
    });
  } else {
    withAnime(function (a) {
      tl = a.createTimeline({ autoplay: false, loop: o.loop || false });
      list.forEach(function (step) { tl.add(step.targets, step.props, step.at); });
      queued.forEach(function (want) { tl[want[0]](want[1]); });
      // An autoplay that arrives after the window has passed is dropped: the elements are already
      // standing where the choreography would have left them, and the app can still press play.
      if (o.autoplay !== false && !queued.length && Date.now() - asked <= LATE) tl.play();
    });
  }

  return {
    /** The anime timeline itself, once the library has landed. Null until then. */
    get timeline() { return tl; },
    play: function () { drive('play'); },
    pause: function () { drive('pause'); },
    restart: function () { drive('restart'); },
    seek: function (ms) { drive('seek', Number(ms) || 0); },
    reverse: function () { drive('reverse'); },
    /** How long the whole piece runs, in milliseconds. 0 until the timeline exists. */
    duration: function () { return tl ? tl.duration : 0; },
    destroy: function () {
      queued.length = 0;
      if (tl) { tl.revert(); tl = null; }
    },
  };
}

/* ── The path ride ──────────────────────────────────────────────────────────────────────── */

/**
 * THE PATH RIDE. Items are placed along an SVG path and carried around it once, each holding the
 * path's own angle as it goes. `spread` is how much of the path the starting positions cover: 1
 * spreads them evenly over the whole figure, 0.25 keeps them in a bunch.
 *
 * NOTHING LOOPS ON ITS OWN. `loop: true` is the app's decision to make and to defend; the kit's
 * default is one lap and then stillness. Under reduced motion, before the library lands and after
 * it fails to, the items sit spread along the path exactly where the ride would start.
 *
 * @param {Element|string} target
 * @param {{ path: SVGPathElement|string, items: Element[]|number, duration?: number,
 *   spread?: number, ease?: string, loop?: boolean, when?: 'now'|'inView', once?: boolean,
 *   viewBox?: string }} opts
 * @returns {{ el: Element, play: () => void, pause: () => void, seek: (p: number) => void,
 *   destroy: () => void }}
 */
export function orbit(target, opts) {
  const o = opts || /** @type {any} */ ({});
  const root = /** @type {HTMLElement} */ (resolve(target));
  const duration = o.duration || 6000;
  const spread = typeof o.spread === 'number' ? Math.max(0, Math.min(1, o.spread)) : 1;
  root.classList.add('ak-orbit');

  /** The stage this call built, if it built one, so destroy takes back only its own work. */
  let stage = null;
  /** @type {any} */
  let path = null;
  if (o.path && typeof o.path !== 'string') {
    path = o.path;
  } else if (typeof o.path === 'string' && o.path.trim()) {
    stage = document.createElementNS(SVG_NS, 'svg');
    stage.setAttribute('class', 'ak-orbit__stage');
    stage.setAttribute('viewBox', o.viewBox || '0 0 100 100');
    stage.setAttribute('aria-hidden', 'true');
    path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'ak-orbit__path');
    path.setAttribute('d', o.path);
    path.setAttribute('fill', 'none');
    stage.appendChild(path);
    root.insertBefore(stage, root.firstChild);
  }

  /** The riders: the caller's own elements, or dots this call made. */
  const madeItems = typeof o.items === 'number';
  let items;
  if (madeItems) {
    items = [];
    for (let i = 0; i < Math.max(1, Math.round(o.items)); i++) {
      const dot = el('span', { class: 'ak-orbit__dot', 'aria-hidden': 'true' });
      root.appendChild(dot);
      items.push(dot);
    }
  } else {
    items = toElements(o.items);
  }
  items.forEach(function (item) { item.classList.add('ak-orbit__item'); });

  /** Where item `i` starts, as a fraction of the path's length. */
  function offsetOf(i) { return items.length ? (spread * i) / items.length : 0; }

  /** @type {any[]} */
  let runs = [];
  let watcher = null;

  /**
   * Sit the items along the path with no library and no motion: the ride's first frame, which is
   * also its resting picture. The path has to be laid out for this, so a first call before layout
   * says so and the caller tries again on the next frame.
   * @returns {boolean} whether the path could be measured yet
   */
  function place() {
    if (!path || typeof path.getTotalLength !== 'function') return false;
    const len = path.getTotalLength();
    if (!len) return false;
    const m = path.getCTM();
    items.forEach(function (item, i) {
      const p = path.getPointAtLength((offsetOf(i) * len) % len);
      const x = m ? p.x * m.a + p.y * m.c + m.e : p.x;
      const y = m ? p.x * m.b + p.y * m.d + m.f : p.y;
      item.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
    });
    return true;
  }

  function stop() {
    runs.forEach(function (run) { run.pause(); });
    runs = [];
  }

  function play() {
    if (reducedMotion()) { place(); return; }
    onCue(function (a) {
      stop();
      items.forEach(function (item, i) {
        const along = a.svg.createMotionPath(path, offsetOf(i));
        if (!along) return;
        runs.push(a.animate(item, Object.assign({}, along, {
          duration: duration,
          ease: o.ease || 'linear',
          loop: o.loop === true,
        })));
      });
    });
  }

  if (!place()) requestAnimationFrame(function () { place(); });
  watcher = cue(root, o.when === 'now' ? 'now' : 'inView', play, o.once);

  return {
    el: root,
    play: play,
    pause: function () { runs.forEach(function (run) { run.pause(); }); },
    /**
     * Move the whole ride to a fraction of one lap, 0 to 1. A no-op until the ride has been built.
     * @param {number} p
     */
    seek: function (p) {
      const at = Math.max(0, Math.min(1, Number(p) || 0));
      runs.forEach(function (run) { run.seek(at * duration); });
    },
    destroy: function () {
      if (watcher) { watcher.destroy(); watcher = null; }
      runs.forEach(function (run) { run.revert(); });
      runs = [];
      if (madeItems) items.forEach(function (item) { item.remove(); });
      else items.forEach(function (item) { item.classList.remove('ak-orbit__item'); item.style.transform = ''; });
      if (stage) stage.remove();
      root.classList.remove('ak-orbit');
    },
  };
}
