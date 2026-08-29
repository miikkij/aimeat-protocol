/**
 * @file atelier/chart-shapes.js
 * @description The chart family's non-axes shapes, on the shared core: the DONUT (parts of a
 *   whole, the total and its change in the middle), the CALENDAR heat wall (months named, the
 *   ramp explained) and the SCATTER (points with an honest trend line). chart.js dispatches
 *   here; the visual bar is the approved Näyteikkuna board.
 * @structure renderDonut(ctx, data) · renderCalendar(ctx, data) · renderScatter(ctx, data)
 * @usage  import { renderDonut, renderCalendar, renderScatter } from './chart-shapes.js';
 * @version-history
 *   v0.35.0 — 2026-08-29 — Initial: donut v2 (rounded segments, HTML centre with delta),
 *     calendar v2 (month labels + ramp legend), scatter (new — points + least-squares trend).
 */
import { el } from './dom.js';
import { t } from './i18n.js';
import { svg, SERIES_VARS, tickStep, fmtTick } from './chart-core.js';

const TONES = { ok: 'var(--ak-ok-text)', warn: 'var(--ak-warn-text)', err: 'var(--ak-err-text)' };

/** Parts of a whole: { slices: [{ label, value }], delta?: { text, tone } }. */
export function renderDonut(ctx, data) {
  const slices = (data && Array.isArray(data.slices) ? data.slices : [])
    .filter((s) => s && typeof s.value === 'number' && s.value > 0);
  if (!slices.length) return ctx.empty();
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  ctx.root.setAttribute('aria-label', (ctx.title ? ctx.title + ' — ' : '')
    + slices.map((s) => s.label + ' ' + s.value).join(', '));

  const R = 88;
  const STROKE = 26;
  const C = 2 * Math.PI * R;
  const GAP = 4;
  const wrap = el('div', { class: 'ak-chart__donutwrap' });
  const node = svg('svg', { viewBox: '0 0 230 230', class: 'ak-chart__svg ak-chart__svg--donut', 'aria-hidden': 'true' });
  node.appendChild(svg('circle', { cx: 115, cy: 115, r: R, class: 'ak-chart__ring' , 'stroke-width': STROKE }));
  let offset = 0;
  slices.forEach((s, i) => {
    const frac = s.value / total;
    const ring = svg('circle', {
      cx: 115, cy: 115, r: R, class: 'ak-chart__slice',
      style: `stroke:${SERIES_VARS[i % SERIES_VARS.length]}`,
      'stroke-width': STROKE,
      'stroke-linecap': slices.length > 1 ? 'round' : 'butt',
      'stroke-dasharray': `${Math.max(frac * C - GAP, 0.5)} ${C}`,
      'stroke-dashoffset': String(-offset * C),
      transform: 'rotate(-90 115 115)',
    });
    if (!ctx.still()) { ring.classList.add('ak-chart__slice--enter'); ring.style.animationDelay = `${i * 70}ms`; }
    node.appendChild(ring);
    offset += frac;
  });
  wrap.appendChild(node);
  // The centre is HTML, not svg text: real typography, and the delta gets its tone.
  const centre = el('div', { class: 'ak-chart__centre' }, [
    el('b', { text: fmtTick(total) }),
    data.delta && data.delta.text
      ? el('span', { class: 'ak-chart__delta', text: String(data.delta.text) })
      : null,
  ]);
  if (data.delta && TONES[data.delta.tone]) {
    /** @type {HTMLElement} */ (centre.lastChild).style.color = TONES[data.delta.tone];
  }
  wrap.appendChild(centre);
  ctx.root.appendChild(wrap);

  const legend = el('figcaption', { class: 'ak-chart__legend' },
    slices.map((s) => el('span', { class: 'ak-chart__key' }, [
      el('span', { class: 'ak-chart__swatch' }),
      el('span', { text: `${s.label} · ${fmtTick(s.value)}` }),
    ])));
  slices.forEach((s, i) => {
    const sw = legend.children[i] && legend.children[i].firstChild;
    if (sw) /** @type {HTMLElement} */ (sw).style.background = SERIES_VARS[i % SERIES_VARS.length];
  });
  ctx.root.appendChild(legend);
}

/** Days as a heat wall: { days: [{ date, value }] } — months named, the ramp explained. */
export function renderCalendar(ctx, data) {
  const days = (data && Array.isArray(data.days) ? data.days : [])
    .map((d) => ({ date: new Date(d.date), value: Number(d.value) || 0 }))
    .filter((d) => !isNaN(d.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (!days.length) return ctx.empty();
  const max = days.reduce((m, d) => Math.max(m, d.value), 0) || 1;
  const start = new Date(days[0].date);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // back to Monday
  const spanDays = Math.round((days[days.length - 1].date.getTime() - start.getTime()) / 86400000) + 1;
  const weeks = Math.min(Math.ceil(spanDays / 7), 53);
  const CELL = 13;
  const GAP = 3;
  const width = weeks * (CELL + GAP) + GAP;
  const height = 7 * (CELL + GAP) + GAP + 16; // room for the month row
  ctx.root.setAttribute('aria-label', (ctx.title ? ctx.title + ' — ' : '') + days.length + ' d');

  const byKey = new Map();
  for (const d of days) byKey.set(d.date.toISOString().slice(0, 10), d.value);
  const node = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'ak-chart__svg ak-chart__svg--calendar', 'aria-hidden': 'true' });
  const cursor = new Date(start);
  const monthAt = []; // first week index of each month change
  for (let w = 0; w < weeks; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const key = cursor.toISOString().slice(0, 10);
      const value = byKey.get(key);
      if (cursor.getDate() === 1) monthAt.push({ w, m: cursor.getMonth() });
      const cell = svg('rect', {
        x: GAP + w * (CELL + GAP), y: GAP + dow * (CELL + GAP), width: CELL, height: CELL, rx: 3,
        class: 'ak-chart__day' + (value === undefined ? ' ak-chart__day--blank' : ''),
      });
      if (value !== undefined) {
        cell.setAttribute('style', `fill: var(--ak-accent); fill-opacity: ${(0.15 + 0.85 * (value / max)).toFixed(3)}`);
      }
      node.appendChild(cell);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  const MONTHS = [t('m1'), t('m2'), t('m3'), t('m4'), t('m5'), t('m6'), t('m7'), t('m8'), t('m9'), t('m10'), t('m11'), t('m12')];
  for (const mark of monthAt) {
    const label = svg('text', { x: GAP + mark.w * (CELL + GAP), y: height - 4, class: 'ak-chart__tick' });
    label.textContent = MONTHS[mark.m];
    node.appendChild(label);
  }
  ctx.root.appendChild(node);

  // The ramp, explained: four swatches from faint to full, with words on both ends.
  const ramp = el('figcaption', { class: 'ak-chart__ramp' }, [
    el('span', { text: t('heatLess') }),
    ...[0.15, 0.43, 0.71, 1].map((o) => {
      const sw = el('span', { class: 'ak-chart__rampcell' });
      sw.style.opacity = String(o);
      return sw;
    }),
    el('span', { text: t('heatMore') }),
  ]);
  ctx.root.appendChild(ramp);
}

/** Points on two value axes: { points: [{ x, y, label? }], xLabel?, yLabel? } + a trend line. */
export function renderScatter(ctx, data) {
  const points = (data && Array.isArray(data.points) ? data.points : [])
    .filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number');
  if (!points.length) return ctx.empty();
  ctx.root.setAttribute('aria-label', (ctx.title ? ctx.title + ' — ' : '') + points.length + ' pts');

  const W = 560;
  const H = 300;
  const PAD = { top: 16, right: 16, bottom: 36, left: 50 };
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of points) {
    if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
  }
  if (xMax === xMin) xMax = xMin + 1;
  if (yMax === yMin) yMax = yMin + 1;
  const xStep = tickStep(xMax - xMin);
  const yStep = tickStep(yMax - yMin);
  xMin = Math.floor(xMin / xStep) * xStep; xMax = Math.ceil(xMax / xStep) * xStep;
  yMin = Math.floor(yMin / yStep) * yStep; yMax = Math.ceil(yMax / yStep) * yStep;
  const X = (v) => PAD.left + (W - PAD.left - PAD.right) * ((v - xMin) / (xMax - xMin));
  const Y = (v) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - (v - yMin) / (yMax - yMin));

  const node = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ak-chart__svg', 'aria-hidden': 'true' });
  for (let v = yMin; v <= yMax + yStep / 2; v += yStep) {
    node.appendChild(svg('line', { x1: PAD.left, x2: W - PAD.right, y1: Y(v), y2: Y(v), class: 'ak-chart__grid' }));
    const tk = svg('text', { x: PAD.left - 8, y: Y(v) + 4, class: 'ak-chart__tick', 'text-anchor': 'end' });
    tk.textContent = fmtTick(v);
    node.appendChild(tk);
  }
  for (let v = xMin; v <= xMax + xStep / 2; v += xStep) {
    const tk = svg('text', { x: X(v), y: H - PAD.bottom + 16, class: 'ak-chart__tick', 'text-anchor': 'middle' });
    tk.textContent = fmtTick(v);
    node.appendChild(tk);
  }

  // The honest trend: least squares over the points, drawn quiet and dashed.
  if (points.length >= 3) {
    const n = points.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (const p of points) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; }
    const slope = (n * sxy - sx * sy) / Math.max(n * sxx - sx * sx, 1e-9);
    const icept = (sy - slope * sx) / n;
    node.appendChild(svg('line', {
      x1: X(xMin), y1: Y(slope * xMin + icept), x2: X(xMax), y2: Y(slope * xMax + icept),
      class: 'ak-chart__trend',
    }));
  }

  const still = ctx.still();
  points.forEach((p, i) => {
    const dot = svg('circle', { cx: X(p.x), cy: Y(p.y), r: 6, class: 'ak-chart__point' });
    if (p.label) {
      const cap = svg('title', {});
      cap.textContent = String(p.label);
      dot.appendChild(cap);
    }
    if (!still) { dot.classList.add('ak-chart__point--enter'); dot.style.animationDelay = `${i * 22}ms`; }
    node.appendChild(dot);
  });
  ctx.root.appendChild(node);

  if (data.xLabel || data.yLabel) {
    ctx.root.appendChild(el('figcaption', { class: 'ak-chart__legend' }, [
      data.xLabel ? el('span', { class: 'ak-chart__key', text: `x · ${data.xLabel}` }) : null,
      data.yLabel ? el('span', { class: 'ak-chart__key', text: `y · ${data.yLabel}` }) : null,
    ]));
  }
}
