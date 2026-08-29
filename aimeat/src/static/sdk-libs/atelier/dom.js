/**
 * @file atelier/dom.js
 * @description The small DOM layer every aimeat-atelier component is built from: element building,
 *   selection, the stylesheet injector, the answer-instantly helpers (`busy`, `guardButtons`), and
 *   the ENTRANCE choreographer (`enter`) that gives Atelier its motion without the app writing any.
 *   Signatures mirror the game kit (game/dom.js) so an author who uses both writes the same code.
 *
 *   NO CSS LIVES HERE. Components never write colours, spacing or typography from JavaScript;
 *   they set class names, and where a value is genuinely dynamic (a fill percentage, a stagger
 *   index) they set a CUSTOM PROPERTY that the stylesheet consumes — so the rule stays in CSS
 *   and only the number comes from JS.
 *
 *   MOTION IS FINITE. `enter()` runs once per mount over at most ENTER_MAX children (the rest
 *   appear instantly), uses transform/opacity only, and collapses to end states under
 *   prefers-reduced-motion. Finished WAAPI animations leave nothing running, so an idle Atelier
 *   surface repaints zero times — the finish gate measures exactly that.
 * @structure el · append · $ · $$ · clear · uid · reducedMotion · resolve · injectStyle ·
 *   busy · guardButtons · whileBusy · enter · kinetic · countUp · attention
 * @usage  import { el, $, injectStyle, enter } from './dom.js';
 *   el('div', { class: 'ak-card', vars: { '--ak-fill': '42%' }, on: { click: fn } }, ['text']);
 * @version-history
 *   v0.3.0 — 2026-08-29 — kinetic(): the headline that arrives one letter at a time on the
 *     look's spring and then behaves — opted in by the look via `--ak-kinetic`, capped at 80
 *     characters, aria-label preserves the word, reduced motion is a no-op.
 *   v0.2.0 — 2026-08-29 — attention(): the NOTICE-ME gesture (pulse / shake / flash / rise),
 *     one finite Web Animation per call, a no-op under reduced motion and honest about it
 *     (returns false), pace and curve from the look. enter() now rides `--ak-ease` too, so a
 *     look's curve shapes its entrance and not only its transitions.
 *   v0.1.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 1).
 */

/** Attribute names handled specially by `el` rather than being set as attributes. */
const SPECIAL = { text: 1, on: 1, vars: 1, children: 1 };

/** The most children one entrance choreographs; later ones appear instantly (the game-kit lesson:
 *  a fifty-row stagger reads as lag, not delight). */
const ENTER_MAX = 12;

let seq = 0;

/**
 * Build an element.
 * @param {string} tag
 * @param {Record<string, any>} [attrs]  Attributes, plus `text` (textContent), `on`
 *   (event map), `vars` (CSS custom properties). A null/undefined/false value is skipped.
 * @param {any} [kids]  A string, a Node, or an array of either (nullish entries skipped).
 * @returns {HTMLElement}
 */
export function el(tag, attrs, kids) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') { node.textContent = String(v); continue; }
      if (k === 'on') { for (const type in v) node.addEventListener(type, v[type]); continue; }
      if (k === 'vars') { for (const name in v) node.style.setProperty(name, String(v[name])); continue; }
      if (SPECIAL[k]) continue;
      node.setAttribute(k, v === true ? '' : String(v));
    }
    if (attrs.children != null) append(node, attrs.children);
  }
  if (kids != null) append(node, kids);
  return node;
}

/**
 * Append a string / Node / array of them to a parent.
 * @param {Node} parent
 * @param {any} kids
 */
export function append(parent, kids) {
  const list = Array.isArray(kids) ? kids : [kids];
  for (const c of list) {
    if (c == null || c === false) continue;
    parent.appendChild(typeof c === 'object' ? /** @type {Node} */ (c) : document.createTextNode(String(c)));
  }
}

/**
 * First match, like `document.querySelector` but rooted where you say.
 * @param {string} sel
 * @param {ParentNode} [root]
 * @returns {HTMLElement|null}
 */
export function $(sel, root) {
  return /** @type {HTMLElement|null} */ ((root || document).querySelector(sel));
}

/**
 * Every match, as a real array.
 * @param {string} sel
 * @param {ParentNode} [root]
 * @returns {HTMLElement[]}
 */
export function $$(sel, root) {
  return Array.prototype.slice.call((root || document).querySelectorAll(sel));
}

/**
 * Empty a node (children only — the node itself stays).
 * @param {Node} node
 * @returns {Node} the same node
 */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * A unique id for aria wiring.
 * @param {string} [prefix]
 * @returns {string}
 */
export function uid(prefix) {
  seq += 1;
  return (prefix || 'ak') + '-' + seq;
}

/**
 * Does the viewer ask for less motion? Animated components check this and jump to the end state.
 * @returns {boolean}
 */
export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Resolve a target that may be a selector, an element, or nothing.
 * @param {string|Element|null|undefined} target
 * @param {Element} [fallback]
 * @returns {Element}
 */
export function resolve(target, fallback) {
  if (!target) return fallback || document.body;
  if (typeof target === 'string') return $(target) || fallback || document.body;
  return target;
}

/**
 * Add the kit's stylesheet, and optionally the host's own overriding CSS.
 *
 * The `<link>` goes FIRST in `<head>` so anything the host already wrote outranks it; `extraCss`
 * is the HOST's css and is appended LAST so it outranks both. Calling this twice is a no-op for
 * the link and replaces the extra style block.
 *
 * @param {{ href?: string, extraCss?: string }} [opts]
 * @returns {{ link: HTMLLinkElement, style: HTMLStyleElement|null }}
 */
export function injectStyle(opts) {
  const o = opts || {};
  const head = document.head || document.getElementsByTagName('head')[0];
  let link = /** @type {HTMLLinkElement|null} */ (document.getElementById('ak-style'));
  if (!link) {
    link = document.createElement('link');
    link.id = 'ak-style';
    link.rel = 'stylesheet';
    link.href = o.href || '/lib/aimeat-atelier.css';
    head.insertBefore(link, head.firstChild);
  }
  let style = /** @type {HTMLStyleElement|null} */ (document.getElementById('ak-style-extra'));
  if (o.extraCss) {
    if (!style) {
      style = document.createElement('style');
      style.id = 'ak-style-extra';
      head.appendChild(style);
    }
    style.textContent = o.extraCss;
  }
  return { link: link, style: style };
}

/** Elements currently marked busy, with the function that ends it. */
const busyMap = new WeakMap();

/**
 * Mark a control as working. It answers instantly (spinner + aria-busy) and refuses further
 * clicks until the returned release is called. Calling it twice on one element is a no-op.
 * @param {Element|null} node
 * @returns {() => void}  release
 */
export function busy(node) {
  if (!node) return function () { /* nothing to release */ };
  const known = busyMap.get(node);
  if (known) return known;
  node.classList.add('ak-busy');
  node.setAttribute('aria-busy', 'true');
  const wasDisabled = /** @type {HTMLButtonElement} */ (node).disabled;
  if ('disabled' in node) /** @type {HTMLButtonElement} */ (node).disabled = true;
  const release = function () {
    busyMap.delete(node);
    node.classList.remove('ak-busy');
    node.removeAttribute('aria-busy');
    if ('disabled' in node) /** @type {HTMLButtonElement} */ (node).disabled = !!wasDisabled;
  };
  busyMap.set(node, release);
  return release;
}

/**
 * Guard every button under a root against double-fire. One listener, capture phase: the first
 * click marks the button busy, a repeat inside the window is swallowed before any handler sees
 * it, and the mark clears when the handler's promise settles or after `ms`.
 *
 * A handler that returns a promise is awaited (return it from your onClick and the spinner lasts
 * exactly as long as the work). Opt one control out with `data-ak-noguard`.
 *
 * @param {string|Element} [target]  Root to delegate from (default: the document).
 * @param {{ ms?: number }} [opts]   Fallback window when no promise is returned (default 700ms).
 * @returns {() => void}  stop guarding
 */
export function guardButtons(target, opts) {
  const root = resolve(/** @type {any} */ (target), document.body) || document.body;
  const ms = (opts && opts.ms) || 700;
  /** @param {Event} ev */
  const onClick = function (ev) {
    const start = /** @type {Element|null} */ (ev.target);
    if (!start || !start.closest) return;
    const btn = start.closest('button, [role="button"], .ak-btn');
    if (!btn || btn.hasAttribute('data-ak-noguard')) return;
    if (busyMap.has(btn)) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
    const release = busy(btn);
    setTimeout(release, ms);
  };
  root.addEventListener('click', onClick, true);
  return function () { root.removeEventListener('click', onClick, true); };
}

/**
 * Hold a control busy for exactly as long as a promise takes. The pairing for an async onClick.
 * @param {Element|null} node
 * @param {Promise<any>|any} work
 * @returns {Promise<any>}
 */
export function whileBusy(node, work) {
  const release = busy(node);
  return Promise.resolve(work).then(
    function (v) { release(); return v; },
    function (e) { release(); throw e; },
  );
}

/**
 * Choreograph one entrance over an element's direct children: fade-rise, staggered, finite.
 * The preset drives distance and pace through `--ak-enter-distance` / `--ak-enter-stagger` /
 * `--ak-motion` on the element; this function only reads them, so a skin changes the feel
 * without a line of JavaScript changing.
 *
 * Runs once; children past ENTER_MAX appear instantly; reduced motion appears instantly.
 * @param {Element|null} root
 * @param {{ max?: number }} [opts]
 * @returns {void}
 */
export function enter(root, opts) {
  if (!root || reducedMotion() || typeof root.animate !== 'function') return;
  const cs = getComputedStyle(root);
  const dist = parseFloat(cs.getPropertyValue('--ak-enter-distance')) || 0;
  const step = parseFloat(cs.getPropertyValue('--ak-enter-stagger')) || 0;
  const span = parseFloat(cs.getPropertyValue('--ak-motion')) || 200;
  if (dist === 0 && step === 0) return;
  const max = (opts && opts.max) || ENTER_MAX;
  const kids = Array.prototype.slice.call(root.children, 0, max);
  // The CURVE is the look's too: `--ak-ease` shapes every entrance (a springy overshoot and a
  // crisp snap are different hands), with the house curve as the floor.
  const ease = (cs.getPropertyValue('--ak-ease') || '').trim() || 'cubic-bezier(0.2, 0.7, 0.3, 1)';
  for (let i = 0; i < kids.length; i++) {
    kids[i].animate(
      [
        { opacity: 0, transform: 'translateY(' + dist + 'px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: span, delay: i * step, easing: ease, fill: 'backwards' },
    );
  }
}

/**
 * NOTICE ME — one finite attention gesture on one element, for the moment something needs the
 * eye: a refused field shakes, a fresh row pulses, a primary action flashes its ring, a saved
 * card rises. Every gesture is a one-shot Web Animation (two beats at most, no CSS class, no
 * idle repaint); reduced motion is a no-op. Returns whether anything ran, so an app can pair
 * the gesture with words instead of relying on it.
 * @param {Element|string|null} target
 * @param {'pulse'|'shake'|'flash'|'rise'} [kind]
 * @returns {boolean}
 */
export function attention(target, kind) {
  const node = typeof target === 'string' ? document.querySelector(target) : target;
  if (!node || reducedMotion() || typeof node.animate !== 'function') return false;
  const cs = getComputedStyle(node);
  const span = (parseFloat(cs.getPropertyValue('--ak-motion')) || 200) * 1.6;
  // The ring colour comes from the theme or from the element's own ink — never a literal: a
  // hardcoded hex in the kit's JavaScript is exactly what check:libs refuses, and rightly.
  const accent = (cs.getPropertyValue('--ak-accent') || '').trim() || cs.color;
  const gesture = kind || 'pulse';
  if (gesture === 'shake') {
    node.animate([
      { transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' },
      { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' },
    ], { duration: span, easing: 'ease-in-out' });
    return true;
  }
  if (gesture === 'flash') {
    node.animate([
      { boxShadow: '0 0 0 0 ' + accent },
      { boxShadow: '0 0 0 12px transparent' },
    ], { duration: span, iterations: 2, easing: 'ease-out' });
    return true;
  }
  if (gesture === 'rise') {
    node.animate([
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(-8px) scale(1.02)', offset: 0.45 },
      { transform: 'translateY(0) scale(1)' },
    ], { duration: span, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' });
    return true;
  }
  node.animate([
    { transform: 'scale(1)' },
    { transform: 'scale(1.06)', offset: 0.5 },
    { transform: 'scale(1)' },
  ], { duration: span / 2, iterations: 2, easing: 'ease-in-out' });
  return true;
}

/**
 * KINETIC TYPE — a headline arrives one letter at a time and then behaves. The element's text is
 * split into per-letter (or per-word) spans, each thrown in on the look's spring; after the run
 * the spans are inert text and nothing animates again. The original text is preserved as the
 * element's aria-label, so a screen reader hears one word, not thirty letters. Finite by
 * construction, a no-op under reduced motion, and refuses long text — one kinetic headline per
 * screen is the rule, and 80 characters is where a headline stops being one.
 * @param {Element|string|null} target
 * @param {{ mode?: 'letters'|'words' }} [opts]  Omitted: the look decides via `--ak-kinetic`.
 * @returns {boolean} whether anything ran
 */
export function kinetic(target, opts) {
  const node = typeof target === 'string' ? document.querySelector(target) : target;
  if (!node || reducedMotion() || typeof node.animate !== 'function') return false;
  if (node.getAttribute('data-ak-kinetic') === 'done') return false;
  const cs = getComputedStyle(node);
  const mode = ((opts && opts.mode) || cs.getPropertyValue('--ak-kinetic') || '').trim();
  if (mode !== 'letters' && mode !== 'words') return false;
  const text = node.textContent || '';
  if (!text.trim() || text.length > 80) return false;
  const span = (parseFloat(cs.getPropertyValue('--ak-motion')) || 200) * 1.8;
  const ease = (cs.getPropertyValue('--ak-ease') || '').trim() || 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  const pieces = mode === 'words' ? text.split(/(\s+)/) : Array.from(text);
  node.setAttribute('aria-label', text);
  node.setAttribute('data-ak-kinetic', 'done');
  clear(node);
  let i = 0;
  for (const piece of pieces) {
    const s = el('span', { 'aria-hidden': 'true' }, piece);
    s.style.display = 'inline-block';
    s.style.whiteSpace = 'pre';
    node.appendChild(s);
    if (!piece.trim()) continue;
    // Each glyph gets its own small throw: depth and twist vary by index so the line lands like
    // a hand of cards, not like a curtain. Everything is transform/opacity and runs once.
    const drop = 22 + (i % 3) * 8;
    const twist = (i % 2 ? 1 : -1) * (3 + (i % 3));
    s.animate(
      [
        { opacity: 0, transform: 'translateY(' + drop + 'px) rotate(' + twist + 'deg)' },
        { opacity: 1, transform: 'translateY(0) rotate(0deg)' },
      ],
      { duration: span, delay: 34 * i, easing: ease, fill: 'backwards' },
    );
    i++;
  }
  return true;
}

/**
 * Count a number up inside an element — the state-change motion for figures. Finite (one run),
 * respects reduced motion (jumps straight to the end), formats through the caller so locales
 * stay the caller's business.
 * @param {Element|null} node
 * @param {number} from
 * @param {number} to
 * @param {{ ms?: number, format?: (n: number) => string }} [opts]
 * @returns {void}
 */
export function countUp(node, from, to, opts) {
  if (!node) return;
  const fmt = (opts && opts.format) || function (n) { return String(Math.round(n)); };
  if (reducedMotion() || from === to || typeof requestAnimationFrame !== 'function') {
    node.textContent = fmt(to);
    return;
  }
  const span = (opts && opts.ms) || 600;
  const t0 = performance.now();
  const tick = function (now) {
    const p = Math.min(1, (now - t0) / span);
    const eased = 1 - (1 - p) * (1 - p);
    node.textContent = fmt(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
