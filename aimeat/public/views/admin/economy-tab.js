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
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: the strip is a numeral band,
 *     the policy rows are the shared metric Row, the grant form is two shared fields and the page's
 *     one loud action. No classes of its own, so a theme change reaches this page too.
 *   v2.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
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
import { num, Row, Empty } from './shared.js';
import { Section, Columns, Stack, Text, NumeralBand, Field, Action } from '/components/poster-parts.js';
import { mintMorsels } from '/js/services/admin.js';

/** Format a { EUR: 15000000, USD: 9000000 } micro-units map as "15.00 EUR · 9.00 USD". */
function fmtMoneyMap(m) {
  const entries = Object.entries(m || {});
  if (!entries.length) return '';
  return entries.map(([cur, micros]) => fmtMoney(micros, cur)).join(' · ');
}

/** A value in a policy row: a machine reading, so mono. */
const mono = (v) => html`<${Text} kind="mono">${v}<//>`;

export default function EconomyTab({ data, reload }) {
  // Hooks must run unconditionally before any early return (Rules of Hooks).
  const [mintGaii, setMintGaii] = useState('');
  const [mintAmount, setMintAmount] = useState('');
  const [mintResult, setMintResult] = useState(null);

  const e = data.dash?.economy;
  if (!e) return html`<${Empty} text=${t('dashboard.loading')} />`;

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
  const unit = (n) => mono(num(n) + ' ' + t('dashboard.morselUnit'));

  return html`<${Stack}>
    <${NumeralBand} tone="plain" items=${[
      { label: t('dashboard.ecoStripCirc'), value: num(e.total_morsels_in_circulation), note: t('dashboard.ecoStripCircSub') },
      { label: t('dashboard.ecoStripMinted'), value: num(e.total_minted_all_time), note: t('dashboard.ecoStripMintedSub', { n: num(e.total_burned_all_time) }) },
      { label: t('dashboard.ecoStripInfl'), value: pct, note: t('dashboard.ecoStripInflSub'), tone: inflHigh ? 'coral' : undefined },
      { label: t('dashboard.ecoStripTx'), value: num(e.transactions_today), note: t('dashboard.ecoStripTxSub', { n: num(e.morsels_transacted_today) }) },
    ]} />

    <${Section} title=${t('dashboard.ecoMorselsTitle')} count=${t('dashboard.ecoMorselsSub')} description=${t('dashboard.ecoMorselsIntro')}>
      <${Columns} layout="equal" collapse=${900}>
        <div>
          <${Row} title=${t('dashboard.welcomeBonus')} why=${t('dashboard.ecoWhyWelcome')} value=${unit(e.welcome_bonus)} />
          <${Row} title=${t('dashboard.dailyAllowance')} why=${t('dashboard.ecoWhyDaily')} value=${unit(e.daily_allowance)} />
          <${Row} title=${t('dashboard.allowanceCap')} why=${t('dashboard.ecoWhyCap')} value=${unit(e.daily_allowance_cap)} />
        </div>
        <div>
          <${Row} title=${t('dashboard.burnRate')} why=${t('dashboard.ecoWhyBurnRate')} value=${mono(e.burn_rate)} />
          <${Row} title=${t('dashboard.maxOperatorMint')} why=${t('dashboard.ecoWhyMintCap')} value=${unit(e.max_operator_mint_per_day)} />
          <${Row} title=${t('dashboard.dailyAllowancesIssued')} why=${t('dashboard.ecoWhyAllowancesToday')} value=${mono(num(e.daily_allowances_issued_today))} />
        </div>
      <//>
    <//>

    ${c && html`
      <${Section} title=${t('dashboard.ecoTradeTitle')} count=${t('dashboard.ecoTradeSub')}>
        <${Columns} layout="equal" collapse=${900}>
          <div>
            <${Row} title=${t('dashboard.ecoCheckout')}
              why=${c.enabled
                ? (c.fee_mode === 'operator' ? t('dashboard.ecoFeeOperator', { p: c.fee_percent }) : t('dashboard.ecoFeeBurn', { p: c.fee_percent }))
                : t('dashboard.ecoCheckoutOff')}
              value=${mono(t('dashboard.ecoSessionsN', { n: num(c.checkout_sessions.total) }))} />
            <${Row} title=${t('dashboard.commerceSessions')}
              why=${t('dashboard.ecoSessionsSub', { open: num(c.checkout_sessions.open), done: num(c.checkout_sessions.completed), cancelled: num(c.checkout_sessions.cancelled), expired: num(c.checkout_sessions.expired) })} />
          </div>
          <div>
            <${Row} title=${t('dashboard.ecoSales')} why=${t('dashboard.ecoAllTimeToday', { n: num(c.sales_volume_today) })} value=${unit(c.sales_volume_all_time)} />
            <${Row} title=${t('dashboard.ecoOperatorFees')} why=${t('dashboard.ecoAllTimeToday', { n: num(c.operator_fees_today) })} value=${unit(c.operator_fees_all_time)} />
          </div>
        <//>
      <//>

      <${Section} title=${t('dashboard.ecoMoneyTitle')} count=${t('dashboard.ecoMoneySub')} description=${t('dashboard.ecoMoneyIntro')}>
        <${Columns} layout="equal" collapse=${900}>
          <div>
            <${Row} title=${t('dashboard.commerceMoneyVolume')} value=${mono(fmtMoneyMap(c.money_volume) || '—')} />
            <${Row} title=${t('dashboard.commerceMoneyFees')} value=${mono(fmtMoneyMap(c.operator_money_fees) || '—')} />
          </div>
        <//>
      <//>`}

    <${Section} title=${t('dashboard.mintMorsels')} count="04" description=${t('dashboard.ecoMintIntro', { cap: num(e.max_operator_mint_per_day) })}>
      <${Stack} density="compact">
        <${Columns} layout="leading" collapse=${600}>
          <${Field} label=${t('dashboard.gaii')} value=${mintGaii} onInput=${ev => setMintGaii(ev.target.value)} placeholder="agent#owner@node" passwordManager=${false} />
          <${Stack} direction="horizontal" align="end">
            <${Field} type="number" label=${t('dashboard.amount')} value=${mintAmount} onInput=${ev => setMintAmount(ev.target.value)} placeholder="100" min="1" />
            <${Action} kind="primary" onClick=${doMint}>${t('dashboard.mint')}<//>
          <//>
        <//>
        ${mintResult && html`<${Text} tone=${mintResult.ok ? 'success' : 'danger'}>${escHtml(mintResult.msg)}<//>`}
      <//>
    <//>
  <//>`;
}
