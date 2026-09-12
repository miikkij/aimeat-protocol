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
 *   v1.0.0 — 2026-09-12 — Initial (the Realtime page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { fmtBytes, when } from './shared.js';
import { split } from './realtime-tab.model.js';

const R = (key, params) => t('dashboard.realtimePage.' + key, params);

/** The same duration the page prints. Both read the model's unit; neither imports the other. */
function dur(ms) {
  const { unit, n } = split(ms);
  return R('unit' + unit, { n });
}

export default function RoomDetail({ room, idleMs, onClose, onCloseRoom }) {
  return html`
    <div class="adm-rt-panel">
      <div class="adm-rt-phead">
        <div>
          <div class="adm-rt-crumb">${R('crumb')}</div>
          <h3>${room.name}<small>${room.id}</small></h3>
          <div class="adm-rt-chips">
            ${room.empty
    ? html`<span class="adm-rt-chip">${R('badgeEmpty')}</span>`
    : html`<span class="adm-rt-chip adm-rt-chip--live">${R('badgeLive')}</span>`}
            ${room.appType && html`<span class="adm-rt-chip">${room.appType}</span>`}
            <span class="adm-rt-chip">${room.isPublic ? R('public') : R('private')}</span>
            ${room.maxPeers !== null && html`<span class="adm-rt-chip">${R('maxPeers', { n: room.maxPeers })}</span>`}
            ${(room.tags || []).map(tag => html`<span class="adm-rt-chip">${tag}</span>`)}
          </div>
        </div>
        <button type="button" class="adm-rt-x" onClick=${onClose} aria-label=${t('common.close') || 'Close'}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="2" y1="2" x2="12" y2="12"></line>
            <line x1="12" y1="2" x2="2" y2="12"></line>
          </svg>
        </button>
      </div>

      <div class="adm-rt-psec">
        <div class="adm-rt-sub">${R('theRoom')}</div>
        <dl class="adm-rt-kv">
          <dt>${R('openedBy')}</dt>
          <dd>${room.createdBy || '—'}<em>${when(room.createdAt)}${room.ageMs !== null ? ` · ${R('ago', { time: dur(room.ageMs) })}` : ''}</em></dd>
          <dt>${R('lastHeard')}</dt>
          <dd>${room.heardMs !== null ? R('ago', { time: dur(room.heardMs) }) : '—'}<em>${
  room.closesInMs !== null
    ? R('closesIn', { time: dur(room.closesInMs) })
    : (idleMs ? R('idleRule', { time: dur(idleMs) }) : R('idleRuleUnknown'))}</em></dd>
          <dt>${R('whereItLives')}</dt>
          <dd>${R('inMemory')}<em>${R('inMemoryWhy')}</em></dd>
        </dl>
      </div>

      <div class="adm-rt-psec">
        <div class="adm-rt-sub">${R('whoIsInIt')}</div>
        ${room.peers.length === 0
    ? html`<p class="adm-rt-note">${R('nobodyLeft')}</p>`
    : html`
          <div class="adm-rt-prow adm-rt-prow--head">
            <div>${R('colPerson')}</div><div>${R('colConnection')}</div><div>${R('colJoined')}</div>
          </div>
          ${room.peers.map(p => html`
            <div class="adm-rt-prow">
              <div class="adm-rt-person"><i></i>${p.nick || R('someone')}</div>
              <div class="adm-rt-id">${p.peerId}</div>
              <div class="adm-rt-when">${p.joinedMs !== null ? dur(p.joinedMs) : '—'}</div>
            </div>`)}
          <p class="adm-rt-note">${R('nickNote')}</p>`}
      </div>

      <div class="adm-rt-psec">
        <div class="adm-rt-sub">${R('sharedDocs')}</div>
        ${room.docList.length === 0
    ? html`<p class="adm-rt-note">${R('noDocs')}</p>`
    : html`
          <div class="adm-rt-prow adm-rt-prow--head">
            <div>${R('colDoc')}</div><div>${R('colSnapshot')}</div><div></div>
          </div>
          ${room.docList.map(d => html`
            <div class="adm-rt-prow">
              <div class="adm-rt-person">${d.id}</div>
              <div class="adm-rt-id">${fmtBytes(d.bytes)}</div>
              <div></div>
            </div>`)}
          <p class="adm-rt-note">${R('docNote')}</p>`}
      </div>

      <div class="adm-rt-psec">
        <div class="adm-rt-sub">${R('closingIt')}</div>
        <p class="adm-rt-note">${room.peerCount === 0 ? R('closingWhyEmpty')
    : room.peerCount === 1 ? R('closingWhyOne')
      : R('closingWhy', { count: room.peerCount })}</p>
        <button type="button" class="adm-rt-slab" onClick=${onCloseRoom}>${R('close')}</button>
      </div>
    </div>`;
}
