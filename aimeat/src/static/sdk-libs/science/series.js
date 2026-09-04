/**
 * @file science/series.js
 * @description A reading over time as one line. Hand-drawn SVG on the Atelier kit's own tokens
 *   rather than a charting library, which is the kit's standing rule ("DATA-DRIVEN AND
 *   LIBRARY-FREE") and the reason a series here weighs nothing and wears whatever look the page is
 *   wearing. The axis maths is the same shape as the kit's chart-core: a step of 1, 2 or 5 times a
 *   power of ten, so the labels are numbers a person would have chosen.
 *
 *   IT TAKES ROWS, IT DOES NOT FETCH THEM. A history is whatever the caller read — a key holding an
 *   array of readings, a row space, the last hour a page has watched go by.
 * @structure seriesEl · rowsToPoints · tickStep
 * @usage
 *   import { seriesEl } from './series.js';
 *   el.append(seriesEl(rows, { label: 'Outside', unit: 'degC', window: '7d' }));
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (wish-tyokirja-tieteellinen-laskenta, stage 2).
 */

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  return node;
};
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};

const UNIT_WORDS = { degC: '°C', degF: '°F', degK: 'K', R: '°R', percent: '%' };
const unitWord = (unit) => (unit ? UNIT_WORDS[unit] || unit : '');

/** How far back a window reaches, in milliseconds. Anything unrecognised means "everything". */
export function windowMs(text) {
  const m = /^(\d+)\s*([hdw])$/.exec(String(text || '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'h' ? n * 3600e3 : m[2] === 'd' ? n * 86400e3 : n * 604800e3;
}

/**
 * Rows into points. A row may be a bare number, `[t, v]`, or a record with a time and a value under
 * the names a device tends to write — the same reading a live cell would take.
 * @param {Array} rows
 * @param {{ window?: string, now?: number }} [opts]
 */
export function rowsToPoints(rows, opts) {
  const o = opts || {};
  const list = Array.isArray(rows) ? rows : [];
  const points = [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    let t = null, v = null;
    if (typeof row === 'number') { t = i; v = row; }
    else if (Array.isArray(row) && row.length >= 2) { t = timeOf(row[0]) ?? i; v = Number(row[1]); }
    else if (row && typeof row === 'object') {
      t = timeOf(row.at ?? row.t ?? row.time ?? row.timestamp ?? row.occurred_at) ?? i;
      v = Number(row.value ?? row.reading ?? row.v ?? row.n ?? row.celsius ?? row.temp);
    }
    if (Number.isFinite(v)) points.push({ t: Number.isFinite(t) ? t : i, v });
  }
  points.sort((a, b) => a.t - b.t);
  const span = windowMs(o.window);
  if (span && points.length) {
    const now = Number.isFinite(o.now) ? o.now : points[points.length - 1].t;
    return points.filter(p => now - p.t <= span);
  }
  return points;
}

function timeOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** A step of 1, 2 or 5 times a power of ten — the kit's own rule, so the labels read as chosen. */
export function tickStep(span) {
  if (!(span > 0)) return 1;
  const raw = span / 4;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / power;
  const nice = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return nice * power;
}

/**
 * A reading over time.
 * @param {Array} rows the history
 * @param {{ label?: string, unit?: string|null, window?: string, height?: number, tone?: string }} [opts]
 */
export function seriesEl(rows, opts) {
  const o = opts || {};
  const points = rowsToPoints(rows, { window: o.window });
  const box = el('div', 'sci-series');
  if (o.label) box.append(el('span', 'sci-q-label', o.label));

  if (points.length < 2) {
    box.append(el('div', 'sci-q-empty', points.length ? 'one reading so far' : 'no readings yet'));
    return box;
  }

  const W = 320, H = Number.isFinite(o.height) ? o.height : 120;
  const padL = 40, padR = 8, padT = 8, padB = 18;
  const lo = Math.min(...points.map(p => p.v));
  const hi = Math.max(...points.map(p => p.v));
  const step = tickStep(hi - lo || Math.abs(hi) || 1);
  const floor = Math.floor(lo / step) * step;
  const ceil = Math.ceil(hi / step) * step;
  const span = ceil - floor || 1;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const tSpan = t1 - t0 || 1;
  const x = (t) => padL + ((t - t0) / tSpan) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - floor) / span) * (H - padT - padB);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'sci-series-svg', role: 'img',
    'aria-label': `${o.label || 'series'}: ${points.length} readings from ${fmt(floor)} to ${fmt(ceil)}`,
  });

  for (let v = floor; v <= ceil + 1e-9; v += step) {
    svg.append(svgEl('line', { x1: padL, y1: y(v), x2: W - padR, y2: y(v), stroke: 'var(--ak-line, var(--border, #E5E7EB))', 'stroke-width': 1 }));
    const label = svgEl('text', { x: padL - 6, y: y(v) + 3, 'text-anchor': 'end', class: 'sci-series-tick' });
    label.textContent = fmt(v);
    svg.append(label);
  }

  const d = points.map((p, i) => `${i ? 'L' : 'M'} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  svg.append(svgEl('path', {
    d, fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    stroke: o.tone || 'var(--ak-accent, var(--accent, #E8564A))',
  }));
  const last = points[points.length - 1];
  svg.append(svgEl('circle', { cx: x(last.t), cy: y(last.v), r: 3.5, fill: o.tone || 'var(--ak-accent, var(--accent, #E8564A))' }));

  box.append(svg);
  box.append(el('small', 'sci-series-foot', `${points.length} readings · latest ${fmt(last.v)}${o.unit ? ' ' + unitWord(o.unit) : ''}`));
  return box;

  function fmt(v) {
    const rounded = Number(v.toPrecision(6));
    return String(rounded);
  }
}
