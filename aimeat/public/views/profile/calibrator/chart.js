/**
 * @file public/views/profile/calibrator/chart.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The score chart of a calibration: one line per model over the scored runs, oldest
 *   on the left, 0 to 100 on the vertical. Ink for the first model, coral for the second, sun for
 *   the third, the usage palette after that; the legend sits beside the plot with a square in the
 *   line's colour.
 * @structure ScoreChart
 * @usage import { ScoreChart } from './chart.js';
 * @version-history
 *   v1.0.1 — 2026-09-04 — Legend labels through labelWords.
 *   v1.0.0 — 2026-09-04 — Initial (replaces calibrator-chart.js v3.0.0 in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { colorForIndex } from '/components/UsageChart.js';
import { x, labelWords } from './frame.js';

const INK = ['var(--text)', 'var(--accent)', 'var(--sun)'];
const colorAt = (i) => (i < INK.length ? INK[i] : colorForIndex(i - INK.length));

/**
 * @param {{ runs: Array<{ batchId: string, number: number, promptVersion: number, scores: Array<{ modelId: string, modelLabel: string, overallScore: number|null }> }> }} props
 *   The runs in order (see runsInOrder), only those with at least one score.
 */
export function ScoreChart({ runs }) {
  const scored = (runs || []).filter((r) => (r.scores || []).some((s) => s.overallScore != null));
  if (!scored.length) return null;
  const labels = new Map();
  for (const r of scored) for (const s of r.scores || []) if (s.modelId && !labels.has(s.modelId)) labels.set(s.modelId, labelWords(s.modelLabel) || s.modelId);
  const ids = [...labels.keys()];
  if (!ids.length) return null;

  const W = 640, H = 220;
  const PAD = { top: 14, right: 16, bottom: 34, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xAt = (i) => PAD.left + (scored.length > 1 ? (i * plotW) / (scored.length - 1) : plotW / 2);
  const yAt = (v) => PAD.top + plotH - (v / 100) * plotH;

  const lines = ids.map((id, idx) => {
    const points = [];
    scored.forEach((r, i) => {
      const s = (r.scores || []).find((e) => e.modelId === id);
      if (s && s.overallScore != null) points.push({ x: xAt(i), y: yAt(s.overallScore), v: s.overallScore, run: r });
    });
    const last = points[points.length - 1];
    return { id, label: labels.get(id), color: colorAt(idx), points, last: last ? last.v : null };
  }).filter((l) => l.points.length);

  return html`
    <div class="cal-chart">
      <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${x('chartTitle')}>
        ${[0, 25, 50, 75, 100].map((p) => html`
          <line key=${'g' + p} x1=${PAD.left} y1=${yAt(p)} x2=${W - PAD.right} y2=${yAt(p)} stroke="var(--border)" stroke-width="1" />
          <text key=${'t' + p} x=${PAD.left - 6} y=${yAt(p) + 4} text-anchor="end" fill="var(--text-dim)" font-size="10" font-family="var(--font-mono)">${p} %</text>`)}
        ${scored.map((r, i) => html`
          <text key=${'x' + r.batchId} x=${xAt(i)} y=${H - 18} text-anchor="middle" fill="var(--text)" font-size="10" font-weight="800" font-family="var(--font-mono)">${x('runN', { n: r.number })}</text>
          <text key=${'v' + r.batchId} x=${xAt(i)} y=${H - 6} text-anchor="middle" fill="var(--text-dim)" font-size="9" font-family="var(--font-mono)">v${r.promptVersion}</text>`)}
        ${lines.map((l) => html`
          ${l.points.length > 1 ? html`<polyline key=${'l' + l.id} fill="none" stroke=${l.color} stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points=${l.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} />` : null}
          ${l.points.map((p) => html`<circle key=${l.id + p.run.batchId} cx=${p.x} cy=${p.y} r="5" fill=${l.color} stroke="var(--card-bg)" stroke-width="2"><title>${l.label}: ${p.v} % (${x('runN', { n: p.run.number })}, v${p.run.promptVersion})</title></circle>`)}`)}
      </svg>
      <div class="cal-legend">
        <small>${x('chartTitle')}</small>
        ${lines.map((l) => html`<div key=${l.id}><i style=${`background:${l.color}`}></i><span>${l.label}</span><b>${l.last} %</b></div>`)}
      </div>
    </div>`;
}
