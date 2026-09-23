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
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared set: the opened record Surface, the room's name
 *     as a mono heading, chips, KeyValues
 *     for the room, the shared Table for its people and documents, a shared icon action to close the
 *     panel and the page's one loud action to close the room.
 *   v1.1.0 -- 2026-09-13 -- Compose ink row boundaries from the shared poster class.
 *   v1.0.0 — 2026-09-12 — Initial (the Realtime page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { fmtBytes, when, DataTable } from './shared.js';
import { split } from './realtime-tab.model.js';
import { Surface, Stack, KeyValue, Action, Chip, Text } from '/components/poster-parts.js';

const R = (key, params) => t('dashboard.realtimePage.' + key, params);

/** The same duration the page prints. Both read the model's unit; neither imports the other. */
function dur(ms) {
  const { unit, n } = split(ms);
  return R('unit' + unit, { n });
}

/** A value with the sentence under it. */
const fact = (value, why) => html`<${Stack} density="compact">${value}<${Text} kind="caption" tone="muted">${why}<//><//>`;

export default function RoomDetail({ room, idleMs, onClose, onCloseRoom }) {
  return html`
    <${Surface} kind="record">
      <${Stack} density="roomy">
        <${Stack} direction="horizontal" align="between">
          <${Stack} density="compact">
            <${Text} kind="label">${R('crumb')}<//>
            <${Text} kind="heading" face="mono">${room.name}<//>
            <${Text} kind="mono" tone="muted">${room.id}<//>
            <${Stack} direction="wrap" density="compact">
              ${room.empty
    ? html`<${Chip} tone="muted">${R('badgeEmpty')}<//>`
    : html`<${Chip} tone="success">${R('badgeLive')}<//>`}
              ${room.appType && html`<${Chip}>${room.appType}<//>`}
              <${Chip}>${room.isPublic ? R('public') : R('private')}<//>
              ${room.maxPeers !== null && html`<${Chip}>${R('maxPeers', { n: room.maxPeers })}<//>`}
              ${(room.tags || []).map(tag => html`<${Chip}>${tag}<//>`)}
            <//>
          <//>
          <${Action} kind="icon" onClick=${onClose} label=${t('common.close') || 'Close'}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
              <line x1="2" y1="2" x2="12" y2="12"></line>
              <line x1="12" y1="2" x2="2" y2="12"></line>
            </svg>
          <//>
        <//>

        <${Stack} density="compact">
          <${Text} kind="label">${R('theRoom')}<//>
          <div>
            <${KeyValue} label=${R('openedBy')} value=${fact(room.createdBy || '—',
    `${when(room.createdAt)}${room.ageMs !== null ? ` · ${R('ago', { time: dur(room.ageMs) })}` : ''}`)} />
            <${KeyValue} label=${R('lastHeard')} value=${fact(room.heardMs !== null ? R('ago', { time: dur(room.heardMs) }) : '—',
    room.closesInMs !== null
      ? R('closesIn', { time: dur(room.closesInMs) })
      : (idleMs ? R('idleRule', { time: dur(idleMs) }) : R('idleRuleUnknown')))} />
            <${KeyValue} label=${R('whereItLives')} value=${fact(R('inMemory'), R('inMemoryWhy'))} />
          </div>
        <//>

        <${Stack} density="compact">
          <${Text} kind="label">${R('whoIsInIt')}<//>
          ${room.peers.length === 0
    ? html`<${Text} tone="muted">${R('nobodyLeft')}<//>`
    : html`
            <${DataTable} headers=${[R('colPerson'), R('colConnection'), R('colJoined')]}
              rows=${room.peers.map(p => [
      p.nick || R('someone'),
      { text: p.peerId, mono: true },
      { text: p.joinedMs !== null ? dur(p.joinedMs) : '—', mono: true },
    ])} />
            <${Text} kind="caption" tone="muted">${R('nickNote')}<//>`}
        <//>

        <${Stack} density="compact">
          <${Text} kind="label">${R('sharedDocs')}<//>
          ${room.docList.length === 0
    ? html`<${Text} tone="muted">${R('noDocs')}<//>`
    : html`
            <${DataTable} headers=${[R('colDoc'), R('colSnapshot')]}
              rows=${room.docList.map(d => [d.id, { text: fmtBytes(d.bytes), mono: true }])} />
            <${Text} kind="caption" tone="muted">${R('docNote')}<//>`}
        <//>

        <${Stack} density="compact">
          <${Text} kind="label">${R('closingIt')}<//>
          <${Text} tone="muted">${room.peerCount === 0 ? R('closingWhyEmpty')
    : room.peerCount === 1 ? R('closingWhyOne')
      : R('closingWhy', { count: room.peerCount })}<//>
          <${Stack} direction="horizontal">
            <${Action} kind="primary" tone="danger" onClick=${onCloseRoom}>${R('close')}<//>
          <//>
        <//>
      <//>
    <//>`;
}
