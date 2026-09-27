/**
 * @file public/views/appcat/dialogs/backup-import.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description appcat's "Import from backup" dialog (features F116, F117, F136, F137, F169,
 *   F242, F243, F271–F273): restoring a backup ZIP of the person's apps into their own account.
 *   - Reading: the picked ZIP goes to the node as it is (POST /v1/apps/backup/inspect,
 *     Content-Type application/zip), "Reading backup..." until it answers. The node checks every
 *     entry against the backup's own layout and refuses anything else (F271); its refusal is shown in
 *     red. Nothing is written by reading.
 *   - Choosing: where the backup came from and when; Select all / Select none; the line "Restoring:
 *     {n} apps, {n} versions[, {n} extensions]", which follows every tick; one row per app (its tick,
 *     name and filename, its version count with "versions ▾" unfolding one tick per version, and
 *     "new", or "exists" with what to do: Skip / Append versions / Import as copy); then the
 *     extensions, each with its tick, "new", or "exists" with Skip / Import as copy. Everything starts
 *     ticked. The ticks are the selection itself: an app counts when it is ticked and at least one of
 *     its versions is (F273).
 *   - Restore selected: "Nothing selected." when nothing is; else "Restoring..." and
 *     POST /v1/apps/backup/restore { backup_token, selections, extensions }, where an app lists its
 *     versions only when not all are ticked and says its conflict mode only when it exists. Then the
 *     result: "✔ Restore complete", the versions restored, and what was created, appended to,
 *     imported as a copy (from → to), skipped, and the errors in red; the lists are read again.
 * @structure BackupImportDialog({ file, close })
 * @usage openDialog('backup-import', { file })   (file: the picked .zip File)
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the status line holds its room at the top (red when refused), the
 *     source and summary lines in the old grey sizes, the table compact (DataTable compact), each
 *     state word over its conflict choice as the old cell had it.
 *   v1.0.0 — 2026-09-27 — Initial (appcat).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { DataTable } from '/components/DataTable.js';
import { Check } from '/components/Check.js';
import { Select } from '/components/Select.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { Row, Stack } from '/components/Layout.js';
import { Action, Loud } from '/components/Action.js';
import { apiPost } from '/js/api.js';
import { authHeaders } from '/js/services/auth.js';
import { dateTime, date } from '/js/format.js';
import { reloadCatalog } from '/views/appcat/store.js';
import { Dialog } from '/views/appcat/dialogs/host.js';
import { Status } from '/views/appcat/dialogs/parts.js';
import { x } from '/views/appcat/i18n.js';

const html = htm.bind(h);

/** The size of one version, as the old page wrote it. */
const size = (n) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');

/** Read the ZIP on the node. Resolves to the inspection, or throws with the node's words. */
async function inspect(file) {
  const buf = await file.arrayBuffer();
  const res = await fetch('/v1/apps/backup/inspect', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/zip' },
    body: buf,
  });
  const json = await res.json();
  if (!json.ok) throw new Error((json.error && (json.error.message || json.error.code)) || ('HTTP ' + res.status));
  return json.data;
}

/** The ticks, all on: per app its own tick and one per version; per extension its tick. */
function allTicks(d, on) {
  return {
    apps: d.apps.map(() => on),
    vers: d.apps.map((a) => a.versions.map(() => on)),
    exts: d.extensions.map(() => on),
  };
}

/** What the ticks select, in the shape the restore takes (F272), and the version count. */
function selection(d, ticks, conflicts, extConflicts) {
  const selections = [];
  const extensions = [];
  let versionTotal = 0;
  d.apps.forEach((app, i) => {
    if (!ticks.apps[i]) return;
    const chosen = app.versions.filter((_, v) => ticks.vers[i][v]).map((v) => v.version);
    if (chosen.length === 0) return;
    const sel = { filename: app.filename };
    if (chosen.length !== app.versions.length) sel.versions = chosen;
    if (app.exists) sel.conflict = conflicts[i] || 'skip';
    versionTotal += chosen.length;
    selections.push(sel);
  });
  d.extensions.forEach((ext, e) => {
    if (!ticks.exts[e]) return;
    const sel = { name: ext.name };
    if (ext.exists) sel.conflict = extConflicts[e] || 'skip';
    extensions.push(sel);
  });
  return { selections, extensions, versionTotal };
}

/** One list of the result, with its count; nothing when it is empty. */
function ResultList({ label, items, error }) {
  if (!items || items.length === 0) return null;
  const words = (it) => {
    if (typeof it === 'string') return it;
    if (it && it.from && it.to) return it.from + ' → ' + it.to;
    if (it && it.item) return it.item + ': ' + (it.message || '');
    return JSON.stringify(it);
  };
  // The old result list: its name bold at .85rem 8px under what is above, the items a bullet list
  // under it, the errors in red (Note report: its list rules are hint.css .note-report ul).
  return html`<${Note} kind="report" tone=${error ? 'err' : ''}>
    <strong>${label} (${items.length})</strong>
    <ul>${items.map((it, i) => html`<li key=${i}>${words(it)}</li>`)}</ul>
  <//>`;
}

export default function BackupImportDialog({ file, close }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState({ text: x('backup.inspecting') });
  const [ticks, setTicks] = useState({ apps: [], vers: [], exts: [] });
  const [open, setOpen] = useState(/** @type {Record<number, boolean>} */ ({}));
  const [conflicts, setConflicts] = useState(/** @type {Record<number, string>} */ ({}));
  const [extConflicts, setExtConflicts] = useState(/** @type {Record<number, string>} */ ({}));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    if (!file) { setStatus({ text: x('backup.nothingSelected'), error: true }); return undefined; }
    inspect(file).then(
      (d) => { if (!live) return; setData(d); setTicks(allTicks(d, true)); setStatus(null); },
      (err) => { if (live) setStatus({ text: err.message || String(err), error: true }); },
    );
    return () => { live = false; };
  }, [file]);

  const sel = data ? selection(data, ticks, conflicts, extConflicts) : null;

  const tickApp = (i, on) => setTicks((t) => ({ ...t, apps: t.apps.map((v, k) => (k === i ? on : v)) }));
  const tickVer = (i, v, on) => setTicks((t) => ({ ...t, vers: t.vers.map((row, k) => (k === i ? row.map((b, j) => (j === v ? on : b)) : row)) }));
  const tickExt = (e, on) => setTicks((t) => ({ ...t, exts: t.exts.map((v, k) => (k === e ? on : v)) }));

  async function restore() {
    if (!data || !sel) return;
    if (sel.selections.length === 0 && sel.extensions.length === 0) {
      setStatus({ text: x('backup.nothingSelected'), error: true });
      return;
    }
    setStatus({ text: x('backup.restoring') + '...' });
    setBusy(true);
    try {
      const res = await apiPost('/v1/apps/backup/restore', {
        backup_token: data.backup_token,
        selections: sel.selections,
        extensions: sel.extensions,
      });
      setStatus(null);
      setResult(res.data || {});
      reloadCatalog();
    } catch (err) {
      setStatus({ text: err.message || x('backup.restoreFailed'), error: true });
    } finally {
      setBusy(false);
    }
  }

  const conflictOptions = [['skip', x('backup.conflictSkip')], ['append', x('backup.conflictAppend')], ['copy', x('backup.conflictCopy')]];
  const extConflictOptions = [['skip', x('backup.conflictSkip')], ['copy', x('backup.conflictCopy')]];

  const statusMark = (exists) => html`<${Mark} kind="status" tone=${exists ? 'attention' : 'fine'}>${x(exists ? 'backup.statusExists' : 'backup.statusNew')}<//>`;

  const choosing = () => {
    if (data.apps.length === 0 && data.extensions.length === 0) return html`<${Note} kind="quiet">${x('backup.empty')}<//>`;
    const src = data.source || {};
    const rows = data.apps.map((app, i) => [
      html`<${Check} checked=${!!ticks.apps[i]} onChange=${(on) => tickApp(i, on)} ariaLabel=${app.name || app.filename} />`,
      html`${app.name || app.filename}<${Note} kind="meta" mono>${app.filename}<//>`,
      html`${app.versions.length} <${Action} tone="more" expanded=${!!open[i]}
          onClick=${() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>${x('backup.colVersions').toLowerCase()} ▾<//>
        ${open[i] ? html`<${Stack} gap="none">${app.versions.map((ver, v) => html`
          <${Check} key=${ver.version} checked=${!!(ticks.vers[i] && ticks.vers[i][v])} onChange=${(on) => tickVer(i, v, on)}>
            v${ver.version}${ver.semver ? ' (' + ver.semver + ')' : ''} · ${size(ver.size)}${ver.created_at ? ' · ' + date(ver.created_at) : ''}
          <//>`)}<//>` : null}`,
      app.exists
        ? html`${statusMark(true)}<br /><${Select} fit ariaLabel=${x('backup.colStatus')} value=${conflicts[i] || 'skip'}
            onChange=${(v) => setConflicts((c) => ({ ...c, [i]: v }))} options=${conflictOptions} />`
        : statusMark(false),
    ]);
    return html`
      <${Note} kind="caption">${x('backup.from')}: <${Note} kind="meta" inline mono>${(src.owner || '?') + '@' + (src.nodeId || '?')}<//>${data.exported_at ? ' · ' + dateTime(data.exported_at) : ''}<//>
      <${Row} wrap justify="between" above="small" below="small">
        <span>
          <${Action} tone="more" onClick=${() => setTicks(allTicks(data, true))}>${x('backup.selectAll')}<//> / <${Action} tone="more" onClick=${() => setTicks(allTicks(data, false))}>${x('backup.selectNone')}<//>
        </span>
        <${Note} kind="caption" size="medium">${x('backup.restoring')}: ${sel.selections.length} ${x('backup.sumApps')}, ${sel.versionTotal} ${x('backup.sumVersions')}${sel.extensions.length ? ', ' + sel.extensions.length + ' ' + x('backup.sumExts') : ''}<//>
      <//>
      <${DataTable} compact headers=${['', x('backup.colApp'), x('backup.colVersions'), x('backup.colStatus')]} rows=${rows} />
      ${data.extensions.length > 0 ? html`
        <${Stack} gap="tight" above="large">
          <${SubHeading}>${x('backup.extensions')}<//>
          ${data.extensions.map((ext, e) => html`
            <${Row} key=${ext.name} gap="small" wrap>
              <${Check} checked=${!!ticks.exts[e]} onChange=${(on) => tickExt(e, on)} ariaLabel=${ext.name} />
              <${Note} kind="meta" inline mono>${ext.name}<//>
              ${statusMark(ext.exists)}
              ${ext.exists ? html`<${Select} fit ariaLabel=${ext.name} value=${extConflicts[e] || 'skip'}
                onChange=${(v) => setExtConflicts((c) => ({ ...c, [e]: v }))} options=${extConflictOptions} />` : null}
            <//>`)}
        <//>` : null}`;
  };

  const done = (s) => html`
    <${SubHeading} level=${3}>✔ ${x('backup.resultTitle')}<//>
    <${Note} kind="report">${x('backup.resVersions')}: ${s.versions_restored ?? 0}<//>
    <${ResultList} label=${x('backup.resCreated')} items=${[...(s.apps_created || []), ...(s.extensions_created || [])]} />
    <${ResultList} label=${x('backup.resAppended')} items=${s.apps_appended} />
    <${ResultList} label=${x('backup.resCopied')} items=${[...(s.apps_copied || []), ...(s.extensions_copied || [])]} />
    <${ResultList} label=${x('backup.resSkipped')} items=${[...(s.apps_skipped || []), ...(s.extensions_skipped || [])]} />
    <${ResultList} label=${x('backup.resErrors')} items=${s.errors} error />`;

  const canRestore = !!data && !result && (data.apps.length > 0 || data.extensions.length > 0);
  const footer = html`
    <${Action} onClick=${close}>${x('common.close')}<//>
    ${canRestore ? html`<${Loud} control disabled=${busy} onClick=${restore}>${x('backup.restore')}<//>` : null}`;

  return html`<${Dialog} title=${x('backup.title')} size="lg" onClose=${close} footer=${footer}>
    <${Status} keep status=${status ? { text: status.text, tone: status.error ? 'err' : 'busy' } : null} />
    ${result ? done(result) : data ? choosing() : null}
  <//>`;
}
