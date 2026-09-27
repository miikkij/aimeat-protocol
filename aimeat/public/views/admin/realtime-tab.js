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
 *   v2.2.0 — 2026-09-27 — On the library components (page group G5): the sections are Sections, the
 *     status and its readings the Verdict and Reading (a quiet page's word in grey), the two facts an
 *     operator can check Facts, the strip the FigureStrip, the rooms the List (the person in a room a
 *     live tag, the open room the selected row, its close the danger action), the counters since the
 *     restart Readings in three columns, the boxes SettingBoxes, the failed read a Box. The close
 *     question's own dialog class goes (no rule drew it). The page sheet admin-realtime.css goes; the
 *     file writes no class and no style.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
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
import { num, fmtBytes, Row, Badge, Empty, useToast, Toast } from './shared.js';
import { closeRoom } from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';
import { decorate, summarise, order, split } from './realtime-tab.model.js';
import RoomDetail from './realtime-tab.detail.js';
import { Section } from '/components/Section.js';
import { Verdict, Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts } from '/components/Facts.js';
import { List, Row as ListRow, Name, Cell, Num, When, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Code, Mark } from '/components/Mark.js';
import { Figure, Tinted } from '/components/Figure.js';
import { Box, SettingBox } from '/components/Box.js';
import { Note } from '/components/Note.js';
import { CardGrid } from '/components/Card.js';
import { Stack } from '/components/Layout.js';
import { scrollToSection } from '/components/Rail.js';

const R = (key, params) => t('dashboard.realtimePage.' + key, params);

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
    const lines = [
      room.peerCount > 0 && { key: 'peers', name: names || R('someone'), value: R('askRowPeers') },
      room.docs > 0 && {
        key: 'docs',
        name: room.docs === 1
          ? R('askRowDocsOne', { size: fmtBytes(room.docBytes) })
          : R('askRowDocs', { count: room.docs, size: fmtBytes(room.docBytes) }),
        value: R('askRowDocsVal'),
      },
      { key: 'room', name: room.name, value: R('askRowRoomVal'), last: true },
    ];
    const body = html`<${Stack} gap="small">
      <span>${room.peerCount === 0
    ? R('askEmpty')
    : room.peerCount === 1 ? R('askOne', { name: names || R('someone') }) : R('askMany', { count: room.peerCount })}</span>
      <${Box} packed><${Readings} rows=${lines} /><//>
      <${Note}>${f.idleMs
    ? R('askNote', { time: dur(f.idleMs) })
    : R('askNoteNoIdle')}<//>
    <//>`;
    confirm(body, () => doClose(room),
      { title: R('askTitle'), confirmLabel: R('closeIt'), danger: true });
  }

  // The read itself failed. Not one of the three empties: nothing here was measured, so nothing
  // here is printed as a zero.
  if (f.state === 'unreachable') {
    return html`
      <${Box} name=${R('noReadTitle')}
        doors=${html`<${Action} small onClick=${() => reload()}>${R('tryAgain')}<//>`}>
        <${Note}>${R('noReadWhy')}<//>
      <//>`;
  }

  // Switched off. There is nothing to count, so nothing is counted: the page says which setting did
  // it and what apps get instead. It used to arrive as grey italic "Realtime unavailable".
  if (f.state === 'off') {
    return html`
      <${Section} first num="01" title=${R('who')}>
        <${Verdict} tone="quiet" word=${R('statusOff')} line=${R('offLead')}>
          <${Stack} gap="large">
            <${Facts} rows=${[
              { k: R('theSwitch'), v: html`<${Code}>AIMEAT_REALTIME_ENABLED=false<//>`, sub: R('theSwitchWhy') },
            ]} />
            <${SettingBox} label=${R('offLabel')} irreversible>
              <span>${R('offBody')}</span>
            <//>
          <//>
        <//>
      <//>`;
  }

  const statusWord = f.state === 'live'
    ? R('statusLive', { people: statusPeople(f.peers), rooms: statusRooms(f.rooms) })
    : f.state === 'never' ? R('statusNever') : R('statusQuiet');

  const head = ['#', R('colRoom'), R('colWho'), R('colDocs'), R('colHeard'), ''];
  // The counters since the restart, in main's three columns (read across: in, opened, peak; out,
  // closed, refused), each column one Readings pair.
  const counter = (key, value, last) => ({ key, name: R(key), value, last });

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

    <${Section} first id="adm-rt-who" num="01" title=${R('who')}
      doors=${html`<${Action} small soft onClick=${() => scrollToSection('adm-rt-since')}>${R('whatIsDoor')}<//>`}>
      <${Verdict} tone=${f.state === 'live' ? undefined : 'quiet'} word=${statusWord} line=${R('lead')}
        stamp=${html`
          ${f.uptimeSeconds !== null ? R('upFor', { time: dur(f.uptimeSeconds * 1000) }) : ''}<br />
          ${f.opened === 1 ? R('upOpenedOne') : R('upOpened', { count: num(f.opened) })}<br />
          ${R('upPeak', { people: people(f.peak) })}`}>
        ${f.state === 'never' && html`
          <${Facts} rows=${[
            { k: R('theAddress'), v: html`<${Code}>${f.wsUrl || R('noAddress')}<//>`, sub: R('theAddressWhy') },
            { k: R('theWindow'), v: f.uptimeSeconds !== null ? dur(f.uptimeSeconds * 1000) : '—', sub: R('theWindowWhy') },
          ]} />
          <${Note}>${R('neverWhy')}<//>`}

        ${f.state !== 'never' && shown.length === 0 && html`
          <${Row} title=${R('quietTitle')} why=${R('quietWhy')} value=${R('roomsOpenedVal', { count: num(f.opened) })} last=${true} />`}

        ${shown.slice(0, 4).map((r, i) => html`
          <${Row}
            key=${r.id}
            title=${r.name}
            why=${roomWhy(r, f)}
            chip=${r.empty ? html`<${Badge} type="neutral" label=${R('badgeEmpty')} />` : html`<${Badge} type="healthy" label=${R('badgeLive')} />`}
            value=${people(r.peerCount)}
            last=${i === Math.min(shown.length, 4) - 1} />`)}
      <//>
    <//>

    <${FigureStrip} wrap items=${[
      { key: 'rooms', n: num(f.rooms), label: R('stripRooms'), sub: R('stripRoomsSub') },
      { key: 'people', n: num(f.peers), label: R('stripPeople'), sub: R('stripPeopleSub') },
      { key: 'opened', n: num(f.opened), label: R('stripOpened'), sub: R('stripOpenedSub') },
      { key: 'refused', n: num(f.refused), tone: f.refused ? 'notice' : undefined, label: R('stripRefused'), sub: R('stripRefusedSub') },
    ]} />

    <${Section} id="adm-rt-rooms" num="02" title=${R('theRooms')}
      doors=${html`<${Action} small soft onClick=${() => setBusiest(v => !v)}>
        ${busiest ? R('orderNewest') : R('orderBusiest')}<//>`}>

      ${shown.length === 0
    ? html`<${Empty} text=${f.state === 'never' ? R('noneEver') : R('noneNow')} />`
    : html`
        <${List} cols="n-name-who-count-when-doors" head=${head} labels>
          ${shown.map((r, i) => html`
            <${ListRow} key=${r.id} selected=${r.id === openId}>
              <${Num}><${Figure} small n=${String(i + 1).padStart(2, '0')} /><//>
              <${Name} clip onOpen=${() => setOpenId(r.id === openId ? null : r.id)}
                meta=${[r.appType, r.createdBy, r.isPublic ? R('public') : R('private')].filter(Boolean).join(' · ')}>${r.name}<//>
              <${Cell} line>
                ${r.peers.length === 0
    ? html`<${Note} kind="meta" inline mono>${R('nobodyInIt')}<//>`
    : r.peers.slice(0, 4).map(p => html`<${Mark} key=${p.peerId} live>${p.nick || p.peerId}<//>`)}
                ${r.peers.length > 4 && html`<${Mark} tone="dim">${R('morePeers', { count: r.peers.length - 4 })}<//>`}
              <//>
              <${Cell} meta>${num(r.docs)} <${Tinted} tone="dim">${r.docs ? fmtBytes(r.docBytes) : '—'}<//><//>
              <${When}>${heard(r.heardMs)}<//>
              <${Doors}><${Action} small tone="danger" onClick=${() => askClose(r)}>${R('close')}<//><//>
            <//>`)}
        <//>
      `}

      ${open && html`<${RoomDetail} room=${open} idleMs=${f.idleMs}
        onClose=${() => setOpenId(null)} onCloseRoom=${() => askClose(open)} />`}
    <//>

    <${Section} id="adm-rt-since" num="03" title=${R('since')}>
      <${Stack} gap="large">
      <${CardGrid} cols="three">
        <${Stack} gap="none"><${Readings} rows=${[counter('cntIn', num(f.messagesIn)), counter('cntOut', num(f.messagesOut))]} /><//>
        <${Stack} gap="none"><${Readings} rows=${[counter('cntOpened', num(f.opened)), counter('cntClosed', num(f.closed))]} /><//>
        <${Stack} gap="none"><${Readings} rows=${[counter('cntPeak', people(f.peak)),
          counter('cntRefused', f.refused ? html`<${Tinted} tone="notice">${num(f.refused)}<//>` : num(f.refused))]} /><//>
      <//>
      <${CardGrid} cols="two">
        <${SettingBox} label=${R('memLabel')}>
          <${Stack} gap="small">
            <span>${f.uptimeSeconds !== null ? R('memBody', { time: dur(f.uptimeSeconds * 1000) }) : R('memBodyNoUptime')}</span>
            <b>${R('memRule')}</b>
          <//>
        <//>
        <${SettingBox} label=${R('gonLabel')} irreversible>
          <${Stack} gap="small">
            <span>${f.idleMs ? R('gonBody', { time: dur(f.idleMs) }) : R('gonBodyNoIdle')}</span>
            <b>${R('gonRule')}</b>
          <//>
        <//>
      <//>
      <//>
    <//>

    <${ConfirmUI} />`;
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
