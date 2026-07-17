/**
 * @file shared.js
 * @description Admin Dashboard shared UI helpers — the admin design system's own
 *   primitives (Badge, StatCard, StatsGrid, Spinner, Empty, ErrorBox, DataTable,
 *   ExpandableHelp, useToast/Toast, EconRow/HealthRow) + formatters. Admin is a
 *   self-contained design system (adm-* scoped); these are intentionally separate
 *   from the main /components primitives.
 * @version-history
 *   v1.2.0 — 2026-06-02 — Component unification (#13 tables): DataTable is now a
 *     thin wrapper that renders `.adm-card` around the canonical
 *     /components/DataTable.js (imported, not bare-re-exported). Admin keeps its
 *     card wrapper and unchanged appearance; the table body is shared.
 *   v1.1.0 — 2026-06-02 — i18n the Spinner/ErrorBox defaults (t('common.loading') /
 *     t('common.error')) — were hardcoded English (Rule 4/7.8).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { escHtml } from '/js/utils.js';
import { t } from '/js/i18n.js';
import { EmptyState } from '/components/EmptyState.js';
// Import (not bare re-export) so we hold a local binding to wrap below — a
// `export { DataTable } from ...` would NOT create a usable local reference.
import { DataTable as GenericDataTable } from '/components/DataTable.js';

// Display formatters now live in the shared /js/format.js. Import them into local
// scope (StatCard etc. call num() directly) AND re-export so the existing admin
// importers (`import { num, dt, fmtUp, fmtBytes } from './shared.js'`) keep working.
import { num, dt, fmtUp, fmtBytes } from '/js/format.js';
export { num, dt, fmtUp, fmtBytes };

/**
 * Render a badge. `type` picks the tone class (adm-badge-${type}); the visible
 * text is `label` when given, else the type word itself (so `<Badge type="public" />`
 * still reads "public"). Previously `label` was silently dropped — 13 call sites
 * that pass a human label + a semantic tone (e.g. type="success" label="Active")
 * showed the tone word instead of the label.
 */
export function Badge({ type, label }) {
  return html`<span class="adm-badge adm-badge-${type}">${label != null ? label : type}</span>`;
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

/** Empty state — delegates to the canonical /components/EmptyState.js. */
export function Empty({ text }) {
  return html`<${EmptyState} text=${text} />`;
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
 * DataTable (admin) — thin wrapper around the canonical
 * /components/DataTable.js that adds admin's `.adm-card` container. The 36
 * admin importers keep the same `{ headers, rows, scroll }` signature and the
 * same admin appearance (the `.adm table` / `.adm .scrollable` / `.adm .mono`
 * scoped CSS still wins over the generic `.data-table` inside `.adm`).
 *
 * SECURITY: cell objects with `_html: true` render `cell.text` as raw HTML;
 * callers MUST sanitize (escHtml()) any user-generated content. See the
 * generic DataTable for the full cell protocol.
 */
export function DataTable({ headers, rows, scroll }) {
  return html`<div class="adm-card">
    <${GenericDataTable} headers=${headers} rows=${rows} scroll=${scroll} />
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
