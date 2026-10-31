/**
 * @file public/views/profile/storage/store-sections.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two sections of the page "Your own storage" (views/profile/storage-tab.js), for a person
 *   who may keep their files in several places. "Where your files are": where a new file goes now, how
 *   many files are in each place, the stores of this service the person may choose, and one control
 *   that moves files from a place (or from everywhere else) into a store they may choose or back to
 *   this service. "Your stores": one box per store of their own, with where it is, its folder, since
 *   when, its last test and the files in it, the Default mark, and its actions: make it the default,
 *   move my other files into it, move its files elsewhere, and disconnect (only once it holds no file,
 *   with the reason said). The page owns the calls; these sections get data and callbacks. Every part
 *   is a library component; the sections pass data and write no class.
 * @structure PlacesSection · StoresSection (StoreBox) · MoveForm · MoveProgress · byWords · checkWords ·
 *   notTakingWords · destinations
 * @usage html`<${PlacesSection} v=${v} moving=${moving} onMove=${moveAll} onStop=${stop} />`
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial: the one-store section of storage-tab.js became these two, for named
 *     stores (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { date, dateTime, num } from '/js/format.js';
import { fileSize } from '/js/services/file-store.js';
import { Section } from '/components/Section.js';
import { Facts, FactLine } from '/components/Facts.js';
import { Note } from '/components/Note.js';
import { Mark } from '/components/Mark.js';
import { Action } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { Select } from '/components/Select.js';
import { Fields, FormActions } from '/components/Field.js';
import { List, Row, Name, Num } from '/components/List.js';
import { Stack, Space } from '/components/Layout.js';
import { S, placeWords } from './connect-form.js';
import { storeWords, RefusalNote } from './store-words.js';

const html = htm.bind(h);

/** Who connected it: the person, or one of their agents by name. */
export function byWords(principal) {
  const p = String(principal || '');
  const hash = p.indexOf('#');
  return hash > 0 ? S('store.byAgent', { agent: p.slice(0, hash) }) : S('store.byYou');
}

/** Why new files do not go to the person's default store now, in the person's words. */
export function notTakingWords(v) {
  if (v.mode === 'off') return S('store.notTakingOff');
  if (v.approval && v.approval.state === 'declined') return S('store.notTakingDeclined');
  if (v.mode === 'operator') return S('store.notTakingWaiting');
  if (!v.default_store) return S('store.notTakingNoDefault');
  return S('store.notTakingOther');
}

/** The last connection test in one line. */
function checkWords(c) {
  if (!c) return S('store.notChecked');
  return c.ok ? S('store.checkOk', { when: dateTime(c.at) }) : S('store.checkFailed', { when: dateTime(c.at), message: c.message || '' });
}

/** Where files may be moved: back to this service, and every store the person may choose but `except`. */
function destinations(v, except) {
  return [
    ['home', S('move.toHome')],
    ...(v.choices || []).filter((c) => c.store !== except).map((c) => [c.store, storeWords(c.store)]),
  ];
}

/** The state of a move that runs or ran: progress, the refusal, and the files that failed. */
function MoveProgress({ moving }) {
  if (!moving) return null;
  const running = moving.running;
  return html`
    <${Note} kind=${running ? 'loading' : 'message'}>
      ${S(running ? 'move.progress' : 'move.done', { moved: num(moving.moved), remaining: num(moving.remaining ?? 0) })}
    <//>
    <${RefusalNote} refusal=${moving.refusal} />
    ${moving.failedCount ? html`
      <${Note} kind="message" error>${S('move.failedCount', { n: num(moving.failedCount) })}<//>
      <${List} cols="name" dense>
        ${moving.failed.map((f, i) => html`<${Row} key=${i}><${Name} code desc=${f.error}>${f.key}<//><//>`)}
      <//>` : null}`;
}

/** Pick where from and where to, then move: `from` '' is every file not already in the destination. */
function MoveForm({ v, fixedFrom, except, running, onMove, onStop }) {
  const places = (v.files.by_store || []).filter((p) => p.count > 0);
  const [from, setFrom] = useState('');
  const dests = destinations(v, except);
  const [picked, setTo] = useState(dests.length > 1 ? dests[1][0] : 'home');
  // A store that left the list since it was picked (disconnected, closed to people) falls back to home.
  const to = dests.some((d) => d[0] === picked) ? picked : 'home';
  const src = fixedFrom ?? from;
  const go = () => onMove({ to, ...(src ? { from: src } : {}) }, fixedFrom ? fixedFrom : 'places');
  const same = !!src && src === to;
  return html`
    <${Stack} gap="small">
      <${Fields} cols=${fixedFrom ? undefined : 2}>
        ${fixedFrom ? null : html`
          <${Select} label=${S('move.from')} value=${from} onChange=${setFrom}
            options=${[['', S('move.fromAll')], ...places.map((p) => [p.store, `${storeWords(p.store)} (${num(p.count)})`])]} />`}
        <${Select} label=${S('move.to')} value=${to} onChange=${setTo} options=${dests} />
      <//>
      <${FormActions}>
        ${running
          ? html`<${Action} small control onClick=${onStop}>${S('move.stop')}<//>`
          : html`<${Action} small control disabled=${same} onClick=${go}>${S('move.go')}<//>`}
        <${Note} kind="hint" inline>${same ? S('move.same') : S('move.hint')}<//>
      <//>
    <//>`;
}

/**
 * "Where your files are": where a new file goes now and why, the files per place, the stores of this
 * service the person may choose, and the move between places.
 */
export function PlacesSection({ number, v, moving, onMove, onStop }) {
  const ownStores = v.stores || [];
  const nodeChoices = (v.choices || []).filter((c) => c.store.startsWith('node:'));
  const places = (v.files.by_store || []).slice().sort((a, b) => b.count - a.count);
  const goesOwn = String(v.new_files_go_to || '').startsWith('own:');
  const newSub = ownStores.length && !v.taking_new_files ? notTakingWords(v)
    : goesOwn ? S('store.takingSub') : (v.choices || []).length ? S('places.newSubChoose') : undefined;
  const running = moving && moving.running;
  return html`
    <${Section} id="fs-places" num=${number} title=${S('places.title')}>
      <${Facts} rows=${[
        { key: 'new', k: S('store.newFiles'), v: storeWords(v.new_files_go_to), sub: newSub, warn: !!(ownStores.length && !v.taking_new_files) },
        nodeChoices.length && {
          key: 'service', k: S('places.serviceStores'),
          v: nodeChoices.map((c) => html`<${FactLine} key=${c.store} sub=${placeWords(c.place)}>${storeWords(c.store)}${c.default ? ` · ${S('store.default')}` : ''}<//>`),
          sub: S('places.serviceStoresSub'),
        },
      ]} />
      <${Space} above="large">
        <${List} cols="name-n-n" labels empty=${S('places.none')}
          head=${[S('places.colPlace'), { label: S('places.colFiles'), num: true }, { label: S('places.colSize'), num: true }]}>
          ${places.map((p) => html`
            <${Row} key=${p.store}>
              <${Name}>${storeWords(p.store)}<//>
              <${Num}>${num(p.count)}<//>
              <${Num}>${fileSize(p.bytes)}<//>
            <//>`)}
        <//>
      <//>
      ${(v.choices || []).length || ownStores.length ? html`
        <${Space} above="large">
          <${Stack} gap="medium">
            <${Note} kind="caption">${S('move.title')}<//>
            <${MoveForm} v=${v} running=${running} onMove=${onMove} onStop=${onStop} />
            ${moving && moving.at === 'places' ? html`<${MoveProgress} moving=${moving} />` : null}
          <//>
        <//>` : null}
    <//>`;
}

/** One of the person's stores: its facts, the Default mark, and its actions. */
function StoreBox({ v, s, moving, onMove, onStop, onDefault, onDisconnect }) {
  const [movingOut, setMovingOut] = useState(false);
  const running = !!(moving && moving.running);
  const choosable = (v.choices || []).some((c) => c.store === s.choice);
  const full = s.files.count > 0;
  return html`
    <${Box} name=${s.name}
      marks=${s.default ? html`<${Mark} kind="status" tone="fine">${S('store.default')}<//>` : null}
      doors=${html`
        ${s.default ? null : html`<${Action} small control disabled=${running} onClick=${() => onDefault(s)}>${S('store.makeDefault')}<//>`}
        <${Action} small control disabled=${running || !choosable} onClick=${() => onMove({ to: s.choice }, s.choice)}>${S('move.here')}<//>
        <${Action} small control disabled=${running || !full} onClick=${() => setMovingOut(!movingOut)}>${S('move.out')}<//>
        <${Action} small control tone="danger" disabled=${running || full} onClick=${() => onDisconnect(s)}>${S('store.disconnect')}<//>`}>
      <${Facts} rows=${[
        { key: 'where', k: S('store.where'), v: placeWords(s.place, s.where) },
        s.prefix && { key: 'folder', k: S('store.folder'), v: s.prefix, mono: true },
        { key: 'since', k: S('store.since'), v: date(s.connected_at), sub: byWords(s.connected_by) },
        { key: 'check', k: S('store.check'), v: checkWords(s.last_check), warn: !!(s.last_check && !s.last_check.ok) },
        { key: 'files', k: S('store.inIt'), v: S('store.files', { n: num(s.files.count), size: fileSize(s.files.bytes) }) },
      ]} />
      <${Note} kind="hint">${full ? S('store.disconnectFirst', { n: num(s.files.count) }) : choosable ? S('store.disconnectHint') : S('store.notChoosable')}<//>
      ${movingOut && full ? html`
        <${Space} above="medium">
          <${MoveForm} v=${v} fixedFrom=${s.choice} except=${s.choice} running=${running} onMove=${onMove} onStop=${onStop} />
        <//>` : null}
      ${moving && moving.at === s.choice ? html`<${MoveProgress} moving=${moving} />` : null}
    <//>`;
}

/** "Your stores": a box per store of the person's own, or a line saying there is none. */
export function StoresSection({ number, v, moving, onMove, onStop, onDefault, onDisconnect }) {
  const stores = v.stores || [];
  const away = v.files.elsewhere;
  return html`
    <${Section} id="fs-store" num=${number} title=${S('store.title')} count=${stores.length ? num(stores.length) : undefined}>
      ${stores.length === 0
        ? html`<${Note} kind="quiet">${S('store.none', { n: num(away.count), size: fileSize(away.bytes) })}<//>`
        : html`<${Stack} gap="medium">${stores.map((s) => html`
            <${StoreBox} key=${s.name} v=${v} s=${s} moving=${moving} onMove=${onMove} onStop=${onStop}
              onDefault=${onDefault} onDisconnect=${onDisconnect} />`)}<//>`}
    <//>`;
}
