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
 *   only around a scene that asked to be pinned. A scene that asks for a sideways chapter is the
 *   one exception, and it is reversed the same way: its own children come back where they were.
 *
 *   SNAP SETTLES, IT DOES NOT STEER. With `snap` on, the story waits for the hand to let go (no
 *   scroll for a beat, and Lenis reporting no speed left) and then takes the reader the short way
 *   to the nearest scene start. A new scroll during that wait cancels it, a jump already in
 *   flight owns the scroll, a start the reader is already near is left alone, and a reader in the
 *   middle of a long held scene is left alone too.
 *
 *   A SIDEWAYS CHAPTER IS STILL VERTICAL SCROLL. `axis: 'x'` on a scene lays that scene's own
 *   children in a row a viewport wide each and pins the scene for as many viewport heights as it
 *   has panels; the scene's progress is what carries the row across. The panels keep their place
 *   in the document and in the tab ring, and focus landing on one off-screen takes the story to
 *   it rather than leaving the reader looking at the wrong panel.
 * @structure ensureLenis · pin · unpin · chapterise · unchapterise · playEnter · railOf ·
 *   director(spec) → handle · storyRail(spec) → { el, set, destroy }
 * @usage
 *   const story = AIMEAT.atelier.director({
 *     scenes: [
 *       { id: 'open', el: '#open', label: 'Opening', enter: 'rise' },
 *       { id: 'hold', el: '#hold', label: 'The claim', enter: 'wipe', hold: 1,
 *         onProgress(p, el) { el.querySelector('.bar').style.setProperty('--ak-fill', (p * 100) + '%'); } },
 *       { id: 'wide', el: '#wide', label: 'The three', axis: 'x' },
 *       { id: 'end',  el: '#end',  label: 'The close', enter: 'stagger' },
 *     ],
 *     snap: { delay: 120, tolerance: 0.1 },
 *     onScene(id) { mark(id); },
 *   });
 *   story.go('end');   story.next();   story.progress();   story.destroy();
 *   AIMEAT.atelier.storyRail({ target: host, scenes: [{ id: 'a', label: 'One' }], onPick(id) { jump(id); } });
 * @version-history
 *   v0.46.1 — 2026-09-02 — The scene classes are .ak-act*: .ak-scene belongs to the scene3d
 *     component (data.css), whose surface painted every story scene white on the night train.
 *   v0.46.0 — 2026-09-02 — SNAP AND THE SIDEWAYS CHAPTER: `snap` settles the reader on the
 *     nearest scene start once the hand lets go (cancelled by a new scroll, silent while a jump
 *     is in flight, silent anywhere inside a pinned scene's hold where the scroll IS that
 *     scene's progress, instant under reduced motion), and a scene with `axis: 'x'` turns its own
 *     children into a row of viewport-wide panels the scene's progress carries across. A
 *     page-level director also names its Lenis instance on `window.__akLenis` while it is alive,
 *     which is how readingRail (lenis-more.js) travels on the same glide
 *     (wish-atelier-story-director-show).
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

/** How long a scroll has to be over before the story calls it settled, in MILLISECONDS. */
const SNAP_DELAY = 120;

/** How near a scene start counts as arrived, as a share of one viewport. */
const SNAP_TOLERANCE = 0.1;

/** Lenis speed under which the scroll counts as stopped (px per frame). */
const SNAP_REST = 0.05;

/** How many times a settle may wait for the speed to fall before it gives up for good. */
const SNAP_TRIES = 3;

/**
 * Wrap a scene so it HOLDS the screen: the outer box is as tall as (1 + n) viewports and the
 * sticky inner keeps the scene on screen for the whole of that travel. The scene element itself
 * is not touched beyond being moved into the inner, so the author's selectors still find it.
 * @param {HTMLElement} node
 * @param {number} holds  how many extra viewport heights the scene stays put for
 * @returns {HTMLElement} the outer hold
 */
function pin(node, holds) {
  const outer = el('div', { class: 'ak-act__hold', vars: { '--ak-hold': String(1 + holds) } });
  const stick = el('div', { class: 'ak-act__stick' });
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
 * Turn a scene into a HORIZONTAL CHAPTER: the scene's own direct children become the panels of
 * one row, a viewport wide each, and the row is what travels sideways while the scene is pinned.
 * The panels are the author's elements with one class added, so they keep their ids, their order
 * in the document and their place in the tab ring; unchapterise() puts them back.
 * @param {HTMLElement} node
 * @returns {{ box: HTMLElement, track: HTMLElement, panels: HTMLElement[] }|null}
 *   null when the scene has no children to lay out, and then it is an ordinary scene.
 */
function chapterise(node) {
  const panels = /** @type {HTMLElement[]} */ (Array.prototype.slice.call(node.children));
  if (!panels.length) return null;
  const track = el('div', { class: 'ak-chapter__track' });
  const box = el('div', { class: 'ak-chapter' }, [track]);
  panels.forEach(function (p) {
    p.classList.add('ak-chapter__panel');
    track.appendChild(p);
  });
  node.appendChild(box);
  node.classList.add('ak-act--x');
  return { box, track, panels };
}

/**
 * Put a chapter's panels back as the scene's own children, in the order they were found.
 * @param {{ el: HTMLElement, chapter: { box: HTMLElement, track: HTMLElement, panels: HTMLElement[] }|null }} sc
 * @returns {void}
 */
function unchapterise(sc) {
  const ch = sc.chapter;
  if (!ch) return;
  ch.panels.forEach(function (p) {
    p.classList.remove('ak-chapter__panel');
    sc.el.appendChild(p);
  });
  if (ch.box.parentNode) ch.box.parentNode.removeChild(ch.box);
  sc.el.classList.remove('ak-act--x');
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

/** The clock the settle and the jump are measured on, wherever performance.now is missing. */
function now() {
  return typeof performance === 'object' && performance && typeof performance.now === 'function'
    ? performance.now() : Date.now();
}

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
 *     axis?: 'x',
 *     onProgress?: (p: number, el: HTMLElement) => void,
 *     onEnter?: (el: HTMLElement) => void,
 *     onLeave?: (el: HTMLElement) => void,
 *   }>,
 *   rail?: boolean, keys?: boolean, lerp?: number, duration?: number,
 *   snap?: boolean|{ delay?: number, tolerance?: number },
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
   *   label: string, spec: any, entered: boolean, inside: boolean,
   *   chapter: { box: HTMLElement, track: HTMLElement, panels: HTMLElement[] }|null }>} */
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
    node.classList.add('ak-act');
    node.setAttribute('data-ak-act', String(raw.id));
    const chapter = raw.axis === 'x' ? chapterise(node) : null;
    // A sideways chapter buys its travel in viewport heights: one per panel, and more if the
    // author asked for a longer hold on top.
    const holds = Math.max(
      Math.max(0, Number(raw.hold) || 0),
      chapter ? chapter.panels.length : 0,
    );
    scenes.push({
      id: String(raw.id), el: node, outer: holds > 0 ? pin(node, holds) : null, hold: holds,
      label: String(raw.label || raw.id), spec: raw, entered: false, inside: false, chapter,
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
      // The page's own glide is named where anything else on the page can find it: readingRail
      // and any app that wants to travel on the same instance rather than start a second one.
      // A story inside a well drives that well and nothing else, so it never claims the name.
      if (isPage) /** @type {any} */ (window).__akLenis = lenis;
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
      const p = progressOf(sc, r, vTop, vH);
      // The sideways travel is the scene's own progress, and the only number JS gives the
      // stylesheet: how far the row has moved, in panels.
      if (sc.chapter) {
        const across = Math.max(0, sc.chapter.panels.length - 1);
        sc.chapter.track.style.setProperty('--ak-chapter-x', (-across * 100 * p) + '%');
      }
      if (sc.spec.onProgress) sc.spec.onProgress(p, sc.el);
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
    settleTries = 0;
    armSnap();
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
    // A jump owns the scroll while it travels, so the settle below stays out of its way.
    jumpUntil = now() + (o.duration || JUMP) * 1000;
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

  /* ── The sideways chapter's keyboard door ──────────────────────────────────────────────── */

  /**
   * Take the reader to one panel of a sideways chapter. The travel is VERTICAL: a chapter's row
   * is carried by the scene's own progress, so reaching panel n means standing n panels deep
   * into the scene's hold.
   * @param {any} sc
   * @param {number} index
   */
  function goPanel(sc, index) {
    const outer = sc.outer;
    const ch = sc.chapter;
    if (!outer || !ch) return;
    const vH = isPage ? window.innerHeight : scroller.clientHeight;
    const across = Math.max(1, ch.panels.length - 1);
    const travel = Math.max(0, outer.offsetHeight - vH);
    const want = (Math.min(Math.max(index, 0), across) / across) * travel;
    jumpUntil = now() + JUMP * 1000;
    if (lenis) { lenis.scrollTo(outer, { offset: want, duration: JUMP }); return; }
    const vTop = isPage ? 0 : scroller.getBoundingClientRect().top;
    const how = /** @type {ScrollToOptions} */ ({
      top: outer.getBoundingClientRect().top - vTop + want,
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
    if (isPage) window.scrollBy(how); else scroller.scrollBy(how);
  }

  /** @type {Array<{ box: HTMLElement, fn: (ev: Event) => void }>} */
  const chapterDoors = [];
  scenes.forEach(function (sc) {
    if (!sc.chapter || !sc.outer) return;
    const ch = sc.chapter;
    const fn = function (ev) {
      const t = /** @type {Element|null} */ (/** @type {any} */ (ev).target);
      if (!t) return;
      let i = -1;
      ch.panels.forEach(function (p, n) { if (p === t || p.contains(t)) i = n; });
      if (i < 0) return;
      // Tabbing to a panel that is off to the side makes the browser scroll the row under the
      // reader. The row belongs to the scene's progress, so it goes back to zero and the story
      // takes the vertical travel that actually brings the panel into view.
      ch.box.scrollLeft = 0;
      goPanel(sc, i);
    };
    ch.box.addEventListener('focusin', fn);
    chapterDoors.push({ box: ch.box, fn });
  });

  /* ── Snap: where the reader lands when the hand lets go ────────────────────────────────── */

  const snapCfg = s.snap && typeof s.snap === 'object' ? s.snap : {};
  const snapOn = !!s.snap;
  const snapDelay = snapCfg.delay !== undefined ? Number(snapCfg.delay) : SNAP_DELAY;
  const snapTol = snapCfg.tolerance !== undefined ? clamp01(Number(snapCfg.tolerance)) : SNAP_TOLERANCE;
  /** @type {any} */
  let settleTimer = 0;
  let settleTries = 0;
  /** The clock reading until which a jump this director started owns the scroll. */
  let jumpUntil = 0;

  /** Start the wait again. Every scroll calls this, so the hand always cancels the last one. */
  function armSnap() {
    if (!snapOn || !scenes.length) return;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, snapDelay);
  }

  /** The scroll has been over for a beat: take the reader the short way to a scene start. */
  function settle() {
    settleTimer = 0;
    if (dead || !snapOn || !scenes.length) return;
    if (now() < jumpUntil) return;
    if (lenis && Math.abs(Number(lenis.velocity) || 0) > SNAP_REST) {
      // Still carrying speed. Wait a few more beats and then let it go: the scrolling that is
      // still happening arms this again on its own, so nothing here can sit and tick.
      settleTries += 1;
      if (settleTries <= SNAP_TRIES) armSnap();
      return;
    }
    const vH = isPage ? window.innerHeight : scroller.clientHeight;
    const vTop = isPage ? 0 : scroller.getBoundingClientRect().top;
    // A HELD SCENE IS THE READER'S, not the snap's. While the sticky inner is pinned — the hold's
    // top is above the viewport and its bottom is still below it — the scroll IS that scene's
    // progress: it is what a bar fills on and what carries a sideways chapter across. Snapping
    // there would take the reader back to progress 0 every time they let go, so the story would
    // never get past the first frame of its own hold. Snap belongs BETWEEN scenes.
    let held = false;
    scenes.forEach(function (sc) {
      if (held || !sc.outer) return;
      const r = sc.outer.getBoundingClientRect();
      const top = r.top - vTop;
      const room = r.bottom - vTop - vH;
      if (top < -1 && room > 1) held = true;
    });
    if (held) return;
    let near = -1;
    let gap = Infinity;
    scenes.forEach(function (sc, i) {
      const d = (sc.outer || sc.el).getBoundingClientRect().top - vTop;
      if (Math.abs(d) < Math.abs(gap)) { gap = d; near = i; }
    });
    if (near < 0) return;
    const room = Math.abs(gap);
    // Already at a start: leave it. A whole viewport or more away from one: the reader is in the
    // middle of something long and reading it, so leave that alone too.
    if (room <= snapTol * vH || room > vH) return;
    go(scenes[near].id);
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
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0; }
      if (io) { io.disconnect(); io = null; }
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (wantKeys) window.removeEventListener('keydown', onKey);
      chapterDoors.forEach(function (d) { d.box.removeEventListener('focusin', d.fn); });
      chapterDoors.length = 0;
      if (lenis) {
        const w = /** @type {any} */ (window);
        if (w.__akLenis === lenis) w.__akLenis = null;
        lenis.destroy();
        lenis = null;
      }
      if (rail && rail.nav.parentNode) rail.nav.parentNode.removeChild(rail.nav);
      if (host && hostMarked) host.classList.remove('ak-story');
      // The author's DOM goes back the way it was found.
      scenes.forEach(function (sc) {
        unchapterise(sc);
        unpin(sc);
        sc.el.classList.remove('ak-act');
        sc.el.removeAttribute('data-ak-act');
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
