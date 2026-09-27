/**
 * @file shared.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Dashboard shared helpers: the formatters, and the few parts every operator page
 *   calls by the names it always had (Row, Badge, StatsGrid, Spinner, Empty, ErrorBox, DataTable,
 *   ExpandableHelp, useToast/Toast). Each part draws a library component and writes no class: the
 *   admin pages take the shared components' look (Jouni, 2026-09-22), and only the operator menu
 *   keeps the admin's own.
 * @version-history
 *   v2.0.0 — 2026-09-27 — The parts draw library components: Row is the Reading, Badge the status
 *     Mark (the type word keeps its tone by meaning: fine, attention, danger, off), StatsGrid the
 *     FigureStrip, Spinner the loading Note, ErrorBox the ErrorNote, DataTable the canonical table
 *     under the heavy rule, ExpandableHelp the Collapsible, Toast the Alert, EconRow a Reading without
 *     a mark. StatCard and HealthRow go: nothing called them any more.
 *   v1.5.0 -- 2026-09-13 -- Stable toast callbacks keep consumer read effects from restarting.
 *   v1.4.0 — 2026-09-12 — Row and when(): the metric row and the machine-readable stamp every
 *     operator page in the poster face uses, moved here from the Discovery page's own file when the
 *     Hooks page needed the same two.
 *   v1.3.0 — 2026-09-09 — Badge translates its type word when dashboard.badge<Type> exists
 *     (healthy, critical, watch, warning, info, pending, idle) and prints the type as before when
 *     it does not. "HEALTHY" was the one English word on the Finnish admin Prompts page.
 *   v1.2.0 — 2026-06-02 — Component unification (#13 tables): DataTable is now a
 *     thin wrapper around the canonical /components/DataTable.js.
 *   v1.1.0 — 2026-06-02 — i18n the Spinner/ErrorBox defaults (t('common.loading') /
 *     t('common.error')) — were hardcoded English (Rule 4/7.8).
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { EmptyState } from '/components/EmptyState.js';
import { DataTable as GenericDataTable } from '/components/DataTable.js';
import { Reading } from '/components/Readings.js';
import { Mark } from '/components/Mark.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Note } from '/components/Note.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { Split } from '/components/Layout.js';
import { Collapsible } from '/components/Collapsible.js';
import { Alert } from '/components/Alert.js';

// Display formatters live in the shared /js/format.js; re-exported so the admin importers
// (`import { num, dt, fmtUp, fmtBytes } from './shared.js'`) keep working.
import { num, dt, day, fmtUp, fmtBytes, date as fmtDate } from '/js/format.js';
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
  return fmtDate(d, thisYear
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
 * One metric row: the name and why it matters, a mark, and the value (the Reading).
 * @param {{ title: any, why: any, chip?: any, value: any, last?: boolean }} props
 */
export function Row({ title, why, chip, value, last }) {
  return html`<${Reading} name=${title} why=${why} mark=${chip ?? null} value=${value} last=${last} />`;
}

/** A name and its value on one row (the Reading without a mark). */
export function EconRow({ label, value }) {
  return html`<${Reading} name=${label} value=${value} />`;
}

// The tone of a badge's type word, by meaning. A type with no state (a visibility, a role, a
// category) is a plain status mark with its word.
const BADGE_TONE = {
  success: 'fine', healthy: 'fine', public: 'fine', delivered: 'fine', settled: 'fine', owner: 'fine',
  approved: 'fine', published: 'fine', active: 'fine', installed: 'fine',
  warning: 'attention', watch: 'attention', pending: 'attention', suspended: 'attention',
  danger: 'danger', critical: 'danger', cancelled: 'danger', expired: 'danger', disputed: 'danger',
  error: 'danger', rejected: 'danger',
  muted: 'off', neutral: 'off', idle: 'off', general: 'off',
};

/**
 * A status mark. `type` names the state (its tone); the visible text is `label` when given, else
 * dashboard.badge<Type> when a translation exists, else the type word itself.
 * @param {{ type: string, label?: any }} props
 */
export function Badge({ type, label }) {
  const key = `dashboard.badge${String(type).charAt(0).toUpperCase()}${String(type).slice(1)}`;
  const auto = t(key);
  return html`<${Mark} kind="status" tone=${BADGE_TONE[type]}>${label != null ? label : (auto === key ? type : auto)}<//>`;
}

// The old stat colours, by meaning, as the strip's tones.
const STAT_TONE = { indigo: 'notice', red: 'danger', amber: 'warn', mint: 'fine', green: 'fine' };

/**
 * The figures of a page as a strip.
 * @param {{ items: Array<{ label: any, value: any, sub?: any, tone?: string }> }} props
 */
export function StatsGrid({ items }) {
  return html`<${FigureStrip} items=${items.map((i, n) => ({ key: n, n: num(i.value), label: i.label, sub: i.sub, tone: STAT_TONE[i.tone] }))} />`;
}

/** The loading line. */
export function Spinner({ text }) {
  return html`<${Note} kind="loading">${text || t('common.loading')}<//>`;
}

/** Empty state: the canonical /components/EmptyState.js. */
export function Empty({ text }) {
  return html`<${EmptyState} text=${text} />`;
}

/** What went wrong. */
export function ErrorBox({ message }) {
  return html`<${ErrorNote} text=${t('common.error')} hint=${message} />`;
}

/** A help text that opens and folds; `open` starts it open (a first-run explanation). */
export function ExpandableHelp({ title, children, open }) {
  const [on, setOn] = useState(!!open);
  return html`<${Collapsible} title=${title} open=${on} onToggle=${() => setOn(!on)}>${children}<//>`;
}

/**
 * The canonical table under the heavy rule.
 *
 * SECURITY: cell objects with `_html: true` render `cell.text` as raw HTML; callers MUST sanitize
 * (escHtml()) any user-generated content. See the generic DataTable for the full cell protocol.
 */
export function DataTable({ headers, rows, scroll }) {
  return html`<${Split} heavy><${GenericDataTable} headers=${headers} rows=${rows} scroll=${scroll} /><//>`;
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
  // Consumers include these callbacks in read-effect dependencies (for example CORS).
  const showError   = useCallback((text) => setMsg({ type: 'error',   text }), []);
  const showSuccess = useCallback((text) => setMsg({ type: 'success', text }), []);
  const clear       = useCallback(() => setMsg(null), []);
  return [msg, showError, showSuccess, clear];
}

/** The message a page's act left, with the way to wave it away. */
export function Toast({ type, text, onDismiss }) {
  return html`<${Alert} type=${type} message=${text} onDismiss=${onDismiss} />`;
}
