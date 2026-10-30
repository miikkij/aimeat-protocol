/**
 * @file public/views/admin/file-stores-tab.parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The words and the sections of the admin page "File storage" (file-stores-tab.js). The
 *   page answers three questions an operator has about stored files: where a new file keeps its bytes
 *   and whether that place works (the node setting file_store.kind with its address, the settings or
 *   environment variables still missing, and the Test connection button with each step it took), how
 *   many files sit in each place and the move from one place to another a batch at a time,
 *   and who keeps their files in a storage of their own (the rule file_store.owner_stores in words,
 *   the requests that wait with Approve and Decline, and the connected stores with Revoke). A decline
 *   and a revoke ask for a note, because the person reads it. The node's own settings change on the
 *   Config tab; this page links there. Every part is a library component; the page passes data and
 *   writes no class.
 * @structure F · kindWord · PlaceSection (TestSteps and placeWords from
 *   views/profile/storage/connect-form.js) · MoveSection (moveBlock) · OwnersSection (WaitingItem, NoteLine)
 * @usage import { PlaceSection, MoveSection, OwnersSection } from './file-stores-tab.parts.js';
 * @version-history
 *   v1.2.0 — 2026-10-30 — Named stores (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-):
 *     "Where new files go" says where a new file goes now, a named default store included; the move
 *     has a from (the database, the environment's store or a named store) and a to (a named store, or
 *     where each owner's new files go); people's own stores list one row per store with its name, its
 *     files and the Default mark, the approval's actions on the person's first row. A refusal reads in
 *     the reader's words (store-words.js).
 *   v1.1.0 — 2026-10-29 — Where a storage is, in the reader's language, from the API's `place`
 *     (placeWords; the English `where` only as a fallback), in the facts, the test line, the requests
 *     and the connected stores. Sizes in the unit that fits (fileSize), so small files no longer read
 *     "0 MB".
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { date, dateTime, num } from '/js/format.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Desc, Cell, Num, Doors } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Mark, Marks, Code } from '/components/Mark.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { TextField } from '/components/TextField.js';
import { Fields } from '/components/Field.js';
import { Select } from '/components/Select.js';
import { Stack, Row as Line, Space } from '/components/Layout.js';
import { fileSize } from '/js/services/file-store.js';
// The steps of a connection test and the words for a storage's place read the same on the person's page and here.
import { TestSteps, placeWords } from '../profile/storage/connect-form.js';
import { storeWords, storeNameOf, RefusalNote } from '../profile/storage/store-words.js';

const html = htm.bind(h);
/** One word of this page. */
export const F = (key, params) => t('admin.fileStores.' + key, params);
const quoted = (s) => (s ? `“${s}”` : '');
/**
 * The move route answers `moved_bytes_mb` in units of 1024 × 1024 bytes (file-store-admin.ts MB), so
 * this turns it back into bytes before fileSize writes it in decimal units.
 */
const SERVER_MB = 1024 * 1024;

/** database, s3 or azure in words. */
export const kindWord = (kind) => t('fileStore.kind.' + kind);

/**
 * "Where new files go": the kind, the address and the folder, whether the settings are complete (the
 * missing names as typewriter chips), and Test connection with its steps under it.
 */
export function PlaceSection({ number, view, test, testing, onTest, switchPage }) {
  const isDb = view.kind === 'database';
  const ready = isDb || view.ready;
  const where = placeWords(view.place, view.where);
  // The test line names the place the page already shows; the test's own English words only without one.
  const tested = placeWords(view.place, test && test.where);
  const named = view.default_store ? storeNameOf(view.default_store) : '';
  return html`
    <${Section} id="adm-fs-place" num=${number} title=${F('place.title')}
      doors=${html`<${Action} small soft onClick=${() => switchPage('config')}>${F('toConfig')}<//>`}>
      <${Note} kind="lead">${named ? F('place.leadNamed', { name: named }) : isDb ? F('place.leadDatabase') : F('place.leadStore')}<//>
      <${Facts} rows=${[
        { key: 'new', k: F('place.newFiles'), v: storeWords(view.new_files_go_to, { operator: true }), sub: F('place.newFilesSub') },
        { key: 'kind', k: F('place.kind'), v: kindWord(view.kind), sub: F('place.kindSub') },
        !isDb && { key: 'where', k: F('place.where'), v: where || F('place.notYet'), missing: !where },
        !isDb && view.prefix && { key: 'folder', k: F('place.folder'), v: view.prefix, mono: true },
        !isDb && {
          key: 'ready', k: F('place.state'),
          v: html`<${Mark} kind="status" tone=${ready ? 'fine' : 'danger'}>${ready ? F('place.ready') : F('place.incomplete')}<//>`,
          sub: ready ? undefined : F('place.missingSub'),
        },
        !isDb && !ready && view.missing.length && {
          key: 'missing', k: F('place.missing'),
          v: html`<${Marks}>${view.missing.map((m) => html`<${Code} key=${m}>${m}<//>`)}<//>`,
        },
      ]} />
      ${isDb ? null : html`
        <${Space} above="large">
          <${Stack} gap="medium">
            <${Line} wrap>
              <${Action} small control disabled=${!ready || testing} onClick=${onTest}>${testing ? F('place.testing') : F('place.test')}<//>
              <${Note} kind="hint" inline>${F('place.testHint')}<//>
            <//>
            ${test && test.error ? html`<${Note} kind="message" error>${test.error}<//>` : null}
            ${test && test.steps ? html`
              <${Note} kind="message" error=${!test.ok}>${test.ok ? F('place.testOk', { where: tested }) : F('place.testFailed', { where: tested })}<//>
              <${TestSteps} steps=${test.steps} />` : null}
          <//>
        <//>`}
    <//>`;
}

/**
 * Why the move cannot start with this from and to, as the hint's words, or '' when it can. `to` ''
 * sends each file where its owner's new files go, which is the database itself when no store takes
 * new files.
 */
function moveBlock(view, from, to, count) {
  if (count === 0) return from === 'database' ? F('move.nothing') : F('move.nothingThere');
  if (to === from || (!to && view.new_files_go_to === from)) return F('move.same');
  if (!to && from === 'database' && view.new_files_go_to === 'database') return F('move.needStore');
  return '';
}

/**
 * "Move files": how many files keep their bytes in each kind of place, and the move from one place
 * (the database, the environment's store or a named store) to a named store or to where each owner's
 * new files go, a hundred at a time until none remain (or the operator stops it).
 */
export function MoveSection({ number, view, move, onMove, onStop }) {
  const places = view.files.by_place || [];
  const countIn = (id) => (places.find((p) => p.store === id) || { count: 0 }).count;
  const fromOptions = [
    ['database', `${storeWords('database', { operator: true })} (${num(view.files.database.count)})`],
    ...places.filter((p) => p.store.startsWith('node:') && p.count > 0)
      .map((p) => [p.store, `${storeWords(p.store, { operator: true })} (${num(p.count)})`]),
  ];
  const [fromPicked, setFrom] = useState('database');
  const [toPicked, setTo] = useState('');
  const toOptions = [
    ['', F('move.toOwners')],
    ...(view.stores || []).map((s) => [s.store, storeWords(s.store, { operator: true })]),
  ];
  // A place emptied or a store removed since it was picked falls back to the first option.
  const from = fromOptions.some((o) => o[0] === fromPicked) ? fromPicked : 'database';
  const to = toOptions.some((o) => o[0] === toPicked) ? toPicked : '';
  const count = from === 'database' ? view.files.database.count : countIn(from);
  const blocked = moveBlock(view, from, to, count);
  const inDb = view.files.database.count;
  const running = move && move.running;
  return html`
    <${Section} id="adm-fs-move" num=${number} title=${F('move.title')} count=${inDb ? num(inDb) : undefined}>
      <${Note} kind="lead">${F('move.lead')}<//>
      <${List} cols="name-n-n" labels head=${[F('move.colPlace'), { label: F('move.colFiles'), num: true }, { label: F('move.colSize'), num: true }]}>
        ${[
          ['database', view.files.database],
          ['node', view.files.node_store],
          ['named', view.files.named_stores || { count: 0, bytes: 0 }],
          ['own', view.files.own_stores],
        ].map(([k, c]) => html`
          <${Row} key=${k}>
            <${Name} desc=${F('move.place.' + k + 'Sub')}>${F('move.place.' + k)}<//>
            <${Num}>${num(c.count)}<//>
            <${Num}>${fileSize(c.bytes)}<//>
          <//>`)}
      <//>
      <${Space} above="large">
        <${Stack} gap="medium">
          <${Fields} cols=${2}>
            <${Select} label=${F('move.from')} value=${from} onChange=${setFrom} options=${fromOptions} disabled=${running} />
            <${Select} label=${F('move.to')} value=${to} onChange=${setTo} options=${toOptions} disabled=${running} />
          <//>
          <${Line} wrap>
            ${running
              ? html`<${Action} small control onClick=${onStop}>${F('move.stop')}<//>`
              : html`<${Action} small control disabled=${!!blocked} onClick=${() => onMove(from, to)}>${F('move.start')}<//>`}
            <${Note} kind="hint" inline>${blocked || F('move.hint')}<//>
          <//>
          ${move ? html`
            <${Note} kind=${running ? 'loading' : 'message'}>
              ${F(running ? 'move.progress' : 'move.done', { moved: num(move.moved), size: fileSize((move.mb || 0) * SERVER_MB), remaining: num(move.remaining ?? 0) })}
            <//>
            <${RefusalNote} refusal=${move.refusal} />
            ${move.failedCount ? html`
              <${Note} kind="message" error>${F('move.failedCount', { n: num(move.failedCount) })}<//>
              <${List} cols="name" dense>
                ${move.failed.map((f, i) => html`
                  <${Row} key=${i}><${Name} code meta=${f.owner} desc=${f.error}>${f.key}<//><//>`)}
              <//>` : null}` : null}
        <//>
      <//>
    <//>`;
}

/** A note field and two buttons under a row or a request: the note is required (a decline, a revoke). */
function NoteLine({ ask, label, confirmLabel, onConfirm, onCancel }) {
  const [note, setNote] = useState('');
  const [need, setNeed] = useState(false);
  const [busy, setBusy] = useState(false);
  const ok = note.trim().length >= 3;
  const confirm = async () => {
    if (!ok) { setNeed(true); return; }
    setBusy(true);
    const done = await onConfirm(note.trim());
    setBusy(false);
    if (done) onCancel();
  };
  return html`
    <${Stack} gap="small">
      <${Note} kind="aside" size="small">${ask}<//>
      <${Fields}>
        <${TextField} label=${label} hint=${F('owners.noteHint')} value=${note} maxLength=${500}
          invalid=${need && !ok} message=${need && !ok ? { text: F('owners.noteNeeded'), error: true } : undefined}
          onInput=${(v) => { setNote(v); if (need && v.trim().length >= 3) setNeed(false); }} onEnter=${confirm} />
      <//>
      <${Line} wrap>
        <${Action} small control tone="danger" disabled=${busy} onClick=${confirm}>${confirmLabel}<//>
        <${Action} small soft disabled=${busy} onClick=${onCancel}>${F('owners.cancel')}<//>
      <//>
    <//>`;
}

/** One request that waits: who, when, why; Approve as the one loud action, Decline with a note. */
function WaitingItem({ w, store, onDecide }) {
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const approve = async () => { setBusy(true); await onDecide(w.owner, 'approve'); setBusy(false); };
  return html`
    <${Box} tone="waiting" name=${w.owner}
      end=${html`<${Mark} kind="status" tone="attention">${F('owners.state.requested')}<//>`}
      doors=${html`
        <${Loud} control disabled=${busy} onClick=${approve}>${F('owners.approve')}<//>
        <${Action} small disabled=${busy} onClick=${() => setDeclining(!declining)}>${F('owners.decline')}<//>`}>
      <${Facts} rows=${[
        { key: 'asked', k: F('owners.asked'), v: dateTime(w.at) },
        { key: 'reason', k: F('owners.reason'), v: w.note ? quoted(w.note) : F('owners.noReason'), missing: !w.note },
        store && { key: 'where', k: F('owners.where'), v: placeWords(store.place, store.where), sub: store.last_check ? F('owners.checked', { date: date(store.last_check.at) }) : undefined },
      ]} />
      ${declining ? html`
        <${NoteLine} ask=${F('owners.declineAsk', { owner: w.owner })} label=${F('owners.declineNote')}
          confirmLabel=${F('owners.declineNow')} onConfirm=${(note) => onDecide(w.owner, 'decline', note)}
          onCancel=${() => setDeclining(false)} />` : null}
    <//>`;
}

/** The state of one connected store in operator mode, as a status mark. */
function approvalMark(approval) {
  const state = approval ? approval.state : 'none';
  const tone = state === 'approved' ? 'fine' : state === 'requested' ? 'attention' : state === 'declined' ? 'danger' : 'off';
  return html`<${Mark} kind="status" tone=${tone}>${F('owners.state.' + state)}<//>`;
}

/**
 * "People's own storage": the rule in words with a link to the Config tab, the requests that wait,
 * and every connected store with where it is, since when, its last test, and (where an operator
 * approves) its approval with Revoke, or Approve for one declined before.
 */
export function OwnersSection({ number, view, onDecide, switchPage }) {
  const [revoking, setRevoking] = useState(null);
  const os = view.owner_stores;
  const operatorMode = os.mode === 'operator';
  const storeOf = (owner) => os.connected.find((c) => c.owner === owner) || null;
  // A person may have several stores, one row each; their approval is one, so its actions stand on
  // their first row only.
  const firstRow = new Set();
  const isFirst = (c) => {
    if (firstRow.has(c.owner)) return false;
    firstRow.add(c.owner);
    return true;
  };
  return html`
    <${Section} id="adm-fs-owners" num=${number} title=${F('owners.title')} count=${os.connected.length ? num(os.connected.length) : undefined}
      doors=${html`<${Action} small soft onClick=${() => switchPage('config')}>${F('toConfig')}<//>`}>
      <${Note} kind="lead">${F('owners.lead')}<//>
      <${Facts} rows=${[
        { key: 'mode', k: F('owners.rule'), v: F('owners.mode.' + os.mode), sub: os.setting === 'auto' ? F('owners.auto') : undefined },
      ]} />
      ${operatorMode ? html`
        <${Space} above="large">
          <${Stack} gap="medium">
            <${Note} kind="caption">${F('owners.waitingTitle', { n: num(os.waiting.length) })}<//>
            ${os.waiting.length === 0
              ? html`<${Note} kind="quiet">${F('owners.noneWaiting')}<//>`
              : os.waiting.map((w) => html`<${WaitingItem} key=${w.owner} w=${w} store=${storeOf(w.owner)} onDecide=${onDecide} />`)}
          <//>
        <//>` : null}
      <${Space} above="large">
        <${List} cols="name-desc-state-doors" labels empty=${F('owners.noneConnected')}
          head=${[F('owners.colWho'), F('owners.colCheck'), operatorMode ? F('owners.colState') : '', '']}>
          ${os.connected.map((c) => {
            const state = c.approval ? c.approval.state : null;
            const first = isFirst(c);
            const files = c.files ? F('owners.files', { n: num(c.files.count), size: fileSize(c.files.bytes) }) : '';
            return html`
              <${Row} key=${`${c.owner}/${c.name || ''}`}
                below=${first && revoking === c.owner ? html`
                  <${NoteLine} ask=${F('owners.revokeAsk', { owner: c.owner })} label=${F('owners.revokeNote')}
                    confirmLabel=${F('owners.revokeNow')} onConfirm=${(note) => onDecide(c.owner, 'revoke', note)}
                    onCancel=${() => setRevoking(null)} />` : undefined}>
                <${Name} meta=${[c.name ? F('owners.storeName', { name: c.name }) : '', c.place ? placeWords(c.place, c.where) : `${kindWord(c.kind)} · ${c.where}`].filter(Boolean).join(' · ')}
                  tag=${c.default ? html`<${Mark} kind="status" tone="fine">${F('named.default')}<//>` : undefined}
                  desc=${first && c.reason ? quoted(c.reason) : undefined}>${c.owner}<//>
                <${Desc} sub=${[F('owners.since', { date: date(c.connected_at) }), files].filter(Boolean).join(' · ')}>
                  ${c.last_check
                    ? (c.last_check.ok ? F('owners.checkOk', { date: date(c.last_check.at) }) : F('owners.checkFailed', { date: date(c.last_check.at), message: c.last_check.message || '' }))
                    : F('owners.notChecked')}
                <//>
                <${Cell}>${operatorMode && first ? approvalMark(c.approval) : null}<//>
                <${Doors}>
                  ${operatorMode && first && state === 'approved' ? html`<${Action} small row tone="danger" onClick=${() => setRevoking(revoking === c.owner ? null : c.owner)}>${F('owners.revoke')}<//>` : null}
                  ${operatorMode && first && state === 'declined' ? html`<${Action} small row onClick=${() => onDecide(c.owner, 'approve')}>${F('owners.approve')}<//>` : null}
                <//>
              <//>`;
          })}
        <//>
      <//>
    <//>`;
}
