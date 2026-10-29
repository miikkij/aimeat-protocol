/**
 * @file public/views/profile/storage-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Settings & Controls page "Your own storage" (tab id `storage`, opened by
 *   /v1/profile?tab=storage and ?tab=storage&section=fs-connect). A person may keep the bytes of
 *   their stored files in their own S3 bucket or Azure Blob container, with their own keys: the files
 *   are theirs to keep, and they do not use this service's space. Whether they may, and whether an
 *   operator approves each person first, is the operator's rule (file_store.owner_stores); the page
 *   says it in words, and when the rule is off it says so and nothing else (unless a storage is still
 *   connected, which the person can then still empty and disconnect). One read, GET /v1/file-store
 *   (the aimeat_file_store_get tool returns the same), re-read on the SSE change domains
 *   `notifications` (an operator's decision reaches the person as one), `files`, `config` and
 *   `file-store`. In order: the figure strip (files in your storage, files elsewhere), the rule
 *   here, your storage (where, since when, its last test, whether new files go there, the two move
 *   buttons and Disconnect), the connect form (connect-form.js), and the aside for the person's own
 *   AI. Every part is a library component; the page passes data and writes no class.
 * @structure StorageTab({ showToast }) — load · ruleFacts · StoreSection · moving (moveAll) ·
 *   disconnect · ConnectForm · AiAside
 * @usage Registered in views/profile.js TABS as { id: 'storage', key: 'profile.tabs.storage' }; menu
 *   entry in landing-page.cards.js (the Account group, after Data Wallet).
 * @version-history
 *   v1.1.0 — 2026-10-29 — The three buttons of "Your storage" are one style and size (the move buttons
 *     and Disconnect were two sizes, and the small one under a phone's touch size). Where the storage
 *     is, in the reader's language (placeWords). Sizes in the unit that fits (fileSize), so small
 *     files no longer read "0 MB". Disconnect empties the form's secret fields.
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { date, dateTime, num } from '/js/format.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { getMyFileStore, moveMyFiles, removeMyFileStore, fileSize } from '/js/services/file-store.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts } from '/components/Facts.js';
import { Note } from '/components/Note.js';
import { Mark, Marks, Code } from '/components/Mark.js';
import { Action } from '/components/Action.js';
import { List, Row, Name } from '/components/List.js';
import { Stack, Row as Line, Space } from '/components/Layout.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import { S, ConnectForm, placeWords } from './storage/connect-form.js';

const html = htm.bind(h);

/** The tools the person's own AI manages the same storage with. */
const AI_TOOLS = ['aimeat_file_store_get', 'aimeat_file_store_set', 'aimeat_file_store_move', 'aimeat_file_store_remove'];
/** Files moved per call: the route's default. */
const MOVE_BATCH = 50;
/** A ceiling on the batches of one press. */
const MOVE_ROUNDS_MAX = 1000;
/** The most failures the page lists; the count says how many there were. */
const FAILURES_SHOWN = 20;

const errWords = (e) => (e && e.message) || t('common.error');


/** Who connected it: the person, or one of their agents by name. */
function byWords(principal) {
  const p = String(principal || '');
  const hash = p.indexOf('#');
  return hash > 0 ? S('store.byAgent', { agent: p.slice(0, hash) }) : S('store.byYou');
}

/** The rule here in one status and one sentence, with the person's own approval where an operator approves. */
function RuleSection({ v }) {
  const a = v.approval;
  const approvalRow = v.mode === 'operator' && {
    key: 'approval', k: S('rule.approval'),
    v: html`<${Mark} kind="status" tone=${!a ? 'off' : a.state === 'approved' ? 'fine' : a.state === 'requested' ? 'attention' : 'danger'}>${S('rule.state.' + (a ? a.state : 'none'))}<//>`,
    sub: a ? [a.at ? date(a.at) : '', a.note ? `“${a.note}”` : ''].filter(Boolean).join(' · ') : S('rule.noneSub'),
  };
  return html`
    <${Section} id="fs-rule" num="01" title=${S('rule.title')}>
      <${Note} kind="lead">${S('rule.mode.' + v.mode)}<//>
      ${approvalRow ? html`<${Facts} rows=${[approvalRow]} />` : null}
    <//>`;
}

/** Why new files do not go to the connected storage now, in the person's words. */
function notTakingWords(v) {
  if (v.mode === 'off') return S('store.notTakingOff');
  if (v.approval && v.approval.state === 'declined') return S('store.notTakingDeclined');
  if (v.mode === 'operator') return S('store.notTakingWaiting');
  return S('store.notTakingOther');
}

/** The last connection test in one line. */
function checkWords(c) {
  if (!c) return S('store.notChecked');
  return c.ok ? S('store.checkOk', { when: dateTime(c.at) }) : S('store.checkFailed', { when: dateTime(c.at), message: c.message || '' });
}

/**
 * "Your storage": where it is and since when, its last test, whether new files go there, the files
 * in it and elsewhere, the two moves, and Disconnect (only once it holds none of your files).
 */
function StoreSection({ v, moving, onMove, onStop, onDisconnect }) {
  const s = v.store;
  const own = v.files.in_own_store;
  const away = v.files.elsewhere;
  if (!s) {
    return html`
      <${Section} id="fs-store" num="02" title=${S('store.title')}>
        <${Note} kind="quiet">${S('store.none', { n: num(away.count), size: fileSize(away.bytes) })}<//>
      <//>`;
  }
  const running = moving && moving.running;
  return html`
    <${Section} id="fs-store" num="02" title=${S('store.title')}>
      <${Facts} rows=${[
        { key: 'where', k: S('store.where'), v: placeWords(s.place, s.where) },
        s.prefix && { key: 'folder', k: S('store.folder'), v: s.prefix, mono: true },
        { key: 'since', k: S('store.since'), v: date(s.connected_at), sub: byWords(s.connected_by) },
        { key: 'check', k: S('store.check'), v: checkWords(s.last_check), warn: !!(s.last_check && !s.last_check.ok) },
        {
          key: 'taking', k: S('store.newFiles'),
          v: html`<${Mark} kind="status" tone=${v.taking_new_files ? 'fine' : 'attention'}>${v.taking_new_files ? S('store.taking') : S('store.notTaking')}<//>`,
          sub: v.taking_new_files ? S('store.takingSub') : notTakingWords(v),
        },
        { key: 'own', k: S('store.inOwn'), v: S('store.files', { n: num(own.count), size: fileSize(own.bytes) }) },
        { key: 'away', k: S('store.elsewhere'), v: S('store.files', { n: num(away.count), size: fileSize(away.bytes) }), sub: S('store.elsewhereSub') },
      ]} />
      <${Space} above="large">
        <${Stack} gap="medium">
          <${Line} wrap>
            ${running ? html`<${Action} small control onClick=${onStop}>${S('move.stop')}<//>` : html`
              <${Action} small control disabled=${!v.taking_new_files || away.count === 0} onClick=${() => onMove('own')}>${S('move.own')}<//>
              <${Action} small control disabled=${own.count === 0} onClick=${() => onMove('home')}>${S('move.home')}<//>`}
            <${Action} small control tone="danger" disabled=${running || own.count > 0} onClick=${onDisconnect}>${S('store.disconnect')}<//>
          <//>
          <${Note} kind="hint">${own.count > 0 ? S('store.disconnectFirst', { n: num(own.count) }) : S('store.disconnectHint')}<//>
          ${moving ? html`
            <${Note} kind=${running ? 'loading' : 'message'}>
              ${S(running ? 'move.progress' : 'move.done', { moved: num(moving.moved), remaining: num(moving.remaining ?? 0) })}
            <//>
            ${moving.error ? html`<${Note} kind="message" error>${moving.error}<//>` : null}
            ${moving.failedCount ? html`
              <${Note} kind="message" error>${S('move.failedCount', { n: num(moving.failedCount) })}<//>
              <${List} cols="name" dense>
                ${moving.failed.map((f, i) => html`<${Row} key=${i}><${Name} code desc=${f.error}>${f.key}<//><//>`)}
              <//>` : null}` : null}
        <//>
      <//>
    <//>`;
}

/** The aside: the person's own AI manages the same storage with four tools. */
function AiAside() {
  return html`
    <${Note} kind="aside" size="small">
      <b>${S('ai.title')}</b> ${S('ai.text')}
      <${Marks}>${AI_TOOLS.map(n => html`<${Code} key=${n}>${n}<//>`)}<//>
    <//>`;
}

/** @param {{ showToast?: (msg: string, kind?: unknown) => void }} props the profile shell's tab props */
export default function StorageTab({ showToast }) {
  const [v, setV] = useState(null);
  const [error, setError] = useState('');
  const [moving, setMoving] = useState(null);
  const [clearSignal, setClearSignal] = useState(0);
  const stopRef = useRef(false);
  const { confirm, ConfirmUI } = useConfirm();

  const load = useCallback(async () => {
    try {
      const r = await getMyFileStore();
      setV(r.data);
      setError('');
    } catch (e) {
      swallowed('storage-tab: load', e);
      setError(errWords(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['notifications', 'files', 'config', 'file-store'], () => load()), [load]);

  /** Move batch after batch until none remain, the person presses Stop, or a batch moved nothing. */
  const moveAll = async (direction) => {
    stopRef.current = false;
    let sum = { running: true, direction, moved: 0, remaining: null, failed: [], failedCount: 0, error: '' };
    setMoving(sum);
    try {
      for (let round = 0; round < MOVE_ROUNDS_MAX; round++) {
        const r = (await moveMyFiles(direction, MOVE_BATCH)).data;
        sum = {
          ...sum,
          moved: sum.moved + r.moved,
          remaining: r.remaining,
          failed: [...sum.failed, ...r.failed].slice(0, FAILURES_SHOWN),
          failedCount: sum.failedCount + r.failed.length,
        };
        setMoving(sum);
        // A batch that moved and skipped nothing failed on every file it tried; the next would repeat it.
        if (stopRef.current || r.remaining === 0 || r.moved + r.skipped === 0) break;
      }
    } catch (e) {
      swallowed('storage-tab: move', e);
      sum = { ...sum, error: errWords(e) };
    }
    setMoving({ ...sum, running: false });
    load();
  };

  const disconnect = () => confirm(
    S('store.disconnectAsk', { where: placeWords(v.store.place, v.store.where) }),
    async () => {
      try {
        await removeMyFileStore();
        showToast?.(S('store.disconnected'));
        setMoving(null);
        await load();
      } catch (e) {
        swallowed('storage-tab: disconnect', e);
        setError(errWords(e));
      } finally {
        // Whatever the answer, no key typed earlier stays in the form.
        setClearSignal((n) => n + 1);
      }
    },
    { danger: true, title: S('store.disconnect'), confirmLabel: S('store.disconnect') },
  );

  const off = v && v.mode === 'off';
  const approved = !!(v && v.approval && v.approval.state === 'approved');
  const strip = v && (v.may_connect || v.store) ? html`<${FigureStrip} items=${[
    { key: 'own', n: num(v.files.in_own_store.count), label: S('strip.own'), sub: fileSize(v.files.in_own_store.bytes) },
    { key: 'away', n: num(v.files.elsewhere.count), label: S('strip.elsewhere'), sub: fileSize(v.files.elsewhere.bytes) },
  ]} />` : null;

  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuAccount'), t('profile.tabs.storage')]}
      title=${S('title')}
      desc=${S('desc')}
      strip=${strip}
      after=${html`<${ConfirmUI} />`}>
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${!v && !error ? html`<${Note} kind="loading">${S('loading')}<//>` : null}
      ${v ? html`
        <${RuleSection} v=${v} />
        ${off && !v.store ? null : html`
          <${StoreSection} v=${v} moving=${moving} onMove=${moveAll} onStop=${() => { stopRef.current = true; }} onDisconnect=${disconnect} />`}
        ${off ? null : html`
          <${Section} id="fs-connect" num="03" title=${v.store ? S('connect.titleReplace') : S('connect.title')}>
            <${ConnectForm} mode=${v.mode} approved=${approved} replacing=${!!v.store} onConnected=${() => load()} clearSignal=${clearSignal} />
          <//>`}
        ${off ? null : html`<${AiAside} />`}` : null}
    <//>`;
}
