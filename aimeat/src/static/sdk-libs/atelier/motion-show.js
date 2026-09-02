/**
 * @file atelier/motion-show.js
 * @description The three Motion-library pieces that are a SHOW before they are a widget: the
 *   layout that rearranges itself in front of you, the stack of cards you throw away, and the
 *   small reactions every control in the kit answers a hand with.
 *
 *     layoutMove  a plain DOM container whose children GLIDE from where they were to where the
 *                 app just put them: filter a grid, sort it, add a tile, remove one, and every
 *                 tile travels instead of teleporting
 *     swipeStack  a pile of cards, the top one under the hand on both axes, thrown off one side
 *                 or the other past a threshold or on a flick, with two buttons and the arrow
 *                 keys for the same two answers and `undo()` to bring the last one back
 *     micro       the hover and the press for kit controls in one call: a lift, a tilt or a
 *                 glow under the pointer, a squash or a dip under the finger, over one element
 *                 or every button and card under a root
 *
 *   THE LIBRARY IS THE POLISH, NEVER THE MECHANISM. Motion 13 is served by this node
 *   (/lib/motion@13.min.js, MIT) and fetched once, lazily, exactly as motion-parts.js fetches it.
 *   Until it lands, the kit's own primitives carry every travel here (`spring`, `flipFrom`,
 *   `drag` from motion.js and flow-parts.js) and the stylesheet carries the rest, so a layout
 *   still rearranges, a card still leaves and a button still answers with no vendored script on
 *   the page at all. Whenever the viewer asks for less motion, each piece lands its end state
 *   with no travel and every control still does what it says.
 *
 *   MOTION IS FINITE. Every travel is under the hand (a drag, a press, a hover) or on a change
 *   (an update, a card leaving, a card coming back). Nothing loops and nothing idles, so a
 *   resting layout, a resting stack and a resting button repaint zero times.
 * @structure ensureMotion · travel · springFrom · whileMoving · paceOf · safeImage · layerOf ·
 *   washOf · icon · layoutMove(container, opts) · swipeStack(spec) · micro(target, opts)
 * @usage
 *   const layout = AIMEAT.atelier.layoutMove(grid, { keyed: 'data-id' });
 *   layout.update(function () { grid.append(...tiles.filter(odd)); });
 *
 *   AIMEAT.atelier.swipeStack({ target: host, data: { items },
 *     onSwipe(item, direction) { record(item, direction); }, onEmpty() { done(); } });
 *
 *   AIMEAT.atelier.micro(page, { selector: '.ak-btn, .ak-card', hover: 'lift', press: 'squash' });
 * @version-history
 *   v0.46.0 — 2026-09-02 — Initial: the Motion show module (layoutMove, swipeStack, micro).
 */
import { el, clear, resolve, reducedMotion } from './dom.js';
import { svg } from './chart-core.js';
import { emptyState } from './state.js';
import { t } from './i18n.js';
import { spring, drag } from './motion.js';
import { flipFrom } from './flow-parts.js';
import { NODE_URL } from '../_core/config.js';

/** The vendored pack, once it has landed. Not on lib.dom's Window, so it is read through a cast. */
function loaded() {
  return /** @type {any} */ (window).Motion;
}

/** One shared load of Motion, whoever asks first. A failure is not an error: the part carries on. */
let motionPromise = null;
function ensureMotion() {
  if (loaded() && loaded().animate) return Promise.resolve(loaded());
  if (motionPromise) return motionPromise;
  motionPromise = new Promise(function (ok, fail) {
    const s = document.createElement('script');
    s.src = NODE_URL + '/lib/motion@13.min.js';
    s.onload = function () { ok(loaded()); };
    s.onerror = function () { motionPromise = null; fail(new Error('motion failed to load')); };
    document.head.appendChild(s);
  });
  return motionPromise;
}

/**
 * Motion, if it has landed AND the viewer wants travel; null otherwise. Every caller treats null
 * as "arrive there now", which is why no piece here depends on the library for correctness.
 * @returns {any}
 */
function travel() {
  if (reducedMotion()) return null;
  const M = loaded();
  return M && typeof M.animate === 'function' ? M : null;
}

/** The house spring, in the two shapes the two engines want. */
const FEEL = { stiffness: 260, damping: 26 };
/** A thrown card is heavier and lands further away, so it wants a looser hand than a glide. */
const TOSS = { stiffness: 170, damping: 22 };
/** The spring that pulls a card the hand let go of back into the pile. */
const BACK = { stiffness: 320, damping: 28 };

/** How many cards of the pile stand in the DOM at once: the top one and the two peeking behind. */
const DEPTH = 3;
/** Degrees of tilt per pixel the top card is pulled sideways, and the spin a thrown card takes. */
const TILT = 0.06;
const SPIN = 18;
/** How far down a thrown card drifts as it leaves, so the throw reads as a throw. */
const LOB = 60;
/** Past this speed a release counts as a throw however short the pull was. */
const FLICK = 480;

/** The tones a card may carry, on the same three the rest of the kit uses. */
const TONES = ['ok', 'warn', 'err'];

/** Rows out of a record or a bare array, as everywhere else in the kit. */
function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

/**
 * The image URL a part may use, or null. As in the card grid, data: URIs are refused — an inline
 * megabyte in a layout record is a stored page nobody can cache, and storage already holds files.
 * @param {string|undefined} url
 * @returns {string|null}
 */
function safeImage(url) {
  if (!url) return null;
  const v = String(url);
  if (/^data:/i.test(v)) {
    console.warn('aimeat-atelier: card image data: URIs are refused — upload the image to storage and pass its URL.');
    return null;
  }
  return v;
}

/** The stylesheet-painted image layer for a card, or null (the tinted wash shows instead). */
function layerOf(url) {
  const v = safeImage(url);
  return v ? 'url("' + v.replace(/"/g, '%22') + '")' : null;
}

/** A stable 1..3 from an id, so the same item keeps the same wash forever. */
function washOf(id) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 3) + 1;
}

/**
 * One icon, drawn on currentColor. The kit's controls carry shapes, never glyphs, so a chevron
 * follows the look's ink in every palette and mode.
 * @param {'left'|'right'} kind
 * @returns {SVGElement}
 */
function icon(kind) {
  const node = svg('svg', {
    class: 'ak-icon', viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  node.appendChild(svg('path', { d: kind === 'left' ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19' }));
  return node;
}

/**
 * Seed a start state on the kit's spring and travel out of it — flipFrom's move, for scale and
 * opacity rather than x and y. A cancelled spring reports no progress, so the next call reads the
 * seeded state whole and starts there, and both happen in one block so no frame is painted
 * between them.
 * @param {Element} node
 * @param {Record<string, number>} from
 * @param {Record<string, number>} to
 * @param {{ stiffness?: number, damping?: number }} feel
 * @returns {{ finished: Promise<void> }}
 */
function springFrom(node, from, to, feel) {
  spring(node, from, feel).cancel();
  return spring(node, to, feel);
}

/**
 * Hold `is-moving` on an element for exactly as long as one travel lasts, and hand the travel
 * back. This is not decoration: a kit card already carries `transition: transform` (a hover lift
 * is a real requirement), and a script writing that same transform frame by frame would be
 * smoothed by it and arrive a whole `--ak-motion` late. Whichever engine is driving, the
 * stylesheet stands down while it does, and takes the element back the moment it finishes.
 * @param {Element} node
 * @param {() => any} run
 * @returns {any} whatever `run` returned
 */
function whileMoving(node, run) {
  node.classList.add('is-moving');
  const free = function () { node.classList.remove('is-moving'); };
  const anim = run();
  if (anim && anim.finished && typeof anim.finished.then === 'function') anim.finished.then(free, free);
  else free();
  return anim;
}

/** The look's own pace and curve, as Motion wants them (seconds, and a four-number bezier). */
function paceOf(node) {
  const cs = getComputedStyle(node);
  const ms = parseFloat(cs.getPropertyValue('--ak-motion')) || 200;
  const raw = (cs.getPropertyValue('--ak-ease') || '').trim();
  const nums = raw.match(/-?\d*\.?\d+/g);
  const ease = nums && nums.length >= 4 ? nums.slice(0, 4).map(Number) : [0.2, 0.7, 0.3, 1];
  return { duration: ms / 1000, ease: ease };
}

/**
 * THE LAYOUT THAT MOVES. The Framer "layout" animation for a plain DOM container, with no
 * framework underneath it and no bookkeeping asked of the app.
 *
 * `update(run)` measures every child by its identity, hands control to `run` — where the app
 * filters, sorts, adds or removes children however it already does — measures again, and every
 * child that ended up somewhere else GLIDES there from where it was standing. A child that
 * appeared scales in. A child the app removed inside `run` is kept for one fade by cloning it
 * where it stood, so a removal reads as a departure rather than a gap opening.
 *
 * Identity comes from the `keyed` attribute (`data-id` by default). A child with no such
 * attribute is identified by the element itself, which is enough for a container that MOVES its
 * children; a container that REBUILDS them needs the attribute, or every child reads as new.
 *
 * Under reduced motion `update` just runs `run`, and the layout is correct with no travel at all.
 * @param {Element|string} container
 * @param {{ keyed?: string, stiffness?: number, damping?: number, enter?: boolean, exit?: boolean }} [opts]
 * @returns {{ el: HTMLElement, update: (run: () => void) => void, destroy: () => void }}
 */
export function layoutMove(container, opts) {
  const node = /** @type {HTMLElement} */ (resolve(container));
  const o = opts || {};
  const keyed = o.keyed || 'data-id';
  const feel = { stiffness: o.stiffness || FEEL.stiffness, damping: o.damping || FEEL.damping };
  const wantEnter = o.enter !== false;
  const wantExit = o.exit !== false;
  /** @type {HTMLElement[]} */
  let ghosts = [];
  let dead = false;
  let running = false;

  node.classList.add('ak-layout');
  ensureMotion().then(function () { /* the polish arrived; nothing to redraw */ }, function () {
    if (!dead) node.classList.add('ak-layout--floor');   // the kit's own spring is carrying it
  });

  /** The container's real children — a ghost mid-fade is scenery, never a tracked child. */
  function kids() {
    return /** @type {HTMLElement[]} */ (Array.prototype.slice.call(node.children))
      .filter(function (k) { return !k.classList.contains('ak-layout__ghost'); });
  }

  /** @param {HTMLElement} kid @returns {string|HTMLElement} */
  function keyOf(kid) {
    const k = kid.getAttribute(keyed);
    return k == null ? kid : k;
  }

  /** @param {HTMLElement} ghost */
  function drop(ghost) {
    const at = ghosts.indexOf(ghost);
    if (at >= 0) ghosts.splice(at, 1);
    if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
  }

  /**
   * The child that vanished, held where it stood for one fade. The clone is pinned to the
   * viewport box it was measured in: four numbers into four custom properties, and the
   * stylesheet does the pinning, so no geometry rule is written from JavaScript.
   * @param {HTMLElement} kid
   * @param {DOMRect} box
   */
  function ghostOf(kid, box) {
    const ghost = /** @type {HTMLElement} */ (kid.cloneNode(true));
    ghost.className = kid.className + ' ak-layout__ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.removeAttribute('id');
    ghost.style.setProperty('--ak-ghost-x', box.left + 'px');
    ghost.style.setProperty('--ak-ghost-y', box.top + 'px');
    ghost.style.setProperty('--ak-ghost-w', box.width + 'px');
    ghost.style.setProperty('--ak-ghost-h', box.height + 'px');
    document.body.appendChild(ghost);
    ghosts.push(ghost);
    const M = travel();
    const done = function () { drop(ghost); };
    if (!M) { spring(ghost, { opacity: 0, scale: 0.94 }, feel).finished.then(done); return; }
    M.animate(ghost, { opacity: [1, 0], scale: [1, 0.94] }, Object.assign({ type: 'spring' }, feel))
      .finished.then(done, done);
  }

  /** The travel itself: from where the child stood to identity, on whichever engine is here. */
  function glide(kid, dx, dy, M) {
    whileMoving(kid, function () {
      return M ? M.animate(kid, { x: [dx, 0], y: [dy, 0] }, Object.assign({ type: 'spring' }, feel))
        : flipFrom(kid, dx, dy, feel);
    });
  }

  function grow(kid, M) {
    whileMoving(kid, function () {
      return M ? M.animate(kid, { scale: [0.88, 1], opacity: [0, 1] }, Object.assign({ type: 'spring' }, feel))
        : springFrom(kid, { scale: 0.88, opacity: 0 }, { scale: 1, opacity: 1 }, feel);
    });
  }

  /** @param {() => void} run */
  function update(run) {
    if (typeof run !== 'function') return;
    // A nested update would measure a layout the outer one has already disturbed, so the inner
    // change lands with no travel rather than with a wrong one.
    if (dead || reducedMotion() || running) { run(); return; }
    running = true;
    try {
      /** @type {Map<string|HTMLElement, { el: HTMLElement, box: DOMRect }>} */
      const before = new Map();
      kids().forEach(function (kid) { before.set(keyOf(kid), { el: kid, box: kid.getBoundingClientRect() }); });
      run();
      const M = travel();
      const seen = new Set();
      kids().forEach(function (kid) {
        const key = keyOf(kid);
        seen.add(key);
        const was = before.get(key);
        if (!was) { if (wantEnter) grow(kid, M); return; }
        const now = kid.getBoundingClientRect();
        const dx = was.box.left - now.left;
        const dy = was.box.top - now.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        glide(kid, dx, dy, M);
      });
      if (!wantExit) return;
      before.forEach(function (was, key) {
        if (seen.has(key)) return;
        if (was.el.parentNode === node) return;   // still here under another identity
        ghostOf(was.el, was.box);
      });
    } finally {
      running = false;
    }
  }

  return {
    el: node,
    update: update,
    destroy: function () {
      dead = true;
      ghosts.slice().forEach(drop);
      // The container belongs to the app; only what this part added to it goes.
      node.classList.remove('ak-layout', 'ak-layout--floor');
    },
  };
}

/**
 * THE PILE OF CARDS. The top card follows the hand on both axes and tilts with it; the two
 * behind it peek out, scaled down. Released past the threshold, or thrown with speed, the card
 * flies off that side and the app hears which way it went; released short of it, the card springs
 * back into the pile. Two buttons under the stack say the same two things, and so do the arrow
 * keys once the stack has focus. `undo()` brings the last card back.
 *
 * The pull, the pile's depth and the two edge marks are numbers written into custom properties;
 * every rule that turns them into a tilt, a lift or a tint lives in the stylesheet. Under reduced
 * motion a card leaves the moment it is thrown, with no travel, and everything else is unchanged.
 * @param {{
 *   target?: string|Element,
 *   data?: { items?: Array<{ id: string, title?: string, sub?: string, image?: string, tone?: string }> }
 *         | Array<{ id: string, title?: string, sub?: string, image?: string, tone?: string }> | null,
 *   onSwipe?: (item: any, direction: 'left'|'right') => void, onEmpty?: () => void,
 *   threshold?: number, empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: any }) => void,
 *   swipe: (direction: 'left'|'right') => void, undo: () => void, destroy: () => void }}
 */
export function swipeStack(spec) {
  const s = spec || {};
  const threshold = typeof s.threshold === 'number' && s.threshold > 0 ? s.threshold : 90;
  const root = el('section', { class: 'ak-root ak-swipe', 'aria-roledescription': 'card stack' });
  if (s.target) resolve(s.target).appendChild(root);

  const deck = el('div', { class: 'ak-swipe__deck', tabindex: '0', role: 'group', 'aria-label': 'Cards' });
  // The kit's dictionary carries no directional throw pair, and a part does not extend it: these
  // two labels say what the button DOES rather than borrowing "previous" and "next", which mean
  // something else. A host that translates them does it with i18n.use() over its own keys.
  const left = deckButton('left', 'Swipe left');
  const right = deckButton('right', 'Swipe right');
  const controls = el('div', { class: 'ak-swipe__controls' }, [left, right]);
  root.appendChild(deck);
  root.appendChild(controls);

  /** @type {any[]} */
  let items = [];
  /** The top card's place in `items`; everything before it has been thrown. */
  let index = 0;
  /** @type {Array<{ index: number, direction: 'left'|'right' }>} */
  const history = [];
  /** @type {Array<{ el: HTMLElement, face: HTMLElement, item: any, hand: { destroy: () => void }|null }>} */
  let live = [];
  let emptyCard = null;
  let flying = false;
  let dead = false;

  function deckButton(kind, label) {
    const b = /** @type {HTMLButtonElement} */ (el('button', {
      type: 'button', class: 'ak-btn ak-swipe__go ak-swipe__go--' + kind,
      'aria-label': label, 'data-ak-noguard': true,
      on: { click: function () { swipe(kind); } },
    }));
    b.appendChild(icon(kind));
    return b;
  }

  /** One card: the picture with its caption band, plus the two marks the pull tints. */
  function buildCard(item) {
    const layer = layerOf(item.image);
    const art = el('span', {
      class: 'ak-swipe__art ak-swipe__art--w' + washOf(item.id) + (layer ? ' ak-swipe__art--image' : ''),
      'aria-hidden': 'true',
      vars: layer ? { '--ak-card-image': layer } : null,
    }, layer ? null : el('span', { class: 'ak-swipe__monogram' },
      (Array.from(String(item.title || item.id || '?'))[0] || '?').toUpperCase()));
    const caption = el('span', { class: 'ak-swipe__caption' }, [
      el('span', { class: 'ak-swipe__label' }, String(item.title || item.id || '')),
      item.sub != null ? el('span', { class: 'ak-swipe__sub' }, String(item.sub)) : null,
    ].filter(Boolean));
    // The tilt rides the FACE, not the card: `drag` writes the card's own transform frame by
    // frame, and a second transform on the same element would be a fight neither one wins.
    const face = el('span', { class: 'ak-swipe__face' }, [
      art, caption,
      el('span', { class: 'ak-swipe__mark ak-swipe__mark--right', 'aria-hidden': 'true' }),
      el('span', { class: 'ak-swipe__mark ak-swipe__mark--left', 'aria-hidden': 'true' }),
    ]);
    const tone = TONES.indexOf(item.tone) >= 0 ? ' ak-swipe__card--' + item.tone : '';
    const card = /** @type {HTMLElement} */ (el('article', {
      class: 'ak-swipe__card' + tone,
      'data-ak-id': item.id,
      'aria-label': String(item.title || item.id || ''),
    }, [face]));
    return { card: card, face: face };
  }

  /** The card's place in the pile — the stylesheet turns the number into the lift and the scale. */
  function setDepth(card, d) { card.style.setProperty('--ak-swipe-depth', String(d)); }

  /** How far the hand has pulled, as a tilt and as the weight of the two edge marks. */
  function pull(face, dx) {
    const share = Math.max(-1, Math.min(1, dx / threshold));
    face.style.setProperty('--ak-swipe-tilt', (dx * TILT).toFixed(2) + 'deg');
    face.style.setProperty('--ak-swipe-yes', String(Math.max(0, share)));
    face.style.setProperty('--ak-swipe-no', String(Math.max(0, -share)));
  }

  /** The release that did not go far enough: the card comes home and the marks fade out. */
  function settle(card, face) {
    pull(face, 0);
    whileMoving(card, function () { return spring(card, { x: 0, y: 0 }, BACK); });
  }

  function arm() {
    const top = live[0];
    if (!top || top.hand) return;
    top.hand = drag(top.el, {
      onMove: function (dx) { pull(top.face, dx); },
      onEnd: function (dx, dy, velocity) {
        if (Math.abs(dx) > threshold || Math.abs(velocity.x) > FLICK) toss(dx < 0 ? 'left' : 'right', dx, dy);
        else settle(top.el, top.face);
      },
    }, { axis: 'both', back: false });
  }

  function render() {
    live.forEach(function (c) { if (c.hand) c.hand.destroy(); });
    live = [];
    clear(deck);
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    const rest = items.length - index;
    left.disabled = rest <= 0;
    right.disabled = rest <= 0;
    if (rest <= 0) {
      deck.hidden = true;
      const e = s.empty || {};
      emptyCard = emptyState({ target: root, tone: 'quiet', title: e.title || t('empty'), hint: e.hint || t('emptyHint') });
      return;
    }
    deck.hidden = false;
    const shown = Math.min(DEPTH, rest);
    live = new Array(shown);
    // Deepest first, so the top card is the last one painted and needs no stacking rule.
    for (let d = shown - 1; d >= 0; d--) {
      const item = items[index + d];
      const built = buildCard(item);
      setDepth(built.card, d);
      built.card.setAttribute('aria-hidden', d === 0 ? 'false' : 'true');
      deck.appendChild(built.card);
      live[d] = { el: built.card, face: built.face, item: item, hand: null };
    }
    arm();
  }

  /**
   * The throw. Motion springs the card off the side it was sent, from exactly where the hand
   * left it (both ends of every keyframe are named, so nothing has to be read back off a
   * transform); without Motion the kit's own spring does the same travel, and under reduced
   * motion it lands at once. The card is gone before the app is told, so an `onSwipe` that
   * re-renders cannot race the animation.
   * @param {'left'|'right'} direction
   * @param {number} dx  where the card stands when it is let go
   * @param {number} dy
   */
  function toss(direction, dx, dy) {
    const top = live[0];
    if (!top || flying) return;
    flying = true;
    if (top.hand) { top.hand.destroy(); top.hand = null; }
    const card = top.el;
    const item = top.item;
    const dir = direction === 'left' ? -1 : 1;
    const off = dir * (window.innerWidth + card.offsetWidth);
    const done = function () {
      flying = false;
      if (card.parentNode) card.parentNode.removeChild(card);
      history.push({ index: index, direction: direction });
      index += 1;
      render();
      if (s.onSwipe) s.onSwipe(item, direction);
      if (index >= items.length && s.onEmpty) s.onEmpty();
    };
    const M = travel();
    whileMoving(card, function () {
      return M ? M.animate(card,
        { x: [dx, off], y: [dy, dy + LOB], rotate: [0, dir * SPIN], opacity: [1, 0] },
        Object.assign({ type: 'spring' }, TOSS))
        : spring(card, { x: off, y: dy, opacity: 0 }, TOSS);
    }).finished.then(done, done);
  }

  /** @param {'left'|'right'} direction */
  function swipe(direction) {
    if (!live[0] || flying) return;
    toss(direction === 'left' ? 'left' : 'right', 0, 0);
  }

  /** The last card comes back, arriving from the side it left by. */
  function undo() {
    const back = history.pop();
    if (!back || flying) return;
    index = back.index;
    render();
    const top = live[0];
    if (!top) return;
    const dir = back.direction === 'left' ? -1 : 1;
    const from = dir * (window.innerWidth + top.el.offsetWidth);
    const M = travel();
    whileMoving(top.el, function () {
      return M ? M.animate(top.el, { x: [from, 0], rotate: [dir * SPIN, 0], opacity: [0, 1] },
        Object.assign({ type: 'spring' }, TOSS))
        : springFrom(top.el, { x: from, opacity: 0 }, { x: 0, opacity: 1 }, TOSS);
    });
  }

  const onKey = function (ev) {
    const k = /** @type {KeyboardEvent} */ (ev).key;
    if (k === 'ArrowLeft') { ev.preventDefault(); swipe('left'); }
    else if (k === 'ArrowRight') { ev.preventDefault(); swipe('right'); }
  };
  deck.addEventListener('keydown', onKey);

  function load(data) {
    items = rowsOf(data);
    index = 0;
    history.length = 0;
    render();
  }

  load(s.data);
  ensureMotion().then(function () { /* the next throw springs instead of stepping */ }, function () {
    if (!dead) root.classList.add('ak-swipe--floor');   // the kit's own spring is carrying it
  });

  return {
    el: root,
    set: function (patch) { if (patch && 'data' in patch) load(patch.data); },
    swipe: swipe,
    undo: undo,
    destroy: function () {
      dead = true;
      live.forEach(function (c) { if (c.hand) c.hand.destroy(); });
      live = [];
      deck.removeEventListener('keydown', onKey);
      if (emptyCard) emptyCard.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/** What each hover and press does, as the transform pair the two engines share. */
const MOVES = {
  lift: { on: { y: -3, scale: 1.02 }, off: { y: 0, scale: 1 } },
  tilt: { on: { rotate: -1.5, scale: 1.015 }, off: { rotate: 0, scale: 1 } },
  squash: { on: { scale: 0.96 }, off: { scale: 1 } },
  dip: { on: { y: 2, scale: 0.99 }, off: { y: 0, scale: 1 } },
};

/** The move, scaled by how much of it the caller asked for. */
function amount(move, k) {
  if (k === 1) return move;
  const out = {};
  Object.keys(move).forEach(function (key) {
    out[key] = key === 'scale' ? 1 + (move[key] - 1) * k : move[key] * k;
  });
  return out;
}

/**
 * THE SMALL REACTIONS. One call gives a control, or every control under a root, the two answers
 * a hand expects: something under the pointer and something under the finger.
 *
 *   hover   'lift' (the default) rises and grows a little · 'tilt' leans · 'glow' takes an
 *           accent halo and no transform at all · false for none
 *   press   'squash' (the default) presses in · 'dip' presses down · false for none
 *
 * `selector` covers a whole page in one call: every descendant matching it is bound at call
 * time, which is a finite set and a finite amount of work. Elements added later are not bound —
 * call `micro` again for a section you have just built, which is cheaper than an observer that
 * never stops watching.
 *
 * Duration and curve come from the look (`--ak-motion`, `--ak-ease`), so a look that wants a
 * springy hand gets one here too. Before Motion lands the stylesheet carries both reactions
 * through a class; once it lands the classes come off and Motion drives, so the two never
 * compose. Under reduced motion nothing is bound and nothing is added.
 * @param {Element|string} target
 * @param {{ hover?: 'lift'|'tilt'|'glow'|false, press?: 'squash'|'dip'|false, scale?: number,
 *   selector?: string }} [opts]
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function micro(target, opts) {
  const node = /** @type {HTMLElement} */ (resolve(target));
  const o = opts || {};
  const hoverKind = o.hover === undefined ? 'lift' : o.hover;
  const pressKind = o.press === undefined ? 'squash' : o.press;
  const k = typeof o.scale === 'number' && o.scale > 0 ? o.scale : 1;
  /** @type {HTMLElement[]} */
  const nodes = o.selector
    ? /** @type {HTMLElement[]} */ (Array.prototype.slice.call(node.querySelectorAll(o.selector)))
    : [node];
  /** @type {Array<() => void>} */
  const handles = [];
  /** @type {string[]} */
  const classes = ['ak-micro'];
  let dead = false;

  if (hoverKind === 'glow') classes.push('ak-micro--glow');
  else if (hoverKind && MOVES[hoverKind]) classes.push('ak-micro--' + hoverKind);
  if (pressKind && MOVES[pressKind]) classes.push('ak-micro--' + pressKind);

  // A viewer who asked for less motion gets no reactions and no classes: there is nothing here
  // that a hand needs in order to work, only how it feels while it does.
  if (reducedMotion() || classes.length === 1 || !nodes.length) {
    return { el: node, destroy: function () { /* nothing was bound */ } };
  }

  nodes.forEach(function (n) { n.classList.add.apply(n.classList, classes); });

  /** The classes Motion takes over from once it lands. The glow is the stylesheet's for good. */
  const owned = classes.filter(function (c) { return c !== 'ak-micro' && c !== 'ak-micro--glow'; });

  function bind(M) {
    const feel = paceOf(node);
    const hoverMove = hoverKind && hoverKind !== 'glow' ? MOVES[hoverKind] : null;
    const pressMove = pressKind ? MOVES[pressKind] : null;
    nodes.forEach(function (n) {
      owned.forEach(function (c) { n.classList.remove(c); });
      if (hoverMove) {
        handles.push(M.hover(n, function () {
          M.animate(n, amount(hoverMove.on, k), feel);
          return function () { M.animate(n, amount(hoverMove.off, k), feel); };
        }));
      }
      if (pressMove) {
        handles.push(M.press(n, function () {
          M.animate(n, amount(pressMove.on, k), feel);
          return function () { M.animate(n, amount(pressMove.off, k), feel); };
        }));
      }
    });
  }

  // A glow is a shadow and stays the stylesheet's for good, so a call that asks for nothing else
  // has nothing for Motion to drive — and does not fetch a library it would never use.
  if (owned.length) {
    ensureMotion().then(function (M) {
      // Destroyed while the script was in flight, or the viewer changed their mind about motion:
      // either way nothing is bound and the classes have already come off.
      if (dead || reducedMotion() || !M || typeof M.hover !== 'function') return;
      bind(M);
    }, function () { /* the stylesheet's classes are already carrying both reactions */ });
  }

  return {
    el: node,
    destroy: function () {
      dead = true;
      handles.forEach(function (stop) { if (typeof stop === 'function') stop(); });
      handles.length = 0;
      nodes.forEach(function (n) { n.classList.remove.apply(n.classList, classes); });
    },
  };
}
