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
 * @structure chart(spec) → { el, set, destroy }
 * @usage  AIMEAT.atelier.chart({ target: host, data: { labels: ['Jan','Feb'], series: [
 *           { id: 'in', label: 'Income', kind: 'bar', values: [1200, 1400] },
 *           { id: 'cash', label: 'Cash', kind: 'line', values: [300, 900] } ] } });
 * @version-history
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
 * @property {'bar'|'line'} [kind]
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
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: ChartData|null }) => void, destroy: () => void }}
 */
export function chart(spec) {
  const root = el('figure', {
    class: 'ak-root ak-chart' + (spec.presentation === 'mural' ? ' ak-chart--mural' : ''),
    role: 'img',
  });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  /** @param {ChartData|null|undefined} data */
  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
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
    const lines = series.filter((s) => s.kind === 'line');
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
