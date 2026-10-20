/**
 * @file public/views/profile/memory-tab/file-facts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fold "What is known about this file" under a stored file's preview on the Memory
 *   page (wish-sis-ll-n-purku-luokittelu-ja-owl). Opened, it reads the file's facts
 *   (GET /v1/content/facts?kind=file&key=…, with `owner` when the file is one of the person's agents')
 *   and shows the same row as the Data Wallet's newest items (data-wallet/content-facts.js itemRow:
 *   the description or alt text, the content classes, the AI mark) and the details the node read from
 *   the file without a model: a PDF's title, author, pages and signatures; a picture's size, camera,
 *   time taken and whether it has a location; a video's length, size and codecs. Under them: the
 *   file's content classes with who decided each and the way to change them
 *   (file-facts-classes.js), the fields picked out for each class with their JSON-LD, the class's OWL
 *   definition and the way to correct or extract them again (file-facts-fields.js), and the text the
 *   node took out of the file (GET /v1/content/text, read when its fold opens). "Read it now"
 *   (POST /v1/content/inspect) reads the file with the person's settings and shows the result.
 *
 *   Opening the fold scrolls it to the top of the dialog (smooth, or at once under reduced motion):
 *   Jouni, 2026-10-21, had to find the opened fold by scrolling himself.
 *
 *   It reads nothing until it is opened, so a preview costs no request when nobody looks. While open
 *   it reads again on the change domain `contentclass` (onLiveUpdate); there is no timer. When the
 *   operator has turned content classes off, the open fold says so in one line.
 * @structure FileFacts({ file }) · fieldClasses(facts, classes) · TextPart({ source, kept })
 * @usage html`<${FileFacts} file=${file} />`
 * @version-history
 *   v1.2.0 — 2026-10-21 — Browser check of the second round: the scroll waits until the fold's content
 *     has loaded; every class of the file that extracts fields gets its part, with or without an
 *     entity (fieldClasses); the text fold asks the server only when the facts name a kept text.
 *   v1.1.0 — 2026-10-21 — Jouni's look of 2026-10-21: the fold scrolls into view when it opens; the
 *     content classes with who decided and Change (file-facts-classes.js); the picked-out fields per
 *     class with Edit, JSON-LD, the OWL class and Extract again (file-facts-fields.js); the text taken
 *     out of the file. The content classes are read with the facts, for their names and fields.
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { Folds, FoldRow } from '/components/Folds.js';
import { Space } from '/components/Layout.js';
import { List } from '/components/List.js';
import { Facts } from '/components/Facts.js';
import { Note } from '/components/Note.js';
import { Code } from '/components/Mark.js';
import { Action, Actions } from '/components/Action.js';
import {
  cc, itemRow, detailRows, readItemFacts, readOverview, readClasses, inspectItem, fileSource, readItemText,
} from '../data-wallet/content-facts.js';
import { ClassesPart } from './file-facts-classes.js';
import { EntityPart } from './file-facts-fields.js';

const html = htm.bind(h);
const errText = (e) => e?.error?.message || e?.response?.error?.message || e?.message || cc('inspectFailed');
/** Whether the reader asked for less motion; a browser without matchMedia scrolls at once too. */
const reducedMotion = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : true);

/**
 * The fold of the text the node took out of the file; read once, when first opened, and only when
 * the facts name a kept text (`kept`): otherwise GET /v1/content/text would answer 404 for nothing.
 */
function TextPart({ source, kept }) {
  const [text, setText] = useState(kept ? undefined : null);
  const load = async (opened) => {
    if (!opened || !kept || text !== undefined) return;
    try { setText(await readItemText(source)); } catch (e) { swallowed('file-facts: text', e); setText(null); }
  };
  const body = text === undefined ? html`<${Note} kind="loading">${t('dwpage.loading')}<//>`
    : !text?.text ? html`<${Note} kind="quiet">${cc('noText')}<//>`
    : html`<${Code} block scroll="medium">${text.text}<//>`;
  return html`<${Folds}><${FoldRow} kind="toggle" name=${cc('textFold')} onToggle=${load} body=${body} /><//>`;
}

/**
 * The classes that get a fields part: every class of the file that extracts fields (`process` and
 * at least one property), whether or not an entity is kept for it yet, so Extract again stays
 * reachable after a class is removed and added back; then any class an entity is kept for that the
 * file no longer belongs to.
 * @param {any} facts @param {any[]} classes @returns {string[]}
 */
export function fieldClasses(facts, classes) {
  const extracts = (id) => { const c = classes.find((k) => k.id === id); return !!c && c.process !== false && (c.properties || []).length > 0; };
  const ids = (facts.classes || []).map((m) => m.id).filter(extracts);
  for (const id of Object.keys(facts.entities || {})) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/**
 * @param {{ file: { key?: string, name?: string, owner_gaii?: string } }} props
 */
export function FileFacts({ file }) {
  const key = file.key || file.name;
  // An agent's file is named with its owner (the agent); the person's own file needs none.
  const owner = file.owner_gaii && file.owner_gaii.includes('#') ? file.owner_gaii : undefined;
  const source = fileSource(key, owner);
  const [open, setOpen] = useState(false);
  // undefined: not read yet · null: nothing read from the file yet · object: its facts
  const [facts, setFacts] = useState(undefined);
  const [off, setOff] = useState(false);
  const [classes, setClasses] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const top = useRef(null);

  const loadClasses = async () => setClasses(await readClasses().catch((e) => { swallowed('file-facts: classes', e); return []; }));
  const load = useCallback(async () => {
    try {
      const f = await readItemFacts(key, owner);
      // The classes first, so the fold's whole content (the class names and the fields parts) is
      // there in one render when the facts arrive, and the scroll below measures the full height.
      if (f) await loadClasses();
      else {
        const o = await readOverview().catch((e) => { swallowed('file-facts: overview', e); return null; });
        setOff(!!o?.off);
      }
      setFacts(f);
    } catch (e) { swallowed('file-facts: facts', e); setFacts(null); }
  }, [key, owner]);

  useEffect(() => { if (open && facts === undefined) load(); }, [open, facts, load]);
  // The opened fold comes to the top of the dialog's body, where it would otherwise open out of sight.
  // It waits for the content: scrolled while it said Loading, the fold moved only as far as one line
  // allowed (browser check, 2026-10-21). Once per opening, so a live re-read does not move the page.
  const scrolled = useRef(false);
  const loaded = facts !== undefined;
  useEffect(() => {
    if (!open) { scrolled.current = false; return; }
    if (!loaded || scrolled.current) return;
    scrolled.current = true;
    top.current?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [open, loaded]);
  const again = useRef(null);
  again.current = () => { if (open) load(); };
  useEffect(() => onLiveUpdate(['contentclass'], () => again.current()), []);

  const readNow = async () => {
    setBusy(true); setMsg(null);
    try {
      const f = await inspectItem(source);
      if (f) { setFacts(f); await loadClasses(); }
    } catch (e) { setMsg({ text: errText(e), error: true }); }
    setBusy(false);
  };

  const action = html`
    <${Actions}>
      <${Action} small disabled=${busy} onClick=${readNow}>${busy ? cc('reading') : cc('readNow')}<//>
      ${msg ? html`<${Note} kind="message" error=${msg.error}>${msg.text}<//>` : null}
    <//>`;
  let body;
  if (facts === undefined) body = html`<${Note} kind="loading">${t('dwpage.loading')}<//>`;
  else if (off) body = html`<${Note} kind="quiet">${cc('off')}<//>`;
  else if (!facts) body = html`<${Note} kind="quiet">${cc('fileNotRead')}<//>${action}`;
  else {
    body = html`
      <${List} cols="name-desc-state-doors" labels head=${[cc('col.item'), cc('col.description'), cc('col.ai'), '']}
        rows=${[facts]} render=${(f) => itemRow(f, classes)} />
      <${Facts} rows=${detailRows(facts)} />
      <${ClassesPart} facts=${facts} classes=${classes} source=${source} onFacts=${setFacts} />
      ${fieldClasses(facts, classes).map((id) => html`
        <${EntityPart} key=${id} classId=${id} entry=${facts.entities?.[id]} cls=${classes.find((c) => c.id === id)} classes=${classes} source=${source} onFacts=${setFacts} />`)}
      <${Space} above="medium"><${TextPart} key=${facts.textKey || 'none'} source=${source} kept=${!!facts.textKey} /><//>
      ${action}`;
  }
  // The bare element is the scroll target only: the kit's parts take no ref, and it draws nothing.
  return html`
    <div ref=${top}>
      <${Space} above="medium">
        <${Folds}>
          <${FoldRow} kind="toggle" name=${cc('fileFold')} open=${open} onToggle=${(next) => setOpen(next)} body=${html`<${Space} above="small">${body}<//>`} />
        <//>
      <//>
    </div>`;
}

export default FileFacts;
