/**
 * @file shared.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Dashboard shared UI helpers — the admin design system's own
 *   primitives (Badge, StatCard, StatsGrid, Spinner, Empty, ErrorBox, DataTable,
 *   ExpandableHelp, useToast/Toast, EconRow/HealthRow) + formatters. Admin is a
 *   self-contained design system (adm-* scoped); these are intentionally separate
 *   from the main /components primitives.
 * @version-history
 *   v1.4.0 — 2026-09-12 — Row and when(): the metric row and the machine-readable stamp every
 *     operator page in the poster face uses, moved here from the Discovery page's own file when the
 *     Hooks page needed the same two.
 *   v1.3.0 — 2026-09-09 — Badge translates its type word when dashboard.badge<Type> exists
 *     (healthy, critical, watch, warning, info, pending, idle) and prints the type as before when
 *     it does not. "HEALTHY" was the one English word on the Finnish admin Prompts page.
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
import { num, dt, day, fmtUp, fmtBytes } from '/js/format.js';
export { num, dt, day, fmtUp, fmtBytes };

/**
 * "16 Mar", or "16 Mar 2025" once it is not this year.
 *
 * For a date column in a table: `dt()` writes the whole stamp ("3/16/2026, 10:25:19 AM"), which is
 * four times the width such a column has and says nothing a reader of a list needs at that
 * precision. The locale is the reader's own, the same reading `dt()` uses.
 */
export function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, thisYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * "2026-09-08 16:51" from an ISO stamp, as a machine reading; '' for none.
 *
 * Not `dt()`, which renders a date the way the reader's locale writes one. A stamp in a row of
 * operational facts is read beside a status code and a duration, and those are all machine
 * readings: sorting them by eye needs one shape whatever language the page is in.
 */
export function when(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 16).replace('T', ' ');
}

/**
 * One metric row in the poster face: the name and why it matters, a chip, and the value.
 *
 * The shape every operator page in this face uses under its status word (Overview, CORS, Discovery,
 * Hooks). Here rather than in one page's own file because the second copy of it was already being
 * written when this moved.
 * @param {{ title: any, why: any, chip?: any, value: any, last?: boolean }} props
 */
export function Row({ title, why, chip, value, last }) {
  return html`
    <div class="adm-mrow ${last ? 'adm-mrow--last' : ''}">
      <span><b>${title}</b><span class="adm-why">${why}</span></span>
      <span>${chip}</span>
      <span class="adm-mval">${value}</span>
    </div>`;
}

/**
 * Render a badge. `type` picks the tone class (adm-badge-${type}); the visible
 * text is `label` when given, else the type word itself (so `<Badge type="public" />`
 * still reads "public"). Previously `label` was silently dropped — 13 call sites
 * that pass a human label + a semantic tone (e.g. type="success" label="Active")
 * showed the tone word instead of the label.
 */
export function Badge({ type, label }) {
  // A badge with no label used to print its type word as it was ("healthy", "critical"), which is
  // the one English word on an otherwise translated page. The type is a CSS class, so it stays; the
  // text comes from dashboard.badge<Type> when a translation exists and is the type word otherwise
  // (a category or a visibility value that has no entry still reads as before).
  const key = `dashboard.badge${String(type).charAt(0).toUpperCase()}${String(type).slice(1)}`;
  const auto = t(key);
  return html`<span class="adm-badge adm-badge-${type}">${label != null ? label : (auto === key ? type : auto)}</span>`;
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
/** `open` starts it expanded — for a first-run explanation nobody would think to click. */
export function ExpandableHelp({ title, children, open }) {
  return html`<details class="adm-help" open=${open || null}>
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
