/**
 * @file atelier/materials.js
 * @description The moves that need a hand on the wheel — the JavaScript half of materials.css
 *   (accepted on the Atelier Next canvas, 2026-09-01). Each helper wires ONE recipe to ONE
 *   element and answers the pointer or a data change; none of them loops, none of them fetches,
 *   and every one is a no-op under reduced motion. The CSS-only recipes (magnet, sheen on hover,
 *   the deal-in class) need no call at all — they are classes.
 *
 *   spotlight(el)        the glow follows the pointer over the surface (.ak-mat--spot)
 *   tilt(el, opts)       the surface leans toward the pointer in 3D (.ak-move--tilt)
 *   sheen(el)            one light pass, now — for the moment a thing changed (.ak-move--sheen)
 *   odometer(el, value)  a figure rolls to its new value (.ak-odo)
 *   thumb(container)     the sliding selection pill behind tabs or segments (.ak-thumb)
 *   deal(targets)        the spring entrance, dealt one after another (.ak-move--deal)
 * @structure spotlight · tilt · sheen · odometer · thumb · deal
 * @usage
 *   AIMEAT.atelier.spotlight(card);            // card carries .ak-mat--spot
 *   AIMEAT.atelier.odometer(figureEl, 74);     // rolls from what it showed to 74
 * @version-history
 *   v0.41.0 — 2026-09-01 — Initial (wish-atelier-night-gallery, stage 2).
 */
import { el, resolve, reducedMotion } from './dom.js';

/** A destroy handle, the shape every helper returns. */
function handle(node, off) {
  return { el: node, destroy() { off(); } };
}

/**
 * The spotlight: the glow follows the pointer while it is over the surface, and settles when
 * it leaves. The CSS reads --ak-spot-x/y; this only writes them.
 * @param {Element|string} target
 * @returns {{ el: Element, destroy: () => void }}
 */
export function spotlight(target) {
  const node = /** @type {HTMLElement} */ (resolve(target));
  node.classList.add('ak-mat--spot');
  const move = (e) => {
    const r = node.getBoundingClientRect();
    node.style.setProperty('--ak-spot-x', Math.round(((e.clientX - r.left) / Math.max(r.width, 1)) * 100) + '%');
    node.style.setProperty('--ak-spot-y', Math.round(((e.clientY - r.top) / Math.max(r.height, 1)) * 100) + '%');
  };
  const leave = () => { node.style.removeProperty('--ak-spot-x'); node.style.removeProperty('--ak-spot-y'); };
  if (!reducedMotion()) {
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', leave);
  }
  return handle(node, () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerleave', leave); leave(); });
}

/**
 * The parallax tilt: the surface leans toward the pointer, up to `max` degrees, and returns on
 * leave through the CSS transition. One per screen is the rule — it is the spotlight moment.
 * @param {Element|string} target
 * @param {{ max?: number, lift?: number }} [opts]
 * @returns {{ el: Element, destroy: () => void }}
 */
export function tilt(target, opts) {
  const node = /** @type {HTMLElement} */ (resolve(target));
  const max = (opts && opts.max) || 10;
  const lift = (opts && opts.lift) || 5;
  node.classList.add('ak-move--tilt');
  const move = (e) => {
    const r = node.getBoundingClientRect();
    const px = (e.clientX - r.left) / Math.max(r.width, 1) - 0.5;
    const py = (e.clientY - r.top) / Math.max(r.height, 1) - 0.5;
    node.style.transform = 'perspective(650px) rotateX(' + (-py * max * 2).toFixed(2) + 'deg) rotateY('
      + (px * max * 2).toFixed(2) + 'deg) translateY(-' + lift + 'px)';
  };
  const leave = () => { node.style.transform = ''; };
  if (!reducedMotion()) {
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', leave);
  }
  return handle(node, () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerleave', leave); leave(); });
}

/**
 * The sheen, now: one light pass over a surface that just changed. Adds the recipe class if the
 * element lacks it, runs once, removes the trigger when the pass ends.
 * @param {Element|string} target
 * @returns {boolean} whether it ran
 */
export function sheen(target) {
  const node = /** @type {HTMLElement} */ (resolve(target));
  if (reducedMotion()) return false;
  node.classList.add('ak-move--sheen');
  node.classList.remove('is-sheening');
  // Force the style recalculation so a second call in the same frame still restarts the pass.
  void node.offsetWidth;
  node.classList.add('is-sheening');
  const done = () => { node.classList.remove('is-sheening'); node.removeEventListener('animationend', done); };
  node.addEventListener('animationend', done);
  return true;
}

/**
 * The odometer: the element shows a figure; calling this with a new value rolls the reel from
 * the old figure to the new one and leaves the new one standing as plain text. Finite, and
 * plain text at once under reduced motion.
 * @param {Element|string} target
 * @param {number|string} value
 * @returns {boolean} whether it rolled (false when nothing changed or motion is reduced)
 */
export function odometer(target, value) {
  const node = /** @type {HTMLElement} */ (resolve(target));
  const next = String(value);
  const prev = node.getAttribute('data-odo') != null ? String(node.getAttribute('data-odo')) : node.textContent.trim();
  node.setAttribute('data-odo', next);
  if (prev === next || reducedMotion() || typeof node.animate !== 'function') {
    node.textContent = next;
    return false;
  }
  node.classList.add('ak-odo');
  const reel = el('span', { class: 'ak-odo__reel' }, [el('span', {}, prev), el('span', {}, next)]);
  node.textContent = '';
  node.appendChild(reel);
  const h = reel.firstChild ? /** @type {HTMLElement} */ (reel.firstChild).offsetHeight : 0;
  const cs = getComputedStyle(node);
  const span = (parseFloat(cs.getPropertyValue('--ak-motion')) || 200) * 3.5;
  const anim = reel.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-' + h + 'px)' }], {
    duration: span, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards',
  });
  const settle = () => { node.textContent = next; };
  anim.addEventListener('finish', settle);
  anim.addEventListener('cancel', settle);
  return true;
}

/**
 * The sliding thumb: a pill behind the selected child of a row (tabs, a segmented control)
 * that glides when the selection moves. The selected child is the one carrying
 * [aria-selected="true"], [aria-pressed="true"], [aria-current] or .is-on; call `update()`
 * after the selection changes, or let the observer see the attribute flip.
 * @param {Element|string} target  the row
 * @returns {{ el: Element, update: () => void, destroy: () => void }}
 */
export function thumb(target) {
  const node = /** @type {HTMLElement} */ (resolve(target));
  node.classList.add('ak-thumb');
  const pill = el('span', { class: 'ak-thumb__pill', 'aria-hidden': 'true' });
  node.insertBefore(pill, node.firstChild);
  const update = () => {
    const on = node.querySelector('[aria-selected="true"], [aria-pressed="true"], [aria-current], .is-on');
    if (!on) { node.style.setProperty('--ak-thumb-w', '0px'); return; }
    const r = /** @type {HTMLElement} */ (on);
    node.style.setProperty('--ak-thumb-left', r.offsetLeft + 'px');
    node.style.setProperty('--ak-thumb-top', r.offsetTop + 'px');
    node.style.setProperty('--ak-thumb-w', r.offsetWidth + 'px');
    node.style.setProperty('--ak-thumb-h', r.offsetHeight + 'px');
  };
  const mo = typeof MutationObserver === 'function'
    ? new MutationObserver(update) : null;
  if (mo) mo.observe(node, { attributes: true, subtree: true, attributeFilter: ['aria-selected', 'aria-pressed', 'aria-current', 'class'] });
  update();
  return { el: node, update, destroy() { if (mo) mo.disconnect(); if (pill.parentNode) pill.parentNode.removeChild(pill); node.classList.remove('ak-thumb'); } };
}

/**
 * Deal-in v2: the spring entrance, dealt one card after another on the look's stagger. Runs
 * once per element; the class comes off when the animation ends, so nothing is left armed.
 * @param {ArrayLike<Element>|Element|string} targets
 * @returns {number} how many were dealt
 */
export function deal(targets) {
  /** @type {HTMLElement[]} */
  let list;
  if (typeof targets === 'string') list = Array.prototype.slice.call(document.querySelectorAll(targets));
  else if (targets instanceof Element) list = [/** @type {HTMLElement} */ (targets)];
  else list = Array.prototype.slice.call(targets || []);
  if (reducedMotion()) return 0;
  list.forEach((node, i) => {
    node.style.setProperty('--ak-deal-i', String(i));
    node.classList.remove('ak-move--deal');
    void node.offsetWidth;
    node.classList.add('ak-move--deal');
    const done = () => { node.classList.remove('ak-move--deal'); node.style.removeProperty('--ak-deal-i'); node.removeEventListener('animationend', done); };
    node.addEventListener('animationend', done);
  });
  return list.length;
}
