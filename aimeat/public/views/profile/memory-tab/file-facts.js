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
 *   time taken and whether it has a location; a video's length, size and codecs. "Read it now"
 *   (POST /v1/content/inspect) reads the file with the person's settings and shows the result.
 *
 *   It reads nothing until it is opened, so a preview costs no request when nobody looks. While open
 *   it reads again on the change domain `contentclass` (onLiveUpdate); there is no timer. When the
 *   operator has turned content classes off, the open fold says so in one line.
 * @structure FileFacts({ file })
 * @usage html`<${FileFacts} file=${file} />`
 * @version-history
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
import { Action, Actions } from '/components/Action.js';
import { cc, itemRow, detailRows, readItemFacts, readOverview, readClasses, inspectItem } from '../data-wallet/content-facts.js';

const html = htm.bind(h);
const errText = (e) => e?.error?.message || e?.response?.error?.message || e?.message || cc('inspectFailed');

/**
 * @param {{ file: { key?: string, name?: string, owner_gaii?: string } }} props
 */
export function FileFacts({ file }) {
  const key = file.key || file.name;
  // An agent's file is named with its owner (the agent); the person's own file needs none.
  const owner = file.owner_gaii && file.owner_gaii.includes('#') ? file.owner_gaii : undefined;
  const [open, setOpen] = useState(false);
  // undefined: not read yet · null: nothing read from the file yet · object: its facts
  const [facts, setFacts] = useState(undefined);
  const [off, setOff] = useState(false);
  const [classes, setClasses] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const f = await readItemFacts(key, owner);
      setFacts(f);
      if (!f) {
        const o = await readOverview().catch((e) => { swallowed('file-facts: overview', e); return null; });
        setOff(!!o?.off);
      } else if (f.classes?.length) {
        setClasses(await readClasses().catch((e) => { swallowed('file-facts: classes', e); return []; }));
      }
    } catch (e) { swallowed('file-facts: facts', e); setFacts(null); }
  }, [key, owner]);

  useEffect(() => { if (open && facts === undefined) load(); }, [open, facts, load]);
  const again = useRef(null);
  again.current = () => { if (open) load(); };
  useEffect(() => onLiveUpdate(['contentclass'], () => again.current()), []);

  const readNow = async () => {
    setBusy(true); setMsg(null);
    try {
      const f = await inspectItem({ kind: 'file', key, ...(owner ? { owner } : {}) });
      if (f) setFacts(f);
      if (f?.classes?.length) setClasses(await readClasses().catch((e) => { swallowed('file-facts: classes', e); return []; }));
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
      ${action}`;
  }
  return html`
    <${Space} above="medium">
      <${Folds}>
        <${FoldRow} kind="toggle" name=${cc('fileFold')} open=${open} onToggle=${(next) => setOpen(next)} body=${html`<${Space} above="small">${body}<//>`} />
      <//>
    <//>`;
}

export default FileFacts;
