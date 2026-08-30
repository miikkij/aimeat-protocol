/**
 * @file atelier/chart.js
 * @description The chart — the whole basic family, drawn properly (the Näyteikkuna canvas
 *   board is the acceptance bar): rounded bars with a sheen, GROUPED, STACKED and HORIZONTAL;
 *   smooth lines and soft-filled areas; a touch tooltip on every axes chart; an optional
 *   story bubble on the one point that matters; the legend in words. The donut, the calendar
 *   heat wall and the scatter live in chart-shapes.js on the same core.
 *
 *   DATA-DRIVEN AND LIBRARY-FREE: one SVG from the bound record, colours from the look's own
 *   accent spectrum, entrance finite and collapsed under reduced motion.
 *
 *   Shapes by `kind`:
 *     axes (default) { labels, series: [{ id, label, kind: 'bar'|'line'|'area', values }],
 *                      stacked?, horizontal?, note?: { label, text } }
 *     donut          { slices: [{ label, value }], delta?: { text, tone } }
 *     calendar       { days: [{ date: 'YYYY-MM-DD', value }] }
 *     scatter        { points: [{ x, y, label? }], xLabel?, yLabel? }
 *     funnel         { steps: [{ label, value }] }
 *     treemap        { items: [{ label, value }] }
 *     flow           { nodes: [{ id, label }], links: [{ from, to, value }] }
 * @structure chart(spec) → { el, set, destroy }
 * @usage  AIMEAT.atelier.chart({ target: host, data: { labels: ['Jan','Feb'], series: [
 *           { id: 'in', label: 'Income', kind: 'bar', values: [1200, 1400] },
 *           { id: 'cash', label: 'Cash', kind: 'line', values: [300, 900] } ] } });
 * @version-history
 *   v0.36.0 — 2026-08-30 — Basket one of the approved expansion: kinds funnel, treemap and
 *     flow join the dispatch (chart-shapes.js).
 *   v0.35.0 — 2026-08-29 — THE PROPER FAMILY (the developer's words: "kaikkea siistiä ja
 *     perusjutut ainakin ja kunnolla"): stacked + horizontal bars, smooth curves, area fills,
 *     tooltips, the note bubble, scatter — and the target-board visual level throughout.
 *   v0.33.0 — 2026-08-29 — kinds donut and calendar; area series.
 *   v0.19.0 — 2026-08-28 — Initial (the harvest: budjetti's chart shape becomes a component).
 */
import { el, clear, resolve, reducedMotion } from './dom.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';
import { svg, SERIES_VARS, tickStep, fmtTick, smoothPath, defsFor } from './chart-core.js';
import { renderDonut, renderCalendar, renderScatter, renderFunnel, renderTreemap, renderFlow } from './chart-shapes.js';

const W = 560;
const H = 300;
const PAD = { top: 16, right: 14, bottom: 34, left: 46 };

/**
 * The chart.
 * @param {{
 *   target?: string|Element, data?: object|null, title?: string,
 *   empty?: { title?: string, hint?: string },
 *   presentation?: 'tile'|'mural',
 *   kind?: 'axes'|'donut'|'calendar'|'scatter'|'funnel'|'treemap'|'flow',
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: object|null }) => void, destroy: () => void }}
 */
export function chart(spec) {
  const kind = ['donut', 'calendar', 'scatter', 'funnel', 'treemap', 'flow'].indexOf(spec.kind) >= 0 ? spec.kind : 'axes';
  const root = el('figure', {
    class: 'ak-root ak-chart' + (spec.presentation === 'mural' ? ' ak-chart--mural' : ''),
    role: 'img',
  });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  const ctx = {
    root: root,
    still: () => reducedMotion(),
    empty: () => {
      const e = spec.empty || {};
      emptyCard = emptyState({ target: root, tone: 'quiet', title: e.title || t('empty'), hint: e.hint || t('emptyHint') });
    },
    title: spec.title,
  };

  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    if (kind === 'donut') return renderDonut(ctx, data);
    if (kind === 'calendar') return renderCalendar(ctx, data);
    if (kind === 'scatter') return renderScatter(ctx, data);
    if (kind === 'funnel') return renderFunnel(ctx, data);
    if (kind === 'treemap') return renderTreemap(ctx, data);
    if (kind === 'flow') return renderFlow(ctx, data);
    renderAxes(data);
  }

  /** The axes chart: bars (grouped / stacked / horizontal), smooth lines, soft areas. */
  function renderAxes(data) {
    const labels = data && Array.isArray(data.labels) ? data.labels : [];
    const series = (data && Array.isArray(data.series) ? data.series : [])
      .filter((s) => s && Array.isArray(s.values) && s.values.length > 0);
    if (!labels.length || !series.length) return ctx.empty();
    const stacked = !!data.stacked;
    const horizontal = !!data.horizontal;
    root.setAttribute('aria-label', (spec.title ? spec.title + ' — ' : '') + series.map((s) => s.label).join(', '));

    const bars = series.filter((s) => (s.kind || 'bar') === 'bar');
    const lines = series.filter((s) => s.kind === 'line' || s.kind === 'area');

    // The scale covers every value (stacked: every stack total) and always includes zero.
    let min = 0;
    let max = 0;
    if (stacked && bars.length) {
      for (let i = 0; i < labels.length; i++) {
        let up = 0;
        let down = 0;
        for (const s of bars) { const v = s.values[i] || 0; if (v >= 0) up += v; else down += v; }
        if (up > max) max = up;
        if (down < min) min = down;
      }
      for (const s of lines) for (const v of s.values) { if (v < min) min = v; if (v > max) max = v; }
    } else {
      for (const s of series) for (const v of s.values) { if (v < min) min = v; if (v > max) max = v; }
    }
    if (max === min) max = min + 1;
    const step = tickStep(max - min);
    min = Math.floor(min / step) * step;
    max = Math.ceil(max / step) * step;

    // One geometry, two orientations: `along` runs the label axis, `cross` the value axis.
    const width = horizontal ? H : W;
    const height = horizontal ? W : H;
    const pad = horizontal
      ? { top: 14, right: 20, bottom: 16, left: 86 }
      : PAD;
    const innerAlong = (horizontal ? height - pad.top - pad.bottom : width - pad.left - pad.right);
    const innerCross = (horizontal ? width - pad.left - pad.right : height - pad.top - pad.bottom);
    const along = (i) => (horizontal ? pad.top : pad.left) + (innerAlong * i) / labels.length;
    const slot = innerAlong / labels.length;
    const cross = (v) => horizontal
      ? pad.left + innerCross * ((v - min) / (max - min))
      : pad.top + innerCross * (1 - (v - min) / (max - min));

    const node = svg('svg', { viewBox: `0 0 ${horizontal ? width : W} ${horizontal ? height : H}`, class: 'ak-chart__svg', 'aria-hidden': 'true' });
    const defs = defsFor(node, series.length);

    // Grid on the VALUE axis only — the soft ruling the board shows.
    for (let v = min; v <= max + step / 2; v += step) {
      const g = cross(v);
      node.appendChild(horizontal
        ? svg('line', { x1: g, x2: g, y1: pad.top, y2: height - pad.bottom, class: v === 0 ? 'ak-chart__zero' : 'ak-chart__grid' })
        : svg('line', { x1: pad.left, x2: width - pad.right, y1: g, y2: g, class: v === 0 ? 'ak-chart__zero' : 'ak-chart__grid' }));
      const tick = horizontal
        ? svg('text', { x: g, y: height - pad.bottom + 14, class: 'ak-chart__tick', 'text-anchor': 'middle' })
        : svg('text', { x: pad.left - 8, y: g + 4, class: 'ak-chart__tick', 'text-anchor': 'end' });
      tick.textContent = fmtTick(v);
      node.appendChild(tick);
    }
    labels.forEach((label, i) => {
      const tx = horizontal
        ? svg('text', { x: pad.left - 10, y: along(i) + slot / 2 + 4, class: 'ak-chart__tick', 'text-anchor': 'end' })
        : svg('text', { x: along(i) + slot / 2, y: height - pad.bottom + 18, class: 'ak-chart__tick', 'text-anchor': 'middle' });
      tx.textContent = String(label);
      node.appendChild(tx);
    });

    const still = ctx.still();

    // AREAS first (the soft ground), then bars, then lines on top.
    for (const s of series) {
      if (s.kind !== 'area' || horizontal) continue;
      const si = series.indexOf(s);
      const pts = s.values.slice(0, labels.length).map((v, i) => ({ x: along(i) + slot / 2, y: cross(v) }));
      const path = smoothPath(pts) + ` L ${pts[pts.length - 1].x} ${cross(0)} L ${pts[0].x} ${cross(0)} Z`;
      node.appendChild(svg('path', { d: path, class: 'ak-chart__area', fill: defs.fade(si) }));
    }

    // BARS: grouped side by side, or stacked into one column per label.
    const groupPad = slot * 0.16;
    const radius = Math.min(7, Math.max(3, (slot - groupPad * 2) / (stacked ? 1 : Math.max(bars.length, 1)) * 0.28));
    if (stacked) {
      const stackW = Math.max(slot - groupPad * 2, 2);
      for (let i = 0; i < labels.length; i++) {
        let acc = 0;
        bars.forEach((s, bi) => {
          const v = s.values[i] || 0;
          if (!v) return;
          const from = cross(acc);
          const to = cross(acc + v);
          acc += v;
          const topMost = bi === bars.length - 1;
          const rect = barRect(along(i) + groupPad, from, to, stackW, topMost ? radius : 0);
          rect.setAttribute('style', `fill:${SERIES_VARS[series.indexOf(s) % SERIES_VARS.length]}`);
          decorateBar(rect, i);
          node.appendChild(rect);
          if (topMost) node.appendChild(sheenOver(rect));
        });
      }
    } else {
      const barW = bars.length ? (slot - groupPad * 2) / bars.length : 0;
      bars.forEach((s, bi) => {
        const colour = SERIES_VARS[series.indexOf(s) % SERIES_VARS.length];
        s.values.slice(0, labels.length).forEach((v, i) => {
          const rect = barRect(along(i) + groupPad + bi * barW + 1, cross(0), cross(v), Math.max(barW - 2, 1), radius);
          rect.setAttribute('style', `fill:${colour}`);
          decorateBar(rect, i);
          node.appendChild(rect);
          node.appendChild(sheenOver(rect));
        });
      });
    }

    function barRect(alongPos, fromCross, toCross, thickness, r) {
      const lo = Math.min(fromCross, toCross);
      const span = Math.max(Math.abs(toCross - fromCross), 0.5);
      return horizontal
        ? svg('rect', { x: lo, y: alongPos, width: span, height: thickness, rx: r, class: 'ak-chart__bar' })
        : svg('rect', { x: alongPos, y: lo, width: thickness, height: span, rx: r, class: 'ak-chart__bar' });
    }
    function sheenOver(rect) {
      const s = /** @type {SVGRectElement} */ (rect.cloneNode(false));
      s.setAttribute('style', `fill:${defs.sheen}`);
      s.setAttribute('class', 'ak-chart__sheen');
      return s;
    }
    function decorateBar(rect, i) {
      if (!still) {
        rect.classList.add('ak-chart__bar--enter');
        rect.style.transformOrigin = horizontal ? `${cross(0)}px center` : `center ${cross(0)}px`;
        rect.style.animationDelay = `${i * 36}ms`;
      }
    }

    // LINES (and area edges) as smooth curves, the last point marked.
    for (const s of lines) {
      if (horizontal) continue; // lines belong to the vertical orientation
      const colour = SERIES_VARS[series.indexOf(s) % SERIES_VARS.length];
      const pts = s.values.slice(0, labels.length).map((v, i) => ({ x: along(i) + slot / 2, y: cross(v) }));
      const line = svg('path', { d: smoothPath(pts), class: 'ak-chart__line', style: `stroke:${colour}` });
      if (!still) line.classList.add('ak-chart__line--enter');
      node.appendChild(line);
      const last = pts[pts.length - 1];
      node.appendChild(svg('circle', { cx: last.x, cy: last.y, r: 5, class: 'ak-chart__dot', style: `stroke:${colour}` }));
    }

    root.appendChild(node);
    legendFor(series);
    if (!horizontal) wireTooltip(node, labels, series, along, slot);
    if (data.note && !horizontal) noteBubble(node, data.note, labels, along, slot);

    if (!still) {
      for (const line of node.querySelectorAll('.ak-chart__line--enter')) {
        const len = /** @type {SVGPathElement} */ (line).getTotalLength();
        line.setAttribute('stroke-dasharray', String(len));
        line.setAttribute('stroke-dashoffset', String(len));
        requestAnimationFrame(() => line.classList.add('ak-chart__line--drawn'));
      }
    }
  }

  /** The legend, in words: one chip per series in its colour. */
  function legendFor(series) {
    const legend = el('figcaption', { class: 'ak-chart__legend' },
      series.map((s) => el('span', { class: 'ak-chart__key' }, [
        el('span', { class: 'ak-chart__swatch' + (s.kind === 'line' || s.kind === 'area' ? ' ak-chart__swatch--line' : '') }),
        el('span', { text: s.label }),
      ])));
    series.forEach((s, i) => {
      const sw = legend.children[i] && legend.children[i].firstChild;
      if (sw) /** @type {HTMLElement} */ (sw).style.background = SERIES_VARS[i % SERIES_VARS.length];
    });
    root.appendChild(legend);
  }

  /** The touch tooltip: nearest label under the pointer, every series' value in its colour. */
  function wireTooltip(node, labels, series, along, slot) {
    const tip = el('div', { class: 'ak-chart__tip', hidden: true });
    root.appendChild(tip);
    node.addEventListener('pointermove', (ev) => {
      const box = node.getBoundingClientRect();
      const sx = (ev.clientX - box.left) * (W / box.width);
      const i = Math.max(0, Math.min(labels.length - 1, Math.floor((sx - along(0)) / slot)));
      clear(tip);
      tip.appendChild(el('div', { class: 'ak-chart__tip-label', text: String(labels[i]) }));
      series.forEach((s, si) => {
        const row = el('div', { class: 'ak-chart__tip-row' }, [
          el('span', { class: 'ak-chart__tip-swatch' }),
          el('span', { text: s.label }),
          el('b', { text: fmtTick(s.values[i] ?? 0) }),
        ]);
        /** @type {HTMLElement} */ (row.firstChild).style.background = SERIES_VARS[si % SERIES_VARS.length];
        tip.appendChild(row);
      });
      tip.hidden = false;
      const rootBox = root.getBoundingClientRect();
      const px = ((along(i) + slot / 2) / W) * box.width + (box.left - rootBox.left);
      tip.style.left = `${Math.max(8, Math.min(rootBox.width - tip.offsetWidth - 8, px - tip.offsetWidth / 2))}px`;
      tip.style.top = `${box.top - rootBox.top + 6}px`;
    });
    node.addEventListener('pointerleave', () => { tip.hidden = true; });
  }

  /** The story bubble: the one point the reader should not miss, said in words on the chart. */
  function noteBubble(node, note, labels, along, slot) {
    const i = labels.indexOf(note.label);
    if (i < 0 || !note.text) return;
    const bubble = el('div', { class: 'ak-chart__note' }, [
      el('span', { class: 'ak-chart__note-label', text: String(note.label) }),
      el('span', { text: String(note.text) }),
    ]);
    root.appendChild(bubble);
    requestAnimationFrame(() => {
      const box = node.getBoundingClientRect();
      const rootBox = root.getBoundingClientRect();
      const px = ((along(i) + slot / 2) / W) * box.width + (box.left - rootBox.left);
      bubble.style.left = `${Math.max(8, Math.min(rootBox.width - bubble.offsetWidth - 8, px - bubble.offsetWidth / 2))}px`;
      bubble.style.top = `${box.top - rootBox.top + 4}px`;
    });
  }

  render(spec.data);

  return {
    el: root,
    /** @param {{ data: object|null }} patch */
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
