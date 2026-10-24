/**
 * @file public/views/admin/compliance-agreements-section.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The admin Compliance page's "Agreements" section (plan doc-mvmr4i2wdk0p, D5; the design's
 *   row 1, approved 2026-10-24): the data processing agreements the operator keeps with its customers.
 *   The screen half of /v1/compliance/agreements; the operator's AI does the same with
 *   aimeat_compliance_agreement, and the section offers the words for it.
 *
 *   THE ORDER OF THE SECTION. The counts first; then what waits for the operator (a signed copy to
 *   decide, a sub-processor taken into use and not announced, an objection), each with the press that
 *   answers it; then the list; then the opened agreement: its parties, the step that waits with its one
 *   loud action, the steps so far, the annexes (Annex IV marks what a draft changes against the version
 *   in force) and the clocks it promises. A new agreement starts from a short form: the node fills the
 *   rest from its own data, and names the measures it cannot see.
 *
 *   Live data by the `compliance` live-update domain, never on a timer.
 * @structure Strip · Waiting · ReviewBox · NewAgreement · Detail · AgreementsSection (default)
 * @usage html`<${AgreementsSection} num="11" onMessage=${(kind, text) => …} />`
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D5).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import {
  listAgreements, agreementGaps, getAgreement, createAgreement, newVersion, sendAgreement, announceChange, decideCopy,
  endAgreement, deletionDone, downloadAgreementPdf,
} from '/js/services/agreements.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Desc, Cell, Doors } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Stack } from '/components/Layout.js';
import { Facts } from '/components/Facts.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { useConfirm } from '/components/Modal.js';
import { A, StatusMark, Steps, Annexes, Obligations, newestOf, inForceOf, dateOf } from '../profile/agreements/parts.js';

const html = htm.bind(h);

function Strip({ list, gaps }) {
  const c = list?.counts ?? {};
  const waitingYou = (list?.items ?? []).filter((i) => i.waiting === 'operator').length;
  return html`<${FigureStrip} lead wrap stacked items=${[
    { key: 'signed', n: c.signed ?? 0, label: A('op.inForce') },
    { key: 'cp', n: (list?.items ?? []).filter((i) => i.waiting === 'counterparty').length, label: A('op.waitingCp') },
    { key: 'you', n: waitingYou, tone: waitingYou ? 'notice' : undefined, label: A('op.waitingYou') },
    { key: 'gaps', n: gaps?.total ?? 0, tone: gaps?.total ? 'notice' : undefined, label: A('op.gaps') },
  ]} />`;
}

/** What waits for the operator, from the gaps, each with the press that answers it. */
function Waiting({ gaps, busy, onOpen, onAnnounce }) {
  const mine = (gaps?.gaps ?? []).filter((g) => ['agreement-review-waiting', 'subprocessor-change-unannounced', 'agreement-objection-open', 'agreement-deletion-overdue', 'breach-notice-overdue'].includes(g.kind));
  if (!mine.length) return null;
  return html`${mine.map((g) => html`
    <${Note} key=${`${g.kind}|${g.agreement}`} kind="aside">
      <b>${A(`gap.${g.kind}`, { who: g.counterparty || '' })}</b> ${g.detail}
      <${Actions}>
        ${g.kind === 'subprocessor-change-unannounced' ? html`<${Loud} control disabled=${busy} onClick=${() => onAnnounce(g.agreement)}>${A('op.announceNow')}<//>` : null}
        ${g.agreement ? html`<${Action} small onClick=${() => onOpen(g.agreement)}>${A('open')}<//>` : null}
      <//>
    <//>`)}`;
}

/** A signed copy that came back: the check, and the operator's yes or no. */
function ReviewBox({ version, busy, onDecide }) {
  const [reason, setReason] = useState('');
  const r = version.review;
  return html`
    <${Box} tone="raised" name=${A(r.kind === 'pdf' ? 'review.pdfTitle' : 'review.scanTitle')} end=${A(`review.verdict.${r.verdict}`)}>
      <${List} cols="name-desc-doors" head=${[A('review.check'), A('review.found'), '']} rows=${r.checks}
        render=${(c) => html`<${Row} key=${c.id} fine=${c.ok === true} rail=${c.ok === false ? 'warn' : c.ok === null ? 'notice' : undefined}>
          <${Name} meta=${c.ok === true ? '✓' : c.ok === false ? '✗' : A('review.unknown')}>${A(`review.c.${c.id}`)}<//>
          <${Desc}>${c.note}<//><div></div><//>`} />
      ${r.checkedBy ? html`<${Note} kind="meta" mono>${A('review.checkedBy', { model: r.checkedBy })}<//>` : null}
      <${Note} kind="aside" size="small">${A(r.kind === 'scan' ? 'review.scanMeans' : 'review.pdfMeans')}<//>
      <${TextArea} label=${A('review.reasonLabel')} value=${reason} rows=${2} onInput=${setReason} />
      <${Actions}>
        <${Loud} control disabled=${busy} onClick=${() => onDecide(true)}>${A('review.accept')}<//>
        <${Action} small disabled=${busy || !reason.trim()} onClick=${() => onDecide(false, reason.trim())}>${A('review.reject')}<//>
      <//>
    <//>`;
}

/** The short form a new agreement starts from; the node fills the annexes. */
function NewAgreement({ busy, onCreate, onCancel }) {
  const [f, setF] = useState({ name: '', businessId: '', address: '', country: '', contactName: '', contactEmail: '', signerName: '', signerRole: '', account: '', product: 'place', language: 'fi' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const submit = () => onCreate({
    product: f.product, language: f.language,
    counterparty: Object.fromEntries(Object.entries({
      name: f.name, businessId: f.businessId, address: f.address, country: f.country, contactName: f.contactName,
      contactEmail: f.contactEmail, signerName: f.signerName, signerRole: f.signerRole, account: f.account,
    }).filter(([, v]) => String(v).trim()).map(([k, v]) => [k, String(v).trim()])),
  });
  return html`
    <${Box} tone="field" name=${A('new.title')}>
      <${Note} kind="hint" size="text">${A('new.lead')}<//>
      <${Fields} cols=${2}>
        <${TextField} label=${A('party.name')} value=${f.name} onInput=${set('name')} />
        <${TextField} label=${A('party.businessId')} value=${f.businessId} onInput=${set('businessId')} />
        <${TextField} label=${A('party.address')} value=${f.address} onInput=${set('address')} />
        <${TextField} label=${A('new.country')} value=${f.country} onInput=${set('country')} />
        <${TextField} label=${A('new.contactName')} value=${f.contactName} onInput=${set('contactName')} />
        <${TextField} label=${A('new.contactEmail')} value=${f.contactEmail} onInput=${set('contactEmail')} />
        <${TextField} label=${A('new.signerName')} value=${f.signerName} onInput=${set('signerName')} />
        <${TextField} label=${A('new.signerRole')} value=${f.signerRole} onInput=${set('signerRole')} />
        <${TextField} label=${A('new.account')} hint=${A('new.accountHint')} value=${f.account} onInput=${set('account')} />
        <${Select} label=${A('new.product')} value=${f.product} onChange=${set('product')}
          options=${['place', 'box', 'managed', 'custom'].map((p) => [p, A(`product.${p}`)])} />
        <${Select} label=${A('new.language')} value=${f.language} onChange=${set('language')} options=${[['fi', 'Suomi'], ['en', 'English']]} />
      <//>
      <${FormActions}>
        <${Action} small onClick=${onCancel}>${A('cancel')}<//>
        <${Loud} control disabled=${busy || !f.name.trim()} onClick=${submit}>${A('new.create')}<//>
      <//>
    <//>`;
}

function Detail({ agreement, busy, onAct, confirm }) {
  const v = newestOf(agreement);
  const f = inForceOf(agreement);
  const id = agreement.id;
  const cp = agreement.counterparty;
  const canNotice = !!f && v.status === 'draft' && v.options.subprocessorAuthorisation === 'general';
  const pdf = (n) => downloadAgreementPdf(id, n).catch((e) => swallowed('agreements-section: pdf', e));
  const end = () => confirm(A('op.endConfirm', { who: cp.name, days: (f ?? v).options.deletionDays }),
    () => onAct(() => endAgreement(id, 'delete'), A('op.ended')), { title: A('op.endTitle'), confirmLabel: A('op.end'), danger: true });
  return html`
    <${Box} id="adm-ag-open" tone="raised" name=${cp.name} marks=${html`<${StatusMark} status=${agreement.status} />`} end=${`${id} · v${v.n}`}>
      <${Note} kind="hint" size="text">${agreement.subject}<//>
      <${Facts} rows=${[
        { k: A('controller'), v: (agreement.ourRole === 'processor' ? v.annexes.I.controller : v.annexes.I.processor).name },
        { k: A('processor'), v: (agreement.ourRole === 'processor' ? v.annexes.I.processor : v.annexes.I.controller).name },
        { k: A('party.signer'), v: [cp.signerName, cp.signerRole].filter(Boolean).join(', ') || A('toComplete') },
        { k: A('party.contact'), v: [cp.contactName, cp.contactEmail].filter(Boolean).join(', ') || A('toComplete') },
        { k: A('op.inForceFrom'), v: f?.effectiveFrom ? dateOf(f.effectiveFrom) : A('op.notYet') },
      ]} />
    <//>
    ${v.status === 'review' && v.review ? html`<${ReviewBox} version=${v} busy=${busy}
      onDecide=${(accept, reason) => onAct(() => decideCopy(id, accept, reason), accept ? A('review.accepted') : A('review.rejected'))} />` : null}
    ${v.status === 'draft' ? html`
      <${Note} kind="aside">${f ? A('op.draftNext', { n: v.n }) : A('op.draftFirst')}<//>
      <${Actions}>
        ${canNotice ? html`<${Loud} control disabled=${busy} onClick=${() => onAct(() => announceChange(id), A('op.announced'))}>${A('op.announce')}<//>` : null}
        <${canNotice ? Action : Loud} control small disabled=${busy} onClick=${() => onAct(() => sendAgreement(id), A('op.sent'))}>${A('op.send')}<//>
        <${Action} small onClick=${() => pdf(v.n)}>${A('op.previewPdf')}<//>
      <//>` : null}
    ${agreement.status === 'signed' && v.status !== 'draft' ? html`
      <${Actions}>
        <${Action} small disabled=${busy} onClick=${() => onAct(() => newVersion(id), A('op.versionMade'))}>${A('op.newVersion')}<//>
      <//>` : null}
    <${Section} id="adm-ag-steps" num="" title=${A('stepsTitle')} plain>
      <${Steps} agreement=${agreement} operator />
    <//>
    <${Section} id="adm-ag-annexes" num="" title=${A('annexes')} plain>
      <${Annexes} version=${v} against=${v.n === f?.n ? null : f} />
    <//>
    <${Section} id="adm-ag-ob" num="" title=${A('obligationsTitle')} plain>
      <${Obligations} version=${f ?? v} />
    <//>
    <${Actions}>
      <${Action} small onClick=${() => pdf((f ?? v).n)}>${A('downloadPdf')}<//>
      ${agreement.deletion && !agreement.deletion.doneAt ? html`<${Action} small disabled=${busy} onClick=${() => onAct(() => deletionDone(id), A('op.deletionRecorded'))}>${A('op.deletionDone')}<//>` : null}
      ${!agreement.endedAt && agreement.versions.some((x) => x.status !== 'draft') ? html`<${Action} small tone="danger" disabled=${busy} onClick=${end}>${A('op.end')}<//>` : null}
    <//>`;
}

/**
 * @param {{ num: string, onMessage?: (kind: 'success'|'error', text: string) => void }} props
 */
export default function AgreementsSection({ num, onMessage }) {
  const [list, setList] = useState(null);
  const [gaps, setGaps] = useState(null);
  const [openId, setOpenId] = useState(() => (location.hash.match(/agreements\/(dpa-[a-z0-9]+)/) || [])[1] || '');
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const { confirm, ConfirmUI } = useConfirm();
  // The page hands a new callback on every render; reading it through a ref keeps the load from
  // running again each time the page draws.
  const say = useRef(onMessage);
  say.current = onMessage;

  const load = useCallback(async () => {
    try {
      const [l, g] = await Promise.all([listAgreements(), agreementGaps()]);
      setList(l); setGaps(g);
      setOpen(openId ? await getAgreement(openId) : null);
    } catch (err) {
      swallowed('agreements-section: load failed', err);
      say.current?.('error', err?.message || A('loadFailed'));
    }
  }, [openId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['compliance'], () => load()), [load]);
  // An address with #agreements/<id> scrolls to the opened agreement once, when it first draws.
  const scrolled = useRef(!location.hash.includes('agreements/'));
  // A link to #agreements/<id> followed while this page is open (the bell's) opens that agreement.
  useEffect(() => {
    const onHash = () => {
      const id = (location.hash.match(/agreements\/(dpa-[a-z0-9]+)/) || [])[1];
      if (id) { scrolled.current = false; setOpenId(id); setCreating(false); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!open || scrolled.current) return;
    scrolled.current = true;
    document.getElementById('adm-ag-open')?.scrollIntoView({ block: 'start' });
  }, [open]);

  const act = async (fn, done) => {
    setBusy(true);
    try { await fn(); say.current?.('success', done); await load(); }
    catch (err) { swallowed('agreements-section: action failed', err); say.current?.('error', err?.message || A('actionFailed')); }
    finally { setBusy(false); }
  };
  const openOne = (id) => { setOpenId(id); setCreating(false); history.replaceState(null, '', `${location.pathname}${location.search}#agreements/${id}`); };
  const announce = (id) => act(async () => { const d = await newVersion(id); await announceChange(d.id); openOne(d.id); }, A('op.announced'));
  const create = (body) => act(async () => { const d = await createAgreement(body); openOne(d.id); }, A('new.created'));
  const forAi = A('op.aiPrompt');

  const items = list?.items ?? [];
  return html`
    <${Section} id="adm-cmp-agreements" num=${num} title=${A('op.title')} doors=${html`
      <${Action} small onClick=${() => setCreating(true)}>${A('new.open')}<//>
      <${Action} small soft copy=${forAi} copiedLabel=${A('op.copied')}>${A('op.copyForAi')}<//>`}>
      <${Stack} gap="section">
      <${Note} kind="lead">${A('op.lead')}<//>
      ${list ? html`<${Strip} list=${list} gaps=${gaps} />` : html`<${FigureStrip} lead stacked loading=${4} />`}
      <${Waiting} gaps=${gaps} busy=${busy} onOpen=${openOne} onAnnounce=${announce} />
      ${creating ? html`<${NewAgreement} busy=${busy} onCreate=${create} onCancel=${() => setCreating(false)} />` : null}
      <${List} cols="name-desc-state-doors" head=${[A('colWith'), A('colNext'), A('colState'), '']} empty=${A('op.empty')} loading=${!list}
        rows=${items}
        render=${(a) => html`
          <${Row} key=${a.id} selected=${openId === a.id}>
            <${Name} meta=${`${A(`product.${a.product}`)} · v${a.newest_version}`}>${a.counterparty.name}<//>
            <${Desc}>${a.waiting === 'operator' ? A(`op.next.${a.newest_status}`) : a.waiting === 'counterparty' ? A('op.next.waitingCp') : a.deletion && !a.deletion.doneAt ? A('next.deletion', { date: dateOf(a.deletion.dueAt) }) : ''}<//>
            <${Cell}><${StatusMark} status=${a.status} /><//>
            <${Doors}><${Action} small row onClick=${() => openOne(a.id)}>${A('open')}<//><//>
          <//>`} />
      ${open ? html`<${Stack} gap="large"><${Detail} agreement=${open} busy=${busy} onAct=${act} confirm=${confirm} /><//>` : null}
      <//>
      <${ConfirmUI} />
    <//>`;
}
