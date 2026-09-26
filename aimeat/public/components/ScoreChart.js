/**
 * @file public/components/ScoreChart.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A chart of scores from 0 to 100 % over a row of rounds (a calibration's runs): one
 *   line per series, the oldest round on the left, the legend beside the plot with a square in the
 *   line's colour and the series' last score. Ink for the first series, coral for the second, sun
 *   for the third, the usage palette after that. A point says its series, score and round when the
 *   pointer rests on it. A page passes the rounds and the series as data; it never writes a class.
 *   The frame is the Object box (components/Box.js); the plot and the legend are
 *   css/components/score-chart.css (on a phone the legend stands under the plot).
 * @structure ScoreChart({ title, rounds, series }) · colorAt(i)
 * @usage html`<${ScoreChart} title=${x('chartTitle')}
 *          rounds=${[{ key: 'r1', label: 'Run 1', sub: 'v1' }, { key: 'r2', label: 'Run 2', sub: 'v2' }]}
 *          series=${[{ key: 'm', label: 'Mistral Small 3.2', values: [54, 82] }]} />`
 *   rounds: the x axis, oldest first: `label` in ink over `sub` in grey.
 *   series: `values` has one entry per round (null where the series has no score in that round).
 * @version-history
 *   v1.0.0 — 2026-09-26 — Moved out of views/profile/calibrator/chart.js v1.1.0 (the plot, the legend
 *     and their colours; the page keeps turning its runs into rounds and series), with its own class
 *     names in css/components/score-chart.css. The legend's colour square is drawn as an SVG square
 *     instead of an inline style.
 */
import { h } from 'preact';
import htm from 'htm';
import { colorForIndex } from '/components/UsageChart.js';
import { Box } from '/components/Box.js';

const html = htm.bind(h);

const INK = ['var(--text)', 'var(--accent)', 'var(--sun)'];
/** The colour of the i-th series: ink, coral, sun, then the usage palette. */
export const colorAt = (i) => (i < INK.length ? INK[i] : colorForIndex(i - INK.length));

const W = 640, H = 220;
const PAD = { top: 14, right: 16, bottom: 34, left: 40 };

/**
 * @param {{ title: string, rounds: Array<{ key: string, label: any, sub?: any }>,
 *   series: Array<{ key: string, label: string, values: Array<number|null|undefined> }> }} props
 */
export function ScoreChart({ title, rounds, series }) {
  const xs = rounds || [];
  if (!xs.length) return null;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xAt = (i) => PAD.left + (xs.length > 1 ? (i * plotW) / (xs.length - 1) : plotW / 2);
  const yAt = (v) => PAD.top + plotH - (v / 100) * plotH;

  const lines = (series || []).map((s, idx) => {
    const points = [];
    xs.forEach((r, i) => {
      const v = (s.values || [])[i];
      if (v !== null && v !== undefined) points.push({ x: xAt(i), y: yAt(v), v, round: r });
    });
    const last = points[points.length - 1];
    return { key: s.key, label: s.label, color: colorAt(idx), points, last: last ? last.v : null };
  }).filter((l) => l.points.length);
  if (!lines.length) return null;

  return html`
    <${Box}>
      <div class="score-chart">
        <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${title}>
          ${[0, 25, 50, 75, 100].map((p) => html`
            <line key=${'g' + p} x1=${PAD.left} y1=${yAt(p)} x2=${W - PAD.right} y2=${yAt(p)} stroke="var(--border)" stroke-width="1" />
            <text key=${'t' + p} x=${PAD.left - 6} y=${yAt(p) + 4} text-anchor="end" fill="var(--text-dim)" font-size="10" font-family="var(--font-mono)">${p} %</text>`)}
          ${xs.map((r, i) => html`
            <text key=${'x' + r.key} x=${xAt(i)} y=${H - 18} text-anchor="middle" fill="var(--text)" font-size="10" font-weight="800" font-family="var(--font-mono)">${r.label}</text>
            <text key=${'v' + r.key} x=${xAt(i)} y=${H - 6} text-anchor="middle" fill="var(--text-dim)" font-size="9" font-family="var(--font-mono)">${r.sub}</text>`)}
          ${lines.map((l) => html`
            ${l.points.length > 1 ? html`<polyline key=${'l' + l.key} fill="none" stroke=${l.color} stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points=${l.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} />` : null}
            ${l.points.map((p) => html`<circle key=${l.key + p.round.key} cx=${p.x} cy=${p.y} r="5" fill=${l.color} stroke="var(--card-bg)" stroke-width="2"><title>${l.label}: ${p.v} % (${p.round.label}, ${p.round.sub})</title></circle>`)}`)}
        </svg>
        <div class="score-chart-legend">
          <small>${title}</small>
          ${lines.map((l) => html`<div key=${l.key}><svg class="score-chart-swatch" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><rect width="10" height="10" fill=${l.color} /></svg><span>${l.label}</span><b>${l.last} %</b></div>`)}
        </div>
      </div>
    <//>`;
}

export default ScoreChart;
