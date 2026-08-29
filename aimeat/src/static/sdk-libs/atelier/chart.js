/**
 * @file atelier/chart.js
 * @description The chart — grouped bars and drawn lines over one label axis, the shape every
 *   money and metrics view keeps asking for (costs, income and the cash curve was the first).
 *   DATA-DRIVEN AND LIBRARY-FREE: one SVG built from the bound record, colours from the look's
 *   own accent spectrum, entrance animated (bars grow, lines draw) and collapsed under
 *   reduced-motion. An app never hand-rolls axes, and the Book can carry chart-bearing
 *   arrangements because the chart is DATA the same way every other block is.
 *
 *   The bound source resolves to ONE record: { labels: string[], series: [{ id, label,
 *   kind: 'bar'|'line', values: number[] }] }. Negative values are legal (a cash curve dips);
 *   the zero line is drawn whenever the range crosses it.
 *   THREE SHAPES, ONE BLOCK (spec.kind): 'axes' (the default — bars, lines and areas over one
 *   label axis), 'donut' (parts of a whole: { slices: [{ label, value }] }, the total in the
 *   middle), 'calendar' (a year of days as a heat grid: { days: [{ date, value }] }, intensity
 *   riding the accent). The Book carries all three as data.
 * @structure chart(spec) → { el, set, destroy }
 * @usage  AIMEAT.atelier.chart({ target: host, data: { labels: ['Jan','Feb'], series: [
 *           { id: 'in', label: 'Income', kind: 'bar', values: [1200, 1400] },
 *           { id: 'cash', label: 'Cash', kind: 'line', values: [300, 900] } ] } });
 * @version-history
 *   v0.33.0 — 2026-08-29 — The chart family: spec.kind 'donut' and 'calendar' join 'axes', and
 *     an axes series may be kind 'area' (the line with its ground filled).
 *   v0.19.0 — 2026-08-28 — Initial (TARGET-074: the harvest — budjetti's chart shape becomes a
 *     kit component so the Design Book can carry it as data).
 */
import { el, clear, resolve, reducedMotion } from './dom.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';

/**
 * @typedef {object} ChartSeries
 * @property {string} id
 * @property {string} label
 * @property {'bar'|'line'|'area'} [kind]
 * @property {number[]} values
 */
/**
 * @typedef {object} ChartData
 * @property {string[]} labels
 * @property {ChartSeries[]} series
 */

const W = 720;
const H = 300;
const PAD = { top: 14, right: 12, bottom: 34, left: 46 };
/** The series palette: the look's own accent spectrum, cycled. */
const SERIES_VARS = ['var(--ak-accent)', 'var(--ak-spectrum-2)', 'var(--ak-spectrum-3)', 'var(--ak-accent-2)'];

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG element helper — el() writes HTML; the chart needs the SVG namespace. */
function svg(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
  return node;
}

/** A tidy tick step: 1/2/5 × a power of ten covering the range in 3-5 steps. */
function tickStep(span) {
  const raw = span / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) { if (raw <= m * pow) return m * pow; }
  return 10 * pow;
}

function fmtTick(v) {
  if (Math.abs(v) >= 1000) return (v / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'k';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * The chart.
 * @param {{
 *   target?: string|Element, data?: ChartData|null, title?: string,
 *   empty?: { title?: string, hint?: string },
 *   presentation?: 'tile'|'mural',
 *   kind?: 'axes'|'donut'|'calendar',
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: ChartData|null }) => void, destroy: () => void }}
 */
export function chart(spec) {
  const kind = spec.kind === 'donut' || spec.kind === 'calendar' ? spec.kind : 'axes';
  const root = el('figure', {
    class: 'ak-root ak-chart' + (spec.presentation === 'mural' ? ' ak-chart--mural' : ''),
    role: 'img',
  });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  function showEmpty() {
    const e = spec.empty || {};
    emptyCard = emptyState({ target: root, tone: 'quiet', title: e.title || t('empty'), hint: e.hint || t('emptyHint') });
  }

  /** @param {ChartData|null|undefined} data */
  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    if (kind === 'donut') return renderDonut(data);
    if (kind === 'calendar') return renderCalendar(data);
    const labels = data && Array.isArray(data.labels) ? data.labels : [];
    const series = (data && Array.isArray(data.series) ? data.series : [])
      .filter((s) => s && Array.isArray(s.values) && s.values.length > 0);
    if (!labels.length || !series.length) {
      const e = spec.empty || {};
      emptyCard = emptyState({ target: root, tone: 'quiet', title: e.title || t('empty'), hint: e.hint || t('emptyHint') });
      return;
    }
    root.setAttribute('aria-label', (spec.title ? spec.title + ' — ' : '')
      + series.map((s) => s.label).join(', '));

    // The scale covers every value and always includes zero, so bar heights read honestly.
    let min = 0;
    let max = 0;
    for (const s of series) for (const v of s.values) { if (v < min) min = v; if (v > max) max = v; }
    if (max === min) max = min + 1;
    const step = tickStep(max - min);
    min = Math.floor(min / step) * step;
    max = Math.ceil(max / step) * step;

    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i) => PAD.left + (innerW * i) / labels.length;
    const slotW = innerW / labels.length;
    const y = (v) => PAD.top + innerH * (1 - (v - min) / (max - min));

    const node = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ak-chart__svg', 'aria-hidden': 'true' });

    // Ticks and the grid, behind everything.
    for (let v = min; v <= max + step / 2; v += step) {
      const gy = y(v);
      node.appendChild(svg('line', { x1: PAD.left, x2: W - PAD.right, y1: gy, y2: gy, class: v === 0 ? 'ak-chart__zero' : 'ak-chart__grid' }));
      const tick = svg('text', { x: PAD.left - 6, y: gy + 4, class: 'ak-chart__tick', 'text-anchor': 'end' });
      tick.textContent = fmtTick(v);
      node.appendChild(tick);
    }
    labels.forEach((label, i) => {
      const tx = svg('text', { x: x(i) + slotW / 2, y: H - PAD.bottom + 18, class: 'ak-chart__tick', 'text-anchor': 'middle' });
      tx.textContent = String(label);
      node.appendChild(tx);
    });

    const still = reducedMotion();
    const bars = series.filter((s) => (s.kind || 'bar') === 'bar');
    const lines = series.filter((s) => s.kind === 'line' || s.kind === 'area');

    // Area grounds first, behind everything drawn on the same axis.
    for (const s of series) {
      if (s.kind !== 'area') continue;
      const colour = SERIES_VARS[series.indexOf(s) % SERIES_VARS.length];
      const pts = s.values.slice(0, labels.length).map((v, i) => `${x(i) + slotW / 2},${y(v)}`);
      const first = x(0) + slotW / 2;
      const last = x(Math.min(s.values.length, labels.length) - 1) + slotW / 2;
      const poly = svg('polygon', {
        points: `${first},${y(0)} ` + pts.join(' ') + ` ${last},${y(0)}`,
        class: 'ak-chart__area', style: `fill:${colour}`,
      });
      node.appendChild(poly);
    }
    const groupPad = slotW * 0.18;
    const barW = bars.length ? (slotW - groupPad * 2) / bars.length : 0;

    bars.forEach((s, si) => {
      const colour = SERIES_VARS[series.indexOf(s) % SERIES_VARS.length];
      s.values.slice(0, labels.length).forEach((v, i) => {
        const top = Math.min(y(v), y(0));
        const height = Math.abs(y(v) - y(0));
        const rect = svg('rect', {
          x: x(i) + groupPad + si * barW + 1, y: top, width: Math.max(barW - 2, 1), height: Math.max(height, 0.5),
          class: 'ak-chart__bar', style: `fill:${colour}`,
        });
        if (!still) {
          rect.setAttribute('style', `fill:${colour}; transform-origin: center ${y(0)}px; animation-delay: ${i * 40}ms`);
          rect.classList.add('ak-chart__bar--enter');
        }
        node.appendChild(rect);
      });
    });

    lines.forEach((s) => {
      const colour = SERIES_VARS[series.indexOf(s) % SERIES_VARS.length];
      const points = s.values.slice(0, labels.length).map((v, i) => `${x(i) + slotW / 2},${y(v)}`).join(' ');
      const line = svg('polyline', { points, class: 'ak-chart__line', style: `stroke:${colour}` });
      if (!still) line.classList.add('ak-chart__line--enter');
      node.appendChild(line);
    });

    root.appendChild(node);

    // The legend, in words: one chip per series in its colour.
    const legend = el('figcaption', { class: 'ak-chart__legend' },
      series.map((s) => el('span', { class: 'ak-chart__key' }, [
        el('span', { class: 'ak-chart__swatch' + (s.kind === 'line' ? ' ak-chart__swatch--line' : '') }),
        el('span', { text: s.label }),
      ])));
    series.forEach((s, i) => {
      const sw = legend.children[i] && legend.children[i].firstChild;
      if (sw) /** @type {HTMLElement} */ (sw).style.background = SERIES_VARS[i % SERIES_VARS.length];
    });
    root.appendChild(legend);

    // Measure the real line lengths now that the SVG is attached, so the draw starts true.
    if (!still) {
      for (const line of node.querySelectorAll('.ak-chart__line--enter')) {
        const len = /** @type {SVGPolylineElement} */ (line).getTotalLength();
        line.setAttribute('stroke-dasharray', String(len));
        line.setAttribute('stroke-dashoffset', String(len));
        requestAnimationFrame(() => line.classList.add('ak-chart__line--drawn'));
      }
    }
  }

  /** Parts of a whole: { slices: [{ label, value }] } — the total sits in the middle. */
  function renderDonut(data) {
    const slices = (data && Array.isArray(data.slices) ? data.slices : [])
      .filter((s) => s && typeof s.value === 'number' && s.value > 0);
    if (!slices.length) return showEmpty();
    const total = slices.reduce((sum, s) => sum + s.value, 0);
    root.setAttribute('aria-label', (spec.title ? spec.title + ' — ' : '')
      + slices.map((s) => s.label + ' ' + s.value).join(', '));

    const R2 = 84;
    const STROKE = 30;
    const C = 2 * Math.PI * R2;
    const node = svg('svg', { viewBox: '0 0 240 240', class: 'ak-chart__svg ak-chart__svg--donut', 'aria-hidden': 'true' });
    let offset = 0;
    slices.forEach((s, i) => {
      const frac = s.value / total;
      const ring = svg('circle', {
        cx: 120, cy: 120, r: R2, class: 'ak-chart__slice',
        style: `stroke:${SERIES_VARS[i % SERIES_VARS.length]}`,
        'stroke-width': STROKE,
        'stroke-dasharray': `${Math.max(frac * C - 3, 0.5)} ${C}`,
        'stroke-dashoffset': String(-offset * C),
        transform: 'rotate(-90 120 120)',
      });
      if (!reducedMotion()) { ring.classList.add('ak-chart__slice--enter'); ring.style.animationDelay = (i * 70) + 'ms'; }
      node.appendChild(ring);
      offset += frac;
    });
    const totalText = svg('text', { x: 120, y: 126, class: 'ak-chart__total', 'text-anchor': 'middle' });
    totalText.textContent = fmtTick(total);
    node.appendChild(totalText);
    root.appendChild(node);

    const legend = el('figcaption', { class: 'ak-chart__legend' },
      slices.map((s) => el('span', { class: 'ak-chart__key' }, [
        el('span', { class: 'ak-chart__swatch' }),
        el('span', { text: s.label + ' · ' + fmtTick(s.value) }),
      ])));
    slices.forEach((s, i) => {
      const sw = legend.children[i] && legend.children[i].firstChild;
      if (sw) /** @type {HTMLElement} */ (sw).style.background = SERIES_VARS[i % SERIES_VARS.length];
    });
    root.appendChild(legend);
  }

  /** A stretch of days as a heat grid: { days: [{ date: 'YYYY-MM-DD', value }] }. Weeks are
   *  columns, weekdays rows — the GitHub-calendar shape, intensity riding the accent. */
  function renderCalendar(data) {
    const days = (data && Array.isArray(data.days) ? data.days : [])
      .map((d) => ({ date: new Date(d.date), value: Number(d.value) || 0 }))
      .filter((d) => !isNaN(d.date.getTime()))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    if (!days.length) return showEmpty();
    const max = days.reduce((m, d) => Math.max(m, d.value), 0) || 1;
    const first = days[0].date;
    const start = new Date(first);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // back to Monday
    const spanDays = Math.round((days[days.length - 1].date.getTime() - start.getTime()) / 86400000) + 1;
    const weeks = Math.min(Math.ceil(spanDays / 7), 53);
    const CELL = 13;
    const GAP = 3;
    const width = weeks * (CELL + GAP) + GAP;
    const height = 7 * (CELL + GAP) + GAP;
    root.setAttribute('aria-label', (spec.title ? spec.title + ' — ' : '') + days.length + ' d');

    const byKey = new Map();
    for (const d of days) byKey.set(d.date.toISOString().slice(0, 10), d.value);
    const node = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'ak-chart__svg ak-chart__svg--calendar', 'aria-hidden': 'true' });
    const cursor = new Date(start);
    for (let w = 0; w < weeks; w++) {
      for (let dow = 0; dow < 7; dow++) {
        const key = cursor.toISOString().slice(0, 10);
        const value = byKey.get(key);
        const cell = svg('rect', {
          x: GAP + w * (CELL + GAP), y: GAP + dow * (CELL + GAP), width: CELL, height: CELL, rx: 3,
          class: 'ak-chart__day' + (value === undefined ? ' ak-chart__day--blank' : ''),
        });
        if (value !== undefined) {
          // Intensity as opacity over the accent: the ramp follows every palette for free.
          cell.setAttribute('style', 'fill: var(--ak-accent); fill-opacity: ' + (0.15 + 0.85 * (value / max)).toFixed(3));
        }
        node.appendChild(cell);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    root.appendChild(node);
  }

  render(spec.data);

  return {
    el: root,
    /** @param {{ data: ChartData|null }} patch */
    set(patch) {
      if (!patch) return;
      render(patch.data);
    },
    destroy() {
      if (emptyCard) emptyCard.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
