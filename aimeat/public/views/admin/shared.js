/**
 * @file shared.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Dashboard shared UI helpers (Row, Badge, StatCard, StatsGrid, EconRow,
 *   HealthRow, Spinner, Empty, ErrorBox, ExpandableHelp, DataTable, useToast/Toast) and formatters.
 *   Since 2026-09-22 every visual helper here draws the site's one component set
 *   (components/poster-parts.js): the admin is no longer a design system of its own, so a theme or
 *   a part reaches it like every other page. The props are unchanged, so no caller changes.
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- The helpers forward to the shared set: Row is a ListRow, Badge a Chip,
 *     StatsGrid and StatCard a NumeralBand, EconRow and HealthRow KeyValues, ErrorBox and Toast an
 *     aside, ExpandableHelp a folding surface, DataTable the shared Table (stacking on a phone).
 *   v1.5.0 -- 2026-09-13 -- Stable toast callbacks keep consumer read effects from restarting.
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
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner as SharedSpinner } from '/components/Spinner.js';
import { ListRow, Chip, NumeralBand, KeyValue, Stack, Text, Surface, Table, Action } from '/components/poster-parts.js';

// Display formatters now live in the shared /js/format.js. Import them into local
// scope (StatCard etc. call num() directly) AND re-export so the existing admin
// importers (`import { num, dt, fmtUp, fmtBytes } from './shared.js'`) keep working.
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
 * One metric row: the name and why it matters, a chip, and the value (Overview, CORS, Discovery,
 * Hooks and the other operator pages). A shared list row; the chip sits before the value.
 * @param {{ title: any, why: any, chip?: any, value: any, last?: boolean }} props
 */
export function Row({ title, why, chip, value }) {
  return html`<${ListRow} name=${title} detail=${why} detailKind="text"
    value=${chip || (value !== undefined && value !== null && value !== '')
      ? html`<${Stack} direction="horizontal" align="center" density="compact">${chip}${value !== undefined && value !== null && value !== '' ? html`<span>${value}</span>` : null}<//>`
      : null} />`;
}

/** The chip tone each badge type reads as: fine, needs a look, broken, or plain information. */
const BADGE_TONE = {
  success: 'success', healthy: 'success', active: 'success', ok: 'success', online: 'success', enabled: 'success', verified: 'success',
  error: 'danger', critical: 'danger', danger: 'danger', failed: 'danger', offline: 'danger', blocked: 'danger', revoked: 'danger',
  warning: 'coral', watch: 'coral', pending: 'coral', stale: 'coral', degraded: 'coral',
  idle: 'muted', disabled: 'muted', hidden: 'muted', inactive: 'muted', archived: 'muted',
  public: 'sun', featured: 'sun',
};

/**
 * A badge: a shared Chip whose tone comes from `type`; the visible text is `label` when given,
 * else the translated type word (dashboard.badge<Type>), else the type word itself.
 */
export function Badge({ type, label }) {
  const key = `dashboard.badge${String(type).charAt(0).toUpperCase()}${String(type).slice(1)}`;
  const auto = t(key);
  return html`<${Chip} tone=${BADGE_TONE[String(type).toLowerCase()] || 'plain'}>${label != null ? label : (auto === key ? type : auto)}<//>`;
}

/**
 * One figure: a shared NumeralBand with a single item.
 * @param {{ label: string, value: any, sub?: string, tone?: string, color?: string }} props
 *   tone "red" sets the number coral; the other old tones and `color` are the band's plain ink now.
 */
export function StatCard({ label, value, sub, tone }) {
  return html`<${NumeralBand} tone="plain" size="small" items=${[{ label, value: num(value), note: sub, tone: tone === 'red' ? 'coral' : undefined }]} />`;
}

/** A row of figures: one shared NumeralBand, the figures in equal columns. */
export function StatsGrid({ items }) {
  return html`<${NumeralBand} tone="plain" size="small" items=${items.map((i) => ({ label: i.label, value: num(i.value), note: i.sub, tone: i.tone === 'red' ? 'coral' : undefined }))} />`;
}

/** An economy-style key-value row. */
export function EconRow({ label, value }) {
  return html`<${KeyValue} label=${label} value=${value} />`;
}

/** A health-metric row: the metric, its zone as a chip, and the value. */
export function HealthRow({ label, obj }) {
  return html`<${KeyValue} label=${label}><${Stack} direction="horizontal" align="center" density="compact"><${Badge} type=${obj.zone} /><span>${obj.value}</span><//><//>`;
}

/** Loading. */
export function Spinner({ text }) {
  return html`<${Stack} direction="horizontal" align="center"><${SharedSpinner} /><${Text} tone="muted">${text || t('common.loading')}<//><//>`;
}

/** Nothing to show: one quiet line, never a dashed box. */
export function Empty({ text }) {
  return html`<${Text} tone="muted">${text}<//>`;
}

/** A failure: the solid danger aside. */
export function ErrorBox({ message }) {
  return html`<${Surface} kind="aside" tone="danger" role="alert"><${Stack} density="compact">
    <${Text} kind="label">${t('common.error')}<//><${Text}>${String(message ?? '')}<//>
  <//><//>`;
}

/** Help that folds away; `open` starts it expanded, for a first-run explanation nobody would think to click. */
export function ExpandableHelp({ title, children, open }) {
  return html`<${Surface} kind="plain" summary=${title} open=${open || null}><${Stack}>${children}<//><//>`;
}

/**
 * A table: the shared Table, which keeps the canonical renderer's cell protocol and stacks its rows
 * on a phone. SECURITY: cell objects with `_html: true` render `cell.text` as raw HTML; callers MUST
 * sanitize (escHtml()) any user-generated content.
 */
export function DataTable({ headers, rows, sort, onSort, rowTones, label, density }) {
  return html`<${Table} headers=${headers} rows=${rows} collapse=${600} sort=${sort} onSort=${onSort} rowTones=${rowTones} label=${label} density=${density} />`;
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

/** A message that stays until dismissed: the aside in the failure or success tone, with its ✗. */
export function Toast({ type, text, onDismiss }) {
  return html`<${Surface} kind="aside" tone=${type === 'error' ? 'danger' : 'success'} role="status">
    <${Stack} direction="horizontal" align="between"><${Text}>${text}<//>
      <${Action} kind="icon" label=${t('common.close') || 'Close'} onClick=${onDismiss}>✗<//>
    <//>
  <//>`;
}
