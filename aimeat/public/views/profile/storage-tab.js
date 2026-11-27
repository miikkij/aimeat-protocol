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
 *   `file-store`. In order: the title's question mark (concept.own_storage: what one's own storage
 *   is, what the test does, where files go, when to use something else), the page's start
 *   (PageStart: what the page is for, the prompt for one's own AI, whose button goes to the connect
 *   form, and what happens next), the figure strip (your stores, what needs a look, files in your
 *   stores, files on this service), your stores (store-sections.js), where your files are (where new
 *   files go, files per place, the service's stores you may choose, and the move between places), the
 *   connect form (connect-form.js) and the rule here; the rule comes first when it is what the person
 *   must know. Every part is a library component; the page passes data and writes no class.
 *   How the page explains itself: .claude/rules/page-guidance.md.
 * @structure StorageTab({ showToast }) — load · RuleSection · PlacesSection · StoresSection
 *   (storage/store-sections.js) · moveAll · makeDefault · testAgain · disconnect · ConnectForm
 * @usage Registered in views/profile.js TABS as { id: 'storage', key: 'profile.tabs.storage' }; menu
 *   entry in landing-page.cards.js (the Account group, after Data Wallet).
 * @version-history
 *   v1.5.0 — 2026-11-27 — Usability pass. The person's stores come first (a store whose last test
 *     failed first among them), then where the files are, then the connect form and the rule here as
 *     folds whose rows say their state; the rule stands first and open when own storage is off here or
 *     an operator declined the person. The connect form is open of itself while the person has no
 *     store and stays open after a connect, so the test's steps and the CORS rule stay in sight; the
 *     head's one loud action "Connect a store" and the start's button open it. The strip is drawn once
 *     a store is connected: the stores and the default, what needs a look (notice tone, only then),
 *     and the files in the stores and on this service. Headings are noun phrases. Nothing was removed.
 *   v1.4.0 — 2026-11-08 — The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart under the head (folded once a store is connected; its button goes to the connect form,
 *     on a service that lets people connect one) and the title's question mark, concept.own_storage.
 *     The dashed aside about one's own AI and its four tool names goes: the start's prompt is that
 *     sentence now.
 *   v1.3.0 — 2026-10-31 — Each store says whether a browser may send files straight to it, shows the CORS
 *     rule to add while it may not, and has Test again (storage/browser-access.js).
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
import { getMyFileStore, moveMyFiles, removeMyFileStore, makeMyStoreDefault, testMyStore, fileSize } from '/js/services/file-store.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts } from '/components/Facts.js';
import { Note } from '/components/Note.js';
import { Mark } from '/components/Mark.js';
import { PageStart } from '/components/PageStart.js';
import { scrollToSection } from '/components/Rail.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import { S, ConnectForm, placeWords } from './storage/connect-form.js';
import { PlacesSection, StoresSection, storeNeedsLook, newFilesNeedPerson } from './storage/store-sections.js';
import { Loud } from '/components/Action.js';
import { refusalWords, RefusalNote } from './storage/store-words.js';

const html = htm.bind(h);

/** Files moved per call: the route's default. */
const MOVE_BATCH = 50;
/** A ceiling on the batches of one press. */
const MOVE_ROUNDS_MAX = 1000;
/** The most failures the page lists; the count says how many there were. */
const FAILURES_SHOWN = 20;

/**
 * The rule here in one status and one sentence, with the person's own approval where an operator
 * approves. Open and first when it is what the person must know (own storage is off here, or an
 * operator declined them); otherwise a fold whose row says the rule and the approval in short.
 */
function RuleSection({ v, number, open, first, folded, onToggle }) {
  const a = v.approval;
  const state = v.mode === 'operator' ? S('rule.state.' + (a ? a.state : 'none')) : '';
  const approvalRow = v.mode === 'operator' && {
    key: 'approval', k: S('rule.approval'),
    v: html`<${Mark} kind="status" tone=${!a ? 'off' : a.state === 'approved' ? 'fine' : a.state === 'requested' ? 'attention' : 'danger'}>${state}<//>`,
    sub: a ? [a.at ? date(a.at) : '', a.note ? `“${a.note}”` : ''].filter(Boolean).join(' · ') : S('rule.noneSub'),
  };
  const sub = v.mode === 'operator' ? S('rule.short.operator', { state }) : S('rule.short.' + v.mode);
  return html`
    <${Section} id="fs-rule" num=${number} first=${first} title=${S('rule.title')}
      ...${folded ? { fold: true, sub, open, onToggle } : {}}>
      <${Note} kind="lead">${S('rule.mode.' + v.mode)}<//>
      ${approvalRow ? html`<${Facts} rows=${[approvalRow]} />` : null}
    <//>`;
}

/** @param {{ showToast?: (msg: string, kind?: unknown) => void }} props the profile shell's tab props */
export default function StorageTab({ showToast }) {
  const [v, setV] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [moving, setMoving] = useState(null);
  const [clearSignal, setClearSignal] = useState(0);
  // The two folds: the connect form (open of itself while the person has no store, null = that
  // default) and the rule here.
  const [connectOpen, setConnectOpen] = useState(null);
  const [ruleOpen, setRuleOpen] = useState(false);
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

  // The test answers the browser check too, which is what a person waits for after adding a CORS rule.
  const testAgain = async (s) => {
    try {
      const r = (await testMyStore(s.name)).data;
      const after = (r.view.stores || []).find((x) => x.name === s.name);
      const ready = after && after.browser_access && after.browser_access.ready;
      showToast?.(r.test && r.test.ok
        ? (ready ? S('store.testedReady', { name: s.name }) : S('store.testedNotReady', { name: s.name }))
        : S('store.testedFailed', { name: s.name }));
      await load();
    } catch (e) {
      swallowed('storage-tab: test again', e);
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
  // What needs the person: a store whose last test failed, and new files that miss their stores for
  // a reason they can fix (never while an operator has yet to decide).
  const failing = stores.filter(storeNeedsLook).length;
  const newFilesStuck = !!v && newFilesNeedPerson(v);
  const needs = failing + (newFilesStuck ? 1 : 0);
  const defaultStore = stores.find((s) => s.default);
  // The figures, from the one read the page makes: the stores and the default, what needs a look
  // (only then), and the files in the person's stores and on this service. Before the person has a
  // store there is no strip: the list's one line says how many files are on this service and how to begin.
  const strip = v && stores.length ? html`<${FigureStrip} items=${[
    { key: 'stores', n: num(stores.length), label: S('strip.stores'), sub: defaultStore ? S('strip.storesDefault', { name: defaultStore.name }) : S('strip.storesNoDefault') },
    needs ? { key: 'needs', n: num(needs), tone: 'notice', label: S('strip.attention'), sub: newFilesStuck ? S('strip.newFilesStuck') : S('strip.attentionSub') } : null,
    { key: 'own', n: num(v.files.in_own_store.count), label: S('strip.own'), sub: fileSize(v.files.in_own_store.bytes) },
    { key: 'away', n: num(v.files.elsewhere.count), label: S('strip.elsewhere'), sub: fileSize(v.files.elsewhere.bytes) },
  ]} />` : null;
  const showPlaces = !!v && (stores.length > 0 || (v.choices || []).length > 0);
  const showStores = !!v && !(off && stores.length === 0);
  // The rule is the page's first word when it is what the person must know: own storage is off here
  // (then often the only section), or an operator declined them. Otherwise it is the last row.
  const ruleFirst = !!v && (off || (v.mode === 'operator' && v.approval && v.approval.state === 'declined'));
  // In this order, numbered as they show, so a section left out leaves no gap.
  const order = [
    ruleFirst ? 'fs-rule' : null,
    showStores ? 'fs-store' : null,
    showPlaces ? 'fs-places' : null,
    off ? null : 'fs-connect',
    ruleFirst ? null : 'fs-rule',
  ].filter(Boolean);
  const numOf = (id) => String(order.indexOf(id) + 1).padStart(2, '0');
  const first = order[0];
  // The connect form is open of itself while the person has no store, since it is how one begins.
  const connectShown = connectOpen ?? stores.length === 0;
  const openConnect = () => { setConnectOpen(true); scrollToSection('fs-connect'); };
  const actions = v && !off ? html`<${Loud} onClick=${openConnect}>${S('connect.loud')}<//>` : null;
  // The start: folded once a store is connected; its button goes to the connect form where there is one.
  const start = html`<${PageStart} id="storage" done=${v ? stores.length > 0 : null}
    action=${v && !off ? { onClick: openConnect } : undefined} />`;
  const parts = {
    'fs-rule': () => html`<${RuleSection} v=${v} number=${numOf('fs-rule')} first=${first === 'fs-rule'} folded=${!ruleFirst}
      open=${ruleOpen} onToggle=${() => setRuleOpen((o) => !o)} />`,
    'fs-store': () => html`<${StoresSection} number=${numOf('fs-store')} first=${first === 'fs-store'} v=${v} moving=${moving} onMove=${moveAll} onStop=${stop}
      onDefault=${makeDefault} onTest=${testAgain} onDisconnect=${disconnect} />`,
    'fs-places': () => html`<${PlacesSection} number=${numOf('fs-places')} first=${first === 'fs-places'} v=${v} moving=${moving} onMove=${moveAll} onStop=${stop} />`,
    'fs-connect': () => html`
      <${Section} fold id="fs-connect" num=${numOf('fs-connect')} title=${stores.length ? S('connect.titleMore') : S('connect.title')}
        sub=${S('connect.sub')} open=${connectShown} onToggle=${() => setConnectOpen(!connectShown)}>
        <${ConnectForm} mode=${v.mode} approved=${approved} names=${stores.map((s) => s.name)}
          onConnected=${() => { setConnectOpen(true); load(); }} clearSignal=${clearSignal} />
      <//>`,
  };

  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuAccount'), t('profile.tabs.storage')]}
      title=${S('title')}
      help="concept.own_storage"
      desc=${S('desc')}
      actions=${actions}
      start=${start}
      strip=${strip}
      after=${html`<${ConfirmUI} />`}>
      <${RefusalNote} refusal=${refusal} />
      ${!v && !refusal ? html`<${Note} kind="loading">${S('loading')}<//>` : null}
      ${v ? order.map((id) => parts[id]()) : null}
    <//>`;
}
