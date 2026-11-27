/**
 * @file public/views/profile/kyc/assessment.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The section "Risk assessment", for the organism's compliance officers and admins: the
 *   business-wide risk assessment (AMLR art. 10) and the data protection impact assessment of the due
 *   diligence itself (GDPR art. 35), both drafted by the server from the organism's own cards
 *   (services/kyc/assessment.ts). The page states when the risk assessment was last recorded and
 *   whether it is due, the organism's own numbers per risk area in the reader's words, and the
 *   server's English draft only as text to copy into the firm's own document or its AI: the
 *   assessment is the firm's own document. A person records, in person, that it was updated today
 *   and where it is. The DPIA draft is shown readable and saved into the organism's compliance
 *   records on a press: the compliance write replaces the whole document, so the page reads it first
 *   and puts the item in by its id.
 * @structure useAssessment · secAssessment · strip · areaFacts · dpiaPart · sentences
 * @usage const ra = useAssessment({ org, role, active }); ... secAssessment(ra, num)
 * @version-history
 *   v1.2.0 — 2026-11-27 — The section is a row (Section fold) that says when the assessment was last
 *     recorded and whether it is due, and opens in place; it opens by itself while the assessment is
 *     due. "Record as updated today" and "Store the DPIA draft" are ordinary actions in the control
 *     size: the page has one loud action. Nothing inside changed, and the in-person rule stays.
 *   v1.1.0 — 2026-11-19 — The risk draft shows open with "Copy the draft"; the DPIA shows one risk or
 *     measure per line as the server writes them, says when it is already stored, and loads again
 *     after a save; the figures are stacked so their words line up.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { h } from 'preact';
import { useState, useCallback, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts, FactLine } from '/components/Facts.js';
import { PromptCard } from '/components/PromptCard.js';
import { SubHeading } from '/components/SubHeading.js';
import { TextField } from '/components/TextField.js';
import { Action, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { x, word, errWords, dateWord } from './frame.js';

const html = htm.bind(h);
const enc = encodeURIComponent;
const part = (words) => html`<${SubHeading} level=${3} rule>${words}<//>`;
const AREAS = ['customers', 'countries', 'products', 'channels', 'transactions'];

/**
 * The drafts and the two writes.
 * @param {{ org: string, role: string, active: boolean }} p active: the cards answer (KYC is on for the caller)
 */
export function useAssessment({ org, role, active }) {
  const may = active && (role === 'officer' || role === 'manager');
  const [ra, setRa] = useState(null);
  const [dpia, setDpia] = useState(null);
  const [err, setErr] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [dpiaMsg, setDpiaMsg] = useState(null);
  // The row's state: null until the person opens or shuts it, then their choice.
  const [shown, setShown] = useState(null);

  const load = useCallback(async () => {
    if (!org || !may) { setRa(null); setDpia(null); return; }
    try {
      const [a, d] = await Promise.all([apiGet(`/v1/kyc/${enc(org)}/risk-assessment`), apiGet(`/v1/kyc/${enc(org)}/dpia-draft`)]);
      setRa(a?.data || null); setDpia(d?.data || null); setErr('');
    } catch (e) { setErr(errWords(e)); }
  }, [org, may]);
  useEffect(() => { setRa(null); setDpia(null); setMsg(null); setDpiaMsg(null); setShown(null); load(); }, [load]);
  // Open by itself while the assessment is due: that needs the person.
  const open = shown ?? !!ra?.due;
  const toggle = () => setShown(!open);

  /** Record, in person, that the firm's risk assessment was updated today, and where it is. */
  const record = async () => {
    // Keep the row open: once recorded it is no longer due, and the message must stay in sight.
    setBusy('record'); setShown(true);
    try {
      await apiPost(`/v1/kyc/${enc(org)}/risk-assessment/recorded`, ref.trim() ? { ref: ref.trim() } : {});
      setRef(''); setMsg({ text: x('ra.recorded') });
      await load();
    } catch (e) { setMsg({ text: errWords(e), error: true }); }
    setBusy('');
  };

  /** Store the DPIA draft in the organism's records: the server keeps every other item and replaces this one by its id. */
  const saveDpia = async () => {
    if (!dpia?.store?.write?.path) return;
    setBusy('dpia');
    try {
      await apiPost(dpia.store.write.path, {});
      setDpiaMsg({ text: x('dpia.saved'), done: true });
      await load();
    } catch (e) { setDpiaMsg({ text: errWords(e), error: true }); }
    setBusy('');
  };

  return { org, may, ra, dpia, err, load, open, toggle, ref, setRef, record, saveDpia, busy, msg, dpiaMsg };
}

/** The four figures that matter most, from the facts. */
function strip(f) {
  return html`<${FigureStrip} wrap stacked items=${[
    { n: f.customers.open, label: x('ra.fig.open'), sub: x('ra.fig.openSub', { ended: f.customers.ended }) },
    { n: f.customers.byRisk.high + f.customers.byRisk.prohibited, tone: f.customers.byRisk.high ? 'notice' : undefined, label: x('ra.fig.high') },
    { n: f.pep.customers, label: x('ra.fig.pep'), sub: x('ra.fig.pepSub', { n: f.pep.unknown }) },
    { n: f.reviewsOverdue, tone: f.reviewsOverdue ? 'notice' : undefined, label: x('ra.fig.overdue'), sub: x('ra.fig.hitsSub', { n: f.openSanctionsHits }) },
  ]} />`;
}

/** One risk area's numbers as Facts rows, in the reader's words. */
function areaFacts(id, f) {
  const c = f.customers;
  const list = (rec, group) => Object.entries(rec).map(([k, v]) => `${k === 'unrated' || k === 'unset' ? x('ra.notSet') : word(group, k)} ${v}`).join(' · ');
  if (id === 'customers') {
    return [
      { k: x('ra.f.byKind'), v: `${word('kind', 'person')} ${c.byKind.person} · ${word('kind', 'entity')} ${c.byKind.entity}` },
      { k: x('ra.f.byRisk'), v: list(c.byRisk, 'risk') },
      { k: x('ra.f.byDd'), v: list(c.byDueDiligence, 'dd') },
      { k: x('ra.f.pep'), v: x('ra.f.pepV', { n: f.pep.customers, unknown: f.pep.unknown }) },
      { k: x('ra.f.complex'), v: String(f.complexOwnership) },
      { k: x('ra.f.open'), v: x('ra.f.openV', { blocked: c.byStatus.blocked, hits: f.openSanctionsHits, overdue: f.reviewsOverdue }), warn: !!(f.openSanctionsHits || f.reviewsOverdue) },
    ];
  }
  if (id === 'countries') {
    const shown = f.countries.slice(0, 12).map((k) => `${k.country} ${k.customers}${k.highRisk ? ` (${x('ra.f.highTag')})` : ''}`).join(' · ');
    return [
      { k: x('ra.f.countries'), v: shown || x('ra.f.noCountries'), sub: f.countries.length > 12 ? x('ra.f.more', { n: f.countries.length - 12 }) : undefined },
      { k: x('ra.f.listed'), v: f.highRiskCountriesListed ? String(f.highRiskCountriesListed) : x('ra.f.listEmpty'), warn: !f.highRiskCountriesListed },
      { k: x('ra.f.linked'), v: String(f.highRiskCountryCustomers) },
    ];
  }
  if (id === 'products') {
    return [
      { k: x('ra.f.product'), v: list(f.productRisk, 'risk') },
      { k: x('ra.f.cash'), v: String(f.cashIntensive) },
    ];
  }
  if (id === 'channels') {
    return [
      { k: x('ra.f.faceToFace'), v: String(f.identity.faceToFace) },
      { k: x('ra.f.remote'), v: x('ra.f.remoteV', { n: f.identity.remote, low: f.identity.remoteBelowSubstantial }) },
      { k: x('ra.f.notIdentified'), v: String(f.identity.notIdentified), warn: !!f.identity.notIdentified },
    ];
  }
  return [
    { k: x('ra.f.purposeUnknown'), v: String(f.purposeUnknown) },
    { k: x('ra.f.sofUnknown'), v: String(f.sourceOfFundsUnknown), sub: x('ra.f.noTx') },
  ];
}

/** A text the server writes one item per line, as its lines. */
function lines(text) {
  return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

/** The DPIA draft, readable, with the action that stores it. */
function dpiaPart(r) {
  const d = r.dpia;
  if (!d?.item) return null;
  const it = d.item;
  const rows = (text) => lines(text).map((s, i) => html`<${FactLine} key=${i}>${s}<//>`);
  return html`
    ${part(x('dpia.title'))}
    <${Note} kind="lead">${x('dpia.lead')}<//>
    ${d.stored ? html`<${Note} kind="state" tone="fine">${x('dpia.stored')}<//>` : null}
    <${Facts} wide rows=${[
      { k: x('dpia.item'), v: x('dpia.itemTitle'), sub: it.id },
      { k: x('dpia.description'), v: it.description, pre: true },
      { k: x('dpia.necessity'), v: it.necessity, pre: true },
      { k: x('dpia.risks'), v: rows(it.risks) },
      { k: x('dpia.measures'), v: rows(it.measures) },
    ]} />
    <${Note} kind="hint">${x('dpia.replaceHint')}<//>
    <${Actions} apart>
      <${Action} control disabled=${!!r.busy} onClick=${r.saveDpia}>${r.busy === 'dpia' ? x('saving') : x(d.stored ? 'dpia.saveAgain' : 'dpia.save')}<//>
    <//>
    ${r.dpiaMsg ? html`<${Note} kind="message" error=${!!r.dpiaMsg.error}>${r.dpiaMsg.text}<//>` : null}`;
}

/**
 * The section, or null for a caller who is not an officer or an admin.
 * @param {ReturnType<typeof useAssessment>} r
 * @param {string} num
 */
export function secAssessment(r, num) {
  if (!r.may) return null;
  const a = r.ra;
  const f = a?.facts;
  const draft = a ? a.sections.map((s) => `${s.title}\n${s.text}`).join('\n\n') : '';
  // The row's one line: when it was last recorded, and whether it is due.
  const sub = !a ? (r.err ? '' : '…')
    : `${a.lastRecordedAt ? x('ra.foldOn', { day: dateWord(a.lastRecordedAt) }) : x('ra.foldNever')}${a.due ? ` · ${x('ra.foldDue')}` : ''}`;
  return html`
    <${Section} fold wrap id="kyc-assessment" num=${num} title=${x('secAssessment')} sub=${sub} open=${r.open} onToggle=${r.toggle}>
      ${r.err ? html`<${Note} kind="quiet">${r.err}<//>` : !a ? html`<${Note} kind="loading">${x('loading')}<//>` : html`
        <${Note} kind="lead">${x('ra.lead')}<//>
        <${Note} kind="state" tone=${a.due ? 'attention' : 'fine'}>
          ${a.lastRecordedAt ? x('ra.recordedOn', { day: dateWord(a.lastRecordedAt) }) : x('ra.never')}${a.due ? ` ${x('ra.due')}` : ''}
        <//>
        ${a.ref ? html`<${Facts} rows=${[{ k: x('ra.where'), v: a.ref }]} />` : null}
        ${strip(f)}
        ${AREAS.map((id) => html`${part(x('ra.area.' + id))}<${Facts} wide rows=${areaFacts(id, f)} />`)}
        ${part(x('ra.draftPart'))}
        <${PromptCard} quiet label=${x('ra.draftLabel')} prompt=${draft} copyLabel=${x('ra.copyDraft')} copiedLabel=${t('common.copied')} />
        <${Note} kind="hint">${x('ra.draftHint')}<//>
        ${part(x('ra.recordPart'))}
        <${TextField} label=${x('ra.ref')} hint=${x('ra.refHint')} value=${r.ref} onInput=${(v) => r.setRef(v)} />
        <${Actions} apart>
          <${Action} small disabled=${!!r.busy} onClick=${r.record}>${r.busy === 'record' ? x('saving') : x('ra.record')}<//>
        <//>
        <${Note} kind="hint">${x('ra.inPerson')}<//>
        ${r.msg ? html`<${Note} kind="message" error=${!!r.msg.error}>${r.msg.text}<//>` : null}
        ${dpiaPart(r)}`}
    <//>`;
}
