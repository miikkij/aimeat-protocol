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
 *   v3.0.1 — 2026-09-28 — No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so a mint error message with a quote or an ampersand showed as &quot; / &amp;.
 *   v3.0.0 — 2026-09-27 — Library components only: the strip is the FigureStrip (the inflation
 *     figure in coral when it is high), the sections Section with their sub-words as the count, the
 *     policy rows Readings in Columns, the grant form TextFields and the Loud action with its
 *     message. The page writes no class.
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
import { fmtMoney } from '/js/utils.js';
import { num, Spinner } from './shared.js';
import { mintMorsels } from '/js/services/admin.js';
import { Section } from '/components/Section.js';
import { Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Note } from '/components/Note.js';
import { Loud } from '/components/Action.js';
import { Columns } from '/components/Layout.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';

/** Format a { EUR: 15000000, USD: 9000000 } micro-units map as "15.00 EUR · 9.00 USD". */
function fmtMoneyMap(m) {
  const entries = Object.entries(m || {});
  if (!entries.length) return '';
  return entries.map(([cur, micros]) => fmtMoney(micros, cur)).join(' · ');
}

/** One policy row: the name, a sentence about what it does, and the value in mono. */
const row = (key, label, why, value, last) => ({ key, name: label, why: why || undefined, value, last });

export default function EconomyTab({ data, reload }) {
  // Hooks must run unconditionally before any early return (Rules of Hooks).
  const [mintGaii, setMintGaii] = useState('');
  const [mintAmount, setMintAmount] = useState('');
  const [mintResult, setMintResult] = useState(null);

  const e = data.dash?.economy;
  if (!e) return html`<${Spinner} text=${t('dashboard.loading')} />`;

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
  const unit = (n) => num(n) + ' ' + t('dashboard.morselUnit');

  return html`
    <${FigureStrip} items=${[
      { key: 'circ', n: num(e.total_morsels_in_circulation), label: t('dashboard.ecoStripCirc'), sub: t('dashboard.ecoStripCircSub') },
      { key: 'minted', n: num(e.total_minted_all_time), label: t('dashboard.ecoStripMinted'), sub: t('dashboard.ecoStripMintedSub', { n: num(e.total_burned_all_time) }) },
      { key: 'infl', n: pct, tone: inflHigh ? 'notice' : undefined, label: t('dashboard.ecoStripInfl'), sub: t('dashboard.ecoStripInflSub') },
      { key: 'tx', n: num(e.transactions_today), label: t('dashboard.ecoStripTx'), sub: t('dashboard.ecoStripTxSub', { n: num(e.morsels_transacted_today) }) },
    ]} />

    <${Section} title=${t('dashboard.ecoMorselsTitle')} count=${t('dashboard.ecoMorselsSub')}>
      <${Note} kind="lead">${t('dashboard.ecoMorselsIntro')}<//>
      <${Columns}>
        <div>
          <${Readings} rows=${[
            row('welcome', t('dashboard.welcomeBonus'), t('dashboard.ecoWhyWelcome'), unit(e.welcome_bonus)),
            row('daily', t('dashboard.dailyAllowance'), t('dashboard.ecoWhyDaily'), unit(e.daily_allowance)),
            row('cap', t('dashboard.allowanceCap'), t('dashboard.ecoWhyCap'), unit(e.daily_allowance_cap)),
          ]} />
        </div>
        <div>
          <${Readings} rows=${[
            row('burn', t('dashboard.burnRate'), t('dashboard.ecoWhyBurnRate'), e.burn_rate),
            row('mintcap', t('dashboard.maxOperatorMint'), t('dashboard.ecoWhyMintCap'), unit(e.max_operator_mint_per_day)),
            row('issued', t('dashboard.dailyAllowancesIssued'), t('dashboard.ecoWhyAllowancesToday'), num(e.daily_allowances_issued_today)),
          ]} />
        </div>
      <//>
    <//>

    ${c && html`
      <${Section} title=${t('dashboard.ecoTradeTitle')} count=${t('dashboard.ecoTradeSub')}>
        <${Columns}>
          <div>
            <${Readings} rows=${[
              row('checkout', t('dashboard.ecoCheckout'),
                c.enabled
                  ? (c.fee_mode === 'operator' ? t('dashboard.ecoFeeOperator', { p: c.fee_percent }) : t('dashboard.ecoFeeBurn', { p: c.fee_percent }))
                  : t('dashboard.ecoCheckoutOff'),
                t('dashboard.ecoSessionsN', { n: num(c.checkout_sessions.total) })),
              row('sessions', t('dashboard.commerceSessions'),
                t('dashboard.ecoSessionsSub', { open: num(c.checkout_sessions.open), done: num(c.checkout_sessions.completed), cancelled: num(c.checkout_sessions.cancelled), expired: num(c.checkout_sessions.expired) }),
                ''),
            ]} />
          </div>
          <div>
            <${Readings} rows=${[
              row('sales', t('dashboard.ecoSales'), t('dashboard.ecoAllTimeToday', { n: num(c.sales_volume_today) }), unit(c.sales_volume_all_time)),
              row('fees', t('dashboard.ecoOperatorFees'), t('dashboard.ecoAllTimeToday', { n: num(c.operator_fees_today) }), unit(c.operator_fees_all_time)),
            ]} />
          </div>
        <//>
      <//>

      <${Section} title=${t('dashboard.ecoMoneyTitle')} count=${t('dashboard.ecoMoneySub')}>
        <${Note} kind="lead">${t('dashboard.ecoMoneyIntro')}<//>
        <${Columns}>
          <div><${Readings} rows=${[row('volume', t('dashboard.commerceMoneyVolume'), null, fmtMoneyMap(c.money_volume) || '—')]} /></div>
          <div><${Readings} rows=${[row('moneyfees', t('dashboard.commerceMoneyFees'), null, fmtMoneyMap(c.operator_money_fees) || '—')]} /></div>
        <//>
      <//>`}

    <${Section} num="04" title=${t('dashboard.mintMorsels')}>
      <${Note} kind="lead">${t('dashboard.ecoMintIntro', { cap: num(e.max_operator_mint_per_day) })}<//>
      <${Fields} cols=${2}>
        <${TextField} label=${t('dashboard.gaii')} value=${mintGaii} onInput=${setMintGaii} placeholder="agent#owner@node" />
        <${TextField} label=${t('dashboard.amount')} type="number" size="short" value=${mintAmount} onInput=${setMintAmount} placeholder="100" min="1" />
      <//>
      <${FormActions}>
        <${Loud} control onClick=${doMint}>${t('dashboard.mint')}<//>
        ${mintResult && html`<${Note} kind="message" error=${!mintResult.ok}>${mintResult.msg}<//>`}
      <//>
    <//>
  `;
}
