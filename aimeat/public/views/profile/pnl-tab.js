/**
 * @file pnl-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: the P&L period summary (tuloslaskelma-kooste) from
 *   GET /v1/finance/pnl — income and expenses from booked vouchers grouped by source,
 *   the result before taxes, the period's VAT payable, internal transfers as an info
 *   line, and the LEDGER AI spend as its own USD line (never mixed into the EUR total).
 *   No forecasts: only the truth of the bookings. Live: re-fetches on the
 *   aimeat-live-update event when the finance domain ticks.
 * @version-history
 *   2026-09-22 -- Composed from the shared set: Page, the income and expense blocks are small
 *     Sections with a Table each, the result is one box with its number, the accountants are list
 *     rows with a Field; no class of its own. Grant is an underlined word, so Show is the one slab.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.1.0 — 2026-08-07 — AccountantAccess: grant and revoke read access to your books.
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 7: initial P&L tab.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from './shared.js';
import { Page, Section, Columns, Stack, ListRow, Table, Field, Action, Surface, Text } from '/components/poster-parts.js';
import { apiGet, apiPost, apiDelete } from '/js/api.js';

function euros(minor) {
  const sign = minor < 0 ? '\u2212' : '';
  const abs = Math.abs(minor);
  // Non-breaking thousands separator + euro sign as escapes (lint: no-irregular-whitespace).
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${sign}${whole},${String(abs % 100).padStart(2, '0')}\u00a0\u20ac`;
}

function monthNow() { return new Date().toISOString().slice(0, 7); }
function monthShift(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function sourceLabel(source) {
  const key = `profile.pnl.source.${source}`;
  const label = t(key);
  return label === key ? source : label;
}

/** Income or expenses: one row per source (what, how many, how much) and the total, bold, last. */
function LineTable({ titleKey, lines, totalMinor }) {
  return html`
    <${Section} size="small" density="compact" title=${t(titleKey)}>
      ${lines.length === 0 && html`<${Text} tone="muted">${t('profile.pnl.empty')}<//>`}
      ${lines.length > 0 && html`
        <${Table} density="compact" label=${t(titleKey)} headers=${['', '', '']}
          rows=${[
            ...lines.map(line => [sourceLabel(line.source), `${line.count} ${t('profile.pnl.count')}`, { text: euros(line.amountMinor), mono: true }]),
            [html`<strong>${t('profile.pnl.total')}</strong>`, '', { text: html`<strong>${euros(totalMinor)}</strong>`, mono: true }],
          ]} />
      `}
    <//>
  `;
}

/**
 * Who may read your books. A grant is a read-only door into this owner's finance data for a
 * named accountant on this node — it never opens writes, and the granting owner is the only
 * one who can open or close it, which is why it lives here and not in the accountant's app.
 */
function AccountantAccess({ showToast }) {
  const [accountants, setAccountants] = useState([]);
  const [name, setName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet('/v1/finance/accountants');
      setAccountants(res?.data?.accountants ?? []);
    } catch (e) { showToast?.(e?.message || String(e), 'error'); }
    setLoaded(true);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const grant = useCallback(async () => {
    const who = name.trim();
    if (!who) return;
    setBusy(true);
    try {
      const res = await apiPost('/v1/finance/accountants', { accountant: who });
      setAccountants(res?.data?.accountants ?? []);
      setName('');
      showToast?.(t('profile.pnl.accountantGranted').replace('{name}', who), 'success');
    } catch (e) { showToast?.(e?.message || String(e), 'error'); }
    setBusy(false);
  }, [name, showToast]);

  const revoke = useCallback(async (who) => {
    if (!confirm(t('profile.pnl.accountantConfirmRevoke').replace('{name}', who))) return;
    setBusy(true);
    try {
      const res = await apiDelete(`/v1/finance/accountants/${encodeURIComponent(who.split('@')[0])}`);
      setAccountants(res?.data?.accountants ?? []);
      showToast?.(t('profile.pnl.accountantRevoked').replace('{name}', who), 'success');
    } catch (e) { showToast?.(e?.message || String(e), 'error'); }
    setBusy(false);
  }, [showToast]);

  if (!loaded) return null;

  return html`
    <${Section} size="small" density="compact" title=${t('profile.pnl.accountantTitle')} description=${t('profile.pnl.accountantDesc')}>
      <${Stack}>
        ${accountants.length === 0
          ? html`<${Text} kind="caption" tone="muted">${t('profile.pnl.accountantNone')}<//>`
          : html`<${Stack} density="compact">
            ${accountants.map((who) => html`
              <${ListRow} key=${who} density="compact" name=${who}
                actions=${html`<${Action} kind="text" tone="danger" disabled=${busy} onClick=${() => revoke(who)}>${t('profile.pnl.accountantRevoke')}<//>`} />`)}
          <//>`}
        <${Stack} direction="wrap" align="end">
          <${Field} label=${t('profile.pnl.accountantName')} value=${name} placeholder=${t('profile.pnl.accountantPlaceholder')}
            onInput=${(e) => setName(e.target.value)} />
          <${Action} disabled=${busy || !name.trim()} onClick=${grant}>${t('profile.pnl.accountantGrant')}<//>
        <//>
        <${Text} kind="caption" tone="muted">${t('profile.pnl.accountantHint')}<//>
      <//>
    <//>
  `;
}

export function PnlTab({ showToast }) {
  const [from, setFrom] = useState(monthShift(monthNow(), -5));
  const [to, setTo] = useState(monthNow());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (fromMonth, toMonth) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiGet(`/v1/finance/pnl?from=${fromMonth}&to=${toMonth}`);
      setReport(res?.data?.report ?? null);
    } catch (e) {
      setError(e?.message || String(e));
      setReport(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(from, to); }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- initial load only; refreshes go through the button + live handler

  // Live: a finance-domain tick (new voucher, paid invoice) refreshes the numbers.
  useEffect(() => {
    const handler = (e) => {
      const domains = e.detail?.domains;
      if (!domains || domains.has('finance')) load(from, to);
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [from, to, load]);

  // The month fields: Field has no month type yet, so they fall back to a text field that keeps
  // the YYYY-MM value (see the report's MISSING PART).
  return html`<${Page} title=${t('profile.pnl.title')}
    crumbs=${[{ label: t('nav.profile') }, { label: t('profile.landing.menuBusiness') }, { label: t('profile.pnl.title') }]}>
    <${Stack}>
      <${Text} kind="lead" tone="muted">${t('profile.pnl.desc')}<//>

      <${Stack} direction="wrap" align="end">
        <${Field} type="month" width="narrow" label=${t('profile.pnl.from')} value=${from} onChange=${(e) => setFrom(e.target.value)} />
        <${Field} type="month" width="narrow" label=${t('profile.pnl.to')} value=${to} onChange=${(e) => setTo(e.target.value)} />
        <${Action} kind="primary" onClick=${() => load(from, to)}>${t('profile.pnl.show')}<//>
      <//>

      ${loading && html`<${Spinner} />`}
      ${error && html`<${Text} tone="danger">${error}<//>`}

      ${report && !loading && html`
        <${Columns} collapse=${600}>
          <${LineTable} titleKey="profile.pnl.income" lines=${report.income} totalMinor=${report.totalIncomeMinor} />
          <${LineTable} titleKey="profile.pnl.expenses" lines=${report.expenses} totalMinor=${report.totalExpenseMinor} />
        <//>

        <${Surface} kind="box" density="roomy">
          <${Stack} density="compact" align="center">
            <${Text} kind="label">${t('profile.pnl.result')}<//>
            <${Text} kind="number" tone=${report.resultMinor >= 0 ? 'success' : 'danger'}>${euros(report.resultMinor)}<//>
            <${Text} tone="muted">${t('profile.pnl.vatPayable')}: ${euros(report.vatPayableMinor)}<//>
          <//>
        <//>

        <${Stack} density="compact">
          <${Table} density="compact" label=${t('profile.pnl.aiCost')} headers=${['', '', '']}
            rows=${[
              ...(report.transferCount > 0 ? [[t('profile.pnl.transfers'), `${report.transferCount} ${t('profile.pnl.count')}`, { text: euros(report.transferMinor), mono: true }]] : []),
              [t('profile.pnl.aiCost'), '', { text: `$${report.aiCostUsd.toFixed(4)}`, mono: true }],
            ]} />
          <${Text} kind="caption" tone="muted">${t('profile.pnl.aiCostNote')}<//>
        <//>
      `}

      <${AccountantAccess} showToast=${showToast} />
    <//>
  <//>`;
}
