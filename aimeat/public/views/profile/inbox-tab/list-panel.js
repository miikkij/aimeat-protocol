/**
 * @file public/views/profile/inbox-tab/list-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The left side of the Messages page: the contact requests, then the conversations in
 *   the sections the server placed them in (services/inbox-organize/): other people, the owner's own
 *   agents grouped by agent, one heading per group rule, and the archive at the bottom. Every section
 *   and every person or agent group closes and remembers it. A row can be archived or brought back
 *   from the list itself, a group all at once, and many rows by selecting them. Rows that stand for
 *   several threads (a broadcast, copies with one subject, a fold rule) open with a disclosure.
 *   Prop-driven: InboxTab and useInboxOrganize (./use-organize.js) keep the state.
 * @structure ListPanel · rowIds
 * @usage <ListPanel requests conversations activeConv peerDisplay accept block openConversation openFolds toggleFold org />
 * @version-history
 *   v1.7.0 — 2026-09-26 — The list is the ConversationList component (components/ConversationList.js):
 *     this file gives it data and writes no class. Put back what the previous branch lost from main's
 *     rows: each row's kind mark (a person's picture, or "ag", "#", "·" inside a group), its date on
 *     the right of the name, the subject as its own coral words, the unread count at the end of the
 *     line under the name; and main's hovers on the People list.
 *   v1.6.0 — 2026-09-26 — A list of conversations is the chat's list (ThreadList's rows, .poster-thread): the name in bold, one quiet line with the time and the last message, the open one on the sun; a person's heading is its person tone (ThreadPerson) with the counts named; the row's archive square is the small icon button in the delete's place. Messages' rows, a broadcast's results list and an agent's Chat threads take it; their own row looks go (a unification: Jouni's decision "Conversation list").
 *   v1.5.0 — 2026-09-25 — Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v1.4.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.3.0 — 2026-09-25 — Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.2.0 — 2026-09-25 — The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.1.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.0.0 — 2026-09-13 — Moved out of panels.js and rebuilt around sections, closable groups, the
 *     archive and selection. The person group, the row and the broadcast fold are the ones panels.js
 *     had, with the fold generalised to the subject and rule folds.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Action } from '/components/Action.js';
import {
  ConversationList, ConversationTools, ConversationRequests, ConversationRequest, ConversationSection,
  ConversationGroup, ConversationRow, ConversationFold,
} from '/components/ConversationList.js';
import { peerName, isAgentPeer, subThreadLabel, groupConversations, stampShort, stampFull } from './helpers.js';

const DAY_MS = 86_400_000;

/** Every thread a row stands for: itself and whatever is folded under it. */
export function rowIds(c) {
  return [c.conversationId, ...(c.folded || []).map(f => f.conversationId)];
}

export function ListPanel({ requests, conversations, activeConv, peerDisplay, accept, block, openConversation, openFolds = {}, toggleFold, org }) {
  const selecting = !!org?.selecting;
  const selected = org?.selected || new Set();
  const isSelected = (c) => rowIds(c).every(id => selected.has(id));

  /** Who a copy inside an opened fold went to. A loop's unanswered copy still names the sender as its
   *  peer, so the one thing that tells the copies apart is the thread's first recipient. */
  const foldedWho = (c) => (c.openedBy && c.openedTo && c.peerGhii === c.openedBy ? c.openedTo : c.peerGhii);
  /** Who a row is filed under. A folded announcement one agent sent is that agent's row, not the row of
   *  whichever recipient answered last; a person's own copies keep the person they went to. */
  const whoOf = (c) => (c.fold && c.openedBy && isAgentPeer(c.openedBy) ? c.openedBy : c.peerGhii);

  const whyArchived = (c) => {
    const a = c.archived;
    if (!a) return '';
    if (a.reason === 'rule') return t('inbox.org.whyRule', { rule: a.rule || '' });
    if (a.reason === 'age') return t('inbox.org.whyAge', { days: String(Math.max(1, Math.round((Date.parse(a.since) - Date.parse(c.updatedAt)) / DAY_MS))) });
    return t('inbox.org.whyManual', { when: stampShort(a.since) });
  };

  /**
   * One conversation row, as data for ConversationRow. `nested` = inside a person or agent group;
   * `labelPeer` = inside an opened fold.
   */
  const convRow = (c, nested, labelPeer) => {
    const sub = subThreadLabel(c.peerGhii);
    // An agent-owned conversation the owner aggregates (a DM the agent sent from its own inbox) — labelled
    // "via <agent>" and read-only. The `viaAgent` tag comes from the conversation list aggregation.
    const via = c.viaAgent ? (subThreadLabel(c.viaAgent) || peerName(c.viaAgent)) : null;
    // The last turn in a thread of MINE that one of my agents spoke. Different from `via`: this thread is
    // still mine to answer, only the newest message is not my own words.
    const byAgent = c.sentByAgent ? (subThreadLabel(c.sentByAgent) || peerName(c.sentByAgent)) : null;
    const label = labelPeer
      ? peerDisplay(foldedWho(c))
      : via
        ? (nested ? `${t('inbox.viaAgent')} ${via}` : peerDisplay(c.peerGhii))
        : (nested ? (c.subject || (sub ? peerDisplay(c.peerGhii) : t('inbox.directThread'))) : peerDisplay(whoOf(c)));
    // A nested row's mark is a word, not an emoji: an agent thread, a subject thread, or the direct one.
    const word = (via || sub) ? t('inbox.cover.markAgent') || 'ag' : (c.subject ? '#' : '·');
    // The row's own archive control is a sibling of the row's button, never inside it: a button in a
    // button is not a control a keyboard or a screen reader can reach.
    const back = c.section === 'archive';
    const archiveWord = back ? t('inbox.org.restoreConv') : t('inbox.org.archiveConv');
    return html`<${ConversationRow} key=${c.conversationId}
      title=${label}
      presence=${(!c.groupAlias && (!nested || c.peerGhii?.includes('#'))) ? c.peerGhii : null}
      mark=${nested ? { word } : { picture: labelPeer ? foldedWho(c) : whoOf(c) }}
      date=${c.updatedAt ? stampShort(c.updatedAt) : ''} dateTitle=${c.updatedAt ? stampFull(c.updatedAt) : ''}
      chips=${[
        !nested && via ? `${t('inbox.viaAgent')} ${via}` : null,
        c.broadcastCount ? t('inbox.broadcastRecipients', { count: String(c.broadcastCount) }) : null,
        c.fold ? t('inbox.org.foldCount', { count: String(c.fold.count) }) : null,
      ]}
      subject=${(!nested && c.subject) ? c.subject : null}
      preview=${`${byAgent ? `${t('inbox.viaAgent')} ${byAgent}: ` : (c.lastDirection === 'outbound' ? `${t('inbox.youPrefix')} ` : '')}${c.lastMessage || ''}`}
      why=${c.archived && !labelPeer ? whyArchived(c) : null}
      unread=${c.unread || 0}
      nested=${nested}
      active=${!selecting && activeConv?.conversationId === c.conversationId}
      selecting=${selecting} selected=${selecting && isSelected(c)}
      onOpen=${() => (selecting ? org.toggleSelected(rowIds(c)) : openConversation(c))}
      archive=${selecting || labelPeer ? null : { label: archiveWord, ariaLabel: `${archiveWord}: ${label}`, restore: back, onClick: () => org.archive(rowIds(c), back) }} />`;
  };

  /**
   * A row that stands for several threads, with the rest behind a disclosure. Collapsed by default: a
   * person who wants the individual threads asks for them, and a person who does not gets their list
   * back. The row itself still opens the newest thread, so what it stands for is one click away.
   */
  const foldRow = (c, nested) => {
    const key = c.broadcastId ? `b:${c.broadcastId}:${c.viaAgent || ''}` : `f:${c.conversationId}`;
    const open = !!openFolds[key];
    return html`<${ConversationFold} key=${key} row=${convRow(c, nested)} open=${open} closed=${selecting}
      onToggle=${() => toggleFold?.(key)}
      label=${open ? `↩ ${t('inbox.broadcastHide')}` : `→ ${t('inbox.broadcastShowAll', { count: String(c.folded.length) })}`}>
      ${c.folded.map(f => convRow(f, true, true))}
    <//>`;
  };
  const anyRow = (c, nested) => (c.folded?.length ? foldRow(c, nested) : convRow(c, nested));

  const unreadOf = (rows) => rows.reduce((n, c) => n + (c.unread || 0), 0);
  const countOf = (rows) => rows.reduce((n, c) => n + 1 + (c.folded?.length || 0), 0);

  /**
   * A person's or an agent's rows under a heading that closes (ThreadList's person heading): the
   * arrow, the picture, the name, the presence word and the two numbers, named. A single thread
   * renders flat.
   */
  const groupBlock = (key, seed, name, rows, presenceId) => {
    const open = !org.isCollapsed(key);
    const unread = unreadOf(rows);
    const ids = rows.flatMap(rowIds);
    const inArchive = rows[0]?.section === 'archive';
    const word = t(inArchive ? 'inbox.org.restoreGroup' : 'inbox.org.archiveGroup', { count: String(ids.length) });
    return html`<${ConversationGroup} key=${key} open=${open} onToggle=${() => org.toggleCollapsed(key)}
      picture=${seed} name=${name} presence=${presenceId}
      countLabel=${t('inbox.org.foldCount', { count: String(countOf(rows)) })}
      unreadLabel=${unread > 0 ? t('inbox.org.unreadCount', { count: String(unread) }) : null}
      pick=${selecting ? { label: t('inbox.org.selectAll'), onClick: () => org.toggleSelected(ids) } : null}
      archive=${selecting ? null : { label: word, ariaLabel: `${word}: ${name}`, restore: inArchive, onClick: () => org.archive(ids, inArchive) }}>
      ${rows.map(c => anyRow(c, true))}
    <//>`;
  };

  /** People: a person and their agents under the person, as the list has always grouped them. */
  const peopleBody = (rows) => groupConversations(rows).map(g => {
    if (g.convs.length === 1 && !isAgentPeer(g.convs[0].peerGhii)) return anyRow(g.convs[0], false);
    return groupBlock(`p:${g.ownerKey}`, g.ownerKey, peerDisplay(g.ownerKey), g.convs, g.ownerKey);
  });

  /** The owner's own agents: one heading per agent, so a coordination flood closes under its sender. */
  const agentsBody = (rows) => {
    const byAgent = new Map();
    for (const c of rows) {
      const k = whoOf(c);
      if (!byAgent.has(k)) byAgent.set(k, []);
      byAgent.get(k).push(c);
    }
    return [...byAgent.entries()].map(([agent, convs]) => (convs.length === 1
      ? anyRow(convs[0], false)
      : groupBlock(`a:${agent}`, agent, peerDisplay(agent), convs, agent)));
  };

  const section = (key, label, rows, body, closedByDefault = false) => {
    if (!rows.length) return null;
    const open = !org.isCollapsed(key, closedByDefault);
    return html`<${ConversationSection} key=${key} kind=${key.split(':')[0]} label=${label}
      count=${countOf(rows)} unread=${unreadOf(rows)} open=${open}
      onToggle=${() => org.toggleCollapsed(key, closedByDefault)}>${open ? body(rows) : null}<//>`;
  };

  const people = [], agents = [], archive = [];
  const groups = new Map();
  for (const c of conversations) {
    if (c.section === 'archive') archive.push(c);
    else if (c.section === 'agents') agents.push(c);
    else if (c.section === 'group' && c.group) {
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group).push(c);
    } else people.push(c);
  }

  // What a selection would do: archive what is in the list, bring back what is in the archive.
  const sectionOf = new Map();
  for (const c of conversations) for (const id of rowIds(c)) sectionOf.set(id, c.section);
  const toArchive = [...selected].filter(id => sectionOf.has(id) && sectionOf.get(id) !== 'archive');
  const toRestore = [...selected].filter(id => sectionOf.get(id) === 'archive');

  return html`
    <${ConversationList} selecting=${selecting} empty=${conversations.length ? null : t('inbox.noConversations')}>
      ${requests.length > 0 ? html`
        <${ConversationRequests} label=${t('inbox.requests')} count=${requests.length}>
          ${requests.map(r => html`<${ConversationRequest} key=${r.contactId} picture=${r.contactId}
            name=${peerDisplay(r.contactId)} presence=${r.contactId} address=${r.contactId} preview=${r.preview || ''}>
            <${Action} onClick=${() => accept(r.contactId)}>${t('inbox.accept')}<//>
            <${Action} onClick=${() => block(r.contactId)}>${t('inbox.block')}<//>
          <//>`)}
        <//>` : null}

      ${conversations.length ? html`
        <${ConversationTools} count=${selecting ? t('inbox.org.selectedCount', { count: String(selected.size) }) : null}>
          ${selecting ? html`
            <${Action} disabled=${!toArchive.length} onClick=${() => org.archive(toArchive, false, true)}>${t('inbox.org.archiveSelected', { count: String(toArchive.length) })}<//>
            ${toRestore.length ? html`<${Action} onClick=${() => org.archive(toRestore, true, true)}>${t('inbox.org.restoreSelected', { count: String(toRestore.length) })}<//>` : null}
            <${Action} tone="quiet" onClick=${() => org.endSelecting()}>${t('inbox.org.selectDone')}<//>`
          : html`<${Action} tone="quiet" onClick=${() => org.startSelecting()}>${t('inbox.org.select')}<//>`}
        <//>` : null}

      ${section('people', t('inbox.org.sectionPeople'), people, peopleBody)}
      ${section('agents', t('inbox.org.sectionAgents'), agents, agentsBody)}
      ${[...groups.entries()].map(([name, rows]) => section(`g:${name}`, name, rows, (r) => r.map(c => anyRow(c, false))))}
      ${section('archive', t('inbox.org.sectionArchive'), archive, (r) => r.map(c => anyRow(c, false)), true)}
    <//>`;
}
