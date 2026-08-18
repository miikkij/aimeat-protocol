/**
 * @file calibrator-chart.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SVG multiline chart for calibration score tracking across runs.
 *   X-axis = individual runs (sorted by date), Y-axis = score 0-100%.
 *   One line per model, data points per run.
 * @version-history
 *   v1.0.0 — 2026-03-29 — Extracted from calibrator-tab.js
 *   v2.0.0 — 2026-03-29 — Updated for batch data source
 *   v3.0.0 — 2026-03-30 — X-axis shows runs, not versions
 */

import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

const CHART_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export default function CalibrationChart({ batches, dimensions }) {
  const [viewMode, setViewMode] = useState('overall');

  if (!batches || !batches.length) return null;

  // Sort batches by createdAt ascending (oldest first = left side of chart)
  const sorted = [...batches]
    .filter(b => (b.scores || []).some(s => s.overallScore != null))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (!sorted.length) return null;

  // Collect all unique models
  const modelMap = new Map();
  for (const batch of sorted) {
    for (const s of (batch.scores || [])) {
      if (s.modelId && !modelMap.has(s.modelId)) modelMap.set(s.modelId, s.modelLabel || s.modelId);
    }
  }
  const modelIds = [...modelMap.keys()];
  if (!modelIds.length) return null;

  // Chart dimensions
  const W = 700, H = 280;
  const PAD = { top: 20, right: 20, bottom: 50, left: 45 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // X positions: one per run, evenly spaced
  const xStep = sorted.length > 1 ? plotW / (sorted.length - 1) : plotW / 2;
  const xPos = (runIndex) => PAD.left + (sorted.length > 1 ? runIndex * xStep : plotW / 2);
  const yScale = (s) => PAD.top + plotH - (s / 100) * plotH;

  // Build lines: one per model
  const lines = modelIds.map((modelId, idx) => {
    const points = [];
    sorted.forEach((batch, runIdx) => {
      const scoreEntry = (batch.scores || []).find(s => s.modelId === modelId);
      if (!scoreEntry || scoreEntry.overallScore == null) return;
      const score = viewMode === 'overall' ? scoreEntry.overallScore : scoreEntry.overallScore;
      points.push({
        x: xPos(runIdx),
        y: yScale(score),
        score,
        runIndex: runIdx,
        version: batch.promptVersion,
        batchId: batch.batchId,
      });
    });
    return {
      modelId,
      label: modelMap.get(modelId),
      color: CHART_COLORS[idx % CHART_COLORS.length],
      points,
    };
  }).filter(l => l.points.length > 0);

  if (!lines.length) return null;

  // Grid lines
  const gridPcts = [0, 25, 50, 75, 100];

  // X-axis labels: "Run #N (vX)" for each run
  const xLabels = sorted.map((b, i) => ({
    x: xPos(i),
    label: `#${sorted.length - i}`,
    sub: `v${b.promptVersion}`,
  }));

  return html`
    <div class="fnd-cal-chart">
      <div class="fnd-cal-chart-header">
        <span class="fnd-cal-chart-title">${viewMode === 'overall' ? t('profile.calibrator.chartOverall') : viewMode}</span>
        <select value=${viewMode} onChange=${e => setViewMode(e.target.value)}
          style="font-size:0.8rem;padding:0.2rem 0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);">
          <option value="overall">${t('profile.calibrator.chartOverall')}</option>
          ${(dimensions || []).map(d => html`<option value=${d.name}>${d.name}</option>`)}
        </select>
      </div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;">
        <!-- Grid lines -->
        ${gridPcts.map(pct => html`
          <line x1=${PAD.left} y1=${yScale(pct)} x2=${W - PAD.right} y2=${yScale(pct)}
            stroke="var(--border)" stroke-width="0.5" />
          <text x=${PAD.left - 5} y=${yScale(pct) + 4} text-anchor="end"
            fill="var(--text-dim)" font-size="10">${pct}%</text>
        `)}
        <!-- X-axis labels -->
        ${xLabels.map(lbl => html`
          <text x=${lbl.x} y=${H - 25} text-anchor="middle" fill="var(--text-dim)" font-size="9">${lbl.label}</text>
          <text x=${lbl.x} y=${H - 12} text-anchor="middle" fill="var(--text-dim)" font-size="8" font-style="italic">${lbl.sub}</text>
        `)}
        <!-- Lines + dots -->
        ${lines.map(line => html`
          ${line.points.length > 1 ? html`
            <polyline fill="none" stroke=${line.color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              points=${line.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} />
          ` : null}
          ${line.points.map(p => html`
            <circle cx=${p.x} cy=${p.y} r="5" fill=${line.color} stroke="var(--card)" stroke-width="2">
              <title>${line.label}: ${p.score}% (${xLabels[p.runIndex]?.label} ${xLabels[p.runIndex]?.sub})</title>
            </circle>
          `)}
        `)}
      </svg>
      <div class="fnd-cal-chart-legend">
        ${lines.map(line => html`
          <div class="fnd-cal-chart-legend-item">
            <span class="fnd-cal-chart-legend-dot" style=${'background:' + line.color}></span>
            <span>${line.label}</span>
          </div>
        `)}
      </div>
    </div>
  `;
}
