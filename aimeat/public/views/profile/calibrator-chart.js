/**
 * @file calibrator-chart.js
 * @description SVG multiline chart for calibration score tracking across batches.
 * @version-history
 *   v1.0.0 — 2026-03-29 — Extracted from calibrator-tab.js
 *   v2.0.0 — 2026-03-29 — Updated for batch data source
 */

import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

// ── Constants ──
const CHART_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

// ── Multiline Chart (SVG) ──
// Props: { batches, dimensions }
// batches: array from listBatches() — each has: batchId, createdAt, promptVersion,
//   status, modelCount, scores: [{ modelId, modelLabel, overallScore }]
// dimensions: array of dimension objects (for per-dimension view mode dropdown)

export default function CalibrationChart({ batches, dimensions }) {
  const [viewMode, setViewMode] = useState('overall');

  if (!batches || !batches.length) return null;

  // Derive versions from batches (sorted, deduplicated)
  const versionSet = new Set(batches.map(b => b.promptVersion));
  const versionNums = [...versionSet].sort((a, b) => a - b);

  if (!versionNums.length) return null;

  // Collect all unique modelIds across all batches' scores
  const modelIdSet = new Set();
  const modelLabels = {};
  for (const batch of batches) {
    for (const s of (batch.scores || [])) {
      modelIdSet.add(s.modelId);
      if (s.modelLabel) modelLabels[s.modelId] = s.modelLabel;
    }
  }
  const modelIds = [...modelIdSet];

  // Build one line per model
  const lines = modelIds.map((modelId, idx) => {
    const points = [];
    for (const v of versionNums) {
      // Find all batches at this version
      const batchesAtVersion = batches.filter(b => b.promptVersion === v);
      for (const batch of batchesAtVersion) {
        const scoreEntry = (batch.scores || []).find(s => s.modelId === modelId);
        if (!scoreEntry || scoreEntry.overallScore == null) continue;

        if (viewMode === 'overall') {
          points.push({ version: v, score: scoreEntry.overallScore });
        } else {
          // Per-dimension: find the dimension in this score entry
          const dim = (scoreEntry.dimensions || []).find(d => d.name === viewMode);
          if (dim) points.push({ version: v, score: dim.pass ? 100 : 0 });
        }
      }
    }
    return {
      modelId,
      label: modelLabels[modelId] || modelId,
      color: CHART_COLORS[idx % CHART_COLORS.length],
      points,
    };
  });

  const W = 600, H = 250, PAD = { top: 20, right: 20, bottom: 30, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const xRange = Math.max(1, versionNums[versionNums.length - 1] - versionNums[0]);
  const xScale = (v) => PAD.left + ((v - versionNums[0]) / xRange) * plotW;
  const yScale = (s) => PAD.top + plotH - (s / 100) * plotH;

  const svgLines = lines.map(line => {
    if (line.points.length === 0) return null;
    const pathD = line.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.version).toFixed(1)} ${yScale(p.score).toFixed(1)}`).join(' ');
    return { ...line, pathD };
  }).filter(Boolean);

  return html`
    <div class="fnd-cal-chart">
      <div class="fnd-cal-chart-header">
        <span class="fnd-cal-chart-title">${viewMode === 'overall' ? t('profile.calibrator.chartOverall') : viewMode}</span>
        <select value=${viewMode} onChange=${e => setViewMode(e.target.value)} style="font-size:0.8rem;padding:0.2rem 0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);">
          <option value="overall">${t('profile.calibrator.chartOverall')}</option>
          ${(dimensions || []).map(d => html`<option value=${d.name}>${d.name}</option>`)}
        </select>
      </div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;">
        ${[0, 25, 50, 75, 100].map(pct => html`
          <line x1=${PAD.left} y1=${yScale(pct)} x2=${W - PAD.right} y2=${yScale(pct)} stroke="var(--border)" stroke-width="0.5" />
          <text x=${PAD.left - 5} y=${yScale(pct) + 4} text-anchor="end" fill="var(--text-dim)" font-size="10">${pct}%</text>
        `)}
        ${versionNums.map(v => html`
          <text x=${xScale(v)} y=${H - 5} text-anchor="middle" fill="var(--text-dim)" font-size="10">v${v}</text>
        `)}
        ${svgLines.map(line => html`
          <path d=${line.pathD} fill="none" stroke=${line.color} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          ${line.points.map(p => html`
            <circle cx=${xScale(p.version)} cy=${yScale(p.score)} r="4" fill=${line.color} stroke="var(--card)" stroke-width="2">
              <title>${line.label}: ${p.score}% (v${p.version})</title>
            </circle>
          `)}
        `)}
      </svg>
      <div class="fnd-cal-chart-legend">
        ${svgLines.map(line => html`
          <div class="fnd-cal-chart-legend-item">
            <span class="fnd-cal-chart-legend-dot" style=${'background:' + line.color}></span>
            <span>${line.label}</span>
          </div>
        `)}
      </div>
    </div>
  `;
}
