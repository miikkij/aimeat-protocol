/**
 * @file atelier/motion-parts.js
 * @description The two parts that are MOTION before they are data (wish-atelier-motion-libraries-
 *   and-parts, stage 3): a strip of media cards you push along, and the picture that opens out of
 *   one of them.
 *
 *     carousel  a horizontal strip of media cards, one of them current, moved by the buttons,
 *               the dots, the arrow keys or a swipe
 *     lightbox  one picture at full size, opened out of the card that was pressed and closed
 *               back into it
 *
 *   THE LIBRARY IS THE POLISH, NEVER THE MECHANISM. Motion 13 is served by this node
 *   (/lib/motion@13.min.js, MIT) and is fetched once, lazily, the way the map fetches Leaflet.
 *   Until it lands — and whenever the viewer asks for less motion — both parts render, answer
 *   every control and report every pick with no travel at all: the strip is a scroll-snap
 *   scroller the browser already knows how to move, and the picture simply appears. Nothing here
 *   is CORRECT only once a script has loaded.
 *
 *   MOTION IS FINITE. Every animation is under the hand (a swipe, a press, a key) or on a change
 *   (the current card lifting, the picture arriving). Nothing loops and nothing idles, so a
 *   resting carousel repaints zero times.
 * @structure ensureMotion · travel · safeImage · icon · carousel(spec) · lightbox(spec)
 * @usage
 *   AIMEAT.atelier.carousel({ target: host, data: { items: [
 *     { id: 'a', title: 'Harbour', sub: 'May', image: '/files/harbour.jpg' } ] },
 *     onPick(item) { AIMEAT.atelier.lightbox({ items, from: document.activeElement }); } });
 * @version-history
 *   v0.44.0 — 2026-09-02 — Initial (wish-atelier-motion-libraries-and-parts, stage 3).
 */
import { el, clear, resolve, uid, reducedMotion } from './dom.js';
import { svg } from './chart-core.js';
import { emptyState } from './state.js';
import { t } from './i18n.js';
import { drag } from './motion.js';
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
 * as "arrive there now", which is why neither part depends on the library for correctness.
 * @returns {any}
 */
function travel() {
  if (reducedMotion()) return null;
  const M = loaded();
  return M && typeof M.animate === 'function' ? M : null;
}

/** The house spring: firm enough to feel decided, damped enough not to wobble. */
const FEEL = { type: 'spring', stiffness: 220, damping: 24 };
/** How much taller than its neighbours the current card stands. */
const LIFT = 1.05;
/** Past this share of a card's width, or this speed, a release counts as "go to the next one". */
const PULL = 0.28;
const FLICK = 420;

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
 * @param {'prev'|'next'|'close'} kind
 * @returns {SVGElement}
 */
function icon(kind) {
  const node = svg('svg', {
    class: 'ak-icon', viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  const d = kind === 'prev' ? 'M15 5 L8 12 L15 19'
    : kind === 'next' ? 'M9 5 L16 12 L9 19'
      : 'M6 6 L18 18 M18 6 L6 18';
  node.appendChild(svg('path', { d: d }));
  return node;
}

/**
 * The travel between two boxes, as the transform that puts the second WHERE THE FIRST IS. The
 * first half of a FLIP: measure both, start the picture on this transform, spring it to nothing.
 * @param {DOMRect} from
 * @param {DOMRect} to
 * @returns {{ x: number, y: number, scale: number }}
 */
function rectDelta(from, to) {
  if (!to.width || !to.height) return { x: 0, y: 0, scale: 1 };
  return {
    x: (from.left + from.width / 2) - (to.left + to.width / 2),
    y: (from.top + from.height / 2) - (to.top + to.height / 2),
    scale: Math.max(from.width / to.width, 0.05),
  };
}

/**
 * THE STRIP. Media cards side by side, one of them current, moved by the buttons, the dots, the
 * arrow keys or a swipe. The browser's own scroll-snap is the floor, so the strip works before
 * any script has loaded and under reduced motion; Motion, once it lands, springs the travel and
 * lifts the current card.
 * @param {{
 *   target?: string|Element, title?: string,
 *   data?: { items?: Array<{ id: string, title?: string, sub?: string, image?: string, tone?: string }> }
 *         | Array<{ id: string, title?: string, sub?: string, image?: string, tone?: string }> | null,
 *   onPick?: (item: any) => void, empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: any }) => void, destroy: () => void }}
 */
export function carousel(spec) {
  const s = spec || {};
  const titleId = uid('ak-carousel');
  const root = el('section', {
    class: 'ak-root ak-carousel',
    role: 'region',
    'aria-roledescription': 'carousel',
    'aria-labelledby': s.title ? titleId : null,
    'aria-label': s.title ? null : 'Media',
  });
  if (s.target) resolve(s.target).appendChild(root);
  if (s.title) root.appendChild(el('h3', { class: 'ak-carousel__title', id: titleId }, String(s.title)));

  const track = el('div', { class: 'ak-carousel__track' });
  const viewport = el('div', { class: 'ak-carousel__viewport', tabindex: '0' }, [track]);
  const prev = navButton('prev', t('previous'), function () { step(-1); });
  const next = navButton('next', t('next'), function () { step(1); });
  const stage = el('div', { class: 'ak-carousel__stage' }, [prev, viewport, next]);
  const dots = el('div', { class: 'ak-carousel__dots' });
  root.appendChild(stage);
  root.appendChild(dots);

  /** @type {any[]} */
  let items = [];
  /** @type {HTMLElement[]} */
  let cards = [];
  /** @type {HTMLElement[]} */
  let dotEls = [];
  let index = 0;
  let flight = null;      // the running scroll spring, if any
  let driving = false;    // we are moving the strip; the scroll watcher stands back
  let settle = 0;
  let swiped = false;     // a swipe just ended, so the click it produces is not a pick
  let emptyCard = null;
  let dead = false;

  function navButton(kind, label, run) {
    const b = /** @type {HTMLButtonElement} */ (el('button', {
      type: 'button', class: 'ak-btn ak-btn--ghost ak-carousel__nav ak-carousel__nav--' + kind,
      'aria-label': label, 'data-ak-noguard': true, on: { click: run },
    }));
    b.appendChild(icon(kind));
    return b;
  }

  /** One card: the picture with its caption band, or the tinted wash when there is no picture. */
  function buildCard(item, i, n) {
    const layer = layerOf(item.image);
    const art = el('span', {
      class: 'ak-carousel__art ak-carousel__art--w' + washOf(item.id) + (layer ? ' ak-carousel__art--image' : ''),
      'aria-hidden': 'true',
      vars: layer ? { '--ak-card-image': layer } : null,
    }, layer ? null : el('span', { class: 'ak-carousel__monogram' },
      (Array.from(String(item.title || item.id || '?'))[0] || '?').toUpperCase()));
    const caption = el('span', { class: 'ak-carousel__caption' }, [
      el('span', { class: 'ak-carousel__label' }, String(item.title || item.id || '')),
      item.sub != null ? el('span', { class: 'ak-carousel__sub' }, String(item.sub)) : null,
    ].filter(Boolean));
    const tone = TONES.indexOf(item.tone) >= 0 ? ' ak-carousel__card--' + item.tone : '';
    const card = /** @type {HTMLElement} */ (el(s.onPick ? 'button' : 'div', {
      class: 'ak-carousel__card' + tone,
      type: s.onPick ? 'button' : null,
      role: 'group',
      'aria-roledescription': 'slide',
      'aria-label': (i + 1) + ' / ' + n + (item.title ? ': ' + item.title : ''),
      'data-ak-noguard': true,
      'data-ak-id': item.id,
      on: s.onPick ? { click: function () { if (!swiped) s.onPick(item); } } : null,
    }, [art, caption]));
    return card;
  }

  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    items = rowsOf(data);
    clear(track);
    clear(dots);
    cards = [];
    dotEls = [];
    index = 0;
    if (!items.length) {
      stage.hidden = true;
      dots.hidden = true;
      const e = s.empty || {};
      emptyCard = emptyState({ target: root, tone: 'quiet', title: e.title || t('empty'), hint: e.hint || t('emptyHint') });
      return;
    }
    stage.hidden = false;
    dots.hidden = items.length < 2;
    items.forEach(function (item, i) {
      const card = buildCard(item, i, items.length);
      cards.push(card);
      track.appendChild(card);
      const dot = /** @type {HTMLElement} */ (el('button', {
        type: 'button', class: 'ak-carousel__dot', 'data-ak-noguard': true,
        'aria-label': String(i + 1) + ' / ' + items.length,
        on: { click: function () { goTo(i); } },
      }));
      dotEls.push(dot);
      dots.appendChild(dot);
    });
    mark();
  }

  /** Where the strip must sit for card `i` to be centred — the same place scroll-snap lands on. */
  function cardLeft(i) {
    const card = cards[i];
    if (!card) return 0;
    return card.offsetLeft - (viewport.clientWidth - card.offsetWidth) / 2;
  }

  /** The current card stands a touch taller; Motion springs it, the stylesheet carries the floor. */
  function lift(card, on) {
    const to = on ? LIFT : 1;
    const M = travel();
    if (!M) { card.style.setProperty('--ak-lift', String(to)); return; }
    M.animate(card, { scale: to }, FEEL);
  }

  function mark() {
    cards.forEach(function (card, i) {
      const on = i === index;
      card.classList.toggle('is-current', on);
      card.setAttribute('aria-current', on ? 'true' : 'false');
      lift(card, on);
    });
    dotEls.forEach(function (dot, i) {
      dot.classList.toggle('is-on', i === index);
      dot.setAttribute('aria-current', i === index ? 'true' : 'false');
    });
    prev.disabled = index <= 0;
    next.disabled = index >= items.length - 1;
  }

  /**
   * Hand the strip back to the scroll watcher after `ms` of quiet. Every travel arms this, and
   * every scroll event re-arms it shorter — so a travel that produces no scroll at all (already
   * there, or a one-card strip) still releases instead of muting the watcher for good.
   */
  function release(ms) {
    if (settle) clearTimeout(settle);
    settle = window.setTimeout(function () {
      settle = 0;
      driving = false;
      syncFromScroll();
    }, ms);
  }

  function travelTo(left, instant) {
    const span = Math.max(0, track.scrollWidth - viewport.clientWidth);
    const target = Math.max(0, Math.min(left, span));
    if (flight && typeof flight.stop === 'function') flight.stop();
    flight = null;
    driving = true;
    release(900);
    const M = travel();
    if (instant || !M) {
      viewport.scrollTo({ left: target, behavior: instant || reducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    flight = M.animate(viewport.scrollLeft, target, Object.assign({}, FEEL, {
      onUpdate: function (v) { viewport.scrollLeft = v; },
    }));
  }

  function goTo(i, instant) {
    if (!items.length) return;
    index = Math.max(0, Math.min(i, items.length - 1));
    mark();
    travelTo(cardLeft(index), instant);
  }

  function step(by) { goTo(index + by); }

  /** Which card is under the middle of the viewport now — the answer the dots must agree with. */
  function syncFromScroll() {
    if (!cards.length) return;
    const mid = viewport.scrollLeft + viewport.clientWidth / 2;
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < cards.length; i++) {
      const gap = Math.abs(cards[i].offsetLeft + cards[i].offsetWidth / 2 - mid);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    if (best !== index) { index = best; mark(); }
  }

  const onScroll = function () {
    release(120);
    if (!driving) syncFromScroll();
  };

  const onKey = function (ev) {
    const k = /** @type {KeyboardEvent} */ (ev).key;
    if (k === 'ArrowLeft') { ev.preventDefault(); step(-1); }
    else if (k === 'ArrowRight') { ev.preventDefault(); step(1); }
    else if (k === 'Home') { ev.preventDefault(); goTo(0); }
    else if (k === 'End') { ev.preventDefault(); goTo(items.length - 1); }
  };

  // A swipe that ends over a card would otherwise ALSO be a click on it: the strip moved and the
  // app was told the card was chosen. The capture listener eats exactly that one click.
  const onDown = function () { swiped = false; };
  const onClick = function (ev) {
    if (!swiped) return;
    swiped = false;
    ev.preventDefault();
    ev.stopPropagation();
  };

  let resizing = 0;
  const onResize = function () {
    if (resizing) return;
    resizing = requestAnimationFrame(function () { resizing = 0; goTo(index, true); });
  };

  // The swipe: the strip follows the hand and springs back, and the release picks the next card by
  // how far it was pulled or how fast it was thrown.
  const swipe = drag(track, {
    onEnd: function (dx, _dy, velocity) {
      if (Math.abs(dx) < 6) return;
      swiped = true;
      const width = cards[index] ? cards[index].offsetWidth : viewport.clientWidth;
      const far = Math.abs(dx) > width * PULL || Math.abs(velocity.x) > FLICK;
      if (far) step(dx < 0 ? 1 : -1); else goTo(index);
    },
  }, { axis: 'x', back: true, stiffness: 260, damping: 24 });

  viewport.addEventListener('scroll', onScroll, { passive: true });
  root.addEventListener('keydown', onKey);
  track.addEventListener('pointerdown', onDown);
  track.addEventListener('click', onClick, true);
  window.addEventListener('resize', onResize);

  render(s.data);
  ensureMotion().then(function () { if (!dead) mark(); }, function () {
    root.classList.add('ak-carousel--floor');   // the browser's own snap is carrying it
  });

  return {
    el: root,
    set: function (patch) { if (patch && 'data' in patch) render(patch.data); },
    destroy: function () {
      dead = true;
      if (flight && typeof flight.stop === 'function') flight.stop();
      if (settle) clearTimeout(settle);
      if (resizing) cancelAnimationFrame(resizing);
      swipe.destroy();
      viewport.removeEventListener('scroll', onScroll);
      root.removeEventListener('keydown', onKey);
      track.removeEventListener('pointerdown', onDown);
      track.removeEventListener('click', onClick, true);
      window.removeEventListener('resize', onResize);
      if (emptyCard) emptyCard.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/**
 * THE PICTURE, FULL SIZE. Component-only, like the dialog family: it mounts itself, opens over
 * everything, and hands back a handle. Built on native <dialog> + showModal() for the same reason
 * dialog.js is — the browser gives the focus trap, the Escape key, the top layer and the focus
 * return, which is the whole accessibility contract, correct and free.
 *
 * It opens by SPRINGING OUT OF the element that was pressed: both boxes are measured, the picture
 * starts on the transform that puts it where that element is, and Motion springs it to nothing.
 * Without Motion, or under reduced motion, the picture simply appears — everything else works the
 * same.
 * @param {{
 *   items: Array<{ id: string, image: string, title?: string, sub?: string }>,
 *   index?: number, from?: Element, onClose?: () => void, onChange?: (index: number) => void,
 * }} spec
 * @returns {{ el: HTMLElement, close: () => void, destroy: () => void }}
 */
export function lightbox(spec) {
  const s = spec || /** @type {any} */ ({});
  const items = (Array.isArray(s.items) ? s.items : []).filter(function (it) { return it && safeImage(it.image); });
  let index = Math.max(0, Math.min(s.index || 0, Math.max(items.length - 1, 0)));

  const node = /** @type {HTMLDialogElement} */ (el('dialog', {
    class: 'ak-root ak-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Picture',
  }));
  const image = /** @type {HTMLImageElement} */ (el('img', { class: 'ak-lightbox__image', alt: '' }));
  const label = el('span', { class: 'ak-lightbox__label' });
  const sub = el('span', { class: 'ak-lightbox__sub' });
  const count = el('span', { class: 'ak-lightbox__count' });
  const figure = el('figure', { class: 'ak-lightbox__figure' }, [
    image,
    el('figcaption', { class: 'ak-lightbox__caption' }, [label, sub, count]),
  ]);
  const shut = navButton('close', t('close'), function () { close(); });
  const prev = navButton('prev', t('previous'), function () { step(-1); });
  const next = navButton('next', t('next'), function () { step(1); });
  const panel = el('div', { class: 'ak-lightbox__panel' }, [shut, prev, figure, next]);
  node.appendChild(panel);

  let closed = false;
  let entered = false;

  // The kit's base button already IS what these want (the surface, the ink, the hairline); the
  // ghost modifier would strip exactly that, and these three have to read over any picture.
  function navButton(kind, aria, run) {
    const b = /** @type {HTMLButtonElement} */ (el('button', {
      type: 'button', class: 'ak-btn ak-lightbox__' + (kind === 'close' ? 'x' : 'nav ak-lightbox__nav--' + kind),
      'aria-label': aria, 'data-ak-noguard': true, on: { click: run },
    }));
    b.appendChild(icon(kind));
    return b;
  }

  function show(reportChange) {
    const item = items[index];
    if (!item) return;
    image.src = /** @type {string} */ (safeImage(item.image));
    image.alt = String(item.title || '');
    label.textContent = String(item.title || '');
    label.hidden = !item.title;
    sub.textContent = String(item.sub || '');
    sub.hidden = !item.sub;
    count.textContent = (index + 1) + ' / ' + items.length;
    count.hidden = items.length < 2;
    prev.disabled = index <= 0;
    next.disabled = index >= items.length - 1;
    if (reportChange && s.onChange) s.onChange(index);
  }

  function goTo(i) {
    if (!items.length) return;
    const to = Math.max(0, Math.min(i, items.length - 1));
    if (to === index) return;
    const forward = to > index;
    index = to;
    show(true);
    // The change is a change, so it gets a beat: the new picture arrives from the side the hand
    // came from. Measured before the index moves, or the direction is always the same one.
    const M = travel();
    if (M) M.animate(image, { x: [forward ? 24 : -24, 0], opacity: [0, 1] }, FEEL);
  }

  function step(by) { goTo(index + by); }

  /** The FLIP, both ways: `to` is where the picture is, `box` is the element it comes from. */
  function flip(box, out) {
    const M = travel();
    if (!M || !box || !box.isConnected) return null;
    const d = rectDelta(box.getBoundingClientRect(), image.getBoundingClientRect());
    const frames = out
      ? { x: [0, d.x], y: [0, d.y], scale: [1, d.scale], opacity: [1, 0] }
      : { x: [d.x, 0], y: [d.y, 0], scale: [d.scale, 1], opacity: [0.4, 1] };
    return M.animate(image, frames, FEEL);
  }

  // A picture with no size yet is a 0×0 box, and a FLIP measured off one lands the spring
  // somewhere nobody asked for. Whichever of the three doors arrives last with a real box wins.
  function open() {
    if (entered || !image.getBoundingClientRect().width) return;
    entered = true;
    flip(s.from, false);
  }

  function close() {
    if (closed) return;
    closed = true;
    const done = function () {
      document.body.classList.remove('ak-lightbox-open');
      if (node.open) node.close();
      if (node.parentNode) node.parentNode.removeChild(node);
      if (s.onClose) s.onClose();
    };
    const out = flip(s.from, true);
    if (!out || !out.finished) return done();
    // A dropped animation (a hidden tab) must never leave the picture stuck open.
    out.finished.then(done, done);
  }

  const onKey = function (ev) {
    const k = /** @type {KeyboardEvent} */ (ev).key;
    if (k === 'ArrowLeft') { ev.preventDefault(); step(-1); }
    else if (k === 'ArrowRight') { ev.preventDefault(); step(1); }
  };
  const onCancel = function (ev) { ev.preventDefault(); close(); };
  const onBackdrop = function (ev) { if (ev.target === node) close(); };

  // The swipe changes the picture, exactly as it moves the strip it came from.
  const swipe = drag(figure, {
    onEnd: function (dx, _dy, velocity) {
      const far = Math.abs(dx) > figure.clientWidth * PULL || Math.abs(velocity.x) > FLICK;
      if (far) step(dx < 0 ? 1 : -1);
    },
  }, { axis: 'x', back: true, stiffness: 260, damping: 24 });

  node.addEventListener('keydown', onKey);
  node.addEventListener('cancel', onCancel);
  node.addEventListener('click', onBackdrop);

  document.body.appendChild(node);
  document.body.classList.add('ak-lightbox-open');
  if (!items.length) {
    clear(panel);
    panel.appendChild(shut);
    emptyState({ target: panel, tone: 'quiet', title: t('empty'), hint: t('emptyHint') });
  } else {
    show(false);
  }
  node.showModal();
  shut.focus();

  if (items.length) {
    if (image.complete && image.naturalWidth) open();
    else image.addEventListener('load', open, { once: true });
    ensureMotion().then(open, function () {
      node.classList.add('ak-lightbox--floor');   // no travel; the picture is already in place
    });
  }

  return {
    el: node,
    close: close,
    destroy: function () {
      swipe.destroy();
      node.removeEventListener('keydown', onKey);
      node.removeEventListener('cancel', onCancel);
      node.removeEventListener('click', onBackdrop);
      close();
    },
  };
}
