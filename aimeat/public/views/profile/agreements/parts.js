/**
 * @file public/views/profile/agreements/parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The parts both screens of a data processing agreement draw (plan doc-mvmr4i2wdk0p, D5,
 *   and the design canvas Jouni approved on 2026-10-24): the operator's section on the admin
 *   Compliance page (views/admin/compliance-agreements-section.js) and the counterparty's tab in
 *   Settings (views/profile/agreements-tab.js). Every part is composed of the library's components;
 *   none writes a class of its own.
 *
 *   - StatusMark: the agreement's state as one word with its tone.
 *   - Steps: what has happened, newest last, and the step that waits, from the agreement's history.
 *   - Annexes: the four annexes behind tabs I to IV; Annex IV shows what a draft adds or drops against
 *     the version in force.
 *   - Obligations: what the version in force promises, as clocks (breach notice hours, notice days,
 *     deletion days).
 *   - Summary: the five lines a counterparty reads before signing.
 * @structure STATUS_TONE · StatusMark · stepRows · Steps · Annexes · Obligations · Summary · newestOf · inForceOf · dateOf
 * @usage html`<${Steps} agreement=${a} operator />`
 * @version-history
 *   2026-10-29 — A version signed only in test (`test-signed`, production settings) shows its state, its
 *     step and what comes next (secaudit2026oct26 round 8c).
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D5).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { date } from '/js/format.js';
import { Mark } from '/components/Mark.js';
import { Facts } from '/components/Facts.js';
import { List, Row, Name, Desc, When } from '/components/List.js';
import { Tabs } from '/components/Tabs.js';
import { Note } from '/components/Note.js';
import { Stack } from '/components/Layout.js';

const html = htm.bind(h);
export const A = (key, vars) => t(`agreements.${key}`, vars);

/** The tone each state is drawn in: in force green, waiting on the sun, drafts and the ended grey. */
export const STATUS_TONE = { signed: 'fine', sent: 'attention', review: 'attention', draft: 'off', expired: 'off', ended: 'off', 'test-signed': 'attention' };

export const dateOf = (iso) => (iso ? date(iso) : '');
export const newestOf = (a) => a.versions[a.versions.length - 1];
export const inForceOf = (a) => [...a.versions].reverse().find((v) => v.status === 'signed') ?? null;

export function StatusMark({ status }) {
  return html`<${Mark} kind="status" tone=${STATUS_TONE[status] ?? 'off'}>${A(`status.${status}`)}<//>`;
}

/** The events the history records, as the person reads them. Anything else keeps its own word. */
const EVENTS = new Set(['created', 'edited', 'version', 'sent', 'reminder', 'signed', 'copy-received', 'copy-accepted', 'copy-rejected',
  'in-force', 'notice', 'notice-reminder', 'notice-lapsed', 'objection', 'breach-notice', 'ended', 'deletion-done', 'test-signed']);

/** The events whose stored detail a person wrote (a reason, a note); every other detail is the
 *  English audit line, which stays in the record and in the MCP answer and is not drawn here. */
const WRITTEN = new Set(['objection', 'copy-rejected', 'deletion-done']);

/**
 * The steps: each recorded event with its day, then the one step that waits. The operator also sees
 * the words a person wrote with a step; the counterparty sees the step and its day.
 */
export function stepRows(a, operator) {
  const done = a.history
    .filter((e) => operator || !['edited', 'version', 'reminder', 'notice-reminder'].includes(e.event))
    .map((e) => ({ key: `${e.at}|${e.event}`, state: 'done', title: EVENTS.has(e.event) ? A(`event.${e.event}`) : e.event, detail: operator && WRITTEN.has(e.event) ? e.detail : '', at: e.at }));
  const v = newestOf(a);
  let next = null;
  if (a.endedAt) next = a.deletion && !a.deletion.doneAt ? { title: A('next.deletion', { date: dateOf(a.deletion.dueAt) }) } : null;
  else if (v.status === 'draft') next = { title: operator ? A('next.sendDraft', { n: v.n }) : null };
  else if (v.status === 'review') next = { title: operator ? A('next.review') : A('next.reviewCp') };
  else if (v.status === 'test-signed') next = { title: operator ? A('next.testSigned') : A('next.testSignedCp') };
  else if (v.status === 'sent' && v.notice) next = { title: v.notice.objectedAt ? A('next.objected') : A('next.notice', { date: dateOf(v.notice.objectionUntil) }) };
  else if (v.status === 'sent') next = { title: operator ? A('next.waitingCp') : A('next.signCp') };
  return next?.title ? [...done, { key: 'next', state: 'next', ...next }] : done;
}

export function Steps({ agreement, operator }) {
  const rows = stepRows(agreement, operator);
  return html`
    <${List} cols="name-desc-when-doors" head=${[A('colStep'), '', A('colWhen'), '']} empty=${A('noSteps')}
      rows=${rows}
      render=${(r) => html`
        <${Row} key=${r.key} rail=${r.state === 'next' ? 'notice' : undefined}>
          <${Name} meta=${r.state === 'next' ? A('waits') : '✓'}>${r.title}<//>
          <${Desc} faint>${r.detail || ''}<//>
          <${When}>${r.at ? dateOf(r.at) : ''}<//>
          <div></div>
        <//>`} />`;
}

function partyRows(p) {
  const contact = [p.contactName, p.contactRole, p.contactEmail].filter(Boolean).join(', ');
  return [
    { k: A('party.name'), v: p.name },
    ...(p.businessId ? [{ k: A('party.businessId'), v: p.businessId, mono: true }] : []),
    { k: A('party.address'), v: p.address || A('toComplete') },
    { k: A('party.contact'), v: contact || A('toComplete') },
    ...(p.signerName ? [{ k: A('party.signer'), v: [p.signerName, p.signerRole].filter(Boolean).join(', ') }] : []),
    ...(p.dpo ? [{ k: A('party.dpo'), v: p.dpo }] : []),
  ];
}

const AREAS = ['encryption', 'confidentiality', 'restore', 'testing', 'identification', 'transmission', 'storage', 'physical', 'logging',
  'configuration', 'governance', 'certification', 'minimisation', 'quality', 'retention', 'accountability', 'portability'];

/** The four annexes behind tabs; Annex IV marks what the shown version adds or drops against `against`. */
export function Annexes({ version, against }) {
  const [tab, setTab] = useState('IV');
  const ax = version.annexes;
  const before = new Set((against?.annexes.IV.subprocessors ?? []).map((s) => s.name));
  const now = new Set(ax.IV.subprocessors.map((s) => s.name));
  const dropped = against ? [...before].filter((n) => !now.has(n)) : [];
  return html`
    <${Tabs} value=${tab} onSelect=${setTab} label=${A('annexes')}
      items=${['I', 'II', 'III', 'IV'].map((k) => ({ value: k, label: A(`annex.${k}`) }))} />
    <${Stack} gap="large" above="large">
    ${tab === 'I' ? html`
      <${Note} kind="lead" size="small">${A('controller')}<//>
      <${Facts} rows=${partyRows(ax.I.controller)} />
      <${Note} kind="lead" size="small">${A('processor')}<//>
      <${Facts} rows=${partyRows(ax.I.processor)} />` : null}
    ${tab === 'II' ? html`<${Facts} wide rows=${[
      { k: A('ii.subjects'), v: ax.II.subjects.join(', ') || A('toComplete') },
      { k: A('ii.categories'), v: ax.II.categories.join(', ') || A('toComplete') },
      { k: A('ii.sensitive'), v: ax.II.sensitive || A('toComplete') },
      { k: A('ii.nature'), v: ax.II.nature || A('toComplete') },
      { k: A('ii.purposes'), v: ax.II.purposes || A('toComplete') },
      { k: A('ii.duration'), v: ax.II.duration || A('toComplete') },
    ]} />` : null}
    ${tab === 'III' ? html`
      <${List} cols="name-desc-doors" head=${[A('iii.area'), A('iii.measure'), '']}
        rows=${AREAS}
        render=${(area) => {
          const ms = ax.III.measures.filter((m) => m.area === area);
          return html`<${Row} key=${area} rail=${ms.length ? undefined : 'notice'}>
            <${Name} meta=${ms[0] ? A(`source.${ms[0].source}`) : A('toComplete')}>${A(`area.${area}`)}<//>
            <${Desc}>${ms.map((m) => m.text).join(' ') || A('toComplete')}<//>
            <div></div>
          <//>`;
        }} />
      <${Facts} wide rows=${[{ k: A('iii.assistance'), v: ax.III.assistance || A('toComplete') }]} />` : null}
    ${tab === 'IV' ? html`
      <${List} cols="name-desc-doors" head=${[A('iv.name'), A('iv.what'), '']} empty=${A('iv.none')}
        rows=${[...ax.IV.subprocessors.map((s) => ({ ...s, added: !!against && !before.has(s.name) })), ...dropped.map((name) => ({ name, dropped: true }))]}
        render=${(s) => html`
          <${Row} key=${s.name} fine=${s.added} rail=${s.dropped ? 'notice' : undefined}>
            <${Name} meta=${s.added ? A('iv.added') : s.dropped ? A('iv.dropped') : (s.country || '')}>${s.name}<//>
            <${Desc}>${s.description || ''}<//>
            <div></div>
          <//>`} />` : null}
    <//>`;
}

/** What the version promises, as clocks. */
export function Obligations({ version }) {
  const o = version.options;
  return html`<${Facts} wide rows=${[
    { k: A('ob.breach'), v: A('ob.breachV', { h: o.breachNoticeHours }) },
    { k: A('ob.notice'), v: A('ob.noticeV', { d: o.noticeDays }) },
    { k: A('ob.requests'), v: A('ob.requestsV') },
    { k: A('ob.deletion'), v: A('ob.deletionV', { d: o.deletionDays }) },
  ]} />`;
}

/** The lines a counterparty reads before signing, in their words. */
export function Summary({ agreement }) {
  const v = newestOf(agreement);
  const processor = agreement.ourRole === 'processor' ? v.annexes.I.processor.name : v.annexes.I.controller.name;
  // Only the own-server product keeps the data on the customer's machine; every other product names
  // the sub-processors that hold it, each with its country as written in Annex IV.
  const subs = v.annexes.IV.subprocessors.map((s) => (s.country ? `${s.name} (${s.country})` : s.name)).join(', ');
  const where = agreement.product === 'box' ? A('sum.whereOwn') : subs ? A('sum.whereV', { places: subs }) : A('toComplete');
  return html`<${Facts} wide rows=${[
    { k: A('sum.who'), v: A('sum.whoV', { name: processor }) },
    { k: A('sum.what'), v: v.annexes.II.categories.join(', ') || A('toComplete') },
    { k: A('sum.where'), v: where },
    { k: A('sum.breach'), v: A('ob.breachV', { h: v.options.breachNoticeHours }) },
    { k: A('sum.end'), v: A('ob.deletionV', { d: v.options.deletionDays }) },
  ]} />`;
}
