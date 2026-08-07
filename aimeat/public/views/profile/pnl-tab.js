/**
 * @file pnl-tab.js
 * @description Profile tab: the P&L period summary (tuloslaskelma-kooste) from
 *   GET /v1/finance/pnl — income and expenses from booked vouchers grouped by source,
 *   the result before taxes, the period's VAT payable, internal transfers as an info
 *   line, and the LEDGER AI spend as its own USD line (never mixed into the EUR total).
 *   No forecasts: only the truth of the bookings. Live: re-fetches on the
 *   aimeat-live-update event when the finance domain ticks.
 * @version-history
 *   v1.1.0 — 2026-08-07 — AccountantAccess: grant and revoke read access to your books.
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 7: initial P&L tab.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from './shared.js';
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

function LineTable({ titleKey, lines, totalMinor }) {
  return html`
    <div class="card pf-pnl-block">
      <h3 class="section-title">${t(titleKey)}</h3>
      ${lines.length === 0 && html`<p class="pf-pnl-empty">${t('profile.pnl.empty')}</p>`}
      ${lines.length > 0 && html`
        <table class="pf-pnl-table">
          <tbody>
            ${lines.map(line => html`
              <tr key=${line.source}>
                <td>${sourceLabel(line.source)}</td>
                <td class="pf-pnl-count">${line.count} ${t('profile.pnl.count')}</td>
                <td class="pf-pnl-num">${euros(line.amountMinor)}</td>
              </tr>
            `)}
            <tr class="pf-pnl-total">
              <td colspan="2">${t('profile.pnl.total')}</td>
              <td class="pf-pnl-num">${euros(totalMinor)}</td>
            </tr>
          </tbody>
        </table>
      `}
    </div>
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
    <div class="card pf-pnl-block">
      <h3 class="section-title">${t('profile.pnl.accountantTitle')}</h3>
      <p class="section-desc">${t('profile.pnl.accountantDesc')}</p>

      ${accountants.length === 0
        ? html`<p class="pf-pnl-note">${t('profile.pnl.accountantNone')}</p>`
        : html`
          <ul class="pf-acc-list">
            ${accountants.map((who) => html`
              <li key=${who}>
                <span class="pf-acc-who">${who}</span>
                <button class="btn-ghost" disabled=${busy} onClick=${() => revoke(who)}>
                  ${t('profile.pnl.accountantRevoke')}
                </button>
              </li>
            `)}
          </ul>
        `}

      <div class="pf-pnl-controls">
        <label class="pf-acc-field">
          <span>${t('profile.pnl.accountantName')}</span>
          <input value=${name} placeholder=${t('profile.pnl.accountantPlaceholder')}
                 onInput=${(e) => setName(e.target.value)} />
        </label>
        <button class="btn-primary" disabled=${busy || !name.trim()} onClick=${grant}>
          ${t('profile.pnl.accountantGrant')}
        </button>
      </div>
      <p class="pf-pnl-note">${t('profile.pnl.accountantHint')}</p>
    </div>
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
    <div class="pf-pnl">
      <h2 class="section-title">${t('profile.pnl.title')}</h2>
      <p class="section-desc">${t('profile.pnl.desc')}</p>

      <div class="pf-pnl-controls">
        <label>${t('profile.pnl.from')}
          <input type="month" value=${from} onChange=${(e) => setFrom(e.target.value)} />
        </label>
        <label>${t('profile.pnl.to')}
          <input type="month" value=${to} onChange=${(e) => setTo(e.target.value)} />
        </label>
        <button class="btn-primary" onClick=${() => load(from, to)}>${t('profile.pnl.show')}</button>
      </div>

      ${loading && html`<${Spinner} />`}
      ${error && html`<p class="pf-pnl-error">${error}</p>`}

      ${report && !loading && html`
        <div class="pf-pnl-grid">
          <${LineTable} titleKey="profile.pnl.income" lines=${report.income} totalMinor=${report.totalIncomeMinor} />
          <${LineTable} titleKey="profile.pnl.expenses" lines=${report.expenses} totalMinor=${report.totalExpenseMinor} />
        </div>

        <div class="card pf-pnl-result ${report.resultMinor >= 0 ? 'pos' : 'neg'}">
          <div class="pf-pnl-result-label">${t('profile.pnl.result')}</div>
          <div class="pf-pnl-result-value">${euros(report.resultMinor)}</div>
          <div class="pf-pnl-vat">${t('profile.pnl.vatPayable')}: ${euros(report.vatPayableMinor)}</div>
        </div>

        <div class="card pf-pnl-block">
          <table class="pf-pnl-table">
            <tbody>
              ${report.transferCount > 0 && html`
                <tr>
                  <td>${t('profile.pnl.transfers')}</td>
                  <td class="pf-pnl-count">${report.transferCount} ${t('profile.pnl.count')}</td>
                  <td class="pf-pnl-num">${euros(report.transferMinor)}</td>
                </tr>
              `}
              <tr>
                <td>${t('profile.pnl.aiCost')}</td>
                <td class="pf-pnl-count"></td>
                <td class="pf-pnl-num">$${report.aiCostUsd.toFixed(4)}</td>
              </tr>
            </tbody>
          </table>
          <p class="pf-pnl-note">${t('profile.pnl.aiCostNote')}</p>
        </div>
      `}

      <${AccountantAccess} showToast=${showToast} />
    </div>
  `;
}
