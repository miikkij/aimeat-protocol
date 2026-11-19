/**
 * @file public/views/profile/kyc/card.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One customer card, opened from a row of the customers list: what the newest version
 *   says (Facts), the risk with its reasons and their legal references, the sanctions screening hits
 *   with a decision on each (in person), the senior approval (in person, when the risk asks for it),
 *   the actions on the card (record the identity, make an identify link, screen again, review, end the
 *   relationship, keep an ended card longer), the versions as a timeline, and a day field that reads
 *   the card as it stood on that day. useCard holds the reads and the writes; the dialogs are
 *   card-dialogs.js.
 * @structure useCard · secCard · cardFacts
 * @usage const card = useCard({ org, role, toast, onChanged }); ... secCard(card, num)
 * @version-history
 *   v1.2.0 — 2026-11-19 — Second browser check: the hits and the versions stack on a phone (no
 *     keepCols, each cell says its column), the risk facts take the wide cut with air before the
 *     reasons, the hit's score is named as the match strength and its subject as who was screened, and
 *     the "as of" view says when the version it shows is the newest.
 *   v1.1.0 — 2026-11-19 — Browser check: each part under its own rule heading (SubHeading rule), the
 *     status out of the section heading (the facts keep it) and the version count in its place, the
 *     "as of" read at the end of the chosen local day and shown as that day, a reason's detail in
 *     locale words only, and a hit's reasons on its row.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { h } from 'preact';
import { useState, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { Section } from '/components/Section.js';
import { Facts, FactLine } from '/components/Facts.js';
import { List, Row, Name, Desc, Who, Num, When, Cell, Doors } from '/components/List.js';
import { Action, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { TextField } from '/components/TextField.js';
import { SubHeading } from '/components/SubHeading.js';
import { x, word, tone, reasonWords, reasonDetail, hitReasonWords, errWords, dateWord, endOfLocalDay, timeWord, today, kycApi } from './frame.js';

const html = htm.bind(h);

/** The heading of one part of the card: coral capitals over the rule, with air above it. */
const part = (words) => html`<${SubHeading} level=${3} rule>${words}<//>`;

/**
 * The state of the open card and what can be done to it.
 * @param {{ org: string, role: string, toast: (m: string, err?: boolean) => void, onChanged: () => void }} p
 */
export function useCard({ org, role, toast, onChanged }) {
  const [id, setId] = useState('');
  const [read, setRead] = useState(null);
  const [err, setErr] = useState('');
  const [day, setDay] = useState('');
  const [asOf, setAsOf] = useState(null);
  const [dlg, setDlg] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const current = useRef('');

  const load = useCallback(async (cardId = current.current) => {
    if (!cardId || !org) return;
    try {
      const r = await kycApi.card(org, cardId);
      if (current.current === cardId) { setRead(r); setErr(''); }
    } catch (e) { if (current.current === cardId) setErr(errWords(e)); }
  }, [org]);

  const open = (cardId) => {
    current.current = cardId;
    setId(cardId); setRead(null); setErr(''); setAsOf(null); setDay(''); setMsg(null); setDlg(null);
    load(cardId);
    window.setTimeout(() => document.getElementById('kyc-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const close = () => { current.current = ''; setId(''); setRead(null); setAsOf(null); setDlg(null); };

  /** Read the card as it stood at the end of the chosen day. */
  const loadAsOf = async () => {
    if (!day) return;
    setBusy('asOf');
    // The end of the chosen day in the reader's own time zone: a bare day is the end of the UTC day
    // on the server, which is the next morning east of UTC. The page shows the day the person chose.
    try { setAsOf({ ...(await kycApi.asOf(org, id, endOfLocalDay(day))), day }); } catch (e) { toast(errWords(e), true); }
    setBusy('');
  };

  /**
   * One write on the card. The server answers the new version; the card and the list read again.
   * @param {string} what the action's path part (identity, screen, hits, approve, review, end, hold)
   * @param {object} [body]
   * @param {string} [done] the words to say after it
   */
  const act = async (what, body, done) => {
    setBusy(what);
    try {
      await kycApi.act(org, id, what, body);
      setDlg(null);
      setMsg({ text: done || x('card.saved') });
      await load(id);
      onChanged();
    } catch (e) {
      if (dlg) setDlg((d) => (d ? { ...d, error: errWords(e) } : d)); else setMsg({ text: errWords(e), error: true });
    }
    setBusy('');
  };

  /** The identify link: the server makes it, the page shows the address to copy. */
  const makeLink = async () => {
    setBusy('link');
    try {
      const r = await kycApi.act(org, id, 'link');
      setDlg({ kind: 'link', url: location.origin + r.path, expiresAt: r.expiresAt });
    } catch (e) { setMsg({ text: errWords(e), error: true }); }
    setBusy('');
  };

  return { org, role, id, read, err, day, setDay, asOf, setAsOf, loadAsOf, dlg, setDlg, busy, msg, open, close, load, act, makeLink };
}

/** A status mark for a code of a group. */
const mark = (group, code) => html`<${Mark} kind="status" tone=${tone(group, code)}>${word(group, code)}<//>`;

/**
 * The Facts rows of one version: who the customer is, the identity, the owners, the purpose, the
 * PEP status and where the card stands.
 * @param {any} v a CustomerVersion
 */
export function cardFacts(v) {
  const id = v.identity;
  const owners = v.beneficialOwners || [];
  return [
    { k: x('f.kind'), v: word('kind', v.kind) },
    { k: x('f.name'), v: v.name, sub: v.aliases?.length ? x('f.aliases', { names: v.aliases.join(', ') }) : undefined },
    v.kind === 'person' && { k: x('f.birthDate'), v: dateWord(v.birthDate), missing: !v.birthDate },
    v.kind === 'person' && { k: x('f.nationality'), v: v.nationality || '–', missing: !v.nationality },
    { k: v.kind === 'person' ? x('f.countryPerson') : x('f.countryEntity'), v: v.country || '–', missing: !v.country },
    v.kind === 'entity' && { k: x('f.businessId'), v: v.businessId || '–', mono: !!v.businessId, missing: !v.businessId },
    { k: x('f.contact'), v: v.contact || '–', missing: !v.contact },
    {
      k: x('f.identity'),
      v: id ? `${word('level', id.level)} · ${word('method', id.method)}` : x('f.noIdentity'),
      warn: !id || id.level === 'none',
      sub: id ? [dateWord(id.verifiedAt), id.faceToFace ? x('f.faceToFace') : x('f.remote'), id.issuer, id.evidence].filter(Boolean).join(' · ') : undefined,
    },
    v.kind === 'entity' && {
      k: x('f.owners'),
      v: owners.length ? owners.map((o, i) => html`<${FactLine} key=${i} sub=${[o.share !== undefined ? x('f.share', { n: o.share }) : '', o.control, o.country, dateWord(o.birthDate) === '–' ? '' : dateWord(o.birthDate)].filter(Boolean).join(' · ')}>${o.name}<//>`) : x('f.noOwners'),
      warn: !owners.length,
    },
    { k: x('f.purpose'), v: v.purpose || x('f.notKnown'), pre: !!v.purpose, missing: !v.purpose },
    { k: x('f.sourceOfFunds'), v: v.sourceOfFunds || x('f.notKnown'), pre: !!v.sourceOfFunds, missing: !v.sourceOfFunds },
    { k: x('f.pep'), v: mark('pep', v.pep), sub: v.pepDetail || undefined },
    { k: x('f.sanctions'), v: mark('sanctions', v.screening?.status), sub: v.screening?.screenedAt ? x('f.screenedAt', { when: timeWord(v.screening.screenedAt) }) : undefined },
    { k: x('f.status'), v: mark('status', v.status) },
    v.lastReviewedAt && { k: x('f.lastReview'), v: dateWord(v.lastReviewedAt) },
    v.status !== 'ended' && { k: x('f.nextReview'), v: dateWord(v.nextReviewAt), warn: !!v.nextReviewAt && v.nextReviewAt.slice(0, 10) <= today() },
    v.endedAt && { k: x('f.ended'), v: dateWord(v.endedAt) },
    v.retainUntil && { k: x('f.retainUntil'), v: dateWord(v.retainUntil), sub: v.holdBasis || undefined },
  ];
}

/** The risk: its level, score and due diligence, then each reason with its points and reference. */
function riskPart(c) {
  const r = c.read.card.risk;
  if (!r) return html`<${Note} kind="quiet">${x('risk.notRated')}<//>`;
  const canApprove = r.needsSeniorApproval && !r.approvedAt && (c.role === 'officer' || c.role === 'manager');
  return html`
    <${Facts} wide rows=${[
      { k: x('risk.level'), v: mark('risk', r.level), sub: x('risk.score', { n: r.score }) },
      { k: x('risk.dd'), v: word('dd', r.dueDiligence) },
      r.blocking?.length && { k: x('risk.blocking'), v: r.blocking.map((b) => reasonWords(b)).join(', '), warn: true },
      r.needsSeniorApproval && {
        k: x('risk.approval'), warn: !r.approvedAt,
        v: r.approvedAt ? x('risk.approvedBy', { who: r.approvedBy, when: dateWord(r.approvedAt) }) : x('risk.approvalWaits'),
        action: canApprove ? html`<${Action} small onClick=${() => c.setDlg({ kind: 'approve', note: '' })}>${x('act.approve')}<//>` : null,
      },
    ]} />
    ${part(x('part.reasons'))}
    <${List} cols="name-n-desc" keepCols dense apart head=${[x('col.reason'), { label: x('col.points'), num: true }, x('col.ref')]} empty=${x('risk.noReasons')}>
      ${r.reasons.map((rs, i) => html`
        <${Row} key=${i}>
          <${Name} meta=${reasonDetail(rs.code, rs.text) || undefined}>${reasonWords(rs.code, rs.text)}<//>
          <${Num}>${rs.points}<//>
          <${Desc}>${rs.ref}<//>
        <//>`)}
    <//>`;
}

/** The screening hits, each with its decision; an open one is decided here, in person. */
function hitsPart(c) {
  const hits = c.read.card.screening?.hits || [];
  if (!hits.length) return null;
  const ended = c.read.card.status === 'ended';
  return html`
    ${part(x('part.hits'))}
    <${Note} kind="lead">${x('hits.lead')}<//>
    <${List} cols="name-desc-state-doors" labels head=${[x('col.listed'), x('col.match'), x('col.verdict'), '']}>
      ${hits.map((hit) => html`
        <${Row} key=${hit.source + hit.id + hit.subject} rail=${hit.verdict === 'open' ? 'warn' : undefined}>
          <${Name} meta=${`${word('source', hit.source)} · ${hit.programme}`} desc=${hit.note || undefined}>${hit.listedName}<//>
          <${Desc} marks=${(hit.reasons || []).map(hitReasonWords)} sub=${hit.subject === 'customer' ? x('hits.screenedCustomer') : x('hits.screenedOwner', { n: Number(hit.subject.split(':')[1]) + 1 })}>
            ${x('hits.matchedScore', { name: hit.matchedName, score: Math.round(hit.score * 100) })}
          <//>
          <${Cell}>${mark('verdict', hit.verdict)}<//>
          <${Doors}>${hit.verdict === 'open' && !ended ? html`<${Action} small row onClick=${() => c.setDlg({ kind: 'hit', hit, verdict: 'false-positive', note: '' })}>${x('act.decide')}<//>` : null}<//>
        <//>`)}
    <//>`;
}

/** The actions on the card, as the card's state allows them. */
function actionsPart(c) {
  const v = c.read.card;
  const ended = v.status === 'ended';
  const b = c.busy;
  return html`
    ${part(x('part.actions'))}
    <${Actions}>
      ${!ended ? html`
        <${Action} small onClick=${() => c.setDlg({ kind: 'identity', level: 'substantial', method: 'document', verifiedAt: today(), faceToFace: true, evidence: '' })}>${x('act.identity')}<//>
        ${v.kind === 'person' ? html`<${Action} small disabled=${b === 'link'} onClick=${c.makeLink}>${x('act.link')}<//>` : null}
        <${Action} small disabled=${b === 'screen'} onClick=${() => c.act('screen', {}, x('card.screened'))}>${b === 'screen' ? x('act.screening') : x('act.screen')}<//>
        <${Action} small onClick=${() => c.setDlg({ kind: 'review', note: '' })}>${x('act.review')}<//>
        <${Action} small tone="danger" onClick=${() => c.setDlg({ kind: 'end', note: '' })}>${x('act.end')}<//>` : null}
      ${ended && c.role === 'officer' ? html`<${Action} small onClick=${() => c.setDlg({ kind: 'hold', until: '', basis: '' })}>${x('act.hold')}<//>` : null}
    <//>
    ${c.msg ? html`<${Note} kind="message" error=${!!c.msg.error}>${c.msg.text}<//>` : null}`;
}

/** The versions, newest first: when, what changed, the note, who wrote it. */
function timelinePart(c) {
  const versions = [...(c.read.versions || [])].reverse();
  return html`
    <${List} cols="when-name-who" labels head=${[x('col.when'), x('col.change'), x('col.by')]}>
      ${versions.map((ver) => html`
        <${Row} key=${ver.n}>
          <${When}>${timeWord(ver.at)}<//>
          <${Name} meta=${x('card.versionN', { n: ver.n })} desc=${ver.note || undefined}>${word('change', ver.change)}<//>
          <${Who}>${ver.by}<//>
        <//>`)}
    <//>`;
}

/** The day field and, once read, the card as it stood that day, read only. */
function asOfPart(c) {
  const a = c.asOf;
  return html`
    ${part(x('part.asOf'))}
    <${Note} kind="lead">${x('asOf.lead')}<//>
    <${TextField} type="date" label=${x('asOf.day')} value=${c.day} max=${today()} onInput=${(v) => c.setDay(v)} onEnter=${c.loadAsOf}
      actions=${html`
        <${Action} small disabled=${!c.day || c.busy === 'asOf'} onClick=${c.loadAsOf}>${x('asOf.show')}<//>
        ${a ? html`<${Action} small soft onClick=${() => c.setAsOf(null)}>${x('asOf.clear')}<//>` : null}`} />
    ${a ? html`
      ${a.card ? html`
        <${Note} kind="state" tone=${a.newer ? 'attention' : 'fine'}>${a.newer ? x('asOf.state', { day: dateWord(a.day), n: a.card.n, newer: a.newer }) : x('asOf.newest', { day: dateWord(a.day), n: a.card.n })}<//>
        <${Facts} wide rows=${[
          ...cardFacts(a.card),
          { k: x('risk.level'), v: a.card.risk ? mark('risk', a.card.risk.level) : x('risk.notRated'), sub: a.card.risk ? a.card.risk.reasons.map((r) => reasonWords(r.code, r.text)).join(' · ') : undefined },
          { k: x('asOf.writtenBy'), v: `${word('change', a.card.change)} · ${a.card.by}`, sub: a.card.note || undefined },
        ]} />` : html`<${Note} kind="quiet">${x('asOf.before', { day: dateWord(a.day) })}<//>`}` : null}`;
}

/**
 * The card's section. Null while no card is open.
 * @param {ReturnType<typeof useCard>} c
 * @param {string} num the section's number
 */
export function secCard(c, num) {
  if (!c.id) return null;
  const v = c.read?.card;
  const doors = html`<${Action} small soft onClick=${c.close}>${x('card.close')}<//>`;
  return html`
    <${Section} id="kyc-card" num=${num} title=${v ? v.name : x('card.title')} count=${c.read ? String(c.read.versions?.length || 0) : ''} doors=${doors}>
      ${c.err ? html`<${Note} kind="quiet">${c.err}<//>`
        : !v ? html`<${Note} kind="loading">${x('loading')}<//>` : html`
        <${Facts} rows=${cardFacts(v)} />
        ${part(x('part.risk'))}
        <${Note} kind="lead">${x('card.riskLead')}<//>
        ${riskPart(c)}
        ${hitsPart(c)}
        ${actionsPart(c)}
        ${part(x('part.versions'))}
        <${Note} kind="lead">${x('card.timelineLead')}<//>
        ${timelinePart(c)}
        ${asOfPart(c)}`}
    <//>`;
}
