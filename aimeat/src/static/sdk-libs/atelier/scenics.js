/**
 * @file atelier/scenics.js
 * @description THE SCENIC BUILDERS — the small hands behind scenics.css: split a string into
 *   flap cells, cut a word into ransom letters, draw a VU photograph of loudness, type a boot
 *   log once, run a finite deal-in over a set of props. Everything here is FINITE (WAAPI runs
 *   that end, a typing loop that stops) and everything defers colour to the stylesheet — no
 *   colour is ever written from this file.
 * @structure flapify · ransom · vu · typeout · dealIn
 * @usage
 *   AIMEAT.atelier.flapify(el)                       — every character becomes a flap cell
 *   AIMEAT.atelier.ransom(el)                        — every letter cut from a different sheet
 *   AIMEAT.atelier.vu(el, [62, 74, 118, …])          — bars drawn once, spring-grown
 *   AIMEAT.atelier.typeout(el, [['ok', '> ready.']]) — the boot log types itself once
 *   AIMEAT.atelier.dealIn('.ak-polaroid')            — a finite staggered entrance for props
 * @version-history
 *   v0.1.0 — 2026-08-29 — Initial: extracted from the approved genre probes.
 */
import { reducedMotion } from './dom.js';

/** The house spring, read from the element so a look's own curve wins. */
function easeOf(node) {
  const cs = getComputedStyle(node);
  return (cs.getPropertyValue('--ak-ease') || '').trim() || 'cubic-bezier(0.34, 1.56, 0.64, 1)';
}

/**
 * Split an element's text into split-flap cells and (unless reduced motion) flip the row
 * legible once, character by character — the way a hall sounds when the schedule turns.
 * @param {Element|string|null} target
 * @param {{ delay?: number }} [opts]  Base delay in ms before this row starts.
 * @returns {boolean} whether anything was built
 */
export function flapify(target, opts) {
  const node = typeof target === 'string' ? document.querySelector(target) : target;
  if (!node || node.getAttribute('data-ak-flapped') === 'done') return false;
  const text = node.textContent || '';
  if (!text.trim()) return false;
  node.setAttribute('data-ak-flapped', 'done');
  node.setAttribute('aria-label', text);
  node.textContent = '';
  const wrap = document.createElement('span');
  wrap.className = 'ak-flaps';
  wrap.setAttribute('aria-hidden', 'true');
  const base = (opts && opts.delay) || 0;
  let i = 0;
  for (const ch of text) {
    const f = document.createElement('span');
    f.className = 'ak-flap' + (ch === ' ' ? ' ak-flap--space' : '');
    f.textContent = ch;
    wrap.appendChild(f);
    if (!reducedMotion() && f.animate && ch !== ' ') {
      f.animate(
        [{ transform: 'rotateX(90deg)', opacity: 0.2 }, { transform: 'rotateX(0deg)', opacity: 1 }],
        { duration: 240, delay: base + i * 14, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' },
      );
    }
    i++;
  }
  node.appendChild(wrap);
  return true;
}

/**
 * Cut an element's text into ransom-note letters: each glyph pasted from a different sheet
 * (six rotating cuts, spaces left as breath). The word survives for screen readers.
 * @param {Element|string|null} target
 * @returns {boolean}
 */
export function ransom(target) {
  const node = typeof target === 'string' ? document.querySelector(target) : target;
  if (!node || node.getAttribute('data-ak-ransomed') === 'done') return false;
  const text = node.textContent || '';
  if (!text.trim()) return false;
  node.setAttribute('data-ak-ransomed', 'done');
  node.setAttribute('aria-label', text);
  node.classList.add('ak-ransom');
  node.textContent = '';
  const cuts = ['cut-a', 'cut-b', 'cut-c', 'cut-d', 'cut-e', 'cut-f'];
  let i = 0;
  for (const ch of text) {
    if (ch === ' ') { node.appendChild(document.createTextNode(' ')); continue; }
    const piece = document.createElement('i');
    piece.className = cuts[i % cuts.length];
    piece.textContent = ch;
    piece.setAttribute('aria-hidden', 'true');
    node.appendChild(piece);
    i++;
  }
  return true;
}

/**
 * Draw a VU photograph of loudness — bars grown once with a small spring, then still.
 * @param {Element|string|null} target
 * @param {number[]} values
 * @returns {boolean}
 */
export function vu(target, values) {
  const node = typeof target === 'string' ? document.querySelector(target) : target;
  if (!node || !Array.isArray(values) || !values.length) return false;
  node.classList.add('ak-vu');
  node.setAttribute('aria-hidden', 'true');
  node.textContent = '';
  const max = Math.max(...values, 1);
  values.forEach((v, i) => {
    const bar = document.createElement('i');
    bar.style.height = Math.round((v / max) * 100) + '%';
    node.appendChild(bar);
    if (!reducedMotion() && bar.animate) {
      bar.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
        { duration: 260, delay: i * 18, easing: easeOf(node), fill: 'backwards' });
    }
  });
  return true;
}

/**
 * Type a boot log ONCE — a finite entrance, then the console holds still. Reduced motion
 * prints it settled. Each line is [className, text].
 * @param {Element|string|null} target
 * @param {Array<[string, string]>} lines
 * @param {{ cps?: number }} [opts]  Characters per tick (default 3).
 * @returns {boolean}
 */
export function typeout(target, lines, opts) {
  const node = typeof target === 'string' ? document.querySelector(target) : target;
  if (!node || !Array.isArray(lines) || !lines.length) return false;
  const step = (opts && opts.cps) || 3;
  const reduced = reducedMotion();
  const typeLine = (li, ci) => {
    if (li >= lines.length) return;
    const row = node.children[li]
      || node.appendChild(Object.assign(document.createElement('div'), { className: lines[li][0] || '' }));
    const text = lines[li][1];
    if (reduced) { row.textContent = text; typeLine(li + 1, 0); return; }
    row.textContent = text.slice(0, ci);
    if (ci <= text.length) setTimeout(() => typeLine(li, ci + step), 12);
    else setTimeout(() => typeLine(li + 1, 0), 90);
  };
  typeLine(0, 0);
  return true;
}

/**
 * A finite deal-in for a set of props: each lands with the look's spring, staggered, ONCE.
 * The props' own resting transforms (a polaroid's tilt, a stamp's angle) survive.
 * @param {string|Element[]} targets  A selector or a list of elements.
 * @param {{ step?: number }} [opts]
 * @returns {number} how many were dealt
 */
export function dealIn(targets, opts) {
  const list = typeof targets === 'string'
    ? Array.from(document.querySelectorAll(targets)) : (targets || []);
  if (reducedMotion()) return 0;
  const step = (opts && opts.step) || 70;
  list.forEach((el, i) => {
    if (!el.animate) return;
    const rest = getComputedStyle(el).transform;
    const at = rest && rest !== 'none' ? rest + ' ' : '';
    el.animate(
      [{ opacity: 0, transform: at + 'translateY(24px) scale(0.96)' },
        { opacity: 1, transform: rest === 'none' ? 'none' : rest }],
      { duration: 380, delay: i * step, easing: easeOf(el), fill: 'backwards' },
    );
  });
  return list.length;
}
