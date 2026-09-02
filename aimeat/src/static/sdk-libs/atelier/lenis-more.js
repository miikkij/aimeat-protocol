/**
 * @file atelier/lenis-more.js
 * @description TWO MORE THINGS THE SCROLL CAN DO, beside the story the director tells
 *   (lenis-director.js). Both are driven by where the reader is rather than by a clock, both are
 *   finite, and both put the author's DOM back in destroy():
 *
 *     parallax(target, opts)   layers inside one box travel at their own speeds as the box
 *                              crosses the screen: the far one lags, the near one leads.
 *     readingRail(spec)        the contents of a long article down the side of it, the heading
 *                              the reader is in lit, and a line saying how far through they are.
 *
 *   PROGRESS IS THE SAME ARITHMETIC THE DIRECTOR USES: 0 when the box's top enters at the bottom
 *   of the viewport, 1 when its bottom leaves at the top, measured against the nearest scrolling
 *   ancestor rather than the window, because an app shell's main pane is its own scroll box and a
 *   window listener never hears it move. One rAF per scroll burst, and nothing runs at rest.
 *
 *   THE ONLY NUMBER JAVASCRIPT SETS IS A CUSTOM PROPERTY. Where a layer stands and how full the
 *   reading line is arrive as `--ak-plx-x` / `--ak-plx-y` / `--ak-fill`; every colour, size and
 *   curve is a rule in lenis-more.css on the --ak-* contract.
 *
 *   THE RAIL TRAVELS ON THE PAGE'S OWN GLIDE. If a page-level director is alive it has named its
 *   Lenis instance on `window.__akLenis`, and a click on a heading rides that; with no director
 *   on the page the browser's own smooth scrolling carries it, and under reduced motion the jump
 *   is instant.
 * @structure nearestScroller · viewOf · layersOf · parallax(target, opts) →
 *   { el, progress, destroy } · slugOf · freeId · readingRail(spec) → { el, set, destroy }
 * @usage
 *   const p = AIMEAT.atelier.parallax('#cover', {
 *     layers: [{ el: '.far', speed: -0.35 }, { el: '.near', speed: 0.2 }], clamp: 120,
 *   });
 *   const toc = AIMEAT.atelier.readingRail({ article: '#story', headings: 'h2, h3',
 *     onPick(id) { track(id); } });
 *   toc.set({ current: 'chapter-2' });   toc.destroy();   p.destroy();
 * @version-history
 *   v0.46.1 — 2026-09-02 — parallax takes a `subject`: the element whose travel is measured, so a
 *     box pinned in a director's hold follows the hold instead of standing at 0.5 forever.
 *   v0.46.0 — 2026-09-02 — Initial (wish-atelier-story-director-show): the parallax box and the
 *     reading rail, beside the director's snap and sideways chapter.
 */
import { el, resolve, reducedMotion, uid } from './dom.js';

/** The travel a heading jump takes, in SECONDS: what Lenis measures duration in. */
const JUMP = 0.9;

/** Where the current heading changes: the line a third of the way down the viewport. */
const READ_LINE = 3;

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
 * What one viewport is, and where its top sits on the screen: the window's own, or the scrolling
 * box's when the caller named one.
 * @param {any} scroller
 * @returns {{ h: number, top: number }}
 */
function viewOf(scroller) {
  if (scroller === window) return { h: window.innerHeight, top: 0 };
  const box = /** @type {Element} */ (scroller);
  return { h: box.clientHeight, top: box.getBoundingClientRect().top };
}

/** @param {number} n */
function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }

/**
 * The layers a parallax box moves: the ones the call names, or the box's own children that carry
 * a `data-speed` attribute. A named selector is looked for inside the box first, so an app can
 * write `.far` and mean its own.
 * @param {HTMLElement} node
 * @param {Array<{ el: Element|string, speed: number, axis?: 'y'|'x' }>} [named]
 * @returns {Array<{ el: HTMLElement, speed: number, axis: 'y'|'x' }>}
 */
function layersOf(node, named) {
  if (named && named.length) {
    /** @type {Array<{ el: HTMLElement, speed: number, axis: 'y'|'x' }>} */
    const out = [];
    named.forEach(function (raw) {
      if (!raw) return;
      const found = /** @type {HTMLElement|null} */ (typeof raw.el === 'string'
        ? (node.querySelector(raw.el) || document.querySelector(raw.el))
        : raw.el || null);
      if (!found) {
        // Said out loud rather than swallowed: a layer with no element is a layer that never moves.
        console.warn('aimeat-atelier: parallax layer "' + String(raw.el) + '" is not on the page, skipped');
        return;
      }
      out.push({ el: found, speed: Number(raw.speed) || 0, axis: raw.axis === 'x' ? 'x' : 'y' });
    });
    return out;
  }
  return /** @type {HTMLElement[]} */ (Array.prototype.slice.call(node.children))
    .filter(function (kid) { return kid.hasAttribute('data-speed'); })
    .map(function (kid) {
      return {
        el: kid,
        speed: parseFloat(kid.getAttribute('data-speed') || '0') || 0,
        axis: /** @type {'y'|'x'} */ (kid.getAttribute('data-axis') === 'x' ? 'x' : 'y'),
      };
    });
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   parallax — layers at their own speeds
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Depth on scroll: each layer inside the box travels by its own share of the box's height as the
 * box crosses the screen. A NEGATIVE speed lags behind the page (the far distance), a positive
 * one leads it (the near foreground), and zero stands still. `clamp` is the furthest any layer
 * may travel in pixels, which is how a tall box keeps its art inside its own frame.
 *
 * Under reduced motion every layer stays at its rest position and no listener is bound at all.
 * @param {Element|string} target
 * `subject` is the element whose travel through the viewport is measured when it is not the box
 * itself: a box pinned inside a director's hold never moves while the hold scrolls, so the hold
 * wrapper is the subject and the layers keep drifting through the whole pinned stretch.
 * @param {{ layers?: Array<{ el: Element|string, speed: number, axis?: 'y'|'x' }>,
 *   scroller?: Element|Window, clamp?: number, subject?: Element|string }} [opts]
 * @returns {{ el: HTMLElement, progress: () => number, destroy: () => void }}
 */
export function parallax(target, opts) {
  const node = /** @type {HTMLElement} */ (resolve(target));
  const o = opts || {};
  const subject = o.subject ? /** @type {HTMLElement} */ (resolve(o.subject)) : node;
  const layers = layersOf(node, o.layers);
  const limit = o.clamp !== undefined ? Math.abs(Number(o.clamp)) : Infinity;
  node.classList.add('ak-parallax');
  layers.forEach(function (L) { L.el.classList.add('ak-parallax__layer'); });

  /** Put every layer back where it rests and take the kit's marks off again. */
  const undress = function () {
    layers.forEach(function (L) {
      L.el.classList.remove('ak-parallax__layer');
      L.el.style.removeProperty('--ak-plx-x');
      L.el.style.removeProperty('--ak-plx-y');
    });
    node.classList.remove('ak-parallax');
  };

  if (reducedMotion() || !layers.length) {
    // Still a real handle, and still reversible: the layers simply stand where they were built.
    return { el: node, progress() { return 0; }, destroy() { undress(); } };
  }

  const scroller = /** @type {any} */ (o.scroller || nearestScroller(node));
  let last = 0;
  const tick = function () {
    const r = node.getBoundingClientRect();
    const s = subject === node ? r : subject.getBoundingClientRect();
    const v = viewOf(scroller);
    last = clamp01((v.top + v.h - s.top) / Math.max(v.h + s.height, 1));
    layers.forEach(function (L) {
      const raw = (last - 0.5) * L.speed * r.height;
      const d = raw < -limit ? -limit : raw > limit ? limit : raw;
      L.el.style.setProperty(L.axis === 'x' ? '--ak-plx-x' : '--ak-plx-y', d.toFixed(2) + 'px');
    });
  };

  let rafId = 0;
  const onScroll = function () {
    if (rafId) return;
    rafId = requestAnimationFrame(function () { rafId = 0; tick(); });
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  tick();

  return {
    el: node,
    progress() { return last; },
    destroy() {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      undress();
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   readingRail — the contents of a long article, and how far through it the reader is
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** A heading's text as something that can be an id and survive being pasted into a link. */
function slugOf(text) {
  return String(text || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** The slug, or the next free one after it, so an id the page already uses is never stolen. */
function freeId(text) {
  const base = slugOf(text);
  if (!base) return uid('ak-heading');
  if (!document.getElementById(base)) return base;
  let n = 2;
  while (document.getElementById(base + '-' + n)) n += 1;
  return base + '-' + n;
}

/**
 * The table of contents for one long article: every heading as a link, the one the reader is in
 * lit as they travel, and a line saying how far through the whole piece they are. Down the side
 * on a wide screen, a strip across the top on a narrow one.
 *
 * Headings without an id are given one, and only those are taken away again in destroy(), so an
 * article that already names its own sections keeps its own anchors.
 * @param {{ target?: string|Element, article: Element|string, headings?: string,
 *   scroller?: Element|Window, onPick?: (id: string) => void }} spec
 * @returns {{ el: HTMLElement, set: (patch: { current?: string|number }) => void, destroy: () => void }}
 */
export function readingRail(spec) {
  const s = spec || /** @type {any} */ ({});
  const article = /** @type {HTMLElement} */ (resolve(s.article));
  const heads = /** @type {HTMLElement[]} */ (
    Array.prototype.slice.call(article.querySelectorAll(s.headings || 'h2')));
  /** @type {HTMLElement[]} */
  const named = [];
  const items = heads.map(function (h) {
    if (!h.id) { h.id = freeId(h.textContent); named.push(h); }
    return {
      id: h.id,
      head: h,
      text: (h.textContent || '').trim() || h.id,
      deep: String(h.tagName).toUpperCase() !== 'H2',
    };
  });

  const fill = el('span', { class: 'ak-reading__fill', 'aria-hidden': 'true' });
  const line = el('div', { class: 'ak-reading__line', 'aria-hidden': 'true' }, [fill]);
  const links = items.map(function (it) {
    return el('a', {
      class: 'ak-reading__link', href: '#' + it.id,
      on: {
        click: function (ev) {
          ev.preventDefault();
          jump(it);
        },
      },
    }, it.text);
  });
  const list = el('ol', { class: 'ak-reading__list' }, links.map(function (a, i) {
    return el('li', { class: 'ak-reading__item' + (items[i].deep ? ' ak-reading__item--deep' : '') }, [a]);
  }));
  const nav = el('nav', {
    class: 'ak-reading' + (s.target ? ' ak-reading--inset' : ''), 'aria-label': 'Contents',
  }, [line, list]);

  const parent = /** @type {HTMLElement} */ (s.target ? resolve(s.target) : document.body);
  // An inset rail is placed against its host, so the host is the positioning context: the class
  // carries that rule and comes off again if this rail was the one to add it.
  let marked = false;
  if (s.target && !parent.classList.contains('ak-reading-host')) {
    parent.classList.add('ak-reading-host');
    marked = true;
  }
  parent.appendChild(nav);

  let curIdx = -1;
  /** @param {number} i */
  function mark(i) {
    if (i === curIdx) return;
    curIdx = i;
    links.forEach(function (a, n) {
      if (n === i) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
      a.classList.toggle('is-current', n === i);
    });
  }

  /** Take the reader to one heading: on the page's own glide when a director named one. */
  function jump(it) {
    const glide = /** @type {any} */ (window).__akLenis;
    if (glide && typeof glide.scrollTo === 'function') {
      glide.scrollTo(it.head, { duration: JUMP });
    } else {
      it.head.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    mark(items.indexOf(it));
    if (s.onPick) s.onPick(it.id);
  }

  const scroller = /** @type {any} */ (s.scroller || nearestScroller(article));
  const tick = function () {
    const v = viewOf(scroller);
    const r = article.getBoundingClientRect();
    const through = clamp01((v.top - r.top) / Math.max(1, r.height - v.h));
    fill.style.setProperty('--ak-fill', (through * 100).toFixed(2) + '%');
    // The heading the reader is IN is the last one that has passed the line a third of the way
    // down; before the first one passes it, the first heading is still the one they are heading for.
    const edge = v.top + v.h / READ_LINE;
    let at = 0;
    items.forEach(function (it, i) {
      if (it.head.getBoundingClientRect().top <= edge) at = i;
    });
    mark(items.length ? at : -1);
  };

  let rafId = 0;
  const onScroll = function () {
    if (rafId) return;
    rafId = requestAnimationFrame(function () { rafId = 0; tick(); });
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  tick();

  return {
    el: nav,
    set(patch) {
      if (!patch || patch.current == null) return;
      const i = typeof patch.current === 'number'
        ? patch.current
        : items.findIndex(function (it) { return it.id === String(patch.current); });
      mark(i);
    },
    destroy() {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (nav.parentNode) nav.parentNode.removeChild(nav);
      if (marked) parent.classList.remove('ak-reading-host');
      // Only the ids this rail invented go away again; the article's own anchors stay.
      named.forEach(function (h) { h.removeAttribute('id'); });
    },
  };
}
