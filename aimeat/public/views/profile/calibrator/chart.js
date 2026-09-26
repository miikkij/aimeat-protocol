/**
 * @file public/views/profile/calibrator/chart.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The score chart of a calibration: its scored runs as the rounds of the library's
 *   Score chart (components/ScoreChart.js), oldest on the left, and one series per model with its
 *   score in each run. The chart itself (the plot, the colours, the legend) is the component's.
 * @structure ScoreChart
 * @usage import { ScoreChart } from './chart.js';
 * @version-history
 *   v2.0.0 — 2026-09-26 — The plot and the legend are the library's Score chart
 *     (components/ScoreChart.js); this file turns the runs into its rounds and series (component
 *     plan, special view).
 *   v1.1.0 — 2026-09-25 — A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.0.1 — 2026-09-04 — Legend labels through labelWords.
 *   v1.0.0 — 2026-09-04 — Initial (replaces calibrator-chart.js v3.0.0 in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { ScoreChart as Chart } from '/components/ScoreChart.js';
import { x, labelWords } from './frame.js';

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
  const rounds = scored.map((r) => ({ key: r.batchId, label: x('runN', { n: r.number }), sub: `v${r.promptVersion}` }));
  const series = ids.map((id) => ({
    key: id,
    label: labels.get(id),
    values: scored.map((r) => {
      const s = (r.scores || []).find((e) => e.modelId === id);
      return s && s.overallScore != null ? s.overallScore : null;
    }),
  }));
  return html`<${Chart} title=${x('chartTitle')} rounds=${rounds} series=${series} />`;
}
