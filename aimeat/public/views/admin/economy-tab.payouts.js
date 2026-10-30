/**
 * @file public/views/admin/economy-tab.payouts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Economy tab's section of beneficiary payouts whose settlement did not answer: the
 *   payment service did not confirm whether a provider's transfer to a beneficiary went out. Each row
 *   names who paid whom, how much, when and the nonce to look up on the chain; under it the operator
 *   writes the reference (the transaction hash or a case number) and marks the payout arrived. The
 *   entries are then recorded as paid and both parties are told (GET /v1/commerce/beneficiary/
 *   possible-payouts and POST .../arrived, commerce/beneficiary-payout-hold.ts). The section shows only
 *   while one is open; it is read when the tab opens, after each mark and on 'aimeat-live-update'.
 * @structure PossiblePayoutsSection
 * @version-history
 *   v1.0.1 -- 2026-10-30 -- Re-reads on 'aimeat-live-update' like the other server-data sections.
 *   v1.0.0 -- 2026-10-29 -- Initial (secaudit2026oct26 round 8c, commerce/beneficiary-payout:settle-error-unrecorded-possible-payment).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { fmtMoney } from '/js/utils.js';
import { dt } from './shared.js';
import { getPossiblePayouts, markPossiblePayoutArrived } from '/js/services/admin.js';
import { Section } from '/components/Section.js';
import { Note } from '/components/Note.js';
import { Loud } from '/components/Action.js';
import { List, Row, Name, When, Num, Doors } from '/components/List.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';

const P = (key, vars) => t('dashboard.possiblePayouts.' + key, vars);

/** One open payout: the row, and under it the reference and the button. */
function PayoutRow({ p, onArrived }) {
  const [reference, setReference] = useState('');
  const [result, setResult] = useState(null);
  async function mark() {
    if (!reference.trim()) { setResult({ ok: false, msg: P('referenceRequired') }); return; }
    try {
      await markPossiblePayoutArrived(p.provider, p.nonce, reference.trim());
      onArrived();
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    }
  }
  return html`
    <${Row} rail="warn" below=${html`
      <${Fields} cols=${1}>
        <${TextField} label=${P('reference')} note=${P('referenceNote')} value=${reference} onInput=${setReference} onEnter=${mark} code />
      <//>
      <${FormActions}>
        <${Loud} control onClick=${mark}>${P('markArrived')}<//>
        ${result && html`<${Note} kind="message" error=${!result.ok}>${result.msg}<//>`}
      <//>`}>
      <${Name} meta=${P('nonce', { nonce: p.nonce })} desc=${P('payer', { payer: p.payer, to: p.pay_to, network: p.network })}>${P('who', { provider: p.provider, beneficiary: p.beneficiary })}<//>
      <${When}>${dt(p.created_at)}<//>
      <${Num} strong>${fmtMoney(p.amount, p.currency)}<//>
      <${Doors} />
    <//>`;
}

export function PossiblePayoutsSection() {
  const [rows, setRows] = useState([]);
  const [failed, setFailed] = useState(null);
  const load = useCallback(() => {
    getPossiblePayouts()
      .then(r => { setFailed(null); setRows(r.data?.possible_payouts ?? []); })
      .catch(err => setFailed(err.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    window.addEventListener('aimeat-live-update', load);
    return () => window.removeEventListener('aimeat-live-update', load);
  }, [load]);
  if (!rows.length && !failed) return null;
  return html`
    <${Section} title=${P('title')} count=${P('count', { n: rows.length })}>
      <${Note} kind="lead">${P('lead')}<//>
      ${failed && html`<${Note} kind="message" error>${failed}<//>`}
      <${List} cols="name-when-amount-doors" keepCols head=${[P('colWho'), P('colWhen'), { label: P('colAmount'), num: true }, '']}>
        ${rows.map(p => html`<${PayoutRow} key=${p.provider + p.nonce} p=${p} onArrived=${load} />`)}
      <//>
    <//>`;
}
