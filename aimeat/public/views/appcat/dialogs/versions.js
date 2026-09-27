/**
 * @file public/views/appcat/dialogs/versions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The versions dialog (features F139, F126, F127, F202): "App Versions {filename}", the
 *   help line, a status line ("Loading versions…", then "{n} versions stored · {first} – {last} · first
 *   to last: {duration}"), and one row per version, newest first: "v{n}" (+ "current" on the sun on
 *   the newest) with "{semver} · {KB} · {date-time} · since the previous one {duration}", and Open,
 *   Restore (not on the newest) and Fork. Open opens that version top level in a new tab (the owner's
 *   access code goes with it). Restore asks first, re-publishes that version as the newest, says
 *   "✔ Restored — now published as v{n}", reads the listing again and, 0.5 s later, this list. Fork
 *   opens the fork dialog, which comes back here with its result in the status line. Unguarded: Escape
 *   closes it (F176).
 * @structure default VersionsDialog({ owner, filename, manifest, status })
 * @usage openDialog('versions', { owner, filename })  — props: owner (the owner name the node files the
 *   app under), filename; manifest (optional: the listing's manifest, for Restore's name, descriptions,
 *   category, tags, extensions and icon; without it the store's listing row is read); app (optional:
 *   the listing row, when the store has none; its access_code opens the owner's coded app); status (optional
 *   { text, tone }: a line to show in place of the count, as the fork dialog's result); onDone
 *   (optional: called after a restore, e.g. the detail's reload).
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the filename after the title in the typewriter face (titleRef), the
 *     help and status lines in the old sizes and greys (a refusal in coral), the rows the old versions
 *     list (List tone 'releases').
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old detail.js showVersionsModal,
 *     restoreVersion and forkVersion.
 */
import { h } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Stack } from '/components/Layout.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { getSession } from '/js/services/auth.js';
import { useCatalog, reloadCatalog, notice } from '/views/appcat/store.js';
import { dateTime } from '/js/format.js';
import { x } from '/views/appcat/i18n.js';
import { Dialog, openDialog } from '/views/appcat/dialogs/host.js';
import { confirmAsk } from '/views/appcat/dialogs/confirm.js';
import { Status } from '/views/appcat/dialogs/parts.js';
import { appUrl, findRow, openPublished, restoreVersion, versionSinceText, versionSpanText } from '/views/appcat/dialogs/app-io.js';

const html = htm.bind(h);

export default function VersionsDialog({ owner, filename, manifest, app, status: given, onDone, close }) {
  const cat = useCatalog();
  const row = findRow(cat.all, owner, filename) || app || null;
  const [versions, setVersions] = useState(null);
  const [status, setStatus] = useState(given || { text: x('detail.loadingVersions'), tone: 'busy' });
  const keep = useRef(!!given);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const load = useCallback(async () => {
    if (!keep.current) setStatus({ text: x('detail.loadingVersions'), tone: 'busy' });
    try {
      const resp = await fetch(appUrl(owner, filename, 'versions'));
      if (!resp.ok) throw new Error(x('io.serverReturned', { status: resp.status }));
      const json = await resp.json();
      const list = (json.data && json.data.versions) || [];
      setVersions(list);
      if (keep.current) { keep.current = false; return; }
      setStatus(list.length
        ? { text: list.length + ' ' + x('versions.stored') + versionSpanText(list), tone: 'busy' }
        : { text: x('versions.none'), tone: 'busy' });
    } catch (e) {
      keep.current = false;
      setStatus({ text: '✘ ' + (e.message || x('versions.loadFailed')), tone: 'refused' });
    }
  }, [owner, filename]);
  useEffect(() => { load(); }, [load]);

  const restore = async (v) => {
    if (!(await confirmAsk(x('confirm.restoreVersion', { version: String(v), file: filename })))) return;
    if (!getSession()) { notice(x('versions.needSignIn')); return; }
    setStatus({ text: x('versions.restoring', { v }), tone: 'ok' });
    try {
      const data = await restoreVersion({ owner, filename, version: v, manifest: manifest || row?.manifest });
      setStatus({ text: '✔ ' + x('versions.restored', { n: data.version_number || '?' }), tone: 'ok' });
      reloadCatalog();
      onDone?.();
      timer.current = setTimeout(load, 500);
    } catch (e) {
      setStatus({ text: '✘ ' + (e.message || x('versions.restoreFailed')), tone: 'refused' });
    }
  };

  const fork = (v) => openDialog('fork', {
    owner, filename, version: v,
    back: { name: 'versions', props: { owner, filename, manifest, app, onDone } },
  });

  const rows = versions || [];
  return html`<${Dialog} title=${x('versions.title')} titleRef=${filename} size="lg"
    footer=${html`<${Action} onClick=${close}>${x('common.close')}<//>`}>
    <${Note} kind="caption">${x('versions.help')}<//>
    <${Stack} gap="small">
      <${Status} keep status=${status} />
      ${rows.length ? html`<${List} tone="releases">
        ${rows.map((v, i) => {
          const kb = v.size ? (Math.round(v.size / 102.4) / 10) + ' KB' : '';
          const when = v.created_at ? dateTime(v.created_at) : '';
          const sub = [v.version || '', kb, when].filter(Boolean).join(' · ') + versionSinceText(rows, i);
          const url = appUrl(owner, filename) + '?version=' + v.version_number + '&mode=inline';
          return html`<${Row} key=${v.version_number}>
            <${Name} meta=${sub} tag=${i === 0 ? html`<${Mark} tone="sun">${x('versions.current')}<//>` : null}>v${v.version_number}<//>
            <${Doors}>
              <${Action} small row onClick=${() => openPublished(url, row)}>${x('card.view')}<//>
              ${i === 0 ? null : html`<${Action} small row title=${x('versions.restoreHint')} onClick=${() => restore(v.version_number)}>${x('card.restore')}<//>`}
              <${Action} small row title=${x('versions.forkHint')} onClick=${() => fork(v.version_number)}>${x('card.fork')}<//>
            <//>
          <//>`;
        })}
      <//>` : null}
    <//>
  <//>`;
}
