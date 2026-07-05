/**
 * @file UsageChart.js
 * @description Canonical Chart.js wrapper for Preact views. Lazily loads the vendored
 *   Chart.js (`/lib/chartjs@4.js`, global `window.Chart` — NOT a CDN, so it works under
 *   the app CSP), draws into a `<canvas>`, and destroys/rebuilds the chart when its data
 *   changes and on unmount. The `stacked` flag turns on stacked axes for per-app
 *   spend-over-time bars. Axis/grid/legend colors are dark-theme tokens.
 * @structure
 *   - UsageChart({ type, labels, datasets, stacked, height, legend, yFormat }) — the component
 *   - APP_PALETTE / colorForIndex(i) — stable, distinct data-series colors (cycled for N apps)
 *   - ensureChartJs() — one-shot vendored-script loader
 * @usage
 *   import { UsageChart, colorForIndex } from '/components/UsageChart.js';
 *   html`<${UsageChart} stacked labels=${days} datasets=${series} yFormat=${usd} />`
 * @version-history
 *   v1.0.0 — 2026-07-05 — Initial: shared chart primitive for the AI-spend charts
 *     (Generator panel, profile home card, admin AI Apps Usage tab).
 */
import { h } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

let chartJsPromise = null;
/** Load the vendored Chart.js UMD once; resolves to the global `Chart`. */
function ensureChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!chartJsPromise) {
    chartJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/lib/chartjs@4.js';
      s.onload = () => resolve(window.Chart);
      s.onerror = () => { chartJsPromise = null; reject(new Error('Chart.js failed to load')); };
      document.head.appendChild(s);
    });
  }
  return chartJsPromise;
}

// Distinct DATA-SERIES colors (not UI chrome) — Chart.js needs concrete strings and N apps
// can't map onto a few theme tokens. Follows the existing chart-color precedent in stats-tab.js.
export const APP_PALETTE = [
  '#E8564A', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4',
  '#ec4899', '#84cc16', '#eab308', '#14b8a6', '#f97316', '#a78bfa',
];
export const colorForIndex = (i) => APP_PALETTE[((i % APP_PALETTE.length) + APP_PALETTE.length) % APP_PALETTE.length];

const AXIS = '#94a3b8';
const GRID = 'rgba(148,163,184,0.15)';

/**
 * UsageChart — themed Chart.js canvas.
 * @param {{ type?: string, labels?: any[], datasets?: any[], stacked?: boolean,
 *   height?: number, legend?: boolean, yFormat?: (v:number)=>string }} props
 */
export function UsageChart({ type = 'bar', labels = [], datasets = [], stacked = false, height = 220, legend = true, yFormat }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  // Signature so the chart only rebuilds when the plotted data actually changes
  // (datasets/labels get fresh array identities on every parent render).
  const sig = JSON.stringify({
    type, stacked, legend, labels,
    datasets: datasets.map((d) => ({ l: d.label, d: d.data, c: d.backgroundColor })),
  });

  useEffect(() => {
    let cancelled = false;
    ensureChartJs().then((Chart) => {
      if (cancelled || !canvasRef.current) return;
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
      chartRef.current = new Chart(canvasRef.current, {
        type,
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: legend
              ? { labels: { color: AXIS, boxWidth: 12, font: { size: 11 } } }
              : { display: false },
            tooltip: yFormat
              ? { callbacks: { label: (c) => `${c.dataset.label}: ${yFormat(c.parsed.y)}` } }
              : {},
          },
          scales: {
            x: { stacked, ticks: { color: AXIS, maxRotation: 45, font: { size: 10 } }, grid: { color: GRID } },
            y: {
              stacked, beginAtZero: true,
              ticks: { color: AXIS, font: { size: 10 }, callback: yFormat ? (v) => yFormat(v) : undefined },
              grid: { color: GRID },
            },
          },
        },
      });
    }).catch(() => { /* chart unavailable — the canvas just stays blank */ });
    return () => {
      cancelled = true;
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, [sig, height]);

  return html`<div class="usage-chart" style="--usage-chart-h:${height}px"><canvas ref=${canvasRef}></canvas></div>`;
}
