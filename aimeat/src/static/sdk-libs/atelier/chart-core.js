/**
 * @file atelier/chart-core.js
 * @description The chart family's shared ground: the SVG helper, the series palette, tick
 *   math, number formatting, smooth-curve building and the one-per-svg gradient defs. Both
 *   chart.js (the block + axes) and chart-shapes.js (donut, calendar, scatter) draw from
 *   here, so every shape shares one visual language.
 * @structure svg() · uid counter · SERIES_VARS · tickStep/fmtTick · smoothPath() · defsFor()
 * @usage  import { svg, SERIES_VARS, tickStep, fmtTick, smoothPath, defsFor } from './chart-core.js';
 * @version-history
 *   v0.35.0 — 2026-08-29 — Extracted as the family grew to the approved target level (the
 *     Näyteikkuna canvas board is the acceptance bar).
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG element helper — el() writes HTML; charts need the SVG namespace. */
export function svg(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
  return node;
}

/** The series palette: the look's own accent spectrum, cycled. */
export const SERIES_VARS = ['var(--ak-accent)', 'var(--ak-spectrum-2)', 'var(--ak-spectrum-3)', 'var(--ak-accent-2)'];

/** A tidy tick step: 1/2/5 × a power of ten covering the range in 3-5 steps. */
export function tickStep(span) {
  const raw = span / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) { if (raw <= m * pow) return m * pow; }
  return 10 * pow;
}

export function fmtTick(v) {
  if (Math.abs(v) >= 1000) return (v / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'k';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * A smooth curve through the points (Catmull-Rom converted to cubic Béziers) — the soft line
 * the target board draws, instead of the ruler-and-elbows polyline.
 * @param {Array<{x:number,y:number}>} pts
 */
export function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x} ${p2.y}`;
  }
  return d;
}

let defsCounter = 0;

/**
 * The svg's <defs>, built once per chart: the SHEEN gradient every bar wears (its colour is the
 * --ak-chart-sheen token, declared in content.css, so it is legal on any series colour) and one
 * FADE gradient per series colour for area fills (the colour itself comes from the token var;
 * only opacity is authored here).
 * @param {SVGElement} node @param {number} seriesCount
 * @returns {{ sheen: string, fade: (i: number) => string }}
 */
export function defsFor(node, seriesCount) {
  const stamp = ++defsCounter;
  const defs = svg('defs', {});
  const sheenId = `ak-sheen-${stamp}`;
  const sheen = svg('linearGradient', { id: sheenId, x1: 0, y1: 0, x2: 0, y2: 1 });
  const s1 = svg('stop', { offset: '0', 'stop-opacity': '0.22' });
  s1.style.stopColor = 'var(--ak-chart-sheen)';
  const s2 = svg('stop', { offset: '1', 'stop-opacity': '0' });
  s2.style.stopColor = 'var(--ak-chart-sheen)';
  sheen.appendChild(s1);
  sheen.appendChild(s2);
  defs.appendChild(sheen);
  for (let i = 0; i < seriesCount; i++) {
    const fade = svg('linearGradient', { id: `ak-fade-${stamp}-${i}`, x1: 0, y1: 0, x2: 0, y2: 1 });
    const f1 = svg('stop', { offset: '0', 'stop-opacity': '0.20' });
    f1.style.stopColor = SERIES_VARS[i % SERIES_VARS.length];
    const f2 = svg('stop', { offset: '1', 'stop-opacity': '0' });
    f2.style.stopColor = SERIES_VARS[i % SERIES_VARS.length];
    fade.appendChild(f1);
    fade.appendChild(f2);
    defs.appendChild(fade);
  }
  node.appendChild(defs);
  return { sheen: `url(#${sheenId})`, fade: (i) => `url(#ak-fade-${stamp}-${i % SERIES_VARS.length})` };
}
