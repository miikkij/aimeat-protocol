/**
 * @file public/views/profile/kyc/customers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism's customers: the list (name, kind, risk, sanctions, PEP, next review,
 *   status), its filter "due for review" (the server's: past the review day, or an open sanctions hit),
 *   and the dialog that opens a new customer card with what the firm knows (a person's birth date and
 *   nationality, a company's business id and its beneficial owners as rows, the contact, the purpose,
 *   the source of funds and the PEP status). The server screens and rates the new card itself.
 * @structure useCustomers · secCustomers · customerDialog · bodyOf
 * @usage const cu = useCustomers({ org, active, onOpened }); ... secCustomers(cu, card, num)
 * @version-history
 *   v1.2.0 — 2026-11-27 — The hook keeps the whole list from its last read without the "due" filter
 *     (`all`), for the page's figures; a customer with a possible sanctions match comes first in the
 *     list, then one due for review (a stable sort); the filter is drawn once there is a customer, and
 *     the empty line says what fills the list and the one way to fill it.
 *   v1.1.1 — 2026-11-19 — The new-card dialog's opening line has its own space under it (caption body).
 *   v1.1.0 — 2026-11-19 — Browser check: the list takes the cut name-when-who-state-when-doors (the
 *     sanctions state in its widest state column, the kind under the name, the name opens the card),
 *     stacks under 1180px (stackWide), and keeps every customer name it read (names) for the
 *     suspicions.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { h } from 'preact';
import { useState, useCallback, useEffect } from 'preact/hooks';
import htm from 'htm';
import { Section } from '/components/Section.js';
import { List, Row, Name, Desc, Cell, When } from '/components/List.js';
import { Tabs } from '/components/Tabs.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Modal } from '/components/Modal.js';
import { Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Choice } from '/components/Choice.js';
import { x, word, tone, errWords, dateWord, today, kycApi } from './frame.js';

const html = htm.bind(h);

const PEPS = ['unknown', 'no', 'yes', 'family', 'close-associate', 'former'];
const EMPTY_OWNER = { name: '', birthDate: '', country: '', share: '', control: '' };
const EMPTY = { kind: 'person', name: '', birthDate: '', nationality: '', country: '', businessId: '', contact: '', purpose: '', sourceOfFunds: '', pep: 'unknown', owners: [] };

/**
 * The request body of a new card: empty words left out, the owners only for an entity.
 * @param {typeof EMPTY} f
 */
export function bodyOf(f) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const out = { kind: f.kind, name: s(f.name), pep: f.pep };
  const put = (k, v) => { if (s(v)) out[k] = s(v); };
  put('contact', f.contact); put('purpose', f.purpose); put('sourceOfFunds', f.sourceOfFunds); put('country', f.country);
  if (f.kind === 'person') { put('birthDate', f.birthDate); put('nationality', f.nationality); }
  if (f.kind === 'entity') {
    put('businessId', f.businessId);
    out.beneficialOwners = f.owners.filter((o) => s(o.name)).map((o) => {
      const one = { name: s(o.name) };
      if (s(o.birthDate)) one.birthDate = s(o.birthDate);
      if (s(o.country)) one.country = s(o.country);
      if (s(o.control)) one.control = s(o.control);
      const share = Number(String(o.share).replace(',', '.'));
      if (s(o.share) && Number.isFinite(share)) one.share = share;
      return one;
    });
  }
  return out;
}

/**
 * The list, its filter and the new-card dialog.
 * @param {{ org: string, active: boolean, onOpened: (id: string) => void }} p active: the caller reaches the cards
 */
export function useCustomers({ org, active, onOpened }) {
  const [list, setList] = useState(null);
  // The list as last read without the "due" filter: the page's figures count from it.
  const [all, setAll] = useState(null);
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [names, setNames] = useState({});
  const [due, setDueState] = useState(false);
  const [form, setFormState] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (onlyDue = due) => {
    if (!org || !active) { setList(null); setAll(null); return; }
    try {
      const got = await kycApi.customers(org, onlyDue);
      setList(got); setErr(''); setCode('');
      if (!onlyDue) setAll(got || []);
      // Every name read so far, so a suspicion names its customer under the "due" filter too.
      setNames((n) => ({ ...n, ...Object.fromEntries((got || []).map((c) => [c.id, c.name])) }));
    } catch (e) { setErr(errWords(e)); setCode(e?.code || ''); setList([]); }
  }, [org, active, due]);
  useEffect(() => { setList(null); load(); }, [load]);
  // Another organism: the figures of the one before do not stand for it.
  useEffect(() => { setAll(null); }, [org]);

  const setDue = (v) => { setDueState(v); };
  const startForm = () => setFormState({ ...EMPTY, owners: [{ ...EMPTY_OWNER }], error: '' });
  const setForm = (patch) => setFormState((f) => ({ ...f, ...patch, error: '' }));
  const setOwner = (i, patch) => setFormState((f) => ({ ...f, owners: f.owners.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));
  const addOwner = () => setFormState((f) => ({ ...f, owners: [...f.owners, { ...EMPTY_OWNER }] }));
  const dropOwner = (i) => setFormState((f) => ({ ...f, owners: f.owners.filter((_, j) => j !== i) }));
  const submit = async () => {
    setBusy(true);
    try {
      const v = await kycApi.open(org, bodyOf(form));
      setFormState(null);
      await load();
      if (v?.id) onOpened(v.id);
    } catch (e) { setFormState((f) => ({ ...f, error: errWords(e) })); }
    setBusy(false);
  };
  return { org, list, all, names, err, code, due, setDue, load, form, startForm, setForm, setOwner, addOwner, dropOwner, closeForm: () => setFormState(null), submit, busy };
}

const mark = (group, code) => html`<${Mark} kind="status" tone=${tone(group, code)}>${word(group, code)}<//>`;

/** An open customer with a possible sanctions match: a person decides it. */
export const hasMatch = (c) => c.status !== 'ended' && c.sanctions === 'possible';
/**
 * Due for review as the server's "due" filter decides it (services/kyc/cards.ts listCustomers): not
 * ended, and no review day, a review day today or before, or a possible sanctions match.
 * @param {any} c @param {string} day today as YYYY-MM-DD
 */
export const isDue = (c, day) => c.status !== 'ended' && (!c.nextReviewAt || c.nextReviewAt.slice(0, 10) <= day || c.sanctions === 'possible');

/** The list in the order a person acts on it: a possible match first, then due for review; stable. */
function byAttention(list, day) {
  const rank = (c) => (hasMatch(c) ? 0 : isDue(c, day) ? 1 : 2);
  return list.map((c, i) => [c, i]).sort(([a, i], [b, j]) => (rank(a) - rank(b)) || i - j).map(([c]) => c);
}

/**
 * The customers section.
 * @param {ReturnType<typeof useCustomers>} cu
 * @param {{ id: string, open: (id: string) => void }} card the open card's id and the way to open one
 * @param {string} num
 */
export function secCustomers(cu, card, num) {
  const list = cu.list;
  const now = today();
  return html`
    <${Section} id="kyc-customers" num=${num} title=${x('secCustomers')} count=${list ? String(list.length) : ''} first=${true}
      doors=${html`<${Loud} control onClick=${cu.startForm}>${x('openCustomer')}<//>`}>
      <${Note} kind="lead">${x('customersLead')}<//>
      ${/* The filter once there is a customer to filter (or while it is on, so it can be turned off). */''}
      ${cu.due || (cu.all && cu.all.length) ? html`
        <${Tabs} tone="filter" value=${cu.due ? 'due' : 'all'} onSelect=${(v) => cu.setDue(v === 'due')}
          items=${[{ value: 'all', label: x('filter.all') }, { value: 'due', label: x('filter.due') }]} />` : null}
      ${cu.err ? html`<${Note} kind="quiet">${cu.err}<//>` : html`
        <${List} cols="name-when-who-state-when-doors" labels stackWide loading=${list === null ? x('loading') : false}
          head=${[x('col.name'), x('col.sanctions'), x('col.risk'), x('col.pep'), x('col.nextReview'), x('col.status')]}
          empty=${cu.due ? x('emptyDue') : x('emptyFirst')}>
          ${byAttention(list || [], now).map((c) => html`
            <${Row} key=${c.id} selected=${card.id === c.id} faded=${c.status === 'ended'} rail=${c.sanctions === 'possible' ? 'warn' : undefined}>
              <${Name} onOpen=${() => card.open(c.id)} openLabel=${x('openCard', { name: c.name })} meta=${`${word('kind', c.kind)} · ${x('updated', { when: dateWord(c.updatedAt) })}`}>${c.name}<//>
              <${Cell}>${mark('sanctions', c.sanctions)}<//>
              <${Cell}>${mark('risk', c.risk)}<//>
              <${Desc}>${word('pep', c.pep)}<//>
              <${When} warn=${c.status !== 'ended' && !!c.nextReviewAt && c.nextReviewAt.slice(0, 10) <= now}>${c.status === 'ended' ? '–' : dateWord(c.nextReviewAt)}<//>
              <${Cell}>${mark('status', c.status)}<//>
            <//>`)}
        <//>`}
    <//>`;
}

/** One beneficial owner's row of fields, with its remove action. */
function ownerFields(cu, o, i) {
  return html`
    <${Fields} key=${i} cols=${2} ruled>
      <${TextField} label=${x('form.ownerName', { n: i + 1 })} value=${o.name} onInput=${(v) => cu.setOwner(i, { name: v })} />
      <${TextField} label=${x('form.ownerShare')} type="number" min=${0} max=${100} step="any" size="short" value=${o.share} onInput=${(v) => cu.setOwner(i, { share: v })} />
      <${TextField} label=${x('form.birthDate')} type="date" value=${o.birthDate} max=${today()} onInput=${(v) => cu.setOwner(i, { birthDate: v })} />
      <${TextField} label=${x('form.ownerCountry')} hint=${x('form.countryHint')} size="medium" value=${o.country} onInput=${(v) => cu.setOwner(i, { country: v })} />
      <${TextField} label=${x('form.ownerControl')} hint=${x('form.ownerControlHint')} value=${o.control} onInput=${(v) => cu.setOwner(i, { control: v })} />
      <${Actions}><${Action} small soft tone="danger" onClick=${() => cu.dropOwner(i)}>${x('form.ownerRemove')}<//><//>
    <//>`;
}

/**
 * The dialog that opens a new card, or null.
 * @param {ReturnType<typeof useCustomers>} cu
 */
export function customerDialog(cu) {
  const f = cu.form;
  if (!f) return null;
  const person = f.kind === 'person';
  const ready = !!f.name.trim();
  const foot = html`
    <${Action} small soft onClick=${cu.closeForm}>${x('cancel')}<//>
    <${Loud} control disabled=${!ready || cu.busy} onClick=${cu.submit}>${cu.busy ? x('saving') : x('form.save')}<//>`;
  return html`
    <${Modal} open size="lg" title=${x('form.title')} onClose=${cu.closeForm} footer=${foot}>
      <${Note} kind="caption" size="body">${x('form.lead')}<//>
      <${Fields}>
        <${Choice} label=${x('form.kind')} value=${f.kind} onChange=${(v) => cu.setForm({ kind: v })}
          options=${[['person', word('kind', 'person')], ['entity', word('kind', 'entity')]]} />
        <${TextField} label=${person ? x('form.namePerson') : x('form.nameEntity')} value=${f.name} autoFocus onInput=${(v) => cu.setForm({ name: v })} />
        ${person ? html`
          <${TextField} label=${x('form.birthDate')} type="date" value=${f.birthDate} max=${today()} onInput=${(v) => cu.setForm({ birthDate: v })} />
          <${TextField} label=${x('form.nationality')} hint=${x('form.countryHint')} size="medium" value=${f.nationality} onInput=${(v) => cu.setForm({ nationality: v })} />`
        : html`<${TextField} label=${x('form.businessId')} code size="medium" value=${f.businessId} onInput=${(v) => cu.setForm({ businessId: v })} />`}
        <${TextField} label=${person ? x('form.countryPerson') : x('form.countryEntity')} hint=${x('form.countryHint')} size="medium" value=${f.country} onInput=${(v) => cu.setForm({ country: v })} />
        <${TextField} label=${x('form.contact')} value=${f.contact} onInput=${(v) => cu.setForm({ contact: v })} />
        <${TextArea} label=${x('form.purpose')} hint=${x('form.purposeHint')} rows=${2} value=${f.purpose} onInput=${(v) => cu.setForm({ purpose: v })} />
        <${TextArea} label=${x('form.sourceOfFunds')} rows=${2} value=${f.sourceOfFunds} onInput=${(v) => cu.setForm({ sourceOfFunds: v })} />
        <${Select} label=${x('form.pep')} help="kyc.pep" value=${f.pep} onChange=${(v) => cu.setForm({ pep: v })}
          options=${PEPS.map((p) => [p, word('pep', p)])} />
      <//>
      ${person ? null : html`
        <${Note} kind="lead">${x('form.ownersLead')}<//>
        ${f.owners.map((o, i) => ownerFields(cu, o, i))}
        <${Actions}><${Action} small onClick=${cu.addOwner}>${x('form.ownerAdd')}<//><//>`}
      <${Note} kind="hint">${x('form.after')}<//>
      ${f.error ? html`<${Note} kind="message" error>${f.error}<//>` : null}
    <//>`;
}
