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
    <${PageSection} title=${t(titleKey)}>
      ${lines.length === 0 && html`<p class="poster-quiet pf-pnl-empty">${t('profile.pnl.empty')}</p>`}
      ${lines.length > 0 && html`
        <div class="listing listing--cols listing--name-n-n">
            ${lines.map(line => html`
              <div class="listing-row" key=${line.source}>
                <div class="listing-name">${sourceLabel(line.source)}</div>
                <div class="listing-desc listing-n">${line.count} ${t('profile.pnl.count')}</div>
                <div class="listing-n">${euros(line.amountMinor)}</div>
              </div>
            `)}
            <div class="listing-row">
              <div class="listing-name">${t('profile.pnl.total')}</div>
              <div></div>
              <div class="listing-name listing-n">${euros(totalMinor)}</div>
            </div>
        </div>
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
    <${PageSection} title=${t('profile.pnl.accountantTitle')}>
      <p class="og-lead">${t('profile.pnl.accountantDesc')}</p>

      ${accountants.length === 0
        ? html`<p class="poster-quiet pf-pnl-note">${t('profile.pnl.accountantNone')}</p>`
        : html`
          <div class="listing listing--name-doors pf-acc-list">
            ${accountants.map((who) => html`
              <div class="listing-row" key=${who}>
                <div class="listing-name">${who}</div>
                <div class="listing-doors">
                <button class="poster-action poster-action--small poster-action--row" disabled=${busy} onClick=${() => revoke(who)}>
                  ${t('profile.pnl.accountantRevoke')}
                </button>
                </div>
              </div>
            `)}
          </div>
        `}

      <div class="pf-pnl-controls">
        <label class="pf-acc-field">
          <span class="poster-label">${t('profile.pnl.accountantName')}</span>
          <input class="og-input" value=${name} placeholder=${t('profile.pnl.accountantPlaceholder')}
                 onInput=${(e) => setName(e.target.value)} />
        </label>
        <button class="poster-slab poster-slab--control" disabled=${busy || !name.trim()} onClick=${grant}>
          ${t('profile.pnl.accountantGrant')}
        </button>
      </div>
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
    <div class="pf-pnl og">
      <div class="mb-1">
        <div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuBusiness')}</span><span>/</span><span class="og-crumb-here">${t('profile.tabs.pnl')}</span></div>
        <div class="og-mast"><div class="og-mast-words">
          <h2 class="og-title poster-page-title">${t('profile.pnl.title')}</h2>
          <p class="og-desc">${t('profile.pnl.desc')}</p>
        </div></div>
      </div>

      <div class="pf-pnl-controls">
        <label><span class="poster-label">${t('profile.pnl.from')}</span>
          <input class="og-input" type="month" value=${from} onChange=${(e) => setFrom(e.target.value)} />
        </label>
        <label><span class="poster-label">${t('profile.pnl.to')}</span>
          <input class="og-input" type="month" value=${to} onChange=${(e) => setTo(e.target.value)} />
        </label>
        <button class="poster-slab" onClick=${() => load(from, to)}>${t('profile.pnl.show')}</button>
      </div>

      ${loading && html`<${LoadingLine} />`}
      ${error && html`<p class="form-message form-message--error">${error}</p>`}

      ${report && !loading && html`
        <div class="pf-pnl-grid">
          <${LineTable} titleKey="profile.pnl.income" lines=${report.income} totalMinor=${report.totalIncomeMinor} />
          <${LineTable} titleKey="profile.pnl.expenses" lines=${report.expenses} totalMinor=${report.totalExpenseMinor} />
        </div>

        <div class="og-strip pf-pnl-result">
          <div>
            <b class=${report.resultMinor >= 0 ? 'og-strip-fine' : 'og-strip-danger'}>${euros(report.resultMinor)}</b>
            <span>${t('profile.pnl.result')}</span>
            <small>${t('profile.pnl.vatPayable')}: ${euros(report.vatPayableMinor)}</small>
          </div>
        </div>

        <div class="card pf-pnl-block poster-row--thing">
          <div class="listing listing--cols listing--name-n-n">
              ${report.transferCount > 0 && html`
                <div class="listing-row">
                  <div class="listing-name">${t('profile.pnl.transfers')}</div>
                  <div class="listing-desc listing-n">${report.transferCount} ${t('profile.pnl.count')}</div>
                  <div class="listing-n">${euros(report.transferMinor)}</div>
                </div>
              `}
              <div class="listing-row">
                <div class="listing-name">${t('profile.pnl.aiCost')}</div>
                <div class="listing-desc listing-n"></div>
                <div class="listing-n">$${report.aiCostUsd.toFixed(4)}</div>
              </div>
          </div>
          <${Hint}>${t('profile.pnl.aiCostNote')}<//>
        </div>
      `}

      <${AccountantAccess} showToast=${showToast} />
    </div>
  `;
}
