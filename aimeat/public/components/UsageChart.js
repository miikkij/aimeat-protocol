/**
 * @file UsageChart.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Canonical Chart.js wrapper for Preact views. Lazily loads the vendored
 *   Chart.js (`/lib/chartjs@4.js`, global `window.Chart` — NOT a CDN, so it works under
 *   the app CSP), draws into a `<canvas>`, and destroys/rebuilds the chart when its data
 *   changes and on unmount. The `stacked` flag turns on stacked axes for per-app
 *   spend-over-time bars. The axis, grid and legend read the theme's tokens (--text-dim, --border,
 *   --font-mono) when the chart is drawn, and the chart redraws when the theme changes, so a theme
 *   reaches the charts like every other part. `type="spark"` is a small line with no axes or legend,
 *   for one figure's trend beside it; the tooltip still gives each day's reading.
 * @structure
 *   - UsageChart({ type, labels, datasets, stacked, height, legend, yFormat }) — the component
 *   - APP_PALETTE / colorForIndex(i) — stable, distinct data-series colors (cycled for N apps)
 *   - ensureChartJs() — one-shot vendored-script loader
 * @usage
 *   import { UsageChart, colorForIndex } from '/components/UsageChart.js';
 *   html`<${UsageChart} stacked labels=${days} datasets=${series} yFormat=${usd} />`
 * @version-history
 *   v1.1.0 — 2026-09-22 — The axis, grid and legend colours and the tick face come from the theme
 *     tokens instead of fixed slate values, and the chart redraws on a theme change. A series without
 *     a colour takes the coral token. New `type="spark"` for the admin Statistics sparklines.
 *   v1.0.0 — 2026-07-05 — Initial: shared chart primitive for the AI-spend charts
 *     (Generator panel, profile home card, admin AI Apps Usage tab).
 */
import { h } from 'preact';
import { useRef, useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { swallowed } from '/js/swallowed.js';
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

/** The chrome colours and face, read from the theme tokens at draw time (Chart.js needs strings). */
function themeInk() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
  return { axis: v('--text-dim', 'gray'), grid: v('--border', 'lightgray'), accent: v('--accent', 'tomato'), mono: v('--font-mono', 'monospace') };
}

/** A number that changes whenever the page's theme or palette changes, so a chart redraws in it. */
function useThemeVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => setVersion((n) => n + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });
    return () => obs.disconnect();
  }, []);
  return version;
}

/**
 * UsageChart — themed Chart.js canvas.
 * @param {{ type?: string, labels?: any[], datasets?: any[], stacked?: boolean,
 *   height?: number, legend?: boolean, yFormat?: (v:number)=>string }} props
 */
export function UsageChart({ type = 'bar', labels = [], datasets = [], stacked = false, height = 220, legend = true, yFormat }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const themeVersion = useThemeVersion();
  const spark = type === 'spark';

  // Signature so the chart only rebuilds when the plotted data actually changes
  // (datasets/labels get fresh array identities on every parent render).
  const sig = JSON.stringify({
    type, stacked, legend, labels, spark,
    datasets: datasets.map((d) => ({ l: d.label, d: d.data, c: d.backgroundColor })),
  });

  useEffect(() => {
    let cancelled = false;
    ensureChartJs().then((Chart) => {
      if (cancelled || !canvasRef.current) return;
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
      const ink = themeInk();
      const font = { family: ink.mono, size: 10 };
      // A series without its own colour takes the coral token.
      const series = datasets.map((d) => ({
        ...d,
        ...(d.backgroundColor || d.borderColor ? {} : { backgroundColor: ink.accent, borderColor: ink.accent }),
        ...(spark ? { pointRadius: 0, borderWidth: d.borderWidth || 2, tension: 0, fill: false } : {}),
      }));
      chartRef.current = new Chart(canvasRef.current, {
        type: spark ? 'line' : type,
        data: { labels, datasets: series },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: legend && !spark
              ? { labels: { color: ink.axis, boxWidth: 12, font: { ...font, size: 11 } } }
              : { display: false },
            tooltip: yFormat
              ? { callbacks: { label: (c) => `${c.dataset.label}: ${yFormat(c.parsed.y)}` } }
              : {},
          },
          scales: spark ? { x: { display: false }, y: { display: false, beginAtZero: true } } : {
            x: { stacked, ticks: { color: ink.axis, maxRotation: 45, font }, grid: { color: ink.grid } },
            y: {
              stacked, beginAtZero: true,
              ticks: { color: ink.axis, font, callback: yFormat ? (v) => yFormat(v) : undefined },
              grid: { color: ink.grid },
            },
          },
        },
      });
    }).catch(err => { swallowed('UsageChart: UsageChart', err); });
    return () => {
      cancelled = true;
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
    // `sig` is a JSON signature of the plotted data (type/stacked/legend/labels/
    // datasets); rebuild only when it or height changes. datasets/labels get fresh
    // identities every render and yFormat is display-only — listing them would
    // destroy/recreate the chart on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, height, themeVersion]);

  return html`<div class="usage-chart" style="--usage-chart-h:${height}px"><canvas ref=${canvasRef}></canvas></div>`;
}
