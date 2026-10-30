/**
 * @file atelier/ornament-text.js
 * @description THE TEXT FIGURES: ornaments that sit with words — flourishes either side of a
 *   heading, a swash under it, a drop cap whose box has a vine twining round it, a fleuron at the
 *   end of a section, a dinkus between parts, leaves as list bullets. INLINE figures for
 *   ornament.js. Each draws in its own fixed units and is sized by ornaments.css, so it scales with
 *   the type. The words are never moved out of the element: a drop cap's first letter stays in the
 *   text, set larger beside it, so a screen reader reads the word whole.
 * @structure TEXT_FIGURES = { flourish, swash, dropcap, fleuron, dinkus, bullets }
 * @usage  Reached through AIMEAT.atelier.ornament(el, 'flourish' | 'swash' | 'dropcap' | 'fleuron' | 'dinkus' | 'bullets').
 * @version-history
 *   v0.1.0 — 2026-10-29 — Initial: ported from the accepted ornament canvas.
 */
import { turtle, at, rrect, roundedRectPath, helix, helixLeaves } from './ornament-geo.js';
import { drawing } from './ornament-svg.js';

const PI = Math.PI;

/**
 * Nodes the figure owns, re-drawn on render and taken away on teardown.
 * @param {(animate: boolean) => void} render
 * @param {() => void} teardown
 */
function owned(render, teardown) { return { render, teardown }; }

/** A span the figure puts its drawing into. */
function slot(cls) {
  const s = document.createElement('span');
  s.className = cls;
  s.setAttribute('aria-hidden', 'true');
  return s;
}

/** The heading flourish, drawn for the right side; the left side is the same drawing mirrored. */
function flourishInto(d, leaves) {
  const t0 = 0.3;
  const m = turtle(8, 58, 0, 200, (u) => -0.004 + 0.3 * Math.pow(u, 5));
  const pa = at(m, 0.38);
  const b1 = turtle(pa.x, pa.y, pa.h + 0.9, 80, (u) => 0.012 + 0.3 * u * u * u);
  const pb = at(m, 0.15);
  const b2 = turtle(pb.x, pb.y, pb.h - 0.9, 55, (u) => -(0.012 + 0.34 * u * u * u));
  d.stroke(d.svg, m.d, 'ln', 1.8, m.len, t0, 1.8);
  d.stroke(d.svg, b2.d, 'ln', 1.2, b2.len, t0 + 0.3, 1.0);
  d.stroke(d.svg, b1.d, 'ln', 1.2, b1.len, t0 + 0.7, 1.3);
  if (leaves > 0) {
    const marks = [
      { t: m, u: 0.26, side: 1, s: 12, start: t0, dur: 1.8 },
      { t: m, u: 0.5, side: -1, s: 11, start: t0, dur: 1.8 },
      { t: m, u: 0.64, side: 1, s: 10, start: t0, dur: 1.8 },
      { t: b1, u: 0.3, side: -1, s: 9, start: t0 + 0.7, dur: 1.3 },
      { t: b2, u: 0.35, side: 1, s: 8, start: t0 + 0.3, dur: 1.0 },
    ];
    for (const mk of marks) {
      const q = at(mk.t, mk.u);
      d.leaf(d.svg, q.x, q.y, q.h + mk.side * 0.95, mk.s, mk.start + mk.dur * mk.u + 0.15);
    }
  }
  d.bead(d.svg, 8, 58, 3.4, 0.1);
  d.bead(d.svg, m.end.x, m.end.y, 2.6, t0 + 1.8);
  d.bead(d.svg, b1.end.x, b1.end.y, 2, t0 + 2.0);
  d.bead(d.svg, b2.end.x, b2.end.y, 2, t0 + 1.3);
}

function mountFlourish(host, p, opts) {
  const left = slot('ak-orn-flourish ak-orn-flourish--left');
  const right = slot('ak-orn-flourish ak-orn-flourish--right');
  host.classList.add('ak-orn-flourished');
  host.insertBefore(left, host.firstChild);
  host.appendChild(right);
  return owned((animate) => {
    for (const s of [left, right]) {
      s.textContent = '';
      flourishInto(drawing(s, 200, 110, { animate, speed: opts.speed, delay: opts.delay, viewBox: true }), p.leaves);
    }
  }, () => { left.remove(); right.remove(); host.classList.remove('ak-orn-flourished'); });
}

function mountSwash(host, p, opts) {
  const s = slot('ak-orn-swash');
  host.appendChild(s);
  return owned((animate) => {
    s.textContent = '';
    const d = drawing(s, 300, 72, { animate, speed: opts.speed, delay: opts.delay, viewBox: true });
    const sc = turtle(20, 26, PI + 0.1, 40, (u) => 0.3 * u * u);
    const sm = turtle(20, 26, -0.1, 270, (u) => 0.0007 + 0.25 * Math.pow(u, 9));
    d.stroke(d.svg, sc.d, 'ln', 1.2, sc.len, 0.5, 0.5);
    d.stroke(d.svg, sm.d, 'ln', 1.6, sm.len, 0.6, 1.6);
    if (p.leaves > 0) { const q = at(sm, 0.55); d.leaf(d.svg, q.x, q.y, q.h - 0.9, 9, 1.4); }
    d.bead(d.svg, sm.end.x, sm.end.y, 2, 2.2);
  }, () => s.remove());
}

/** The first letter that is a letter, in the first text node that has one. */
function firstLetter(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue || '';
    const i = text.search(/\S/);
    if (i >= 0) return { node: /** @type {Text} */ (n), index: i };
  }
  return null;
}

function mountDropcap(host, p, opts) {
  const found = firstLetter(host);
  if (!found) return owned(() => {}, () => {});
  const { node, index } = found;
  const text = node.nodeValue || '';
  const letter = Array.from(text.slice(index))[0] || '';
  const cap = document.createElement('span');
  cap.className = 'ak-orn-cap';
  const art = slot('ak-orn-cap__art');
  const glyph = document.createElement('span');
  glyph.className = 'ak-orn-cap__letter';
  glyph.textContent = letter;
  cap.appendChild(art);
  cap.appendChild(glyph);
  node.nodeValue = text.slice(index + letter.length);
  const pre = text.slice(0, index);
  node.parentNode.insertBefore(cap, node);
  const preNode = pre ? node.parentNode.insertBefore(document.createTextNode(pre), cap) : null;
  return owned((animate) => {
    art.textContent = '';
    const d = drawing(art, 124, 124, { animate, speed: opts.speed, delay: opts.delay, viewBox: true });
    const box = rrect(8, 8, 108, 108, 10);
    const per = box.L / Math.round(box.L / 34);
    d.fade(d.stroke(d.svg, roundedRectPath(14, 14, 96, 96, 5), 'dim', 0.8), 1.4);
    const back = d.group(d.svg);
    d.stroke(d.svg, roundedRectPath(8, 8, 108, 108, 10), 'ln', 2, 420, 0.4, 1.2);
    const front = d.group(d.svg);
    d.chain(back, front, helix(box.at, box.L, 5, per, 0, 1.5), box.L, 1.0, 3.0, [['gap', 4], ['vine', 1.4]], ['vback', 1]);
    if (p.leaves > 0) {
      for (const q of helixLeaves(box.at, box.L, 5, per, 0, { size: 6.5, alpha: 0.9, every: p.leaves > 1.5 ? 1 : 2 })) {
        d.leaf(front, q.x, q.y, q.ang, q.size, 1.0 + 3.0 * q.s / box.L + 0.1);
      }
    }
    if (animate) d.fade(glyph, 0.6);
  }, () => {
    node.nodeValue = text;
    cap.remove();
    if (preNode) preNode.remove();
  });
}

/** A leaf standing between two mirrored curls, beads below: the end of a section. */
function mountFleuron(host, p, opts) {
  const s = slot('ak-orn-fleuron');
  host.appendChild(s);
  return owned((animate) => {
    s.textContent = '';
    const d = drawing(s, 160, 64, { animate, speed: opts.speed, delay: opts.delay, viewBox: true });
    for (const sx of [1, -1]) {
      const c = turtle(80 + sx * 4, 38, sx > 0 ? 0.3 : PI - 0.3, 70, (u) => -sx * (0.01 + 0.34 * u * u * u));
      d.stroke(d.svg, c.d, 'ln', 1.4, c.len, 0.3, 1.3);
      if (p.leaves > 0) { const q = at(c, 0.35); d.leaf(d.svg, q.x, q.y, q.h + sx * 0.95, 10, 0.8); }
      d.bead(d.svg, c.end.x, c.end.y, 1.8, 1.6);
      d.bead(d.svg, 80 + sx * 14, 52, 1.6, 0.5);
    }
    d.leaf(d.svg, 80, 34, -PI / 2, 22, 0.2);
    d.bead(d.svg, 80, 44, 2.4, 0.1);
  }, () => s.remove());
}

/** A rosette with a leaf either way and fine rules: a pause between parts. */
function mountDinkus(host, _p, opts) {
  const s = slot('ak-orn-dinkus');
  host.appendChild(s);
  return owned((animate) => {
    s.textContent = '';
    const d = drawing(s, 200, 24, { animate, speed: opts.speed, delay: opts.delay, viewBox: true });
    d.stroke(d.svg, 'M20 12H64M136 12H180', 'dim', 0.8, 120, 0.2, 0.8);
    d.leaf(d.svg, 108, 12, 0, 14, 0.3);
    d.leaf(d.svg, 92, 12, PI, 14, 0.3);
    d.bead(d.svg, 100, 12, 3.2, 0.2);
    d.bead(d.svg, 128, 12, 1.6, 0.5);
    d.bead(d.svg, 72, 12, 1.6, 0.5);
  }, () => s.remove());
}

/** A leaf before each item of a list, opening one after another. */
function mountBullets(host, _p, opts) {
  host.classList.add('ak-orn-bullets');
  /** @type {HTMLElement[]} */
  const marks = [];
  return owned((animate) => {
    for (const m of marks) m.remove();
    marks.length = 0;
    Array.from(host.children).forEach((li, i) => {
      if (li.tagName !== 'LI') return;
      const m = slot('ak-orn-bullet');
      li.insertBefore(m, li.firstChild);
      marks.push(m);
      const d = drawing(m, 18, 18, { animate, speed: opts.speed, delay: opts.delay + i * 0.12, viewBox: true });
      d.leaf(d.svg, 3, 15, -PI / 4, 16, 0, 0.36);
    });
  }, () => { for (const m of marks) m.remove(); host.classList.remove('ak-orn-bullets'); });
}

/** @type {Record<string, import('./ornament.js').InlineFigure>} */
export const TEXT_FIGURES = {
  flourish: { params: ['leaves'], mount: mountFlourish },
  swash: { params: ['leaves'], mount: mountSwash },
  dropcap: { params: ['leaves'], mount: mountDropcap },
  fleuron: { params: ['leaves'], mount: mountFleuron },
  dinkus: { params: [], mount: mountDinkus },
  bullets: { params: [], mount: mountBullets },
};
