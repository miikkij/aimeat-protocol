/**
 * @file public/views/admin/economy-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Economy tab — renders morsel-supply, daily-activity, and policy
 *   metrics, plus an operator mint form that credits morsels to a target GAII.
 *
 * @structure
 *   - default EconomyTab({ data, reload }): reads data.dash.economy, shows EconRow metric cards
 *   - doMint(): validates amount (1–1,000,000) and calls mintMorsels(), surfacing the result
 *
 * @version-history
 *   v1.1.0 — 2026-07-13 — Commerce card: checkout sessions, sales volume, operator fees, fee mode (TARGET-033)
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, fmtMoney } from '/js/utils.js';
import { num, EconRow } from './shared.js';
import { mintMorsels } from '/js/services/admin.js';

/** Format a { EUR: 15000000, USD: 9000000 } micro-units map as "15.00 EUR · 9.00 USD". */
function fmtMoneyMap(m) {
  const entries = Object.entries(m || {});
  if (!entries.length) return '';
  return entries.map(([cur, micros]) => fmtMoney(micros, cur)).join(' · ');
}

export default function EconomyTab({ data, reload }) {
  // Hooks must run unconditionally before any early return (Rules of Hooks).
  const [mintGaii, setMintGaii] = useState('');
  const [mintAmount, setMintAmount] = useState('');
  const [mintResult, setMintResult] = useState(null);

  const e = data.dash?.economy;
  if (!e) return html`<div class="empty">${t('dashboard.loading')}</div>`;

  async function doMint() {
    const amount = parseInt(mintAmount, 10);
    if (!mintGaii || !amount || amount < 1 || amount > 1_000_000) {
      setMintResult({ ok: false, msg: t('dashboard.mintGaiiRequired') || 'Amount must be 1\u20131,000,000' });
      return;
    }
    try {
      const r = await mintMorsels(mintGaii, amount);
      setMintResult({ ok: true, msg: t('dashboard.mintedSuccess').replace('{amount}', num(r.data.minted)).replace('{balance}', num(r.data.new_balance)) });
      reload();
    } catch (err) {
      setMintResult({ ok: false, msg: err.message });
    }
  }

  return html`
    <div class="adm-grid adm-grid-2">
      <div class="adm-card">
        <h2>${t('dashboard.morselSupply')}</h2>
        <${EconRow} label=${t('dashboard.inCirculation')} value=${num(e.total_morsels_in_circulation)} />
        <${EconRow} label=${t('dashboard.totalMintedAllTime')} value=${num(e.total_minted_all_time)} />
        <${EconRow} label=${t('dashboard.totalBurnedAllTime')} value=${num(e.total_burned_all_time)} />
        <${EconRow} label=${t('dashboard.inflationRate30d')} value=${e.inflation_rate_30d_percent + '%'} />
        <${EconRow} label=${t('dashboard.burnMintRatio')} value=${e.burn_mint_ratio} />
      </div>
      <div class="adm-card">
        <h2>${t('dashboard.todayActivity')}</h2>
        <${EconRow} label=${t('dashboard.transactionsToday')} value=${num(e.transactions_today)} />
        <${EconRow} label=${t('dashboard.morselsMovedToday')} value=${num(e.morsels_transacted_today)} />
        <${EconRow} label=${t('dashboard.networkFees')} value=${num(e.network_fees_today)} />
        <${EconRow} label=${t('dashboard.burned')} value=${num(e.burned_today)} />
        <${EconRow} label=${t('dashboard.dailyAllowancesIssued')} value=${num(e.daily_allowances_issued_today)} />
      </div>
    </div>

    ${e.commerce && html`
      <div class="adm-card">
        <h2>${t('dashboard.commerceTitle')}</h2>
        <${EconRow} label=${t('dashboard.commerceEnabled')} value=${e.commerce.enabled ? t('dashboard.on') || 'on' : t('dashboard.off') || 'off'} />
        <${EconRow} label=${t('dashboard.commerceFeeMode')} value=${e.commerce.fee_mode === 'operator' ? t('dashboard.feeModeOperator') : t('dashboard.feeModeBurn')} />
        <${EconRow} label=${t('dashboard.commerceFeePercent')} value=${e.commerce.fee_percent + '%'} />
        <${EconRow} label=${t('dashboard.commerceSessions')} value=${`${num(e.commerce.checkout_sessions.total)} (${num(e.commerce.checkout_sessions.open)} / ${num(e.commerce.checkout_sessions.completed)} / ${num(e.commerce.checkout_sessions.cancelled)} / ${num(e.commerce.checkout_sessions.expired)})`} />
        <${EconRow} label=${t('dashboard.commerceSalesAllTime')} value=${num(e.commerce.sales_volume_all_time) + ' ' + t('dashboard.morselUnit')} />
        <${EconRow} label=${t('dashboard.commerceSalesToday')} value=${num(e.commerce.sales_volume_today) + ' ' + t('dashboard.morselUnit')} />
        <${EconRow} label=${t('dashboard.commerceFeesAllTime')} value=${num(e.commerce.operator_fees_all_time) + ' ' + t('dashboard.morselUnit')} />
        <${EconRow} label=${t('dashboard.commerceFeesToday')} value=${num(e.commerce.operator_fees_today) + ' ' + t('dashboard.morselUnit')} />
        ${Object.keys(e.commerce.money_volume || {}).length > 0 || Object.keys(e.commerce.operator_money_fees || {}).length > 0 ? html`
          <div class="adm-subhead">${t('dashboard.commerceMoney')}</div>
          <${EconRow} label=${t('dashboard.commerceMoneyVolume')} value=${fmtMoneyMap(e.commerce.money_volume) || '—'} />
          <${EconRow} label=${t('dashboard.commerceMoneyFees')} value=${fmtMoneyMap(e.commerce.operator_money_fees) || '—'} />
        ` : null}
      </div>`}

    <div class="adm-card">
      <h2>${t('dashboard.morselPolicy')}</h2>
      <${EconRow} label=${t('dashboard.welcomeBonus')} value=${num(e.welcome_bonus) + ' ' + t('dashboard.morselUnit')} />
      <${EconRow} label=${t('dashboard.dailyAllowance')} value=${num(e.daily_allowance) + ' ' + t('dashboard.morselUnit')} />
      <${EconRow} label=${t('dashboard.allowanceCap')} value=${num(e.daily_allowance_cap) + ' ' + t('dashboard.morselUnit')} />
      <${EconRow} label=${t('dashboard.burnRate')} value=${e.burn_rate} />
      <${EconRow} label=${t('dashboard.maxOperatorMint')} value=${num(e.max_operator_mint_per_day) + ' ' + t('dashboard.morselUnit')} />
    </div>

    <!-- Mint form -->
    <div class="adm-card" style="margin-top:16px">
      <h2>${t('dashboard.mintMorsels')}</h2>
      <p style="color:var(--text-dim);font-size:.8rem;margin-bottom:10px">${t('dashboard.issueToAgent').replace('{cap}', num(e.max_operator_mint_per_day))}</p>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:2;min-width:200px">
          <label style="color:var(--text-dim);font-size:.75rem;margin-bottom:2px;display:block">${t('dashboard.gaii')}</label>
          <input type="text" value=${mintGaii} onInput=${e => setMintGaii(e.target.value)} placeholder="agent#owner@node" style="width:100%" />
        </div>
        <div style="flex:1;min-width:100px">
          <label style="color:var(--text-dim);font-size:.75rem;margin-bottom:2px;display:block">${t('dashboard.amount')}</label>
          <input type="number" value=${mintAmount} onInput=${e => setMintAmount(e.target.value)} placeholder="100" min="1" style="width:100%" />
        </div>
        <button class="adm-btn" style="height:38px;white-space:nowrap" onClick=${doMint}>${t('dashboard.mint')}</button>
      </div>
      ${mintResult && html`<div style="margin-top:8px;font-size:.85rem;color:${mintResult.ok ? '#22c55e' : '#ef4444'}">${escHtml(mintResult.msg)}</div>`}
    </div>
  `;
}
