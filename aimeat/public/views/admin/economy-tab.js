/**
 * @file public/views/admin/economy-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Economy tab in the poster face (design canvas "AIMEAT Hallinnan
 *   kolme sivua"): the numeral strip, then four sections that keep different things apart —
 *   morsels (a pacer, not a currency, and the page says so), trade in morsels, real money on its
 *   own rails, and the operator grant as a proper form that says where the grant lands and what
 *   the daily cap is. Every policy row carries a sentence about what it does.
 * @structure EconomyTab — strip · morsels · trade · money · grant form
 * @version-history
 *   v2.0.0 — 2026-08-31 — The poster face: sections with meaning sentences, morsels and money
 *     separated, the mint form explained. Replaces five equal-weight key-value cards.
 *   v1.1.0 — 2026-07-13 — Commerce card: checkout sessions, sales volume, operator fees, fee mode (TARGET-033)
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { escHtml, fmtMoney } from '/js/utils.js';
import { num } from './shared.js';
import { mintMorsels } from '/js/services/admin.js';

/** Format a { EUR: 15000000, USD: 9000000 } micro-units map as "15.00 EUR · 9.00 USD". */
function fmtMoneyMap(m) {
  const entries = Object.entries(m || {});
  if (!entries.length) return '';
  return entries.map(([cur, micros]) => fmtMoney(micros, cur)).join(' · ');
}

/** One policy row: the name, a sentence about what it does, and the value in mono. */
function Row({ label, why, value }) {
  return html`<div class="adm-mrow adm-mrow--two">
    <span><b>${label}</b>${why ? html`<span class="adm-why">${why}</span>` : null}</span>
    <span class="adm-mval">${value}</span>
  </div>`;
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
      setMintResult({ ok: false, msg: t('dashboard.mintGaiiRequired') || 'Amount must be 1–1,000,000' });
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

  const c = e.commerce;
  const inflHigh = parseFloat(e.inflation_rate_30d_percent) >= 10;
  // Finnish writes decimals with a comma and a space before the percent sign (Kielitoimisto).
  const pct = (getLocale() === 'fi' ? String(e.inflation_rate_30d_percent).replace('.', ',') : String(e.inflation_rate_30d_percent)) + ' %';

  return html`
    <div class="og">
      <div class="og-strip">
        <div><b>${num(e.total_morsels_in_circulation)}</b><span>${t('dashboard.ecoStripCirc')}</span><small>${t('dashboard.ecoStripCircSub')}</small></div>
        <div><b>${num(e.total_minted_all_time)}</b><span>${t('dashboard.ecoStripMinted')}</span><small>${t('dashboard.ecoStripMintedSub', { n: num(e.total_burned_all_time) })}</small></div>
        <div><b class=${inflHigh ? 'og-coral-num' : ''}>${pct}</b><span>${t('dashboard.ecoStripInfl')}</span><small>${t('dashboard.ecoStripInflSub')}</small></div>
        <div><b>${num(e.transactions_today)}</b><span>${t('dashboard.ecoStripTx')}</span><small>${t('dashboard.ecoStripTxSub', { n: num(e.morsels_transacted_today) })}</small></div>
      </div>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${t('dashboard.ecoMorselsTitle')}<small>${t('dashboard.ecoMorselsSub')}</small></h2></div>
        <p class="adm-intro">${t('dashboard.ecoMorselsIntro')}</p>
        <div class="adm-two">
          <div>
            <${Row} label=${t('dashboard.welcomeBonus')} why=${t('dashboard.ecoWhyWelcome')} value=${num(e.welcome_bonus) + ' ' + t('dashboard.morselUnit')} />
            <${Row} label=${t('dashboard.dailyAllowance')} why=${t('dashboard.ecoWhyDaily')} value=${num(e.daily_allowance) + ' ' + t('dashboard.morselUnit')} />
            <${Row} label=${t('dashboard.allowanceCap')} why=${t('dashboard.ecoWhyCap')} value=${num(e.daily_allowance_cap) + ' ' + t('dashboard.morselUnit')} />
          </div>
          <div>
            <${Row} label=${t('dashboard.burnRate')} why=${t('dashboard.ecoWhyBurnRate')} value=${e.burn_rate} />
            <${Row} label=${t('dashboard.maxOperatorMint')} why=${t('dashboard.ecoWhyMintCap')} value=${num(e.max_operator_mint_per_day) + ' ' + t('dashboard.morselUnit')} />
            <${Row} label=${t('dashboard.dailyAllowancesIssued')} why=${t('dashboard.ecoWhyAllowancesToday')} value=${num(e.daily_allowances_issued_today)} />
          </div>
        </div>
      </section>

      ${c && html`
        <section class="og-sec">
          <div class="og-sec-h"><h2>${t('dashboard.ecoTradeTitle')}<small>${t('dashboard.ecoTradeSub')}</small></h2></div>
          <div class="adm-two">
            <div>
              <${Row} label=${t('dashboard.ecoCheckout')}
                why=${c.enabled
                  ? (c.fee_mode === 'operator' ? t('dashboard.ecoFeeOperator', { p: c.fee_percent }) : t('dashboard.ecoFeeBurn', { p: c.fee_percent }))
                  : t('dashboard.ecoCheckoutOff')}
                value=${t('dashboard.ecoSessionsN', { n: num(c.checkout_sessions.total) })} />
              <${Row} label=${t('dashboard.commerceSessions')}
                why=${t('dashboard.ecoSessionsSub', { open: num(c.checkout_sessions.open), done: num(c.checkout_sessions.completed), cancelled: num(c.checkout_sessions.cancelled), expired: num(c.checkout_sessions.expired) })}
                value=${''} />
            </div>
            <div>
              <${Row} label=${t('dashboard.ecoSales')} why=${t('dashboard.ecoAllTimeToday', { n: num(c.sales_volume_today) })} value=${num(c.sales_volume_all_time) + ' ' + t('dashboard.morselUnit')} />
              <${Row} label=${t('dashboard.ecoOperatorFees')} why=${t('dashboard.ecoAllTimeToday', { n: num(c.operator_fees_today) })} value=${num(c.operator_fees_all_time) + ' ' + t('dashboard.morselUnit')} />
            </div>
          </div>
        </section>

        <section class="og-sec">
          <div class="og-sec-h"><h2>${t('dashboard.ecoMoneyTitle')}<small>${t('dashboard.ecoMoneySub')}</small></h2></div>
          <p class="adm-intro">${t('dashboard.ecoMoneyIntro')}</p>
          <div class="adm-half">
            <${Row} label=${t('dashboard.commerceMoneyVolume')} value=${fmtMoneyMap(c.money_volume) || '—'} />
            <${Row} label=${t('dashboard.commerceMoneyFees')} value=${fmtMoneyMap(c.operator_money_fees) || '—'} />
          </div>
        </section>`}

      <section class="og-sec">
        <div class="og-sec-h"><h2>${t('dashboard.mintMorsels')}<small>04</small></h2></div>
        <p class="adm-intro">${t('dashboard.ecoMintIntro', { cap: num(e.max_operator_mint_per_day) })}</p>
        <div class="adm-mint">
          <label class="adm-fld adm-fld--wide"><span>${t('dashboard.gaii')}</span>
            <input type="text" value=${mintGaii} onInput=${ev => setMintGaii(ev.target.value)} placeholder="agent#owner@node" /></label>
          <label class="adm-fld"><span>${t('dashboard.amount')}</span>
            <input type="number" value=${mintAmount} onInput=${ev => setMintAmount(ev.target.value)} placeholder="100" min="1" /></label>
          <button class="adm-btn" onClick=${doMint}>${t('dashboard.mint')}</button>
        </div>
        ${mintResult && html`<div class=${'adm-mint-result' + (mintResult.ok ? '' : ' bad')}>${escHtml(mintResult.msg)}</div>`}
      </section>
    </div>
  `;
}
