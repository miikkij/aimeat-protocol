/**
 * @file public/views/home/waiting-band.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The first band of the home: everything that waits for this person, in one list.
 *
 *   WHY ONE LIST. The home said "something waits for you" in six bands and the top bar in three more
 *   places, none of them showed all of it, and the first of them stood several screens down. A person
 *   who opens the home asks one question first: what needs me now. This band answers it in one place,
 *   and an AI reads the same answer with the MCP tool aimeat_home_waiting.
 *
 *   WHAT IT DRAWS. One sentence that says how many things wait (or that nothing does, so the band
 *   keeps its place on a quiet day), then the items in three groups: a yes or a no to give, an answer
 *   somebody waits for, and counts to open. A row with a yes and a no is decided here; every other
 *   row opens the place where the person acts.
 *
 *   THE WORDS. The server sends names and previews as data (`from`, `subject`, `detail`); the sentence
 *   of a row is made here from its kind, so it reads in the person's language. A kind this file does
 *   not know yet is shown by its subject and opens its page.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure WaitingBand({ data, navigate }) · wordsOf(item) · GROUPS
 * @usage html`<${WaitingBand} data=${data} navigate=${ctx?.navigate} />` (views/surface/blocks-home.js)
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPost } from '/js/api.js';
import { Band, BandNote } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { HelpTip } from '/components/HelpTip.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const fill = (text, values) => Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v ?? '')), text);

/** The groups in the order the server sends them, each with the name its rows stand under. */
export const GROUPS = [
  { group: 'decide', label: () => tr('home.waiting.group.decide', 'For you to decide') },
  { group: 'answer', label: () => tr('home.waiting.group.answer', 'For you to answer') },
  { group: 'look', label: () => tr('home.waiting.group.look', 'For you to open') },
];

/**
 * The sentence of one row and the line under it, from the item's kind.
 * @param {{ kind: string, from?: string, subject?: string, detail?: string, count?: number }} item
 * @returns {{ name: string, desc: string }}
 */
export function wordsOf(item) {
  const v = { from: item.from || '', subject: item.subject || '', n: item.count ?? 0 };
  const detail = item.detail || '';
  switch (item.kind) {
    case 'agent_proposal':
      return {
        name: v.from
          ? fill(tr('home.waiting.kind.agentProposalBy', '{from} proposes an agent: {subject}'), v)
          : fill(tr('home.waiting.kind.agentProposal', 'Proposed agent: {subject}'), v),
        desc: detail,
      };
    case 'agent_sign_in':
      return { name: fill(tr('home.waiting.kind.agentSignIn', '{subject} asks to connect as your agent'), v), desc: detail };
    case 'reply':
      return { name: v.from || v.subject, desc: detail || (v.from ? v.subject : '') };
    case 'help_question':
      return { name: v.from ? fill(tr('home.waiting.kind.helpQuestionBy', '{from} asks'), v) : tr('home.waiting.kind.helpQuestion', 'A question for you'), desc: v.subject || detail };
    case 'team':
      return { name: v.subject, desc: fill(tr('home.waiting.kind.team', 'Waiting for you in this team: {n}'), v) };
    case 'invitation':
      return {
        name: v.from
          ? fill(tr('home.waiting.kind.invitationBy', '{from} invites you to {subject}'), v)
          : fill(tr('home.waiting.kind.invitation', 'Invitation: {subject}'), v),
        desc: detail,
      };
    case 'publish_request':
      return {
        name: v.from
          ? fill(tr('home.waiting.kind.publishRequestBy', '{from} asks to make public: {subject}'), v)
          : fill(tr('home.waiting.kind.publishRequest', 'Waits for your permission to become public: {subject}'), v),
        desc: detail,
      };
    case 'workflow_input':
      return { name: fill(tr('home.waiting.kind.workflowInput', 'The workflow {subject} waits for your answer'), v), desc: detail };
    case 'open_item':
      return { name: fill(tr('home.waiting.kind.openItem', 'Open items: {n}'), v), desc: detail };
    case 'unread':
      return { name: fill(tr('home.waiting.kind.unread', 'Unread messages: {n}'), v), desc: detail };
    default:
      return { name: v.subject || item.kind, desc: detail };
  }
}

/** The two words of a row's yes and no: an invitation is joined or declined, everything else approved or declined. */
function decideWords(kind) {
  return kind === 'invitation'
    ? { yes: tr('home.waiting.do.join', 'Join'), no: tr('home.waiting.do.refuse', 'Decline') }
    : { yes: tr('profile.agents.new.approve', 'Approve'), no: tr('profile.agents.new.decline', 'Decline') };
}

/** The word on the action of a row that opens its place. */
function openWord(group) {
  return group === 'answer' ? tr('home.waiting.do.answer', 'Answer') : tr('home.waiting.do.open', 'Open');
}

/**
 * How many things wait for a decision or an answer, as one sentence. The counts to open are not in
 * the number: a count repeats things the rows above it name (an open item made for a proposal, an
 * unread message in a thread that waits for an answer). When only counts are left, the sentence says
 * that no decision and no answer is owed.
 */
function leadOf(total, toOpen) {
  if (!total && toOpen) return tr('home.waiting.lead.noneToDecide', 'Nothing waits for your decision or your answer.');
  if (!total) return tr('home.waiting.lead.none', 'Nothing waits for you now.');
  if (total === 1) return tr('home.waiting.lead.one', 'One thing waits for you.');
  return fill(tr('home.waiting.lead.n', '{n} things wait for you.'), { n: total });
}

/**
 * @param {{ data: { total: number, to_open?: number, items: Array<any>, partial?: string[] }, navigate?: (path: string) => void }} props
 */
export function WaitingBand({ data, navigate }) {
  const [busy, setBusy] = useState(false);
  // What a decided row says until the list is read again: the row keeps its place, so the next row
  // does not move under the pointer of a person who decides several in a row.
  const [settled, setSettled] = useState(/** @type {Record<string, string>} */ ({}));

  const items = data.items ?? [];
  const total = data.total ?? items.length;
  const keyOf = (it) => `${it.kind}|${it.id}`;

  async function decide(item, answer) {
    const call = item.decide?.[answer];
    if (!call || busy) return;
    setBusy(true);
    try {
      await apiPost(call.url, {});
      setSettled((s) => ({ ...s, [keyOf(item)]: answer === 'approve'
        ? tr('home.waiting.done.approve', 'Approved.')
        : tr('home.waiting.done.decline', 'Declined.') }));
    } catch (err) {
      setSettled((s) => ({ ...s, [keyOf(item)]: err?.message || tr('home.waiting.done.failed', 'That did not work. Open it and try there.') }));
    } finally {
      setBusy(false);
    }
  }

  const follow = (href) => (e) => {
    if (!navigate || !href || !href.startsWith('/v1/') || href.includes('#')) return;
    e.preventDefault();
    navigate(href);
  };

  const rowOf = (item) => {
    const words = wordsOf(item);
    const done = settled[keyOf(item)];
    const yesNo = decideWords(item.kind);
    return html`
      <${Row} key=${keyOf(item)}>
        <${Name} href=${item.href} onFollow=${follow(item.href)}>${words.name}<//>
        <${Desc}>${done || words.desc}<//>
        <${Doors}>
          ${done ? null : item.decide
            ? html`
              <${Loud} control disabled=${busy} onClick=${() => decide(item, 'approve')}>${yesNo.yes}<//>
              <${Action} small row disabled=${busy} onClick=${() => decide(item, 'decline')}>${yesNo.no}<//>`
            : html`<${Action} small row href=${item.href} onClick=${follow(item.href)}>${openWord(item.group)}<//>`}
        <//>
      <//>`;
  };

  // What the cap left out: the decisions and answers the server counted and did not send.
  const shown = items.filter((it) => it.group !== 'look').reduce((sum, it) => sum + (it.count || 1), 0);
  const more = total - shown;
  const title = tr('home.waiting.title', 'Waiting for you');

  return html`
    <${Band} title=${html`${title} <${HelpTip} term="home.waiting" label=${title} />`}>
      <${Note} kind="state" tone=${total ? 'attention' : 'fine'}>${leadOf(total, data.to_open ?? 0)}<//>
      ${GROUPS.map(({ group, label }) => {
        const rows = items.filter((it) => it.group === group);
        if (!rows.length) return null;
        return html`
          <${NamedRow} key=${group} stack label=${label()}>
            <${List} cols="name-desc-doors">${rows.map(rowOf)}<//>
          <//>`;
      })}
      ${more > 0 && html`<${BandNote}>${fill(tr('home.waiting.more', '{n} more wait for you.'), { n: more })}<//>`}
      ${(data.partial ?? []).length > 0 && html`<${Note} kind="quiet">${tr('home.waiting.partial', 'A part of the list could not be read just now.')}<//>`}
    <//>`;
}

export default WaitingBand;
