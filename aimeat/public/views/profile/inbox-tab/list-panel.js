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
import { escHtml } from '/js/utils.js';
import { PresenceDot } from '/components/PresenceDot.js';
import { Avatar } from './components.js';
import { ThreadPerson } from '/components/ThreadList.js';
import { peerName, isAgentPeer, subThreadLabel, groupConversations, stampShort, stampFull } from './helpers.js';

const DAY_MS = 86_400_000;

/** Every thread a row stands for: itself and whatever is folded under it. */
export function rowIds(c) {
  return [c.conversationId, ...(c.folded || []).map(f => f.conversationId)];
}

const Chevron = ({ open }) => html`<svg class=${`inbox-chev${open ? ' is-open' : ''}`} viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
  <path d="M3.2 1.6 6.6 5 3.2 8.4" fill="none" stroke="currentColor" stroke-width="1.8" /></svg>`;
/** A box with the lid on (archive) or an arrow leaving it (restore). */
const BoxIcon = ({ restore }) => html`<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">
  <rect x="1.8" y="2.2" width="12.4" height="3.4" /><path d="M3 5.6v8.2h10V5.6" />
  ${restore ? html`<path d="M8 12V7.6M5.9 9.5 8 7.4l2.1 2.1" />` : html`<path d="M6.2 8.4h3.6" />`}</svg>`;

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
   * One conversation row: the chat's row (ThreadList's .poster-thread), the name in bold and one quiet
   * line under it with the time and the last message. `nested` = inside a person or agent group;
   * `labelPeer` = inside an opened fold.
   */
  const convRow = (c, nested, labelPeer) => {
    const active = !selecting && activeConv?.conversationId === c.conversationId ? ' poster-thread--active' : '';
    const picked = selecting && isSelected(c) ? ' inbox-conv--selected' : '';
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
    const onClick = () => (selecting ? org.toggleSelected(rowIds(c)) : openConversation(c));
    // The row's own archive control is a sibling of the row's button, never inside it: a button in a
    // button is not a control a keyboard or a screen reader can reach.
    const back = c.section === 'archive';
    const word = back ? t('inbox.org.restoreConv') : t('inbox.org.archiveConv');
    const chip = (text) => html` · <span class="poster-chip">${text}</span>`;
    return html`
      <div class=${`poster-thread${active}${picked}`} key=${c.conversationId}>
        <button type="button" class="poster-thread-open"
          aria-pressed=${selecting ? (isSelected(c) ? 'true' : 'false') : undefined} onClick=${onClick}>
          <span class="poster-thread-title">
            ${selecting ? html`<span class="inbox-conv-check" aria-hidden="true">${isSelected(c) ? '✓' : ''}</span> ` : null}${escHtml(label)} ${(!c.groupAlias && (!nested || c.peerGhii?.includes('#'))) ? html`<${PresenceDot} ghii=${c.peerGhii} />` : ''}
          </span>
          <span class="poster-thread-sub" title=${c.updatedAt ? stampFull(c.updatedAt) : ''}>
            ${c.updatedAt ? stampShort(c.updatedAt) : ''}${!nested && via ? chip(`${t('inbox.viaAgent')} ${escHtml(via)}`) : ''}${c.broadcastCount ? chip(t('inbox.broadcastRecipients', { count: String(c.broadcastCount) })) : ''}${c.fold ? chip(t('inbox.org.foldCount', { count: String(c.fold.count) })) : ''}${(!nested && c.subject) ? ` · ${escHtml(c.subject)}` : ''} · ${byAgent ? `${t('inbox.viaAgent')} ${byAgent}: ` : (c.lastDirection === 'outbound' ? `${t('inbox.youPrefix')} ` : '')}${escHtml(c.lastMessage || '')}
          </span>
          ${c.archived && !labelPeer ? html`<span class="poster-thread-sub">${whyArchived(c)}</span>` : null}
        </button>
        ${c.unread > 0 ? html`<span class="poster-count poster-count--waiting">${c.unread}</span>` : null}
        ${selecting || labelPeer ? null : html`
          <button type="button" class="poster-icon poster-icon--small poster-thread-del" title=${word} aria-label=${`${word}: ${label}`}
            onClick=${() => org.archive(rowIds(c), back)}><${BoxIcon} restore=${back} /></button>`}
      </div>`;
  };

  /**
   * A row that stands for several threads, with the rest behind a disclosure. Collapsed by default: a
   * person who wants the individual threads asks for them, and a person who does not gets their list
   * back. The row itself still opens the newest thread, so what it stands for is one click away.
   */
  const foldRow = (c, nested) => {
    const key = c.broadcastId ? `b:${c.broadcastId}:${c.viaAgent || ''}` : `f:${c.conversationId}`;
    const open = !!openFolds[key];
    return html`
      <div class="inbox-conv-fold" key=${key}>
        ${convRow(c, nested)}
        ${selecting ? null : html`<button type="button" class="inbox-fold-toggle" aria-expanded=${open ? 'true' : 'false'}
          onClick=${() => toggleFold?.(key)}>
          ${open ? `↩ ${t('inbox.broadcastHide')}` : `→ ${t('inbox.broadcastShowAll', { count: String(c.folded.length) })}`}
        </button>`}
        ${open && !selecting ? c.folded.map(f => convRow(f, true, true)) : null}
      </div>`;
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
    return html`
      <div class="inbox-conv-group" key=${key}>
        <div class="inbox-conv-group-bar">
          <${ThreadPerson} expanded=${open} onClick=${() => org.toggleCollapsed(key)}>
            <${Chevron} open=${open} />
            <${Avatar} seed=${seed} size=${24} />
            <span class="poster-thread-person-name">${escHtml(name)}</span>
            ${presenceId ? html`<${PresenceDot} ghii=${presenceId} label=${true} />` : null}
            <span class="poster-count poster-count--tally">${t('inbox.org.foldCount', { count: String(countOf(rows)) })}</span>
            ${unread > 0 ? html`<span class="poster-count poster-count--waiting">${t('inbox.org.unreadCount', { count: String(unread) })}</span>` : null}
          <//>
          ${selecting
            ? html`<button type="button" class="poster-action poster-action--quiet inbox-group-pick" onClick=${() => org.toggleSelected(ids)}>${t('inbox.org.selectAll')}</button>`
            : html`<button type="button" class="poster-icon poster-icon--small inbox-group-act" title=${word}
                aria-label=${`${word}: ${name}`} onClick=${() => org.archive(ids, inArchive)}><${BoxIcon} restore=${inArchive} /></button>`}
        </div>
        ${open ? rows.map(c => anyRow(c, true)) : null}
      </div>`;
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
    const unread = unreadOf(rows);
    return html`
      <div class=${`inbox-sec inbox-sec--${key.split(':')[0]}`} key=${key}>
        <button type="button" class="inbox-list-section inbox-sec-head poster-day-title" aria-expanded=${open ? 'true' : 'false'} onClick=${() => org.toggleCollapsed(key, closedByDefault)}>
          <${Chevron} open=${open} />
          <span class="inbox-sec-name">${label}</span>
          <span class="poster-count poster-count--tally">${countOf(rows)}</span>
          ${unread > 0 ? html`<span class="poster-count poster-count--waiting">${unread}</span>` : null}
        </button>
        ${open ? html`<div class="poster-thread-list">${body(rows)}</div>` : null}
      </div>`;
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
    <div class=${`inbox-list${selecting ? ' inbox-list--selecting' : ''}`}>
      ${requests.length > 0 ? html`
        <div class="inbox-list-section poster-day-title">${t('inbox.requests')} <span class="poster-count poster-count--waiting">${requests.length}</span></div>
        ${requests.map(r => html`
          <div class="inbox-request" key=${r.contactId}>
            <div class="inbox-request-top">
              <${Avatar} seed=${r.contactId} size=${36} />
              <div class="inbox-request-id">
                <div class="inbox-name">${escHtml(peerDisplay(r.contactId))} <${PresenceDot} ghii=${r.contactId} /></div>
                <div class="inbox-sub">${escHtml(r.contactId)}</div>
              </div>
            </div>
            <div class="inbox-request-preview">${escHtml(r.preview || '')}</div>
            <div class="inbox-request-actions">
              <button class="poster-action" onClick=${() => accept(r.contactId)}>${t('inbox.accept')}</button>
              <button class="poster-action" onClick=${() => block(r.contactId)}>${t('inbox.block')}</button>
            </div>
          </div>`)}` : null}

      ${conversations.length ? html`
        <div class="inbox-list-tools">
          ${selecting ? html`
            <span class="inbox-list-tools-count">${t('inbox.org.selectedCount', { count: String(selected.size) })}</span>
            <button type="button" class="poster-action" disabled=${!toArchive.length} onClick=${() => org.archive(toArchive, false, true)}>${t('inbox.org.archiveSelected', { count: String(toArchive.length) })}</button>
            ${toRestore.length ? html`<button type="button" class="poster-action" onClick=${() => org.archive(toRestore, true, true)}>${t('inbox.org.restoreSelected', { count: String(toRestore.length) })}</button>` : null}
            <button type="button" class="poster-action poster-action--quiet" onClick=${() => org.endSelecting()}>${t('inbox.org.selectDone')}</button>`
          : html`<button type="button" class="poster-action poster-action--quiet" onClick=${() => org.startSelecting()}>${t('inbox.org.select')}</button>`}
        </div>` : html`<div class="poster-quiet inbox-empty-sm">${t('inbox.noConversations')}</div>`}

      ${section('people', t('inbox.org.sectionPeople'), people, peopleBody)}
      ${section('agents', t('inbox.org.sectionAgents'), agents, agentsBody)}
      ${[...groups.entries()].map(([name, rows]) => section(`g:${name}`, name, rows, (r) => r.map(c => anyRow(c, false))))}
      ${section('archive', t('inbox.org.sectionArchive'), archive, (r) => r.map(c => anyRow(c, false)), true)}
    </div>`;
}
