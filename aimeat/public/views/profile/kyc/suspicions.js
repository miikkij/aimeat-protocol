/**
 * @file public/views/profile/kyc/suspicions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Suspicions. Everyone with a role in the organism's due diligence marks one: what they
 *   saw, and the customer if there is one; the answer is only "received", because the law forbids
 *   telling anyone else that a report exists (AMLR art. 73). The compliance officers, in person, see
 *   the list and work a case into a report for the Financial Intelligence Unit: the report type (STR
 *   or SAR), the indicators, the transactions as rows, the narrative (the server's AI can draft it
 *   from the saved facts), then either "recorded as sent in goAML" with goAML's reference or "not
 *   reported" with the decision. A decided case is read only.
 * @structure useSuspicions · secSuspicions · draftOf
 * @usage const su = useSuspicions({ org, role, customers }); ... secSuspicions(su, num)
 * @version-history
 *   v1.1.0 — 2026-11-19 — Browser check: the case names its customer (the names the customers list
 *     read; the id only when the name is not known), and the cases, the transactions, the narrative
 *     and the decision each stand under a rule heading (SubHeading rule) with air above.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { h } from 'preact';
import { useState, useCallback, useEffect } from 'preact/hooks';
import htm from 'htm';
import { Section } from '/components/Section.js';
import { List, Row, Name, Who, Cell, When, Doors } from '/components/List.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Choice } from '/components/Choice.js';
import { TagInput } from '/components/TagInput.js';
import { SubHeading } from '/components/SubHeading.js';
import { x, word, tone, errWords, dateWord, timeWord, kycApi } from './frame.js';

const html = htm.bind(h);

/** The heading of one part of the section: coral capitals over the rule, with air above it. */
const part = (words) => html`<${SubHeading} level=${3} rule>${words}<//>`;

const EMPTY_TX ={ date: '', amount: '', currency: 'EUR', description: '' };

/** The editable part of a report, as the form holds it. */
export function draftOf(r) {
  return {
    reportType: r.reportType || 'STR',
    indicators: r.indicators || [],
    transactions: (r.transactions || []).map((tx) => ({ ...tx, amount: String(tx.amount) })),
    narrative: r.narrative || '',
    goamlRef: '', decision: '', closeDecision: '',
  };
}

/** The rows of the transactions the form can send: a date and a number each. */
function txBody(rows) {
  return rows.filter((tx) => tx.date && tx.amount !== '' && Number.isFinite(Number(String(tx.amount).replace(',', '.'))))
    .map((tx) => ({ date: tx.date, amount: Number(String(tx.amount).replace(',', '.')), currency: (tx.currency || 'EUR').toUpperCase().slice(0, 3), description: tx.description.trim() }));
}

/**
 * The mark form for everyone, and the officer's list and draft.
 * @param {{ org: string, role: string, active: boolean }} p
 */
export function useSuspicions({ org, role, active }) {
  const officer = role === 'officer';
  const [mark, setMarkState] = useState({ customerId: '', observation: '' });
  const [markMsg, setMarkMsg] = useState(null);
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState('');
  const [draft, setDraftState] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    if (!org || !active || !officer) { setList(null); return; }
    try { setList(await kycApi.suspicions(org)); setErr(''); } catch (e) { setErr(errWords(e)); setList([]); }
  }, [org, active, officer]);
  useEffect(() => { setList(null); setOpenId(''); setDraftState(null); load(); }, [load]);

  const setMark = (patch) => { setMarkState((m) => ({ ...m, ...patch })); setMarkMsg(null); };
  const sendMark = async () => {
    setBusy('mark');
    try {
      await kycApi.mark(org, { observation: mark.observation.trim(), ...(mark.customerId ? { customer_id: mark.customerId } : {}) });
      setMarkState({ customerId: '', observation: '' });
      setMarkMsg({ text: x('sus.received') });
      load();
    } catch (e) { setMarkMsg({ text: errWords(e), error: true }); }
    setBusy('');
  };

  const report = list && openId ? list.find((r) => r.id === openId) || null : null;
  const open = (id) => {
    if (openId === id) { setOpenId(''); setDraftState(null); return; }
    const r = (list || []).find((s) => s.id === id);
    setOpenId(id); setDraftState(r ? draftOf(r) : null); setMsg(null);
  };
  const setDraft = (patch) => { setDraftState((d) => ({ ...d, ...patch })); setMsg(null); };
  const setTx = (i, patch) => setDraftState((d) => ({ ...d, transactions: d.transactions.map((tx, j) => (j === i ? { ...tx, ...patch } : tx)) }));
  const addTx = () => setDraftState((d) => ({ ...d, transactions: [...d.transactions, { ...EMPTY_TX }] }));
  const dropTx = (i) => setDraftState((d) => ({ ...d, transactions: d.transactions.filter((_, j) => j !== i) }));

  /** Save the draft's facts; the AI and the two decisions read what is saved. */
  const save = async (quiet) => {
    const body = { reportType: draft.reportType, indicators: draft.indicators, transactions: txBody(draft.transactions), narrative: draft.narrative };
    const r = await kycApi.saveDraft(org, openId, body);
    setList((l) => (l || []).map((s) => (s.id === r.id ? r : s)));
    if (!quiet) setMsg({ text: x('sus.saved') });
    return r;
  };
  const run = async (what, fn) => {
    setBusy(what);
    try { await fn(); } catch (e) { setMsg({ text: errWords(e), error: true }); }
    setBusy('');
  };
  const saveDraft = () => run('save', () => save(false));
  const assist = () => run('assist', async () => {
    await save(true);
    const r = await kycApi.report(org, openId, 'assist');
    setDraftState((d) => ({ ...d, narrative: r.narrative }));
    setMsg({ text: x('sus.assisted', { model: r.model }) });
  });
  const submit = () => run('submit', async () => {
    await save(true);
    await kycApi.report(org, openId, 'submit', { goaml_ref: draft.goamlRef.trim(), ...(draft.decision.trim() ? { decision: draft.decision.trim() } : {}) });
    await load();
    setMsg({ text: x('sus.submitted') });
  });
  const close = () => run('close', async () => {
    await kycApi.report(org, openId, 'close', { decision: draft.closeDecision.trim() });
    await load();
    setMsg({ text: x('sus.closed') });
  });

  return { org, officer, active, mark, setMark, sendMark, markMsg, list, err, load, openId, open, report, draft, setDraft, setTx, addTx, dropTx, saveDraft, assist, submit, close, busy, msg };
}

const status = (s) => html`<${Mark} kind="status" tone=${tone('report', s)}>${word('report', s)}<//>`;

/** The mark form: open to everyone with a role. */
function markForm(su, customers) {
  const m = su.mark;
  const ready = m.observation.trim().length >= 10;
  return html`
    <${Note} kind="lead">${x('sus.markLead')}<//>
    <${Fields}>
      <${Select} label=${x('sus.customer')} value=${m.customerId} placeholder=${x('sus.noCustomer')}
        options=${(customers || []).map((c) => [c.id, c.name])} onChange=${(v) => su.setMark({ customerId: v })} />
      <${TextArea} label=${x('sus.observation')} hint=${x('sus.observationHint')} rows=${4} value=${m.observation} onInput=${(v) => su.setMark({ observation: v })} />
      <${FormActions}>
        <${Loud} control disabled=${!ready || su.busy === 'mark'} onClick=${su.sendMark}>${su.busy === 'mark' ? x('saving') : x('sus.markSave')}<//>
        ${su.markMsg ? html`<${Note} kind="message" error=${!!su.markMsg.error}>${su.markMsg.text}<//>` : null}
      <//>
    <//>`;
}

/** One transaction's fields, with its remove action. */
function txFields(su, tx, i, locked) {
  return html`
    <${Fields} key=${i} cols=${2} ruled>
      <${TextField} label=${x('sus.txDate')} type="date" value=${tx.date} disabled=${locked} onInput=${(v) => su.setTx(i, { date: v })} />
      <${TextField} label=${x('sus.txAmount')} type="number" step="any" size="short" value=${tx.amount} disabled=${locked} onInput=${(v) => su.setTx(i, { amount: v })} />
      <${TextField} label=${x('sus.txCurrency')} size="short" maxLength=${3} value=${tx.currency} disabled=${locked} onInput=${(v) => su.setTx(i, { currency: v.toUpperCase() })} />
      <${TextField} label=${x('sus.txDescription')} value=${tx.description} disabled=${locked} onInput=${(v) => su.setTx(i, { description: v })} />
      ${locked ? null : html`<${Actions}><${Action} small soft tone="danger" onClick=${() => su.dropTx(i)}>${x('sus.txRemove')}<//><//>`}
    <//>`;
}

/**
 * The officer's draft of the open case.
 * @param {ReturnType<typeof useSuspicions>} su
 * @param {Record<string, string>} names customer names by id; the id shows only when the name is not known
 */
function draftPanel(su, names) {
  const r = su.report;
  const d = su.draft;
  if (!r || !d) return null;
  const locked = r.status === 'submitted' || r.status === 'not-reported';
  const b = su.busy;
  return html`
    <${Box} name=${x('sus.caseTitle', { when: dateWord(r.markedAt) })} marks=${status(r.status)}>
      <${Facts} rows=${[
        { k: x('sus.observation'), v: r.observation, pre: true, sub: x('sus.markedBy', { who: r.markedBy, when: timeWord(r.markedAt) }) },
        r.customerId && { k: x('sus.customer'), v: names[r.customerId] || r.customerId, mono: !names[r.customerId] },
        r.goamlRef && { k: x('sus.goamlRef'), v: r.goamlRef, mono: true, sub: r.submittedAt ? timeWord(r.submittedAt) : undefined },
        r.decision && { k: x('sus.decision'), v: r.decision, pre: true },
        r.retainUntil && { k: x('f.retainUntil'), v: dateWord(r.retainUntil) },
      ]} />
      <${Fields}>
        <${Choice} label=${x('sus.reportType')} help="kyc.reportType" value=${d.reportType} disabled=${locked} onChange=${(v) => su.setDraft({ reportType: v })}
          options=${[['STR', x('sus.str')], ['SAR', x('sus.sar')]]} />
        <${TagInput} label=${x('sus.indicators')} hint=${x('sus.indicatorsHint')} tags=${d.indicators} disabled=${locked} onChange=${(tags) => su.setDraft({ indicators: tags })} />
      <//>
      ${part(x('part.transactions'))}
      <${Note} kind="lead">${x('sus.txLead')}<//>
      ${d.transactions.length ? d.transactions.map((tx, i) => txFields(su, tx, i, locked)) : html`<${Note} kind="quiet">${x('sus.noTx')}<//>`}
      ${locked ? null : html`<${Actions} apart><${Action} small onClick=${su.addTx}>${x('sus.txAdd')}<//><//>`}
      ${part(x('part.narrative'))}
      <${TextArea} label=${x('sus.narrative')} hint=${x('sus.narrativeHint')} rows=${8} grow value=${d.narrative} readOnly=${locked} onInput=${(v) => su.setDraft({ narrative: v })} />
      ${locked ? null : html`
        <${FormActions}>
          <${Loud} control disabled=${!!b} onClick=${su.saveDraft}>${b === 'save' ? x('saving') : x('sus.save')}<//>
          <${Action} small disabled=${!!b} onClick=${su.assist}>${b === 'assist' ? x('sus.assisting') : x('sus.assist')}<//>
        <//>
        <${Note} kind="hint">${x('sus.assistHint')}<//>
        ${part(x('part.decision'))}
        <${Fields}>
          <${TextField} label=${x('sus.goamlRef')} hint=${x('sus.goamlRefHint')} code value=${d.goamlRef} onInput=${(v) => su.setDraft({ goamlRef: v })}
            actions=${html`<${Action} small disabled=${!d.goamlRef.trim() || !!b} onClick=${su.submit}>${x('sus.submit')}<//>`} />
          <${TextArea} label=${x('sus.notReportedWhy')} hint=${x('sus.notReportedHint')} rows=${2} value=${d.closeDecision} onInput=${(v) => su.setDraft({ closeDecision: v })} />
          <${Actions}><${Action} small tone="danger" disabled=${!d.closeDecision.trim() || !!b} onClick=${su.close}>${x('sus.notReported')}<//><//>
        <//>`}
      ${su.msg ? html`<${Note} kind="message" error=${!!su.msg.error}>${su.msg.text}<//>` : null}
    <//>`;
}

/** The officer's list of cases. */
function officerList(su, names) {
  return html`
    ${part(x('part.cases'))}
    <${Note} kind="lead">${x('sus.listLead')}<//>
    ${su.err ? html`<${Note} kind="quiet">${su.err}<//>` : html`
      <${List} cols="when-name-who-state-doors" keepCols loading=${su.list === null ? x('loading') : false}
        head=${[x('col.when'), x('sus.observation'), x('col.by'), x('col.status'), '']} empty=${x('sus.empty')}>
        ${(su.list || []).map((r) => html`
          <${Row} key=${r.id} selected=${su.openId === r.id} faded=${r.status === 'not-reported'} rail=${r.status === 'marked' ? 'warn' : undefined}>
            <${When}>${dateWord(r.markedAt)}<//>
            <${Name} clip onOpen=${() => su.open(r.id)} meta=${r.reportType || undefined}>${r.observation}<//>
            <${Who} clip>${r.markedBy}<//>
            <${Cell}>${status(r.status)}<//>
            <${Doors}><${Action} small row onClick=${() => su.open(r.id)}>${su.openId === r.id ? x('close') : x('open')}<//><//>
          <//>`)}
      <//>`}
    ${draftPanel(su, names)}`;
}

/**
 * The suspicions section, or null for a caller without a role.
 * @param {ReturnType<typeof useSuspicions>} su
 * @param {{ list: any[] | null, names: Record<string, string> }} cu the customers (useCustomers): the
 *   list for the mark form's picker, and every name read, for the case's customer
 * @param {string} num
 */
export function secSuspicions(su, cu, num) {
  if (!su.active) return null;
  return html`
    <${Section} id="kyc-suspicions" num=${num} title=${x('secSuspicions')} count=${su.officer && su.list ? String(su.list.length) : ''}>
      ${markForm(su, cu.list)}
      ${su.officer ? officerList(su, cu.names || {}) : html`<${Note} kind="hint">${x('sus.notOfficer')}<//>`}
    <//>`;
}
