/**
 * @file atelier/chart-motion.js
 * @description The axes chart's two moves, kept out of chart.js so that file stays about shapes:
 *
 *     drawWhenSeen  the lines draw themselves from left to right when the chart first comes into
 *                   view (not when it was built, which may be far below the fold; at the latest
 *                   after 2.5 s, so a capture that never scrolls has them), the soft area
 *                   under a line fills in behind it, and the last point's dot arrives when the
 *                   line reaches it.
 *     hoverRig      the reading under the pointer: a vertical guide, a marker on every line and
 *                   the tooltip, all travelling to the nearest label on the look's spring instead
 *                   of jumping from label to label. The tooltip fades in and out.
 *
 *   Under reduced motion the lines are drawn at once and the reading jumps; nothing here runs at
 *   idle.
 * @structure drawWhenSeen(root, node) · hoverRig(root, node, geom) → { at, hide }
 * @version-history
 *   v0.55.0 — 2026-09-28 — Initial (the ten motion parts).
 */
import { motionOff } from './dom.js';
import { inView } from './motion.js';
import { liveSpring } from './springs.js';
import { svg } from './chart-core.js';

/** The latest a line waits to be seen before it draws anyway. */
const LATEST_DRAW = 2500;

/**
 * Hold the lines undrawn until the chart is seen, then draw them; areas and end dots follow.
 * @param {HTMLElement} root  the chart figure (what is watched for coming into view)
 * @param {SVGSVGElement} node  the chart's svg
 * @returns {void}
 */
export function drawWhenSeen(root, node) {
  const lines = Array.prototype.slice.call(node.querySelectorAll('.ak-chart__line'));
  const rest = Array.prototype.slice.call(node.querySelectorAll('.ak-chart__area, .ak-chart__dot'));
  if (motionOff(root) || !lines.length) return;
  lines.forEach(function (line) {
    const len = typeof line.getTotalLength === 'function' ? line.getTotalLength() : 0;
    if (!len) return;
    line.setAttribute('stroke-dasharray', String(len));
    line.setAttribute('stroke-dashoffset', String(len));
    line.classList.add('ak-chart__line--enter');
  });
  rest.forEach(function (n) { n.classList.add('ak-chart__late'); });
  let drawn = false;
  let late = null;
  let watch = null;
  const draw = function () {
    if (drawn) return;
    drawn = true;
    clearTimeout(late);
    if (watch) watch.destroy();
    // One frame after the undrawn state was painted, so the browser has a start to travel from.
    requestAnimationFrame(function () {
      lines.forEach(function (line) { line.classList.add('ak-chart__line--drawn'); });
      rest.forEach(function (n) { n.classList.add('ak-chart__late--in'); });
    });
  };
  watch = inView(root, draw);
  // A chart nobody scrolls to still gets its lines: a full-page capture, a print or the Design
  // Book's preview bench never scrolls, and a chart without lines there reads as broken.
  if (!drawn) late = setTimeout(draw, LATEST_DRAW);
}

/**
 * The spring-driven reading under the pointer.
 * @param {HTMLElement} root  the chart figure, which holds the tooltip
 * @param {SVGSVGElement} node  the chart's svg
 * @param {{ top: number, bottom: number, x: (i: number) => number,
 *   points: Array<{ colour: string, y: (i: number) => number }> }} geom
 *   All in the svg's own units: the guide's vertical extent, each label's x, each line's y.
 * @returns {{ at: (i: number, tip: HTMLElement, tipLeft: number) => void, hide: (tip: HTMLElement) => void }}
 */
export function hoverRig(root, node, geom) {
  const guide = svg('line', { x1: 0, x2: 0, y1: geom.top, y2: geom.bottom, class: 'ak-chart__guide' });
  node.appendChild(guide);
  const marks = geom.points.map(function (p) {
    const c = svg('circle', { cx: 0, cy: 0, r: 4.5, class: 'ak-chart__hover', style: 'stroke:' + p.colour });
    node.appendChild(c);
    return c;
  });
  const gx = liveSpring(function (x) {
    guide.setAttribute('x1', x.toFixed(2));
    guide.setAttribute('x2', x.toFixed(2));
    marks.forEach(function (m) { m.setAttribute('cx', x.toFixed(2)); });
  }, { el: root, precision: 0.05 });
  const gy = geom.points.map(function (_p, k) {
    return liveSpring(function (y) { marks[k].setAttribute('cy', y.toFixed(2)); }, { el: root, precision: 0.05 });
  });
  let tipSpring = null;
  let showing = false;
  let lastTip = null;
  return {
    at(i, tip, tipLeft) {
      if (!tipSpring || lastTip !== tip) {
        lastTip = tip;
        tipSpring = liveSpring(function (x) { tip.style.left = x.toFixed(1) + 'px'; }, { el: root, precision: 0.1 });
      }
      if (!showing) {
        // The reading appears where the pointer is; only a move between labels travels.
        gx.jump(geom.x(i));
        gy.forEach(function (s, k) { s.jump(geom.points[k].y(i)); });
        tipSpring.jump(tipLeft);
        showing = true;
        node.classList.add('ak-chart__svg--reading');
        tip.classList.add('ak-chart__tip--on');
        return;
      }
      gx.set(geom.x(i));
      gy.forEach(function (s, k) { s.set(geom.points[k].y(i)); });
      tipSpring.set(tipLeft);
    },
    hide(tip) {
      showing = false;
      node.classList.remove('ak-chart__svg--reading');
      tip.classList.remove('ak-chart__tip--on');
    },
  };
}
