/**
 * Admin Dashboard — Shared UI helpers
 * Reusable utilities used across admin tab components.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { escHtml } from '/js/utils.js';

/** Format a number with locale */
export function num(n) {
  return typeof n === 'number' ? n.toLocaleString() : String(n ?? '\u2014');
}

/** Format a date string */
export function dt(s) {
  return s ? new Date(s).toLocaleString() : '\u2014';
}

/** Format uptime seconds to human-readable */
export function fmtUp(s) {
  const d = Math.floor(s / 86400);
  const hr = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (d ? d + 'd ' : '') + (hr ? hr + 'h ' : '') + (m ? m + 'm' : '<1m');
}

/** Format bytes to human-readable */
export function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

/** Render a badge */
export function Badge({ type }) {
  return html`<span class="adm-badge adm-badge-${type}">${type}</span>`;
}

/** Render a stat card */
export function StatCard({ label, value, sub, color }) {
  return html`<div class="adm-card">
    <h2>${label}</h2>
    <div class="adm-stat" style="color:${color || 'var(--accent, #06b6d4)'}">${num(value)}</div>
    ${sub && html`<div class="adm-stat-label">${sub}</div>`}
  </div>`;
}

/** Render a stats grid (4-column) */
export function StatsGrid({ items }) {
  return html`<div class="adm-grid adm-grid-4">
    ${items.map(i => html`<${StatCard} label=${i.label} value=${i.value} sub=${i.sub} color=${i.color} />`)}
  </div>`;
}

/** Render an economy-style key-value row */
export function EconRow({ label, value }) {
  return html`<div class="adm-erow">
    <span class="adm-elabel">${label}</span>
    <span class="adm-eval">${value}</span>
  </div>`;
}

/** Render a health-metric row */
export function HealthRow({ label, obj }) {
  return html`<div class="adm-hrow">
    <span class="adm-hmetric">${label}</span>
    <span><${Badge} type=${obj.zone} /> <span class="adm-hval">${obj.value}</span></span>
  </div>`;
}

/** Loading spinner */
export function Spinner({ text }) {
  return html`<div class="empty"><div class="spinner"></div> ${text || 'Loading...'}</div>`;
}

/** Empty state */
export function Empty({ text }) {
  return html`<div class="empty">${text}</div>`;
}

/** Error box */
export function ErrorBox({ message }) {
  return html`<div class="error-box"><strong>Error</strong><br/>${escHtml(message)}</div>`;
}

/** Expandable/collapsible help section — reusable across all tabs and portal pages */
export function ExpandableHelp({ title, children }) {
  return html`<details class="adm-help">
    <summary class="adm-help-summary">${title}</summary>
    <div class="adm-help-body">${children}</div>
  </details>`;
}

/** Simple data table */
export function DataTable({ headers, rows, scroll }) {
  return html`<div class="adm-card">
    ${scroll && html`<div class="scrollable">`}
    <table>
      <thead><tr>${headers.map(h => html`<th>${h}</th>`)}</tr></thead>
      <tbody>
        ${rows.map(row => html`<tr>
          ${row.map(cell => {
            if (cell && typeof cell === 'object' && cell._html) {
              return html`<td class=${cell.mono ? 'mono' : ''} title=${cell.title || ''}
                dangerouslySetInnerHTML=${{ __html: cell.text }}></td>`;
            }
            if (cell && typeof cell === 'object' && cell.mono) {
              return html`<td class="mono" title=${cell.title || ''}>${cell.text}</td>`;
            }
            return html`<td>${cell}</td>`;
          })}
        </tr>`)}
      </tbody>
    </table>
    ${scroll && html`</div>`}
  </div>`;
}
