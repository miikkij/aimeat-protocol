/**
 * @file shared.js
 * @description Admin Dashboard shared UI helpers — the admin design system's own
 *   primitives (Badge, StatCard, StatsGrid, Spinner, Empty, ErrorBox, DataTable,
 *   ExpandableHelp, useToast/Toast, EconRow/HealthRow) + formatters. Admin is a
 *   self-contained design system (adm-* scoped); these are intentionally separate
 *   from the main /components primitives.
 * @version-history
 *   v1.1.0 — 2026-06-02 — i18n the Spinner/ErrorBox defaults (t('common.loading') /
 *     t('common.error')) — were hardcoded English (Rule 4/7.8).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { escHtml } from '/js/utils.js';
import { t } from '/js/i18n.js';

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

/**
 * Render a stat card.
 * @param {{ label: string, value: any, sub?: string, tone?: string, color?: string }} props
 *   tone — theme-aware modifier class (indigo|mint|green|cyan|amber|purple|blue|red). Preferred.
 *   color — legacy inline color (still honored if no tone); migrate callers to `tone`.
 */
export function StatCard({ label, value, sub, tone, color }) {
  const toneClass = tone ? ` ${tone}` : '';
  const style = !tone && color ? `color:${color}` : '';
  return html`<div class="adm-card">
    <h2>${label}</h2>
    <div class="adm-stat${toneClass}" style=${style}>${num(value)}</div>
    ${sub && html`<div class="adm-stat-label">${sub}</div>`}
  </div>`;
}

/** Render a stats grid (4-column) */
export function StatsGrid({ items }) {
  return html`<div class="adm-grid adm-grid-4">
    ${items.map(i => html`<${StatCard} label=${i.label} value=${i.value} sub=${i.sub} tone=${i.tone} color=${i.color} />`)}
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
  return html`<div class="empty"><div class="spinner"></div> ${text || t('common.loading')}</div>`;
}

/** Empty state */
export function Empty({ text }) {
  return html`<div class="empty">${text}</div>`;
}

/** Error box */
export function ErrorBox({ message }) {
  return html`<div class="error-box"><strong>${t('common.error')}</strong><br/>${escHtml(message)}</div>`;
}

/** Expandable/collapsible help section — reusable across all tabs and portal pages */
export function ExpandableHelp({ title, children }) {
  return html`<details class="adm-help">
    <summary class="adm-help-summary">${title}</summary>
    <div class="adm-help-body">${children}</div>
  </details>`;
}

/**
 * DataTable — renders rows with optional raw HTML cells.
 *
 * SECURITY: When a cell object has `_html: true`, `cell.text` is rendered
 * as raw HTML via dangerouslySetInnerHTML. Callers MUST ensure `cell.text`
 * is sanitized (use escHtml() for any user-generated content).
 * Only use `_html` for trusted, server-generated markup like badges.
 */
export function DataTable({ headers, rows, scroll }) {
  const table = html`<table>
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
  </table>`;
  return html`<div class="adm-card">
    ${scroll ? html`<div class="scrollable">${table}</div>` : table}
  </div>`;
}

/**
 * useToast — state hook for dismissible error/success messages.
 * Returns [message, showError, showSuccess, clear].
 * Usage:
 *   const [toast, showErr, showOk, clearToast] = useToast();
 *   // in catch: showErr(e.message);
 *   // in render: ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
 */
export function useToast() {
  const [msg, setMsg] = useState(null);
  const showError   = (text) => setMsg({ type: 'error',   text });
  const showSuccess = (text) => setMsg({ type: 'success', text });
  const clear       = ()     => setMsg(null);
  return [msg, showError, showSuccess, clear];
}

export function Toast({ type, text, onDismiss }) {
  return html`<div class="adm-toast adm-toast-${type}">
    <span>${text}</span>
    <button class="adm-toast-dismiss" onClick=${onDismiss}>\u00d7</button>
  </div>`;
}
