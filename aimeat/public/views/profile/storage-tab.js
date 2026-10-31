/**
 * @file public/views/profile/storage-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Settings & Controls page "Your own storage" (tab id `storage`, opened by
 *   /v1/profile?tab=storage and ?tab=storage&section=fs-connect). A person may keep the bytes of
 *   their stored files in their own S3 buckets or Azure Blob containers, with their own keys, each
 *   store under a name and one of them the default: the files are theirs to keep, and they do not use
 *   this service's space. The operators may also open stores of the service for everyone to choose.
 *   Whether a person may connect their own, and whether an operator approves each person first, is the
 *   operator's rule (file_store.owner_stores); the page says it in words, and when the rule is off it
 *   says so (a store still connected can then still be emptied and disconnected). One read,
 *   GET /v1/file-store (the aimeat_file_store_get tool returns the same), re-read on the SSE change
 *   domains `notifications` (an operator's decision reaches the person as one), `files`, `config` and
 *   `file-store`. In order: the figure strip (files in your stores, files on this service), the rule
 *   here, where your files are (where new files go, files per place, the service's stores you may
 *   choose, and the move between places), your stores (store-sections.js), the connect form
 *   (connect-form.js), and the aside for the person's own AI. Every part is a library component; the
 *   page passes data and writes no class.
 * @structure StorageTab({ showToast }) — load · RuleSection · PlacesSection · StoresSection
 *   (storage/store-sections.js) · moveAll · makeDefault · disconnect · ConnectForm · AiAside
 * @usage Registered in views/profile.js TABS as { id: 'storage', key: 'profile.tabs.storage' }; menu
 *   entry in landing-page.cards.js (the Account group, after Data Wallet).
 * @version-history
 *   v1.2.0 — 2026-10-30 — Named stores (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-):
 *     the section "Where your files are" (where new files go, files per place, the service's stores
 *     the person may choose, a move from any place to any store they may choose or home), one box per
 *     store with Make default, Move my other files here, Move its files and Disconnect, and the
 *     connect form names the store. The sections moved to storage/store-sections.js. A refusal reads
 *     in the reader's words.
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
import { date, num } from '/js/format.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { getMyFileStore, moveMyFiles, removeMyFileStore, makeMyStoreDefault, fileSize } from '/js/services/file-store.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts } from '/components/Facts.js';
import { Note } from '/components/Note.js';
import { Mark, Marks, Code } from '/components/Mark.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import { S, ConnectForm, placeWords } from './storage/connect-form.js';
import { PlacesSection, StoresSection } from './storage/store-sections.js';
import { refusalWords, RefusalNote } from './storage/store-words.js';

const html = htm.bind(h);

/** The tools the person's own AI manages the same storage with. */
const AI_TOOLS = ['aimeat_file_store_get', 'aimeat_file_store_set', 'aimeat_file_store_move', 'aimeat_file_store_remove'];
/** Files moved per call: the route's default. */
const MOVE_BATCH = 50;
/** A ceiling on the batches of one press. */
const MOVE_ROUNDS_MAX = 1000;
/** The most failures the page lists; the count says how many there were. */
const FAILURES_SHOWN = 20;

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
  const [refusal, setRefusal] = useState(null);
  const [moving, setMoving] = useState(null);
  const [clearSignal, setClearSignal] = useState(0);
  const stopRef = useRef(false);
  const { confirm, ConfirmUI } = useConfirm();

  const load = useCallback(async () => {
    try {
      const r = await getMyFileStore();
      setV(r.data);
      setRefusal(null);
    } catch (e) {
      swallowed('storage-tab: load', e);
      setRefusal(refusalWords(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['notifications', 'files', 'config', 'file-store'], () => load()), [load]);

  /**
   * Move batch after batch until none remain, the person presses Stop, or a batch moved nothing.
   * `body` is { to, from? }; `at` names where the progress shows ('places' or the store's id).
   */
  const moveAll = async (body, at) => {
    stopRef.current = false;
    let sum = { running: true, at, moved: 0, remaining: null, failed: [], failedCount: 0, refusal: null };
    setMoving(sum);
    try {
      for (let round = 0; round < MOVE_ROUNDS_MAX; round++) {
        const r = (await moveMyFiles({ ...body, limit: MOVE_BATCH })).data;
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
      sum = { ...sum, refusal: refusalWords(e) };
    }
    setMoving({ ...sum, running: false });
    load();
  };
  const stop = () => { stopRef.current = true; };

  const makeDefault = async (s) => {
    try {
      await makeMyStoreDefault(s.name);
      showToast?.(S('store.defaultDone', { name: s.name }));
      await load();
    } catch (e) {
      swallowed('storage-tab: make default', e);
      setRefusal(refusalWords(e));
    }
  };

  const disconnect = (s) => confirm(
    S('store.disconnectAsk', { name: s.name, where: placeWords(s.place, s.where) }),
    async () => {
      try {
        await removeMyFileStore(s.name);
        showToast?.(S('store.disconnected', { name: s.name }));
        setMoving(null);
        await load();
      } catch (e) {
        swallowed('storage-tab: disconnect', e);
        setRefusal(refusalWords(e));
      } finally {
        // Whatever the answer, no key typed earlier stays in the form.
        setClearSignal((n) => n + 1);
      }
    },
    { danger: true, title: S('store.disconnect'), confirmLabel: S('store.disconnect') },
  );

  const off = v && v.mode === 'off';
  const stores = (v && v.stores) || [];
  const approved = !!(v && v.approval && v.approval.state === 'approved');
  const strip = v && (v.may_connect || stores.length) ? html`<${FigureStrip} items=${[
    { key: 'own', n: num(v.files.in_own_store.count), label: S('strip.own'), sub: fileSize(v.files.in_own_store.bytes) },
    { key: 'away', n: num(v.files.elsewhere.count), label: S('strip.elsewhere'), sub: fileSize(v.files.elsewhere.bytes) },
  ]} />` : null;
  const showPlaces = !!v && (stores.length > 0 || (v.choices || []).length > 0);
  const showStores = !!v && !(off && stores.length === 0);
  // The sections number themselves in the order they show: a section left out leaves no gap.
  let shown = 1;
  const next = () => String(++shown).padStart(2, '0');
  const placesNum = showPlaces ? next() : '';
  const storesNum = showStores ? next() : '';
  const connectNum = next();

  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuAccount'), t('profile.tabs.storage')]}
      title=${S('title')}
      desc=${S('desc')}
      strip=${strip}
      after=${html`<${ConfirmUI} />`}>
      <${RefusalNote} refusal=${refusal} />
      ${!v && !refusal ? html`<${Note} kind="loading">${S('loading')}<//>` : null}
      ${v ? html`
        <${RuleSection} v=${v} />
        ${showPlaces ? html`<${PlacesSection} number=${placesNum} v=${v} moving=${moving} onMove=${moveAll} onStop=${stop} />` : null}
        ${showStores ? html`
          <${StoresSection} number=${storesNum} v=${v} moving=${moving} onMove=${moveAll} onStop=${stop} onDefault=${makeDefault} onDisconnect=${disconnect} />` : null}
        ${off ? null : html`
          <${Section} id="fs-connect" num=${connectNum} title=${stores.length ? S('connect.titleMore') : S('connect.title')}>
            <${ConnectForm} mode=${v.mode} approved=${approved} names=${stores.map((s) => s.name)} onConnected=${() => load()} clearSignal=${clearSignal} />
          <//>`}
        ${off ? null : html`<${AiAside} />`}` : null}
    <//>`;
}
