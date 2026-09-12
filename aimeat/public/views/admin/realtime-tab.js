/**
 * @file public/views/admin/realtime-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Realtime page in the poster face (design canvas "AIMEAT Admin Realtime"):
 *   who is connected right now, the rooms one at a time, and what has moved since this site started.
 *
 *   THE PAGE IS USUALLY EMPTY, SO THE EMPTY STATES ARE THE PAGE. Three different things used to
 *   print as the same three zeros: nobody connected this minute, nothing connected since the last
 *   restart, and realtime switched off. The first is ordinary, the second is worth checking with the
 *   address it names, and the third is a setting rather than a fault. The route says which it is now.
 *
 *   IT SHOWED THREE OF EIGHT NUMBERS, AND ONE OF THE THREE COULD NOT WORK. The overview carries
 *   eight counters; the page printed the two that are zero whenever nobody is online plus a document
 *   count that read `yjs_documents`, a key nothing has ever sent. The five it dropped are the ones
 *   that say whether this has ever worked at all, and refused messages is a health signal nobody had
 *   seen. All eight are drawn, under the sentence that says they are counted in memory since the
 *   restart and cover the uptime beside them.
 *
 * @structure
 *   - RealtimeTab({ data, reload }) — the three sections, the four empty states, the close question
 *   - dur / heard — the durations a row prints instead of a timestamp
 * @version-history
 *   v2.0.0 — 2026-09-12 — The poster face: all eight counters, the document count summed from the
 *     rooms it actually lives in, the three empties told apart, one room openable with its peers and
 *     documents, and a close question that says who it disconnects.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { num, fmtBytes, Row, Badge, Empty, useToast, Toast } from './shared.js';
import { closeRoom } from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';
import { decorate, summarise, order, split } from './realtime-tab.model.js';
import RoomDetail from './realtime-tab.detail.js';

const R = (key, params) => t('dashboard.realtimePage.' + key, params);

/** The poster dialog this page asks its one question in. */
const DLG = 'adm-rt-dlg';

/** "2 d", "20 h", "35 min", "4 s" — the model picks the unit, the locale writes the words. */
function dur(ms) {
  const { unit, n } = split(ms);
  return R('unit' + unit, { n });
}

/**
 * One or many, branched here rather than in the string: t() interpolates and does not decline, so
 * "1 people" is what a single {n} produces and "1 huoneessa" is not what Finnish wants either.
 */
const people = (n) => (n === 1 ? R('peopleOne') : R('peopleN', { n: num(n) }));
const statusPeople = (n) => (n === 1 ? R('statusPersonOne') : R('statusPeople', { n: num(n) }));
const statusRooms = (n) => (n === 1 ? R('statusRoomOne') : R('statusRooms', { n: num(n) }));

/** "4 s ago", or nothing when the room carried no usable stamp. */
function heard(ms) {
  return ms === null ? '' : R('ago', { time: dur(ms) });
}

export default function RealtimeTab({ data, reload }) {
  useViewCSS('/css/views/admin-realtime.css');
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const [busiest, setBusiest] = useState(false);
  const [openId, setOpenId] = useState(null);

  const rt = data.realtime;
  const rows = useMemo(() => decorate(rt), [rt]);
  const f = useMemo(() => summarise(rt, rows), [rt, rows]);
  const shown = useMemo(() => order(rows, busiest), [rows, busiest]);
  const open = shown.find(r => r.id === openId) || null;

  async function doClose(room) {
    try {
      await closeRoom(room.id);
      showOk(R('closed', { name: room.name }));
      setOpenId(null);
      reload();
    } catch (e) { showErr(e?.message || 'Failed'); }
  }

  /** The one question. It is felt by other people the instant it is answered. */
  function askClose(room) {
    const names = room.peers.map(p => p.nick).filter(Boolean).join(', ');
    const body = html`<span class="adm-rt-ask">
      <span>${room.peerCount === 0
    ? R('askEmpty')
    : room.peerCount === 1 ? R('askOne', { name: names || R('someone') }) : R('askMany', { count: room.peerCount })}</span>
      <span class="adm-rt-ask-rows">
        ${room.peerCount > 0 && html`<span class="adm-rt-ask-row">${names || R('someone')}<em>${R('askRowPeers')}</em></span>`}
        ${room.docs > 0 && html`<span class="adm-rt-ask-row">${room.docs === 1
    ? R('askRowDocsOne', { size: fmtBytes(room.docBytes) })
    : R('askRowDocs', { count: room.docs, size: fmtBytes(room.docBytes) })}<em>${R('askRowDocsVal')}</em></span>`}
        <span class="adm-rt-ask-row">${room.name}<em>${R('askRowRoomVal')}</em></span>
      </span>
      <span class="adm-rt-ask-note">${f.idleMs
    ? R('askNote', { time: dur(f.idleMs) })
    : R('askNoteNoIdle')}</span>
    </span>`;
    confirm(body, () => doClose(room),
      { title: R('askTitle'), confirmLabel: R('closeIt'), danger: true, className: DLG });
  }

  // The read itself failed. Not one of the three empties: nothing here was measured, so nothing
  // here is printed as a zero.
  if (f.state === 'unreachable') {
    return html`
      <div class="og adm-rt">
        <div class="adm-rt-empty">
          <h3>${R('noReadTitle')}</h3>
          <p>${R('noReadWhy')}</p>
          <button type="button" class="og-door" onClick=${() => reload()}>${R('tryAgain')}</button>
        </div>
      </div>`;
  }

  // Switched off. There is nothing to count, so nothing is counted: the page says which setting did
  // it and what apps get instead. It used to arrive as grey italic "Realtime unavailable".
  if (f.state === 'off') {
    return html`
      <div class="og adm-rt">
        <section class="og-sec og-sec--first">
          <div class="og-sec-h"><h2>${R('who')}<small>01</small></h2></div>
          <div class="adm-ov-grid">
            <div>
              <div class="adm-ov-status quiet">${R('statusOff')}</div>
              <p class="adm-alert-line">${R('offLead')}</p>
            </div>
            <div>
              <dl class="adm-rt-kv">
                <dt>${R('theSwitch')}</dt>
                <dd><code>AIMEAT_REALTIME_ENABLED=false</code><em>${R('theSwitchWhy')}</em></dd>
              </dl>
              <div class="og-box og-box--solid adm-rt-offbox">
                <span class="og-box-label">${R('offLabel')}</span>
                <p>${R('offBody')}</p>
              </div>
            </div>
          </div>
        </section>
      </div>`;
  }

  const statusWord = f.state === 'live'
    ? R('statusLive', { people: statusPeople(f.peers), rooms: statusRooms(f.rooms) })
    : f.state === 'never' ? R('statusNever') : R('statusQuiet');

  return html`
    <div class="og adm-rt">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <section class="og-sec og-sec--first">
        <div class="og-sec-h">
          <h2>${R('who')}<small>01</small></h2>
          <div class="og-doors">
            <button type="button" class="og-door og-door--quiet" onClick=${() => {
    document.querySelector('.adm-rt-since')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }}>${R('whatIsDoor')}</button>
          </div>
        </div>
        <div class="adm-ov-grid">
          <div>
            <div class="adm-ov-status ${f.state === 'live' ? '' : 'quiet'}">${statusWord}</div>
            <p class="adm-alert-line">${R('lead')}</p>
            <div class="adm-ov-up">
              ${f.uptimeSeconds !== null ? R('upFor', { time: dur(f.uptimeSeconds * 1000) }) : ''}<br />
              ${f.opened === 1 ? R('upOpenedOne') : R('upOpened', { count: num(f.opened) })}<br />
              ${R('upPeak', { people: people(f.peak) })}
            </div>
          </div>
          <div>
            ${f.state === 'never' && html`
              <dl class="adm-rt-kv">
                <dt>${R('theAddress')}</dt>
                <dd><code>${f.wsUrl || R('noAddress')}</code><em>${R('theAddressWhy')}</em></dd>
                <dt>${R('theWindow')}</dt>
                <dd>${f.uptimeSeconds !== null ? dur(f.uptimeSeconds * 1000) : '—'}<em>${R('theWindowWhy')}</em></dd>
              </dl>
              <p class="adm-rt-note">${R('neverWhy')}</p>`}

            ${f.state !== 'never' && shown.length === 0 && html`
              <${Row} title=${R('quietTitle')} why=${R('quietWhy')} value=${R('roomsOpenedVal', { count: num(f.opened) })} last=${true} />`}

            ${shown.slice(0, 4).map((r, i) => html`
              <${Row}
                title=${r.name}
                why=${roomWhy(r, f)}
                chip=${r.empty ? html`<${Badge} type="neutral" label=${R('badgeEmpty')} />` : html`<${Badge} type="healthy" label=${R('badgeLive')} />`}
                value=${people(r.peerCount)}
                last=${i === Math.min(shown.length, 4) - 1} />`)}
          </div>
        </div>
      </section>

      <div class="og-strip">
        <div><b>${num(f.rooms)}</b><span>${R('stripRooms')}</span><small>${R('stripRoomsSub')}</small></div>
        <div><b>${num(f.peers)}</b><span>${R('stripPeople')}</span><small>${R('stripPeopleSub')}</small></div>
        <div><b>${num(f.opened)}</b><span>${R('stripOpened')}</span><small>${R('stripOpenedSub')}</small></div>
        <div><b class=${f.refused ? 'og-coral-num' : ''}>${num(f.refused)}</b><span>${R('stripRefused')}</span><small>${R('stripRefusedSub')}</small></div>
      </div>

      <section class="og-sec">
        <div class="og-sec-h">
          <h2>${R('theRooms')}<small>02</small></h2>
          <div class="og-doors">
            <button type="button" class="og-door og-door--quiet" onClick=${() => setBusiest(v => !v)}>
              ${busiest ? R('orderNewest') : R('orderBusiest')}</button>
          </div>
        </div>

        ${shown.length === 0
    ? html`<${Empty} text=${f.state === 'never' ? R('noneEver') : R('noneNow')} />`
    : html`
          <div class="adm-rt-row adm-rt-row--head">
            <div class="adm-rt-n">#</div>
            <div>${R('colRoom')}</div>
            <div>${R('colWho')}</div>
            <div>${R('colDocs')}</div>
            <div>${R('colHeard')}</div>
            <div></div>
          </div>
          ${shown.map((r, i) => html`
            <div class="adm-rt-row ${r.id === openId ? 'is-open' : ''}">
              <div class="adm-rt-n">${String(i + 1).padStart(2, '0')}</div>
              <div class="adm-rt-nm">
                <button type="button" class="adm-rt-open" onClick=${() => setOpenId(r.id === openId ? null : r.id)}>${r.name}</button>
                <em>${[r.appType, r.createdBy, r.isPublic ? R('public') : R('private')].filter(Boolean).join(' · ')}</em>
              </div>
              <div class="adm-rt-who">
                ${r.peers.length === 0
    ? html`<span class="adm-rt-nobody">${R('nobodyInIt')}</span>`
    : r.peers.slice(0, 4).map(p => html`<span class="adm-rt-pip"><i></i>${p.nick || p.peerId}</span>`)}
                ${r.peers.length > 4 && html`<span class="adm-rt-pip adm-rt-pip--more">${R('morePeers', { count: r.peers.length - 4 })}</span>`}
              </div>
              <div class="adm-rt-docs">${num(r.docs)} <em>${r.docs ? fmtBytes(r.docBytes) : '—'}</em></div>
              <div class="adm-rt-when">${heard(r.heardMs)}</div>
              <div class="adm-rt-acts">
                <button type="button" class="adm-rt-act" onClick=${() => askClose(r)}>${R('close')}</button>
              </div>
            </div>`)}
        `}

        ${open && html`<${RoomDetail} room=${open} idleMs=${f.idleMs}
          onClose=${() => setOpenId(null)} onCloseRoom=${() => askClose(open)} />`}
      </section>

      <section class="og-sec adm-rt-since">
        <div class="og-sec-h">
          <h2>${R('since')}<small>03</small></h2>
        </div>
        <div class="adm-rt-counts">
          <div class="adm-rt-cnt"><span>${R('cntIn')}</span><b>${num(f.messagesIn)}</b></div>
          <div class="adm-rt-cnt"><span>${R('cntOpened')}</span><b>${num(f.opened)}</b></div>
          <div class="adm-rt-cnt"><span>${R('cntPeak')}</span><b>${people(f.peak)}</b></div>
          <div class="adm-rt-cnt"><span>${R('cntOut')}</span><b>${num(f.messagesOut)}</b></div>
          <div class="adm-rt-cnt"><span>${R('cntClosed')}</span><b>${num(f.closed)}</b></div>
          <div class="adm-rt-cnt"><span>${R('cntRefused')}</span><b class=${f.refused ? 'is-bad' : ''}>${num(f.refused)}</b></div>
        </div>
        <div class="adm-rt-two">
          <div class="og-box">
            <span class="og-box-label">${R('memLabel')}</span>
            <p>${f.uptimeSeconds !== null ? R('memBody', { time: dur(f.uptimeSeconds * 1000) }) : R('memBodyNoUptime')}</p>
            <p class="adm-rt-rule">${R('memRule')}</p>
          </div>
          <div class="og-box og-box--solid">
            <span class="og-box-label">${R('gonLabel')}</span>
            <p>${f.idleMs ? R('gonBody', { time: dur(f.idleMs) }) : R('gonBodyNoIdle')}</p>
            <p class="adm-rt-rule">${R('gonRule')}</p>
          </div>
        </div>
      </section>

      <${ConfirmUI} />
    </div>`;
}

/** What the sentence under a room's name says, which is different for a room nobody is left in. */
function roomWhy(r, f) {
  if (r.empty) {
    return r.closesInMs !== null
      ? R('whyEmptyClosing', { time: dur(r.closesInMs) })
      : R('whyEmpty');
  }
  const what = r.docs === 1 ? R('whyDocsOne', { size: fmtBytes(r.docBytes) })
    : r.docs > 1 ? R('whyDocs', { count: r.docs, size: fmtBytes(r.docBytes) })
      : R('whyNoDocs', { type: r.appType || R('unknownType') });
  return f.idleMs && r.heardMs !== null && r.heardMs > 60000
    ? `${what} ${R('whyQuietFor', { time: dur(r.heardMs) })}`
    : what;
}
