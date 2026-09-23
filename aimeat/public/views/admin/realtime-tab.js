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
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared set and admin-realtime.css deleted: Sections,
 *     the status word a heading, the strip and the counters NumeralBands, the rooms the shared Table,
 *     the explanations asides; the close question is the shared confirm without a class of its own, the room named in mono.
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
import { num, fmtBytes, Row, Badge, Empty, useToast, Toast, DataTable } from './shared.js';
import { closeRoom } from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';
import { Section, Columns, Stack, NumeralBand, KeyValue, ListRow, Surface, Action, Chip, Text, scrollToId } from '/components/poster-parts.js';
import { decorate, summarise, order, split } from './realtime-tab.model.js';
import RoomDetail from './realtime-tab.detail.js';

const R = (key, params) => t('dashboard.realtimePage.' + key, params);

/** The id of the third section, which the first section's door scrolls to. */
const SINCE_ID = 'adm-realtime-since';

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

/** A value with the sentence that says why, as the page's key-value rows read. */
const fact = (value, why) => html`<${Stack} density="compact">${value}<${Text} kind="caption" tone="muted">${why}<//><//>`;

/** An explanation beside the counters: its label, its body, and the rule it follows. */
function Aside({ tone, label, body, rule }) {
  return html`<${Surface} kind="aside" tone=${tone}><${Stack} density="compact">
    <${Text} kind="label">${label}<//><${Text}>${body}<//>${rule && html`<${Text} kind="caption" tone="muted">${rule}<//>`}
  <//><//>`;
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
    const body = html`<${Stack} density="compact">
      <${Text}>${room.peerCount === 0
    ? R('askEmpty')
    : room.peerCount === 1 ? R('askOne', { name: names || R('someone') }) : R('askMany', { count: room.peerCount })}<//>
      <div>
        ${room.peerCount > 0 && html`<${ListRow} density="compact" name=${names || R('someone')} detail=${R('askRowPeers')} detailKind="text" />`}
        ${room.docs > 0 && html`<${ListRow} density="compact" name=${room.docs === 1
    ? R('askRowDocsOne', { size: fmtBytes(room.docBytes) })
    : R('askRowDocs', { count: room.docs, size: fmtBytes(room.docBytes) })} detail=${R('askRowDocsVal')} detailKind="text" />`}
        <${ListRow} density="compact" nameKind="mono" name=${room.name} detail=${R('askRowRoomVal')} detailKind="text" />
      </div>
      <${Text} kind="caption" tone="muted">${f.idleMs
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
      <${Section} title=${R('noReadTitle')} description=${R('noReadWhy')}>
        <${Stack} direction="horizontal"><${Action} onClick=${() => reload()}>${R('tryAgain')}<//><//>
      <//>`;
  }

  // Switched off. There is nothing to count, so nothing is counted: the page says which setting did
  // it and what apps get instead. It used to arrive as grey italic "Realtime unavailable".
  if (f.state === 'off') {
    return html`
      <${Section} title=${R('who')} count="01">
        <${Columns} layout="trailing" collapse=${900}>
          <${Stack} density="compact">
            <${Text} kind="heading" tone="muted">${R('statusOff')}<//>
            <${Text}>${R('offLead')}<//>
          <//>
          <${Stack}>
            <${KeyValue} label=${R('theSwitch')} value=${fact(html`<${Text} kind="mono">AIMEAT_REALTIME_ENABLED=false<//>`, R('theSwitchWhy'))} />
            <${Aside} tone="danger" label=${R('offLabel')} body=${R('offBody')} />
          <//>
        <//>
      <//>`;
  }

  const statusWord = f.state === 'live'
    ? R('statusLive', { people: statusPeople(f.peers), rooms: statusRooms(f.rooms) })
    : f.state === 'never' ? R('statusNever') : R('statusQuiet');

  const roomRows = shown.map((r, i) => [
    { text: String(i + 1).padStart(2, '0'), mono: true },
    html`<${Stack} density="compact">
      <${Action} kind="text" expanded=${r.id === openId} onClick=${() => setOpenId(r.id === openId ? null : r.id)}>${r.name}<//>
      <${Text} kind="mono" tone="muted">${[r.appType, r.createdBy, r.isPublic ? R('public') : R('private')].filter(Boolean).join(' · ')}<//>
    <//>`,
    html`<${Stack} direction="wrap" density="compact">
      ${r.peers.length === 0
    ? html`<${Text} kind="caption" tone="muted">${R('nobodyInIt')}<//>`
    : r.peers.slice(0, 4).map(p => html`<${Chip} tone="success">${p.nick || p.peerId}<//>`)}
      ${r.peers.length > 4 && html`<${Chip} tone="muted">${R('morePeers', { count: r.peers.length - 4 })}<//>`}
    <//>`,
    { text: `${num(r.docs)} ${r.docs ? fmtBytes(r.docBytes) : '—'}`, mono: true },
    { text: heard(r.heardMs), mono: true },
    html`<${Action} kind="text" tone="danger" onClick=${() => askClose(r)}>${R('close')}<//>`,
  ]);

  return html`
    <${Stack}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Section} title=${R('who')} count="01"
        actions=${html`<${Action} onClick=${() => scrollToId(SINCE_ID)}>${R('whatIsDoor')}<//>`}>
        <${Columns} layout="trailing" collapse=${900}>
          <${Stack} density="compact">
            <${Text} kind="heading" tone=${f.state === 'live' ? 'plain' : 'muted'}>${statusWord}<//>
            <${Text}>${R('lead')}<//>
            <${Stack} density="compact">
              ${f.uptimeSeconds !== null && html`<${Text} kind="mono" tone="muted">${R('upFor', { time: dur(f.uptimeSeconds * 1000) })}<//>`}
              <${Text} kind="mono" tone="muted">${f.opened === 1 ? R('upOpenedOne') : R('upOpened', { count: num(f.opened) })}<//>
              <${Text} kind="mono" tone="muted">${R('upPeak', { people: people(f.peak) })}<//>
            <//>
          <//>
          <${Stack}>
            ${f.state === 'never' && html`
              <div>
                <${KeyValue} label=${R('theAddress')} value=${fact(html`<${Text} kind="mono">${f.wsUrl || R('noAddress')}<//>`, R('theAddressWhy'))} />
                <${KeyValue} label=${R('theWindow')} value=${fact(f.uptimeSeconds !== null ? dur(f.uptimeSeconds * 1000) : '—', R('theWindowWhy'))} />
              </div>
              <${Text} tone="muted">${R('neverWhy')}<//>`}

            ${f.state !== 'never' && shown.length === 0 && html`
              <${Row} title=${R('quietTitle')} why=${R('quietWhy')} value=${R('roomsOpenedVal', { count: num(f.opened) })} last=${true} />`}

            ${shown.length > 0 && html`<div>${shown.slice(0, 4).map((r, i) => html`
              <${Row}
                title=${r.name}
                why=${roomWhy(r, f)}
                chip=${r.empty ? html`<${Badge} type="neutral" label=${R('badgeEmpty')} />` : html`<${Badge} type="healthy" label=${R('badgeLive')} />`}
                value=${people(r.peerCount)}
                last=${i === Math.min(shown.length, 4) - 1} />`)}</div>`}
          <//>
        <//>
      <//>

      <${NumeralBand} tone="plain" items=${[
        { label: R('stripRooms'), value: num(f.rooms), note: R('stripRoomsSub') },
        { label: R('stripPeople'), value: num(f.peers), note: R('stripPeopleSub') },
        { label: R('stripOpened'), value: num(f.opened), note: R('stripOpenedSub') },
        { label: R('stripRefused'), value: num(f.refused), note: R('stripRefusedSub'), tone: f.refused ? 'coral' : undefined },
      ]} />

      <${Section} title=${R('theRooms')} count="02"
        actions=${html`<${Action} onClick=${() => setBusiest(v => !v)}>${busiest ? R('orderNewest') : R('orderBusiest')}<//>`}>
        ${shown.length === 0
    ? html`<${Empty} text=${f.state === 'never' ? R('noneEver') : R('noneNow')} />`
    : html`<${DataTable} headers=${['#', R('colRoom'), R('colWho'), R('colDocs'), R('colHeard'), '']} rows=${roomRows} />`}

        ${open && html`<${RoomDetail} room=${open} idleMs=${f.idleMs}
          onClose=${() => setOpenId(null)} onCloseRoom=${() => askClose(open)} />`}
      <//>

      <${Section} id=${SINCE_ID} title=${R('since')} count="03">
        <${NumeralBand} tone="plain" size="small" items=${[
          { label: R('cntIn'), value: num(f.messagesIn) },
          { label: R('cntOpened'), value: num(f.opened) },
          { label: R('cntPeak'), value: people(f.peak) },
          { label: R('cntOut'), value: num(f.messagesOut) },
          { label: R('cntClosed'), value: num(f.closed) },
          { label: R('cntRefused'), value: num(f.refused), tone: f.refused ? 'coral' : undefined },
        ]} />
        <${Columns} collapse=${900}>
          <${Aside} label=${R('memLabel')} rule=${R('memRule')}
            body=${f.uptimeSeconds !== null ? R('memBody', { time: dur(f.uptimeSeconds * 1000) }) : R('memBodyNoUptime')} />
          <${Aside} tone="danger" label=${R('gonLabel')} rule=${R('gonRule')}
            body=${f.idleMs ? R('gonBody', { time: dur(f.idleMs) }) : R('gonBodyNoIdle')} />
        <//>
      <//>

      <${ConfirmUI} />
    <//>`;
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
