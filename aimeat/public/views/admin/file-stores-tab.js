/**
 * @file public/views/admin/file-stores-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The admin page "File storage" (id `file-stores`, opened by /v1/admin?tab=file-stores,
 *   the link the operators' notifications carry). Stored files can keep their bytes in the node's
 *   database, in one S3 bucket or in one Azure Blob container for the whole node, and a person may
 *   connect a storage of their own when the operator's rule lets them. This page shows where new files
 *   go and whether that place is complete and answers (Test connection), how many files sit where,
 *   moves the older files out of the database, and decides people's requests for their own storage.
 *   One read, GET /v1/admin/file-store, which the aimeat_admin_file_store tool returns too, re-read on
 *   the SSE change domains `config` (a setting saved on the Config tab), `notifications` (a person's
 *   request reaches the operators as one) and `file-store`. In order: the lead, the numeral strip (in
 *   the database, in the node's store, in people's own storage, waiting for you), where new files go,
 *   the files in the database with the move, people's own storage, and the aside on the same page for
 *   the operator's own AI. Every part is a library component; the page passes data and writes no class.
 * @structure FileStoresTab({ switchPage }) — load · Strip · PlaceSection · MoveSection · OwnersSection
 *   (file-stores-tab.parts.js) · AiAside · the writes (test, move, decide)
 * @usage Registered in views/admin.js NAV_GROUPS as { id: 'file-stores', key: 'admin.fileStores.title' }.
 * @version-history
 *   v1.1.0 — 2026-10-29 — Sizes in the unit that fits (fileSize), so small files no longer read "0 MB".
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num, Spinner, useToast, Toast } from './shared.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Note } from '/components/Note.js';
import { Marks, Code } from '/components/Mark.js';
import { getNodeFileStore, testNodeFileStore, moveNodeFiles, decideOwnerFileStore } from '/js/services/file-store.js';
import { fileSize } from '/js/services/file-store.js';
import { F, PlaceSection, MoveSection, OwnersSection } from './file-stores-tab.parts.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

/** The tools the operator's own AI reads and runs this page with. */
const AI_TOOLS = ['aimeat_admin_file_store', 'aimeat_admin_file_store_test', 'aimeat_admin_file_store_move', 'aimeat_admin_file_store_decide'];
/** Files moved per call: the route's default, small enough that one call never holds the node for long. */
const MOVE_BATCH = 100;
/** The most failures the page lists; the count says how many there were. */
const FAILURES_SHOWN = 20;
/** A ceiling on the batches of one press, so a node that keeps answering "more" cannot loop for ever. */
const MOVE_ROUNDS_MAX = 2000;

const errWords = (e) => (e && e.message) || t('common.error');

/** The numeral strip: files per place, and the requests that wait; each scrolls to its section. */
function Strip({ view, toSection }) {
  const f = view.files;
  const waiting = view.owner_stores.mode === 'operator' ? view.owner_stores.waiting.length : 0;
  return html`<${FigureStrip} wrap items=${[
    { key: 'db', n: num(f.database.count), label: F('strip.database'), sub: fileSize(f.database.bytes), onClick: () => toSection('adm-fs-move') },
    { key: 'node', n: num(f.node_store.count), label: F('strip.node'), sub: fileSize(f.node_store.bytes), onClick: () => toSection('adm-fs-place') },
    { key: 'own', n: num(f.own_stores.count), label: F('strip.own'), sub: fileSize(f.own_stores.bytes), onClick: () => toSection('adm-fs-owners') },
    view.owner_stores.mode === 'operator' && {
      key: 'waiting', n: num(waiting), label: F('strip.waiting'), sub: F('strip.waitingSub'),
      tone: waiting > 0 ? 'notice' : undefined, onClick: () => toSection('adm-fs-owners'),
    },
  ]} />`;
}

/** The aside: the operator's own AI reads and runs the same page with four tools. */
function AiAside() {
  return html`
    <${Note} kind="aside" size="small">
      <b>${F('ai.title')}</b> ${F('ai.text')}
      <${Marks}>${AI_TOOLS.map(n => html`<${Code} key=${n}>${n}<//>`)}<//>
    <//>`;
}

export default function FileStoresTab(props) {
  const { switchPage } = props;
  const [view, setView] = useState(null);
  const [failed, setFailed] = useState(false);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [move, setMove] = useState(null);
  const stopRef = useRef(false);
  const [toast, showErr, showOk, clearToast] = useToast();

  const load = useCallback(async () => {
    try {
      const r = await getNodeFileStore();
      setView(r.data);
      setFailed(false);
    } catch (e) {
      setFailed(true);
      showErr(errWords(e));
    }
  }, [showErr]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['config', 'notifications', 'file-store'], () => load()), [load]);

  const toSection = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const r = await testNodeFileStore();
      setTest(r.data);
    } catch (e) {
      // The refusal names what is missing (NO_FILE_STORE, FILE_STORE_INCOMPLETE); it stays under the button.
      swallowed('file-stores-tab: test', e);
      setTest({ error: errWords(e) });
    } finally {
      setTesting(false);
    }
  };

  /**
   * Move batch after batch until none remain, the operator presses Stop, or a batch was the last page
   * (`next` null: what is left failed, and the next press tries it again from the start).
   */
  const runMove = async () => {
    stopRef.current = false;
    let sum = { running: true, moved: 0, mb: 0, remaining: null, failed: [], failedCount: 0, error: '' };
    setMove(sum);
    let after;
    try {
      for (let round = 0; round < MOVE_ROUNDS_MAX; round++) {
        const r = (await moveNodeFiles(MOVE_BATCH, after)).data;
        sum = {
          ...sum,
          moved: sum.moved + r.moved,
          mb: sum.mb + (r.moved_bytes_mb || 0),
          remaining: r.remaining,
          failed: [...sum.failed, ...r.failed].slice(0, FAILURES_SHOWN),
          failedCount: sum.failedCount + r.failed.length,
        };
        setMove(sum);
        if (stopRef.current || r.remaining === 0 || !r.next) break;
        after = r.next;
      }
    } catch (e) {
      swallowed('file-stores-tab: move', e);
      sum = { ...sum, error: errWords(e) };
    }
    setMove({ ...sum, running: false });
    load();
  };
  const stopMove = () => { stopRef.current = true; };

  /** One decision, one re-read, one word to the operator; true when it was done. */
  const decide = async (owner, decision, note) => {
    try {
      await decideOwnerFileStore(owner, decision, note);
      showOk(F('owners.done.' + decision, { owner }));
      await load();
      return true;
    } catch (e) {
      // The operator reads the refusal in the toast; the note field keeps what they typed.
      swallowed('file-stores-tab: decide', e);
      showErr(errWords(e));
      return false;
    }
  };

  if (!view) {
    return html`
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      ${failed ? html`<${Note} kind="quiet">${F('loadFailed')}<//>` : html`<${Spinner} />`}`;
  }

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${Note} kind="lead">${F('lead')}<//>
    <${Strip} view=${view} toSection=${toSection} />
    <${PlaceSection} number="01" view=${view} test=${test} testing=${testing} onTest=${runTest} switchPage=${switchPage} />
    <${MoveSection} number="02" view=${view} move=${move} onMove=${runMove} onStop=${stopMove} />
    <${OwnersSection} number="03" view=${view} onDecide=${decide} switchPage=${switchPage} />
    <${AiAside} />`;
}
