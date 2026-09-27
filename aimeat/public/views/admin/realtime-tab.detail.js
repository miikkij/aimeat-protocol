/**
 * @file realtime-tab.detail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One room, opened: what it is, who is in it, which documents it is holding, and the
 *   door that closes it. Split from the page so neither file carries the other's length.
 *
 *   A NICK IS NOT AN ACCOUNT. The socket asks nobody who they are: the name beside a peer is what
 *   that peer called itself when it joined. That is worth reading before closing a room on the
 *   strength of a name, so the panel says it where the names are.
 * @structure RoomDetail({ room, idleMs, onClose, onCloseRoom })
 * @usage imported by realtime-tab.js
 * @version-history
 *   v1.2.0 — 2026-09-27 — On the library components (page group G5): the panel is the raised Box
 *     with the room's name, its tags and the ✕ in its head; each part a heavy Split with its
 *     SubHeading; the facts Facts; the people and the documents Lists; the close the loud danger
 *     action. The file writes no class and no style.
 *   v1.1.0 -- 2026-09-13 -- Compose ink row boundaries from the shared poster class.
 *   v1.0.0 — 2026-09-12 — Initial (the Realtime page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { fmtBytes, when } from './shared.js';
import { split } from './realtime-tab.model.js';
import { Box } from '/components/Box.js';
import { Marks, Mark, Code } from '/components/Mark.js';
import { Icon, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { List, Row, Name, Cell, When } from '/components/List.js';
import { Split } from '/components/Layout.js';
import { SubHeading } from '/components/SubHeading.js';

const R = (key, params) => t('dashboard.realtimePage.' + key, params);

/** The same duration the page prints. Both read the model's unit; neither imports the other. */
function dur(ms) {
  const { unit, n } = split(ms);
  return R('unit' + unit, { n });
}

export default function RoomDetail({ room, idleMs, onClose, onCloseRoom }) {
  const marks = html`<${Marks}>
    <${Code}>${room.id}<//>
    ${room.empty
    ? html`<${Mark}>${R('badgeEmpty')}<//>`
    : html`<${Mark} tone="fine">${R('badgeLive')}<//>`}
    ${room.appType && html`<${Mark}>${room.appType}<//>`}
    <${Mark}>${room.isPublic ? R('public') : R('private')}<//>
    ${room.maxPeers !== null && html`<${Mark}>${R('maxPeers', { n: room.maxPeers })}<//>`}
    ${(room.tags || []).map(tag => html`<${Mark} key=${tag}>${tag}<//>`)}
  <//>`;

  return html`
    <${Box} tone="raised" name=${room.name} marks=${marks}
      end=${html`<${Icon} small label=${t('common.close') || 'Close'} onClick=${onClose}>✗<//>`}>
      <${Note} kind="meta" mono>${R('crumb')}<//>

      <${Split} heavy>
        <${SubHeading} level=${4}>${R('theRoom')}<//>
        <${Facts} rows=${[
          { k: R('openedBy'), v: room.createdBy || '—', sub: `${when(room.createdAt)}${room.ageMs !== null ? ` · ${R('ago', { time: dur(room.ageMs) })}` : ''}` },
          { k: R('lastHeard'), v: room.heardMs !== null ? R('ago', { time: dur(room.heardMs) }) : '—', sub:
  room.closesInMs !== null
    ? R('closesIn', { time: dur(room.closesInMs) })
    : (idleMs ? R('idleRule', { time: dur(idleMs) }) : R('idleRuleUnknown')) },
          { k: R('whereItLives'), v: R('inMemory'), sub: R('inMemoryWhy') },
        ]} />
      <//>

      <${Split} heavy>
        <${SubHeading} level=${4}>${R('whoIsInIt')}<//>
        ${room.peers.length === 0
    ? html`<${Note}>${R('nobodyLeft')}<//>`
    : html`
          <${List} cols="name-id-when" dense head=${[R('colPerson'), R('colConnection'), R('colJoined')]} labels>
            ${room.peers.map(p => html`
              <${Row} key=${p.peerId}>
                <${Name} dot="active">${p.nick || R('someone')}<//>
                <${Cell} meta>${p.peerId}<//>
                <${When}>${p.joinedMs !== null ? dur(p.joinedMs) : '—'}<//>
              <//>`)}
          <//>
          <${Note}>${R('nickNote')}<//>`}
      <//>

      <${Split} heavy>
        <${SubHeading} level=${4}>${R('sharedDocs')}<//>
        ${room.docList.length === 0
    ? html`<${Note}>${R('noDocs')}<//>`
    : html`
          <${List} cols="path-size" dense head=${[R('colDoc'), R('colSnapshot')]} labels>
            ${room.docList.map(d => html`
              <${Row} key=${d.id}>
                <${Name}>${d.id}<//>
                <${Cell} meta>${fmtBytes(d.bytes)}<//>
              <//>`)}
          <//>
          <${Note}>${R('docNote')}<//>`}
      <//>

      <${Split} heavy>
        <${SubHeading} level=${4}>${R('closingIt')}<//>
        <${Note}>${room.peerCount === 0 ? R('closingWhyEmpty')
    : room.peerCount === 1 ? R('closingWhyOne')
      : R('closingWhy', { count: room.peerCount })}<//>
        <${Loud} danger onClick=${onCloseRoom}>${R('close')}<//>
      <//>
    <//>`;
}
