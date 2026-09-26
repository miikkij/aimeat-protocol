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
 *   v1.17.0 — 2026-09-27 — As main: the result before taxes is centred with its words over it and the VAT
 *     line under it (Figure's Result in a section Card), and the section bands span their columns
 *     (Section `band`).
 *   v1.16.0 — 2026-09-26 — Every part is a kit component (SettingsPage, List with its number cells, FigureStrip with the result's fine or danger tone, section Card, TextField, Loud, Action, Note, Layout): the page passes data and writes no class (page group G8).
 *   v1.15.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.14.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.13.0 — 2026-09-25 — The P&L result and the overview's commerce, AI spend and agent ledger figures are the figure strip (.og-strip); a profit keeps its green as the fine tone and a loss its red as the danger tone (a unification: the look most tabs use).
 *   v1.12.0 — 2026-09-25 — The last labels over a field or a group wear .poster-label: the classic AI settings, the presence dialog, the scope groups, the ecosystem's trigger and sample, the scheduler's edit form, P&L's fields, the task runner's name; a place keeps its layout (Jouni's decision "Row label", a unification).
 *   v1.11.0 — 2026-09-25 — The last lines that say nothing is there are the quiet sentence (.poster-quiet); the ecosystem's empty frame goes, its second line is the Hint (Jouni's decision "Empty line", a unification).
 *   v1.10.0 — 2026-09-25 — A line that says a load or a save failed is the Form message in its error tone (.form-message--error); the error lines' own rules go (a unification: the look most tabs use).
 *   v1.9.0 — 2026-09-25 — A table of rows is the Listing (css/components/listing.css): the P&L lines, the accountants, the usage report, the AI spend per app, the security overrides and an agent's internal jobs; figures stand at the right of their column (a unification: the look most tabs use).
 *   v1.8.0 — 2026-09-25 — Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — The crumb is the full trail (Settings & Controls / the menu group / the tab), as in the kit tabs (a unification).
 *   v1.6.0 — 2026-09-25 — A section is the kit's section (PageSection in an .og page) and the line under its title is the lead (.og-lead), the look most tabs use (a unification).
 *   v1.5.0 — 2026-09-25 — The page head is the kit's crumb trail and page head (.og-crumb, .og-mast, .og-title, .og-desc), the look most tabs use (a unification).
 *   v1.4.0 — 2026-09-25 — A grey help note is the Hint (poster-hint, components/Hint.js), as every other Settings hint (UI consolidation phase 5, a unification).
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { LoadingLine } from './shared.js';
import { apiGet, apiPost, apiDelete } from '/js/api.js';
import { Hint } from '/components/Hint.js';
import { PageSection } from '/components/PageSection.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { List, Row, Name, Num, Cell, Doors } from '/components/List.js';
import { Result } from '/components/Figure.js';
import { Card, CardGrid } from '/components/Card.js';
import { Note } from '/components/Note.js';
import { Action, Loud } from '/components/Action.js';
import { TextField } from '/components/TextField.js';
import { Row as Line, Space } from '/components/Layout.js';

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

function LineTable({ titleKey, lines, totalMinor }) {
  return html`
    <${PageSection} band title=${t(titleKey)}>
      <${List} cols="name-n-n" keepCols empty=${t('profile.pnl.empty')}>
        ${lines.length > 0 && html`
            ${lines.map(line => html`
              <${Row} key=${line.source}>
                <${Name}>${sourceLabel(line.source)}<//>
                <${Num} quiet>${line.count} ${t('profile.pnl.count')}<//>
                <${Num}>${euros(line.amountMinor)}<//>
              <//>
            `)}
            <${Row} key="total">
              <${Name}>${t('profile.pnl.total')}<//>
              <${Cell} />
              <${Num} strong>${euros(totalMinor)}<//>
            <//>
        `}
      <//>
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
    <${PageSection} band title=${t('profile.pnl.accountantTitle')}>
      <${Note} kind="lead">${t('profile.pnl.accountantDesc')}<//>

      <${List} cols="name-doors" apart empty=${t('profile.pnl.accountantNone')}>
            ${accountants.map((who) => html`
              <${Row} key=${who}>
                <${Name}>${who}<//>
                <${Doors}>
                <${Action} small row disabled=${busy} onClick=${() => revoke(who)}>
                  ${t('profile.pnl.accountantRevoke')}
                <//>
                <//>
              <//>
            `)}
      <//>

      <${Space} above="medium" below="large">
        <${TextField} label=${t('profile.pnl.accountantName')} value=${name} placeholder=${t('profile.pnl.accountantPlaceholder')}
          onInput=${setName}
          actions=${html`<${Loud} control disabled=${busy || !name.trim()} onClick=${grant}>${t('profile.pnl.accountantGrant')}<//>`} />
      <//>
      <${Hint}>${t('profile.pnl.accountantHint')}<//>
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

  return html`
    <${SettingsPage} name="pnl"
      crumb=${[t('nav.profile'), t('profile.landing.menuBusiness'), t('profile.tabs.pnl')]}
      title=${t('profile.pnl.title')}
      desc=${t('profile.pnl.desc')}>

      <${Line} gap="medium" align="end" wrap below="large">
        <${TextField} type="month" label=${t('profile.pnl.from')} value=${from} onChange=${setFrom} />
        <${TextField} type="month" label=${t('profile.pnl.to')} value=${to} onChange=${setTo} />
        <${Loud} onClick=${() => load(from, to)}>${t('profile.pnl.show')}<//>
      <//>

      ${loading && html`<${LoadingLine} />`}
      ${error && html`<${Note} kind="message" error>${error}<//>`}

      ${report && !loading && html`
        <${CardGrid} cols="two">
          <${LineTable} titleKey="profile.pnl.income" lines=${report.income} totalMinor=${report.totalIncomeMinor} />
          <${LineTable} titleKey="profile.pnl.expenses" lines=${report.expenses} totalMinor=${report.totalExpenseMinor} />
        <//>

        <${Card} tone="section">
          <${Result} label=${t('profile.pnl.result')} n=${euros(report.resultMinor)}
            tone=${report.resultMinor >= 0 ? 'fine' : 'danger'}
            sub=${`${t('profile.pnl.vatPayable')}: ${euros(report.vatPayableMinor)}`} />
        <//>

        <${Card} tone="section">
          <${List} cols="name-n-n" keepCols>
              ${report.transferCount > 0 && html`
                <${Row} key="transfers">
                  <${Name}>${t('profile.pnl.transfers')}<//>
                  <${Num} quiet>${report.transferCount} ${t('profile.pnl.count')}<//>
                  <${Num}>${euros(report.transferMinor)}<//>
                <//>
              `}
              <${Row} key="ai">
                <${Name}>${t('profile.pnl.aiCost')}<//>
                <${Num} quiet />
                <${Num}>$${report.aiCostUsd.toFixed(4)}<//>
              <//>
          <//>
          <${Hint}>${t('profile.pnl.aiCostNote')}<//>
        <//>
      `}

      <${AccountantAccess} showToast=${showToast} />
    <//>
  `;
}
