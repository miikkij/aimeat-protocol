/**
 * @file atelier/chart-shapes.js
 * @description The chart family's non-axes shapes, on the shared core: the DONUT (parts of a
 *   whole, the total and its change in the middle), the CALENDAR heat wall (months named, the
 *   ramp explained), the SCATTER (points with an honest trend line), the FUNNEL (stages losing
 *   people, the survival rate written at each step), the TREEMAP (shares as area, squarified)
 *   and the FLOW (where the quantity went — ribbons as wide as their sums). chart.js
 *   dispatches here; the visual bar is the approved Näyteikkuna board.
 * @structure renderDonut · renderCalendar · renderScatter · renderFunnel · renderTreemap ·
 *   renderFlow — each (ctx, data)
 * @usage  import { renderDonut, renderCalendar, renderScatter, renderFunnel, renderTreemap,
 *   renderFlow } from './chart-shapes.js';
 * @version-history
 *   v0.36.0 — 2026-08-30 — Basket one of the approved expansion: funnel, treemap (own
 *     squarify, no library) and flow (own layered layout — ribbons cubic, node colour carries
 *     into its ribbons).
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

/** Stages losing people: { steps: [{ label, value }] } — the survival rate written per step. */
export function renderFunnel(ctx, data) {
  const steps = (data && Array.isArray(data.steps) ? data.steps : [])
    .filter((s) => s && typeof s.value === 'number' && s.value >= 0);
  if (!steps.length || steps[0].value <= 0) return ctx.empty();
  ctx.root.setAttribute('aria-label', (ctx.title ? ctx.title + ' — ' : '')
    + steps.map((s) => s.label + ' ' + s.value).join(', '));

  const W = 460;
  const STEP_H = 44;
  const GAP = 7;
  const BAND = 340; // widest band, centred; the right margin carries the survival rates
  const CX = 195;
  const H = steps.length * (STEP_H + GAP) - GAP + 8;
  const first = steps[0].value;
  const node = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ak-chart__svg', 'aria-hidden': 'true' });
  const still = ctx.still();
  const half = (v) => Math.max((v / first) * BAND, 18) / 2;
  steps.forEach((s, i) => {
    const y = 4 + i * (STEP_H + GAP);
    const topHalf = half(s.value);
    const nxt = steps[i + 1];
    // The band narrows TOWARD the next step, so the loss reads as the slope of this band.
    const botHalf = nxt ? half(nxt.value) : topHalf;
    const band = svg('path', {
      d: `M${CX - topHalf} ${y} L${CX + topHalf} ${y} L${CX + botHalf} ${y + STEP_H} L${CX - botHalf} ${y + STEP_H} Z`,
      class: 'ak-chart__funnelband',
    });
    band.style.fill = SERIES_VARS[i % SERIES_VARS.length];
    if (!still) { band.classList.add('ak-chart__band--enter'); band.style.animationDelay = `${i * 80}ms`; }
    node.appendChild(band);
    // One line per band — the halo keeps ink readable wherever the band's edge falls.
    const name = svg('text', { x: CX, y: y + STEP_H / 2 + 5, class: 'ak-chart__funnellabel', 'text-anchor': 'middle' });
    name.textContent = `${s.label} · ${fmtTick(s.value)}`;
    node.appendChild(name);
    const pct = svg('text', { x: W - 10, y: y + STEP_H / 2 + 5, class: 'ak-chart__funnelpct', 'text-anchor': 'end' });
    pct.textContent = Math.round((s.value / first) * 100) + ' %';
    node.appendChild(pct);
  });
  ctx.root.appendChild(node);
}

/** Squarify (Bruls): rows of items laid into the free rectangle, aspect ratios kept humane. */
function squarify(items, x, y, w, h) {
  const out = [];
  let rest = items.slice();
  while (rest.length) {
    const along = Math.min(w, h);
    let row = [rest[0]];
    let sum = rest[0].v;
    const total = rest.reduce((a, b) => a + b.v, 0);
    const worst = (r, s) => {
      const side = (s / total) * (w * h) / along;
      let bad = 0;
      for (const it of r) {
        const other = ((it.v / s) * along);
        bad = Math.max(bad, side / other, other / side);
      }
      return bad;
    };
    while (rest.length > row.length) {
      const cand = rest[row.length];
      if (worst(row.concat(cand), sum + cand.v) <= worst(row, sum)) { row.push(cand); sum += cand.v; }
      else break;
    }
    const side = (sum / total) * (w * h) / along;
    let run = 0;
    for (const it of row) {
      const span = (it.v / sum) * along;
      out.push(w <= h
        ? { it, x: x + run, y, w: span, h: side }
        : { it, x, y: y + run, w: side, h: span });
      run += span;
    }
    if (w <= h) { y += side; h -= side; } else { x += side; w -= side; }
    rest = rest.slice(row.length);
  }
  return out;
}

/** Shares as area: { items: [{ label, value }] } — when the donut's slices would not fit. */
export function renderTreemap(ctx, data) {
  const items = (data && Array.isArray(data.items) ? data.items : [])
    .filter((s) => s && typeof s.value === 'number' && s.value > 0)
    .sort((a, b) => b.value - a.value);
  if (!items.length) return ctx.empty();
  ctx.root.setAttribute('aria-label', (ctx.title ? ctx.title + ' — ' : '')
    + items.map((s) => s.label + ' ' + s.value).join(', '));
  const W = 560;
  const H = 320;
  const node = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ak-chart__svg', 'aria-hidden': 'true' });
  const cells = squarify(items.map((s, i) => ({ v: s.value, s, i })), 2, 2, W - 4, H - 4);
  const still = ctx.still();
  cells.forEach((c, n) => {
    const G = 2.5;
    const rect = svg('rect', {
      x: c.x + G, y: c.y + G, width: Math.max(c.w - G * 2, 1), height: Math.max(c.h - G * 2, 1), rx: 6,
      class: 'ak-chart__cell',
    });
    rect.style.fill = SERIES_VARS[c.it.i % SERIES_VARS.length];
    const cap = svg('title', {});
    cap.textContent = `${c.it.s.label} · ${fmtTick(c.it.s.value)}`;
    rect.appendChild(cap);
    if (!still) { rect.classList.add('ak-chart__band--enter'); rect.style.animationDelay = `${n * 45}ms`; }
    node.appendChild(rect);
    if (c.w > 86 && c.h > 44) {
      const name = svg('text', { x: c.x + 12, y: c.y + 24, class: 'ak-chart__cellname' });
      name.textContent = String(c.it.s.label);
      node.appendChild(name);
      const val = svg('text', { x: c.x + 12, y: c.y + 42, class: 'ak-chart__cellvalue' });
      val.textContent = fmtTick(c.it.s.value);
      node.appendChild(val);
    }
  });
  ctx.root.appendChild(node);
}

/** Where it went: { nodes: [{ id, label }], links: [{ from, to, value }] } — layered ribbons. */
export function renderFlow(ctx, data) {
  const nodes = (data && Array.isArray(data.nodes) ? data.nodes : []).filter((n) => n && n.id);
  const links = (data && Array.isArray(data.links) ? data.links : [])
    .filter((l) => l && l.from && l.to && typeof l.value === 'number' && l.value > 0);
  if (!nodes.length || !links.length) return ctx.empty();
  const byId = new Map(nodes.map((n) => [n.id, { n, in: 0, out: 0, depth: 0 }]));
  for (const l of links) {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b) continue;
    a.out += l.value;
    b.in += l.value;
  }
  // Depth: longest path from a source, settled by relaxation (cycles clamp at node count).
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const l of links) {
      const a = byId.get(l.from);
      const b = byId.get(l.to);
      if (a && b && b.depth < a.depth + 1 && a.depth + 1 < nodes.length) { b.depth = a.depth + 1; moved = true; }
    }
    if (!moved) break;
  }
  const maxDepth = Math.max(...[...byId.values()].map((m) => m.depth));
  ctx.root.setAttribute('aria-label', (ctx.title ? ctx.title + ' — ' : '') + nodes.map((n) => n.label || n.id).join(', '));

  const W = 560;
  const H = 320;
  const NODE_W = 12;
  const PAD_Y = 10;
  const cols = [];
  for (const m of byId.values()) (cols[m.depth] = cols[m.depth] || []).push(m);
  const scale = (H - PAD_Y * 2 - 8 * Math.max(...cols.map((c) => (c || []).length - 1), 0))
    / Math.max(...cols.map((c) => (c || []).reduce((a, m) => a + Math.max(m.in, m.out), 0)), 1e-9);
  const colX = (d) => 8 + (maxDepth ? (W - NODE_W - 16) * (d / maxDepth) : 0);
  const node = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ak-chart__svg', 'aria-hidden': 'true' });
  let colourIdx = 0;
  for (const col of cols) {
    if (!col) continue;
    col.sort((a, b) => Math.max(b.in, b.out) - Math.max(a.in, a.out));
    let y = PAD_Y;
    for (const m of col) {
      m.h = Math.max(Math.max(m.in, m.out) * scale, 4);
      m.x = colX(m.depth);
      m.y = y;
      m.colour = SERIES_VARS[colourIdx++ % SERIES_VARS.length];
      m.spentOut = 0;
      m.spentIn = 0;
      y += m.h + 8;
    }
  }
  // Ribbons first, so the node bars sit on top of their own colour.
  for (const l of links) {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b) continue;
    const th = l.value * scale;
    const y1 = a.y + a.spentOut + th / 2;
    const y2 = b.y + b.spentIn + th / 2;
    a.spentOut += th;
    b.spentIn += th;
    const x1 = a.x + NODE_W;
    const x2 = b.x;
    const mid = (x1 + x2) / 2;
    const ribbon = svg('path', {
      d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`,
      class: 'ak-chart__ribbon',
      'stroke-width': Math.max(th, 1.5),
    });
    ribbon.style.stroke = a.colour;
    node.appendChild(ribbon);
  }
  for (const m of byId.values()) {
    const bar = svg('rect', { x: m.x, y: m.y, width: NODE_W, height: m.h, rx: 4, class: 'ak-chart__flownode' });
    bar.style.fill = m.colour;
    node.appendChild(bar);
    const last = m.depth === maxDepth;
    const name = svg('text', {
      x: last ? m.x - 6 : m.x + NODE_W + 6,
      y: m.y + Math.min(m.h / 2 + 4, m.h + 2),
      class: 'ak-chart__flowlabel',
      'text-anchor': last ? 'end' : 'start',
    });
    name.textContent = `${m.n.label || m.n.id} · ${fmtTick(Math.max(m.in, m.out))}`;
    node.appendChild(name);
  }
  ctx.root.appendChild(node);
}
