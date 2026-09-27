/**
 * @file public/views/appcat/sections/history.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Working-copy history" (features F304, F303): every save leaves the bytes it replaced
 *   here as a checkpoint in the owner's private memory, at most eight, newest first; each row says
 *   when and before what ("before: {note}", or "before an edit") and how big, and offers Preview (the
 *   sandboxed viewer, the working copy untouched), Restore (asked first; the current working copy is
 *   checkpointed before it is replaced, so it can be undone) and Delete (asked first). Restore and
 *   Delete wait while one of them runs. These are private; the published versions below are the ones
 *   other people see.
 * @structure meta · HistorySection({ d })
 * @usage loaded by the detail view: import('./sections/history.js')
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity (sections-a): the chapter's lead, the rows as the old checkpoint rows
 *     (List tone "checkpoints"), the small quiet line while loading or empty.
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder A): the old catalogue's detail.js historyHtml
 *     and detailCheckpointRows / Preview / Restore / Delete.
 */
import { h } from 'preact';
import htm from 'htm';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { dateTime } from '/js/format.js';
import { x } from '/views/appcat/i18n.js';
import { checkpointPreview, checkpointRestore, checkpointDelete } from '/views/appcat/detail-state.js';

const html = htm.bind(h);

export const meta = { id: 'history', title: 'wc.history', show: (d) => !!(d && d.published) };

export default function HistorySection({ d }) {
  const w = d.work;
  const list = w.checkpoints;
  let body;
  if (list === null) {
    body = html`<${Note} kind="quiet" size="small" inline>…<//>`;
  } else if (!list.length) {
    body = html`<${Note} kind="quiet" size="small" inline>${x('wc.none')}<//>`;
  } else {
    body = html`<${List} tone="checkpoints" rows=${list} render=${(c) => {
      const when = c.at ? dateTime(c.at) : '';
      const kb = c.size ? (Math.round(c.size / 102.4) / 10) + ' KB' : '';
      const note = c.note ? x('wc.before', { note: c.note }) : x('wc.beforeUnnamed');
      return html`<${Row} key=${c.id}>
        <${Name} meta=${note + (kb ? ' · ' + kb : '')}>${when}<//>
        <${Doors}>
          <${Action} small row onClick=${() => checkpointPreview(c.id, d.meta.name)}>${x('wc.preview')}<//>
          <${Loud} control disabled=${w.ckBusy} onClick=${() => checkpointRestore(c.id)}>${x('wc.restore')}<//>
          <${Action} small row disabled=${w.ckBusy} onClick=${() => checkpointDelete(c.id)}>${x('wc.delete')}<//>
        <//>
      <//>`;
    }} />`;
  }
  return html`<${Note} kind="lead" chapter>${x('wc.historyHint')}<//>${body}`;
}
