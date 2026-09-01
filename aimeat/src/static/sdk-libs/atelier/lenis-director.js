/**
 * @file atelier/lenis-director.js
 * @description THE SCROLL IS THE NARRATOR. An app hands over a list of scenes and the motion each
 *   one arrives on, and the page tells that story as the reader travels down it, the way
 *   lenis.darkroom.engineering does, in this kit's own hand:
 *
 *     director(spec)  the whole story: it prepares the scenes, pins the ones that should hold
 *                     the screen, plays each entrance once when the scene arrives, hands every
 *                     scene its own progress on every scroll frame, keeps a dot rail marked with
 *                     where the reader is, and answers go/next/prev from a rail click, a key or
 *                     the app itself.
 *     storyRail(spec) the rail on its own, for a page that scrolls through something the
 *                     director does not own.
 *
 *   LENIS IS THE SMOOTHNESS AND NEVER THE CORRECTNESS, the rule lenis-parts.js already carries.
 *   The pack is lazy-loaded from this node behind one shared promise; until it lands, under
 *   reduced motion where it is never asked for, and on a browser without Web Animations, every
 *   scene still enters, every progress still arrives and every jump still lands — through the
 *   browser's own scrolling and end states set at once. One instance per director, destroyed in
 *   destroy(), and the author's DOM is put back the way it was found.
 *
 *   THE AUTHOR'S SELECTORS SURVIVE. `el` stays the scene element with the author's own classes,
 *   ids and children; the only DOM the director adds is the outer hold and its sticky inner, and
 *   only around a scene that asked to be pinned. Nothing inside a scene is moved.
 * @structure ensureLenis · pin · unpin · playEnter · railOf · director(spec) → handle ·
 *   storyRail(spec) → { el, set, destroy }
 * @usage
 *   const story = AIMEAT.atelier.director({
 *     scenes: [
 *       { id: 'open', el: '#open', label: 'Opening', enter: 'rise' },
 *       { id: 'hold', el: '#hold', label: 'The claim', enter: 'wipe', hold: 1,
 *         onProgress(p, el) { el.querySelector('.bar').style.setProperty('--ak-fill', (p * 100) + '%'); } },
 *       { id: 'end',  el: '#end',  label: 'The close', enter: 'stagger' },
 *     ],
 *     onScene(id) { mark(id); },
 *   });
 *   story.go('end');   story.next();   story.progress();   story.destroy();
 *   AIMEAT.atelier.storyRail({ target: host, scenes: [{ id: 'a', label: 'One' }], onPick(id) { jump(id); } });
 * @version-history
 *   v0.45.0 — 2026-09-02 — Initial (wish-atelier-motion-libraries-and-parts, the Lenis director).
 */
import { el, resolve, reducedMotion } from './dom.js';
import { NODE_URL } from '../_core/config.js';
import { stagger } from './motion.js';

/** One shared load of Lenis (script + stylesheet), whoever asks first. */
let lenisPromise = null;
function ensureLenis() {
  const w = /** @type {any} */ (window);
  if (w.Lenis) return Promise.resolve(w.Lenis);
  if (lenisPromise) return lenisPromise;
  lenisPromise = new Promise(function (ok, fail) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = NODE_URL + '/lib/lenis@1.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = NODE_URL + '/lib/lenis@1.min.js';
    s.onload = function () { ok(w.Lenis); };
    s.onerror = function () { lenisPromise = null; fail(new Error('lenis failed to load')); };
    document.head.appendChild(s);
  });
  return lenisPromise;
}

/** The travel a jump takes, in SECONDS: what Lenis measures duration in. */
const JUMP = 0.9;

/** The glide, when the call names neither lerp nor duration. Lenis's own default is 0.1. */
const LERP = 0.09;

/**
 * Wrap a scene so it HOLDS the screen: the outer box is as tall as (1 + n) viewports and the
 * sticky inner keeps the scene on screen for the whole of that travel. The scene element itself
 * is not touched beyond being moved into the inner, so the author's selectors still find it.
 * @param {HTMLElement} node
 * @param {number} holds  how many extra viewport heights the scene stays put for
 * @returns {HTMLElement} the outer hold
 */
function pin(node, holds) {
  const outer = el('div', { class: 'ak-scene__hold', vars: { '--ak-hold': String(1 + holds) } });
  const stick = el('div', { class: 'ak-scene__stick' });
  const parent = node.parentNode;
  if (parent) parent.insertBefore(outer, node);
  stick.appendChild(node);
  outer.appendChild(stick);
  return outer;
}

/**
 * Put a pinned scene back where it stood before the director wrapped it.
 * @param {{ el: HTMLElement, outer: HTMLElement|null }} sc
 * @returns {void}
 */
function unpin(sc) {
  const outer = sc.outer;
  if (!outer || !outer.parentNode) return;
  outer.parentNode.insertBefore(sc.el, outer);
  outer.parentNode.removeChild(outer);
}

/**
 * One scene's entrance, played once. Distance, pace and curve are the look's own tokens, so a
 * skin changes the feel with no JavaScript. Under reduced motion, and on a browser without Web
 * Animations, nothing travels and the scene simply stands in its end state.
 * @param {HTMLElement} node
 * @param {'rise'|'fade'|'wipe'|'scale'|'stagger'|((el: HTMLElement) => void)} [kind]
 * @returns {void}
 */
function playEnter(node, kind) {
  if (typeof kind === 'function') { kind(node); return; }
  if (kind === 'stagger') { stagger(node.children, { from: 'up' }); return; }
  if (reducedMotion() || typeof node.animate !== 'function') return;
  const cs = getComputedStyle(node);
  // A scene is a screenful, so it arrives from further away than a card does.
  const dist = (parseFloat(cs.getPropertyValue('--ak-enter-distance')) || 14) * 2.5;
  const span = (parseFloat(cs.getPropertyValue('--ak-motion')) || 200) * 3;
  const ease = (cs.getPropertyValue('--ak-ease') || '').trim() || 'cubic-bezier(0.2, 0.7, 0.3, 1)';
  const frames = kind === 'fade'
    ? [{ opacity: 0 }, { opacity: 1 }]
    : kind === 'wipe'
      ? [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }]
      : kind === 'scale'
        ? [{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'scale(1)' }]
        : [{ opacity: 0, transform: 'translateY(' + dist + 'px)' }, { opacity: 1, transform: 'translateY(0)' }];
  node.animate(frames, { duration: span, easing: ease, fill: 'backwards' });
}

/**
 * The dot rail: one button per scene, its label arriving on hover or focus, the current one lit.
 * @param {Array<{ id: string, label: string }>} items
 * @param {(id: string, index: number) => void} onPick
 * @param {boolean} [inset]  inside a scrolling well rather than fixed to the window
 * @returns {{ nav: HTMLElement, dots: HTMLElement[], mark: (index: number) => void }}
 */
function railOf(items, onPick, inset) {
  const dots = items.map(function (it, i) {
    return el('button', {
      type: 'button', class: 'ak-rail__dot', 'aria-label': it.label,
      on: { click: function () { onPick(it.id, i); } },
    }, [
      el('span', { class: 'ak-rail__label', 'aria-hidden': 'true' }, it.label),
      el('span', { class: 'ak-rail__mark', 'aria-hidden': 'true' }),
    ]);
  });
  const nav = el('nav', {
    class: 'ak-rail' + (inset ? ' ak-rail--inset' : ''), 'aria-label': 'Story',
  }, dots);
  return {
    nav,
    dots,
    mark(index) {
      dots.forEach(function (d, n) {
        if (n === index) d.setAttribute('aria-current', 'true');
        else d.removeAttribute('aria-current');
        d.classList.toggle('is-current', n === index);
      });
    },
  };
}

/** Is the reader typing? Then the arrow keys belong to them and not to the story. */
function editing() {
  const a = /** @type {any} */ (document.activeElement);
  if (!a) return false;
  const tag = String(a.tagName || '');
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable === true;
}

/** @param {number} n */
function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   director — the scenes, the motions, the rail and the keys
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The story on scroll.
 * @param {{
 *   scroller?: Element,
 *   scenes: Array<{
 *     id: string, el: Element|string, label?: string,
 *     enter?: 'rise'|'fade'|'wipe'|'scale'|'stagger'|((el: HTMLElement) => void),
 *     hold?: number,
 *     onProgress?: (p: number, el: HTMLElement) => void,
 *     onEnter?: (el: HTMLElement) => void,
 *     onLeave?: (el: HTMLElement) => void,
 *   }>,
 *   rail?: boolean, keys?: boolean, lerp?: number, duration?: number,
 *   onScene?: (id: string) => void,
 * }} spec
 * @returns {{ el: HTMLElement|null, lenis: any, go: (id: string, opts?: { offset?: number, duration?: number }) => void,
 *   next: () => void, prev: () => void, current: () => string|null, progress: () => number, destroy: () => void }}
 */
export function director(spec) {
  const s = spec || /** @type {any} */ ({});
  const scroller = /** @type {any} */ (s.scroller || window);
  const isPage = scroller === window;

  /** @type {Array<{ id: string, el: HTMLElement, outer: HTMLElement|null, hold: number,
   *   label: string, spec: any, entered: boolean, inside: boolean }>} */
  const scenes = [];
  (s.scenes || []).forEach(function (raw) {
    if (!raw) return;
    const node = /** @type {HTMLElement|null} */ (
      typeof raw.el === 'string' ? document.querySelector(raw.el) : raw.el || null);
    if (!node) {
      // Said out loud rather than swallowed: a story with a missing scene is a story with a hole.
      console.warn('aimeat-atelier: story scene "' + raw.id + '" has no element on the page, skipped');
      return;
    }
    node.classList.add('ak-scene');
    node.setAttribute('data-ak-scene', String(raw.id));
    const holds = Math.max(0, Number(raw.hold) || 0);
    scenes.push({
      id: String(raw.id), el: node, outer: holds > 0 ? pin(node, holds) : null, hold: holds,
      label: String(raw.label || raw.id), spec: raw, entered: false, inside: false,
    });
  });

  /** A pinned scene's boxes are measured in viewports, and a well's viewport is not the window's. */
  function sizeHolds() {
    if (isPage) return;
    const h = scroller.clientHeight;
    scenes.forEach(function (sc) {
      if (sc.outer) sc.outer.style.setProperty('--ak-story-vh', h + 'px');
    });
  }
  sizeHolds();

  /** @type {any} */
  let lenis = null;
  let dead = false;
  if (!reducedMotion()) {
    ensureLenis().then(function (Lenis) {
      if (dead) return;
      const opts = /** @type {any} */ ({ autoRaf: true });
      if (s.duration !== undefined) opts.duration = s.duration;
      else opts.lerp = s.lerp !== undefined ? s.lerp : LERP;
      if (!isPage) {
        opts.wrapper = scroller;
        opts.content = scroller.firstElementChild || scroller;
      }
      lenis = new Lenis(opts);
    }, function (err) {
      // The story still runs: the browser's own scrolling carries it, it just does not glide.
      console.warn('aimeat-atelier: lenis did not load, the browser scrolls this story', err);
    });
  }

  const rail = s.rail === false || !scenes.length ? null : railOf(scenes, function (id) { go(id); }, !isPage);
  let host = null;
  let hostMarked = false;
  if (rail) {
    if (isPage) {
      document.body.appendChild(rail.nav);
    } else {
      host = scroller.parentElement || document.body;
      if (!host.classList.contains('ak-story')) { host.classList.add('ak-story'); hostMarked = true; }
      host.appendChild(rail.nav);
    }
  }

  let curIdx = -1;
  let storyP = 0;

  /** Where one scene stands: through its hold when pinned, through the viewport when not. */
  function progressOf(sc, r, vTop, vH) {
    if (sc.hold > 0) return clamp01((vTop - r.top) / Math.max(1, r.height - vH));
    return clamp01((vTop + vH - r.top) / Math.max(1, vH + r.height));
  }

  function tick() {
    if (!scenes.length) return;
    const vH = isPage ? window.innerHeight : scroller.clientHeight;
    const vTop = isPage ? 0 : scroller.getBoundingClientRect().top;
    const mid = vTop + vH / 2;
    let best = -1;
    let bestGap = Infinity;
    /** @type {DOMRect|null} */
    let first = null;
    /** @type {DOMRect|null} */
    let last = null;
    scenes.forEach(function (sc, i) {
      const r = (sc.outer || sc.el).getBoundingClientRect();
      if (i === 0) first = r;
      last = r;
      if (sc.spec.onProgress) sc.spec.onProgress(progressOf(sc, r, vTop, vH), sc.el);
      // The current scene is the one crossing the middle of the viewport; when none does (a gap
      // between two scenes), the nearest edge wins, so the rail is never blank.
      const gap = r.top <= mid && r.bottom >= mid ? 0
        : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
      if (gap < bestGap) { bestGap = gap; best = i; }
    });
    if (first && last) {
      const span = last.bottom - first.top - vH;
      storyP = span > 0 ? clamp01((vTop - first.top) / span) : 1;
    }
    if (best !== curIdx) {
      curIdx = best;
      if (rail) rail.mark(best);
      if (s.onScene && scenes[best]) s.onScene(scenes[best].id);
    }
  }

  let rafId = 0;
  const onScroll = function () {
    if (rafId) return;
    rafId = requestAnimationFrame(function () { rafId = 0; tick(); });
  };
  const onResize = function () { sizeHolds(); onScroll(); };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  /** The entrance plays once, when the scene has a quarter of itself on screen. */
  let io = null;
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        const sc = scenes.find(function (c) { return c.el === entry.target; });
        if (!sc) return;
        if (entry.isIntersecting) {
          if (!sc.entered) { sc.entered = true; playEnter(sc.el, sc.spec.enter || 'rise'); }
          if (!sc.inside) { sc.inside = true; if (sc.spec.onEnter) sc.spec.onEnter(sc.el); }
        } else if (sc.inside) {
          sc.inside = false;
          if (sc.spec.onLeave) sc.spec.onLeave(sc.el);
        }
      });
    }, { root: isPage ? null : scroller, threshold: 0.25 });
    scenes.forEach(function (sc) { io.observe(sc.el); });
  } else {
    // No observer: every scene is already in its end state, which is the whole promise.
    scenes.forEach(function (sc) {
      sc.entered = true;
      if (sc.spec.onEnter) sc.spec.onEnter(sc.el);
    });
  }

  /**
   * Take the reader to a scene. Through Lenis once the pack has landed; before that, and under
   * reduced motion where it is instant, through the browser's own scrolling.
   * @param {string} id
   * @param {{ offset?: number, duration?: number }} [opts]
   */
  function go(id, opts) {
    const i = scenes.findIndex(function (sc) { return sc.id === id; });
    if (i < 0) return;
    const target = scenes[i].outer || scenes[i].el;
    const o = opts || {};
    if (lenis) {
      lenis.scrollTo(target, { offset: o.offset || 0, duration: o.duration || JUMP });
    } else {
      target.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    curIdx = i;
    if (rail) rail.mark(i);
    if (s.onScene) s.onScene(scenes[i].id);
  }

  /** @param {number} by  how many scenes forward (or back, when negative) */
  function step(by) {
    if (!scenes.length) return;
    const from = curIdx < 0 ? 0 : curIdx;
    const to = Math.max(0, Math.min(scenes.length - 1, from + by));
    if (to !== from || curIdx < 0) go(scenes[to].id);
  }

  const onKey = function (ev) {
    if (editing() || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key;
    if (k === 'ArrowDown' || k === 'PageDown') { ev.preventDefault(); step(1); return; }
    if (k === 'ArrowUp' || k === 'PageUp') { ev.preventDefault(); step(-1); return; }
    if (k === 'Home' && scenes.length) { ev.preventDefault(); go(scenes[0].id); return; }
    if (k === 'End' && scenes.length) { ev.preventDefault(); go(scenes[scenes.length - 1].id); }
  };
  const wantKeys = s.keys !== false;
  if (wantKeys) window.addEventListener('keydown', onKey);

  tick();

  return {
    el: rail ? rail.nav : null,
    get lenis() { return lenis; },
    go,
    next() { step(1); },
    prev() { step(-1); },
    current() { return curIdx >= 0 && scenes[curIdx] ? scenes[curIdx].id : null; },
    progress() { return storyP; },
    destroy() {
      dead = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (io) { io.disconnect(); io = null; }
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (wantKeys) window.removeEventListener('keydown', onKey);
      if (lenis) { lenis.destroy(); lenis = null; }
      if (rail && rail.nav.parentNode) rail.nav.parentNode.removeChild(rail.nav);
      if (host && hostMarked) host.classList.remove('ak-story');
      // The author's DOM goes back the way it was found.
      scenes.forEach(function (sc) {
        unpin(sc);
        sc.el.classList.remove('ak-scene');
        sc.el.removeAttribute('data-ak-scene');
      });
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   storyRail — the rail on its own
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The dot rail without a director behind it: for a page that scrolls through something the
 * director does not own (a virtualised list, a canvas, a video timeline). The app says which
 * scene is current; the rail says where the reader wants to go.
 * @param {{ scenes: Array<{ id: string, label?: string }>, target?: string|Element,
 *   onPick?: (id: string) => void }} spec
 * @returns {{ el: HTMLElement, set: (patch: { current?: string|number }) => void, destroy: () => void }}
 */
export function storyRail(spec) {
  const s = spec || /** @type {any} */ ({});
  const items = (s.scenes || []).map(function (sc) {
    return { id: String(sc.id), label: String(sc.label || sc.id) };
  });
  const built = railOf(items, function (id) { if (s.onPick) s.onPick(id); }, !!s.target);
  const parent = s.target ? resolve(s.target) : document.body;
  // An inset rail is positioned against its host, so the host is the positioning context: the
  // class carries that rule, and it is taken off again if the director put it there.
  let marked = false;
  if (s.target && !parent.classList.contains('ak-story')) { parent.classList.add('ak-story'); marked = true; }
  parent.appendChild(built.nav);
  return {
    el: built.nav,
    set(patch) {
      if (!patch || patch.current == null) return;
      const i = typeof patch.current === 'number'
        ? patch.current
        : items.findIndex(function (it) { return it.id === String(patch.current); });
      built.mark(i);
    },
    destroy() {
      if (built.nav.parentNode) built.nav.parentNode.removeChild(built.nav);
      if (marked) parent.classList.remove('ak-story');
    },
  };
}
