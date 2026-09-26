/**
 * @file public/components/SeriesBars.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A short series of numbers as a strip of bars, drawn inline as SVG with no chart
 *   library (a living document's aggregate section: the data points a person added). One bar per
 *   point, the highest at the strip's full height, the lowest (or zero) at its foot; each bar says
 *   its label and value as its tooltip. It stands under the heavy rule of a section part (poster.css
 *   .poster-row--thing). A page passes the points and never a class. The look is
 *   css/components/series-bars.css (the bars in the accent colour, the space around the strip).
 * @structure SeriesBars({ series, height })
 * @usage html`<${SeriesBars} series=${[{ label: 'May', value: 12 }, { label: 'June', value: 18 }]} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Moved out of views/profile/living-tab.js (renderChart, the aggregate
 *     section's bars) with its drawing unchanged, so the page writes no class (page group G4; a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const WIDTH = 280;

/**
 * @param {{ series: Array<{ label: any, value: number }>, height?: number }} props
 *   `height`: the strip's height in pixels (56 by default); the width is the column's.
 */
export function SeriesBars({ series, height = 56 }) {
  if (!series || !series.length) return null;
  const n = series.length;
  const max = Math.max(...series.map((d) => d.value), 1);
  const min = Math.min(...series.map((d) => d.value), 0);
  const range = (max - min) || 1;
  const bw = WIDTH / n;
  return html`<svg class="series-bars poster-row--thing" viewBox="0 0 ${WIDTH} ${height}" width="100%" height=${height} preserveAspectRatio="none">
    ${series.map((d, i) => {
      const bar = ((d.value - min) / range) * (height - 8) + 4;
      return html`<rect key=${i} x=${i * bw + 1} y=${height - bar} width=${Math.max(1, bw - 2)} height=${bar}><title>${d.label}: ${d.value}</title></rect>`;
    })}
  </svg>`;
}

export default SeriesBars;
