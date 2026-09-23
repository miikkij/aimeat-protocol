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
 *   v2.1.0 -- 2026-09-22 -- The last line is clamped to one line and a row's archive menu shows on
 *     hover or focus, so a row is as dense as the old mail list's; on a phone (`narrow`) the menu
 *     sits beside the time, where it does not add a line to the row.
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared set and kept dense: one compact ListRow per
 *     conversation (avatar, name, subject and the last line clamped, the time at the right), the
 *     section and group headings small folds with a count chip, not section slabs; a row's and a
 *     group's archive sit in their Menu instead of a framed button on every row. The selection,
 *     the folds and every handler are unchanged.
 *   v1.0.0 — 2026-09-13 — Moved out of panels.js and rebuilt around sections, closable groups, the
 *     archive and selection. The person group, the row and the broadcast fold are the ones panels.js
 *     had, with the fold generalised to the subject and rule folds.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PresenceDot } from '/components/PresenceDot.js';
import { Fold, ListRow, Action, Menu, Chip, CheckItem, Stack, Surface, Text } from '/components/poster-parts.js';
import { Avatar } from './components.js';
import { peerName, isAgentPeer, subThreadLabel, groupConversations, stampShort, stampFull } from './helpers.js';

const DAY_MS = 86_400_000;

/** Every thread a row stands for: itself and whatever is folded under it. */
export function rowIds(c) {
  return [c.conversationId, ...(c.folded || []).map(f => f.conversationId)];
}

/** Rows side by side with no gap of their own: each row carries its own hairline. */
const Rows = ({ children }) => html`<${Surface} kind="plain" density="flush">${children}<//>`;

export function ListPanel({ requests, conversations, activeConv, peerDisplay, accept, block, openConversation, openFolds = {}, toggleFold, org, narrow = false }) {
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

  /** One conversation row. `nested` = inside a person or agent group; `labelPeer` = inside an opened fold. */
  const convRow = (c, nested, labelPeer) => {
    const active = !selecting && activeConv?.conversationId === c.conversationId;
    const picked = selecting && isSelected(c);
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
    const icon = (via || sub) ? t('inbox.cover.markAgent') || 'ag' : (c.subject ? '#' : '·');
    const onClick = () => (selecting ? org.toggleSelected(rowIds(c)) : openConversation(c));
    const back = c.section === 'archive';
    const word = back ? t('inbox.org.restoreConv') : t('inbox.org.archiveConv');
    const mark = selecting ? html`<${CheckItem} done=${isSelected(c)} />`
      : nested ? html`<${Text} kind="mono" tone="coral">${icon}<//>`
      : html`<${Avatar} seed=${labelPeer ? foldedWho(c) : whoOf(c)} size=${36} />`;
    const name = html`${label}${(!c.groupAlias && (!nested || c.peerGhii?.includes('#'))) ? html` <${PresenceDot} ghii=${c.peerGhii} />` : ''}
      ${!nested && via ? html` <${Chip} tone="muted">${t('inbox.viaAgent')} ${via}<//>` : ''}
      ${c.broadcastCount ? html` <${Chip} tone="muted">${t('inbox.broadcastRecipients', { count: String(c.broadcastCount) })}<//>` : ''}
      ${c.fold ? html` <${Chip} tone="muted">${t('inbox.org.foldCount', { count: String(c.fold.count) })}<//>` : ''}
      ${c.unread > 0 ? html` <${Chip} tone="sun">${c.unread}<//>` : null}`;
    const detail = html`${(!nested && c.subject) ? html`<${Text} kind="mono" tone="coral">${c.subject}<//> ` : ''}${byAgent ? `${t('inbox.viaAgent')} ${byAgent}: ` : (c.lastDirection === 'outbound' ? `${t('inbox.youPrefix')} ` : '')}${c.lastMessage || ''}`;
    const stamp = html`<span title=${c.updatedAt ? stampFull(c.updatedAt) : ''}>${c.updatedAt ? stampShort(c.updatedAt) : ''}</span>`;
    // The row's own archive is in its menu, a control on the row (never inside the button that opens
    // it) that shows while the row is hovered or focused, as the old archive button did. On a phone
    // the menu is always there, and a row's actions would take a line of their own, so it sits
    // beside the time instead.
    const menu = selecting || labelPeer ? null
      : html`<${Menu} label=${`${word}: ${label}`} items=${[{ label: word, onClick: () => org.archive(rowIds(c), back) }]} />`;
    const value = narrow && menu ? html`<${Stack} direction="horizontal" align="center" density="compact">${stamp}${menu}<//>` : stamp;
    const actions = narrow ? null : menu;
    return html`<${ListRow} key=${c.conversationId} density="compact" preview=${true} previewLines=${1} mark=${mark}
      name=${name} detail=${detail} value=${value} actions=${actions} actionsReveal="hover" onOpen=${onClick} selected=${active || picked}>
      ${c.archived && !labelPeer ? html`<${Text} kind="caption" tone="muted">${whyArchived(c)}<//>` : null}
    <//>`;
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
      <${Rows} key=${key}>
        ${convRow(c, nested)}
        ${selecting ? null : html`<${Action} kind="text" expanded=${open} onClick=${() => toggleFold?.(key)}>
          ${open ? `↩ ${t('inbox.broadcastHide')}` : `→ ${t('inbox.broadcastShowAll', { count: String(c.folded.length) })}`}<//>`}
        ${open && !selecting ? c.folded.map(f => convRow(f, true, true)) : null}
      <//>`;
  };
  const anyRow = (c, nested) => (c.folded?.length ? foldRow(c, nested) : convRow(c, nested));

  const unreadOf = (rows) => rows.reduce((n, c) => n + (c.unread || 0), 0);
  const countOf = (rows) => rows.reduce((n, c) => n + 1 + (c.folded?.length || 0), 0);
  /** The count and the unread figure that follow a heading. */
  const counts = (rows) => {
    const unread = unreadOf(rows);
    return html` <${Chip}>${countOf(rows)}<//>${unread > 0 ? html` <${Chip} tone="sun">${unread}<//>` : null}`;
  };

  /** A person's or an agent's rows under a heading that closes. A single thread renders flat. */
  const groupBlock = (key, seed, name, rows, presenceId) => {
    const open = !org.isCollapsed(key);
    const ids = rows.flatMap(rowIds);
    const inArchive = rows[0]?.section === 'archive';
    const word = t(inArchive ? 'inbox.org.restoreGroup' : 'inbox.org.archiveGroup', { count: String(ids.length) });
    return html`
      <${Fold} key=${key} open=${open} onToggle=${() => org.toggleCollapsed(key)}
        title=${html`<${Avatar} seed=${seed} size=${28} /> ${name}${presenceId ? html` <${PresenceDot} ghii=${presenceId} />` : null}${counts(rows)}`}
        actions=${selecting
          ? html`<${Action} kind="text" onClick=${() => org.toggleSelected(ids)}>${t('inbox.org.selectAll')}<//>`
          : html`<${Menu} label=${`${word}: ${name}`} items=${[{ label: word, onClick: () => org.archive(ids, inArchive) }]} />`}>
        <${Rows}>${rows.map(c => anyRow(c, true))}<//>
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

  /** A section of the list: a small coral label that folds, its count, and its rows. Not a slab: the
   *  list is a dense mail list, and a heading here names a group, it does not open a page part. */
  const section = (key, label, rows, body, closedByDefault = false) => {
    if (!rows.length) return null;
    const open = !org.isCollapsed(key, closedByDefault);
    return html`
      <${Fold} key=${key} open=${open} onToggle=${() => org.toggleCollapsed(key, closedByDefault)}
        title=${html`<${Text} kind="label">${label}<//>${counts(rows)}`}>
        <${Rows}>${body(rows)}<//>
      <//>`;
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
    <${Stack} density="compact">
      ${requests.length > 0 ? html`
        <${Stack} direction="horizontal" align="center" density="compact"><${Text} kind="label">${t('inbox.requests')}<//><${Chip}>${requests.length}<//><//>
        <${Rows}>${requests.map(r => html`
          <${ListRow} key=${r.contactId} density="compact" mark=${html`<${Avatar} seed=${r.contactId} size=${36} />`}
            name=${html`${peerDisplay(r.contactId)} <${PresenceDot} ghii=${r.contactId} />`} detail=${r.contactId}
            actions=${html`
              <${Action} kind="text" tone="success" onClick=${() => accept(r.contactId)}>${t('inbox.accept')}<//>
              <${Action} kind="text" tone="danger" onClick=${() => block(r.contactId)}>${t('inbox.block')}<//>`}>
            ${r.preview ? html`<${Text} kind="caption">${r.preview}<//>` : null}
          <//>`)}<//>` : null}

      ${conversations.length ? html`
        <${Stack} direction="wrap" align="center" density="compact">
          ${selecting ? html`
            <${Text} kind="mono">${t('inbox.org.selectedCount', { count: String(selected.size) })}<//>
            <${Action} disabled=${!toArchive.length} onClick=${() => org.archive(toArchive, false, true)}>${t('inbox.org.archiveSelected', { count: String(toArchive.length) })}<//>
            ${toRestore.length ? html`<${Action} onClick=${() => org.archive(toRestore, true, true)}>${t('inbox.org.restoreSelected', { count: String(toRestore.length) })}<//>` : null}
            <${Action} kind="text" onClick=${() => org.endSelecting()}>${t('inbox.org.selectDone')}<//>`
          : html`<${Action} kind="text" onClick=${() => org.startSelecting()}>${t('inbox.org.select')}<//>`}
        <//>` : html`<${Text} tone="muted">${t('inbox.noConversations')}<//>`}

      <${Rows}>
        ${section('people', t('inbox.org.sectionPeople'), people, peopleBody)}
        ${section('agents', t('inbox.org.sectionAgents'), agents, agentsBody)}
        ${[...groups.entries()].map(([name, rows]) => section(`g:${name}`, name, rows, (r) => r.map(c => anyRow(c, false))))}
        ${section('archive', t('inbox.org.sectionArchive'), archive, (r) => r.map(c => anyRow(c, false)), true)}
      <//>
    <//>`;
}
