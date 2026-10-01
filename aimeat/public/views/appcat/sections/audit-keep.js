/**
 * @file public/views/appcat/sections/audit-keep.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Keeping the audit log, under the entries of the "Audit log" section: what is kept (all
 *   by default, or the newest N of each app's log), the archived years with their entries on demand,
 *   "Archive entries before <date>", and the owner's own limit. Nothing is deleted unless the owner
 *   sets a number here, and that asks first. The node holds the rules (services/app-audit-archive.ts,
 *   routes/apps/legal.ts); this draws them and calls GET .../audit?archive=, POST .../audit/archive and
 *   PUT /v1/audit/apps/settings.
 * @structure AuditKeep({ d, st }) · ArchiveYear
 * @usage html`<${AuditKeep} d=${d} st=${st} />`   // from sections/audit.js
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (IAM round 2 leftover 7).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Select } from '/components/Select.js';
import { TextField } from '/components/TextField.js';
import { Fields } from '/components/Field.js';
import { List, Row, Name, When, Who, Doors } from '/components/List.js';
import { apiGet, apiPost, apiPut } from '/js/api.js';
import { confirmAsk } from '/views/appcat/dialogs/confirm.js';
import { x } from '/views/appcat/i18n.js';
import { dateText, errorText, noticeKind } from '/views/appcat/sections/app-write.js';
import { reloadLegal } from '/views/appcat/sections/legal-state.js';

const html = htm.bind(h);
const SHOW = 25;
/**
 * The last answer per app. The section reads the log again after an archive or a new limit and draws
 * this part afresh, so a notice kept in component state would vanish with the read it caused.
 */
const notices = new Map();
/** A count in words: the singular key when it is one. */
const counted = (key, n, vars = {}) => (n === 1 ? x(key + '1', vars) : x(key, { ...vars, n }));

function base(d) { return '/v1/apps/' + encodeURIComponent(d.owner) + '/' + encodeURIComponent(d.filename); }

/** One archived year: its count, and its entries newest first once asked for. */
function ArchiveYear({ d, year, count, actWords }) {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState('');
  async function show() {
    if (rows) { setRows(null); return; }
    try {
      const res = await apiGet(base(d) + '/audit?archive=' + encodeURIComponent(year));
      setRows(((res && res.data && res.data.entries) || []).slice().reverse());
      setFailed('');
    } catch (err) { setFailed(x('audit.failed', { why: errorText(err) })); }
  }
  return html`
    <${Row}>
      <${Name}>${counted('audit.archiveYear', count, { year })}<//>
      <${Doors}><${Action} small onClick=${show}>${rows ? x('audit.archiveHide') : x('audit.archiveShow')}<//><//>
    <//>
    ${failed ? html`<${Note} kind="message" error>${failed}<//>` : null}
    ${rows ? html`<${List} tone="log" cols="when-name-who">${rows.slice(0, SHOW).map((e, i) => html`<${Row} key=${i}>
      <${When}>${dateText(e.at)}<//><${Name}>${actWords(e)}<//><${Who}>${e.by}<//>
    <//>`)}<//>` : null}`;
}

export default function AuditKeep({ d, st, actWords }) {
  const keep = (st.audit.keep && st.audit.keep.keep) || 0;
  const source = (st.audit.keep && st.audit.keep.source) || 'node';
  const archives = st.audit.archives || [];
  const [before, setBefore] = useState('');
  const [mode, setMode] = useState(keep > 0 ? 'n' : 'all');
  const [count, setCount] = useState(keep > 0 ? String(keep) : '1000');
  const ref = d.owner + '/' + d.filename;
  const [notice, setNoticeState] = useState(() => notices.get(ref) || '');
  const setNotice = (text) => { notices.set(ref, text); setNoticeState(text); };
  const [busy, setBusy] = useState(false);

  async function archive() {
    if (!before) return;
    setBusy(true);
    try {
      const res = await apiPost(base(d) + '/audit/archive', { before });
      const n = (res && res.data && res.data.moved) || 0;
      setNotice(n ? counted('audit.archiveDone', n) : x('audit.archiveNothing'));
      reloadLegal(d.owner, d.filename);
    } catch (err) { setNotice(x('audit.failed', { why: errorText(err) })); }
    setBusy(false);
  }

  async function saveKeep() {
    const n = Number(count);
    const value = mode === 'all' ? 'all' : n;
    if (mode === 'n') {
      if (!Number.isInteger(n) || n < 1) return;
      // A limit deletes the older entries now. Ask first, in words that say so.
      if (!(await confirmAsk(x('audit.keepConfirm')))) return;
    }
    setBusy(true);
    try {
      const res = await apiPut('/v1/audit/apps/settings', { keep: value });
      const deleted = (res && res.data && res.data.deleted) || 0;
      setNotice(deleted ? counted('audit.keepDeleted', deleted) : x('audit.keepSaved'));
      reloadLegal(d.owner, d.filename);
    } catch (err) { setNotice(x('audit.failed', { why: errorText(err) })); }
    setBusy(false);
  }

  // The shape of the page's other forms (marks.js, legal.js): a part heading, the state in a line,
  // then one narrow column of fields with its button inside it, the button a control-sized Loud.
  return html`
    <${SubHeading} level=${4} part="apart">${x('audit.keepTitle')}<//>
    <${Note} kind="hint" chapter>${keep > 0 ? counted('audit.keepN', keep) : x('audit.keepAll')}${source === 'node' && keep > 0 ? ' ' + x('audit.keepNode') : ''}<//>
    <${Fields} plain column narrow>
      <${Select} label=${x('audit.keepLabel')} value=${mode} onChange=${setMode}
        options=${[['all', x('audit.keepOptAll')], ['n', x('audit.keepOptN')]]} />
      ${mode === 'n' ? html`<${TextField} type="number" min="1" step="1" label=${x('audit.keepCount')} value=${count} onInput=${setCount} />` : null}
      <${Actions} chapter><${Loud} control onClick=${saveKeep} disabled=${busy}>${x('audit.keepSave')}<//><//>
    <//>

    <${SubHeading} level=${4} part="apart">${x('audit.archiveTitle')}<//>
    ${archives.length
      ? html`<${List} cols="name-doors">${archives.slice().reverse().map((a) => html`<${ArchiveYear} key=${a.year} d=${d} year=${a.year} count=${a.entries} actWords=${actWords} />`)}<//>`
      : html`<${Note} kind="hint" chapter>${x('audit.archiveNone')}<//>`}
    <${Fields} plain column narrow>
      <${TextField} type="date" label=${x('audit.archiveBefore')} value=${before} onInput=${setBefore} />
      <${Actions} chapter><${Loud} control onClick=${archive} disabled=${busy || !before}>${x('audit.archiveGo')}<//><//>
    <//>
    ${notice ? html`<${Note} kind="message" error=${noticeKind(notice) === 'error'}>${notice}<//>` : null}`;
}
