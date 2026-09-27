/**
 * @file public/views/appcat/sections/versions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Versions" (features F312–F314, F127, F128): the published versions, the ones other
 *   people see. Over the list one line (how many, the days they cover, the sittings and about how
 *   long the work between publishes took: a sitting is a run of publishes under two hours apart), the
 *   "Publishes per day" chart (weeks past 120 days) and its caveat; then one row per version, newest
 *   first: "v{n}" ("current" on the newest), "{KB} · {date-time} · since the previous one {time}",
 *   and Open (a new tab, top level), Restore (not the newest: asked first, re-published as the
 *   newest, then the versions dialog opens on it half a second later, as the old page did) and Fork
 *   (the fork dialog). The server's newest number is adopted (F313), so "Publish as v{n+1}" is right
 *   after publishes made elsewhere. The list reads again after a publish from this page.
 *
 *   Decided in the parity pass (F360): the list is read under the app's owner (d.owner, F352), not
 *   under the signed-in person's own name as the old page did (which showed the viewer's same-named
 *   app, or none, on someone else's app). The versions are public, so it is read signed out too.
 *   Restore re-publishes a version as the newest one in the signed-in person's own account, so it is
 *   offered on the person's own app only; Open and Fork stand on every app.
 * @structure meta · VersionsSection({ d }) · sittingsOf(versions) · chartBars(stamps)
 * @usage loaded by the detail view: import('./sections/versions.js')
 * @version-history
 *   v1.2.0 — 2026-09-27 — Parity pass (sections-b): the chapter's lead, the span line and the caveat
 *     around the chart (SlotBars summary, caveat, fitAxis), the rows as the old version rows (List
 *     tone "history"), the small quiet line while loading or empty. Restore shows what the old page
 *     showed: the versions dialog opening on the new list, no notice and no status of its own; a
 *     failure is said (the old page wrote it where nobody saw it).
 *   v1.1.0 — 2026-09-27 — F360 decided: the list is read under the app's owner; Restore only on the
 *     person's own app.
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder A): the old catalogue's detail.js
 *     versionsHtml, detailLoadVersions, versionSpanHtml, versionChartHtml, versionSittings.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { apiGet } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { SlotBars } from '/components/SlotBars.js';
import { date, dateTime, calendar } from '/js/format.js';
import { x } from '/views/appcat/i18n.js';
import { useCatalog, reloadCatalog } from '/views/appcat/store.js';
import { appUrl, findRow, openPublished, restoreVersion, versionSinceText, durationLabel } from '/views/appcat/dialogs/app-io.js';
import { confirmAsk } from '/views/appcat/dialogs/confirm.js';
import { noticeKind } from '/views/appcat/sections/app-write.js';

const html = htm.bind(h);

export const meta = { id: 'versions', title: 'detail.versions', show: () => true };

const DAY = 24 * 60 * 60 * 1000;
/** One part, in the one-part chart's coral. */
const PARTS = [{ key: 'n', label: '', tone: 'coral' }];
const SITTING_GAP_MS = 2 * 60 * 60 * 1000;
/** A chart slot's key (the UTC midnight of a local calendar day) as that day, in the reader's format. */
const slotDay = (key) => calendar(new Date(key).toISOString().slice(0, 10));

/** The publish stamps, oldest first, and the sittings they make (a gap of two hours ends one). */
export function sittingsOf(versions) {
  const stamps = [];
  for (let i = versions.length - 1; i >= 0; i--) {
    const ms = versions[i].created_at ? Date.parse(versions[i].created_at) : NaN;
    if (isFinite(ms)) stamps.push(ms);
  }
  const out = [];
  let cur = null;
  for (const ms of stamps) {
    if (!cur || ms - cur.end > SITTING_GAP_MS) { cur = { start: ms, end: ms, n: 1 }; out.push(cur); } else { cur.end = ms; cur.n++; }
  }
  return { stamps, sittings: out };
}

/**
 * Publishes per day from the first day to the last (per week past 120 days), as SlotBars' slots:
 * { from, to, total, n, title } with the one part `n`; `title` is the bar's tooltip.
 */
export function chartBars(stamps) {
  const dayOf = (ms) => { const dt = new Date(ms); return Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()); };
  const counts = {};
  let first = Infinity;
  let last = -Infinity;
  for (const ms of stamps) {
    const dd = dayOf(ms);
    counts[dd] = (counts[dd] || 0) + 1;
    if (dd < first) first = dd;
    if (dd > last) last = dd;
  }
  if (!stamps.length) return { bars: [], max: 0, first: '', last: '' };
  const days = Math.round((last - first) / DAY) + 1;
  const bucket = days > 120 ? 7 : 1;
  const bars = [];
  let max = 0;
  for (let at = first; at <= last; at += DAY * bucket) {
    let n = 0;
    for (let b = 0; b < bucket; b++) n += counts[at + b * DAY] || 0;
    if (n > max) max = n;
    bars.push({ from: at, to: at, total: n, n, title: slotDay(at) + (bucket > 1 ? ' +' + (bucket - 1) : '') + ' · ' + x('versions.perDay', { n }) });
  }
  return { bars, max, first: slotDay(first), last: slotDay(last) };
}

/** The line over the list: count, days, sittings and the work between publishes. */
function spanLine(versions, stamps, sittings) {
  const parts = [versions.length + ' ' + x('versions.stored')];
  if (stamps.length) {
    const a = date(stamps[0]);
    const b = date(stamps[stamps.length - 1]);
    parts.push(a === b ? a : a + ' – ' + b);
  }
  if (sittings.length) {
    const worked = sittings.reduce((s, it) => s + (it.end - it.start), 0);
    const sit = x('versions.sittings', { n: sittings.length });
    const lab = durationLabel(worked);
    parts.push(lab ? sit + ', ' + x('versions.worked', { t: lab }) : sit);
  }
  return parts.join(' · ');
}

export default function VersionsSection({ d }) {
  const cat = useCatalog();
  const [versions, setVersions] = useState(null);
  // Under the app's owner (F360, decided: the old page used the signed-in name).
  const listOwner = d.owner || '';
  const { filename, versionsTick, setVersion } = d;

  useEffect(() => {
    if (!listOwner || !filename) { setVersions(null); return undefined; }
    let live = true;
    apiGet(appUrl(listOwner, filename, 'versions'))
      .then((j) => {
        if (!live) return;
        const list = (j && j.data && j.data.versions) || [];
        // The server's newest IS the current version: adopt it (F313).
        if (list.length && list[0].version_number) setVersion(list[0].version_number);
        setVersions(list);
      })
      // As on the old page, a list that cannot be read says "No published versions yet."
      .catch((err) => { void err; if (live) setVersions([]); });
    return () => { live = false; };
  }, [listOwner, filename, versionsTick, setVersion]);

  const restore = async (v) => {
    if (!(await confirmAsk(x('confirm.restoreVersion', { version: String(v), file: d.filename })))) return;
    if (!getSession()) { const t = x('versions.needSignIn'); d.notice(t, noticeKind(t)); return; }
    try {
      const row = findRow(cat.all, listOwner, d.filename);
      await restoreVersion({ owner: listOwner, filename: d.filename, version: v, manifest: row && row.manifest });
      // As on the old page, what the person sees is the versions dialog opening half a second later
      // on the list with the restored version at its top (the old page wrote its "✔ Restored" into
      // that dialog's status line, which the dialog's own count line replaced as it opened).
      reloadCatalog();
      d.bumpVersions();
      setTimeout(() => d.openDialog('versions', { owner: listOwner, filename: d.filename }), 500);
    } catch (err) {
      // The old page wrote a failure into the closed dialog, where nobody saw it; here it is said.
      d.notice('✘ ' + (err.message || x('versions.restoreFailed')), 'error');
    }
  };

  let body;
  if (versions === null) body = html`<${Note} kind="quiet" size="small">${x('detail.loadingVersions')}<//>`;
  else if (!versions.length) body = html`<${Note} kind="quiet" size="small">${x('detail.noVersions')}<//>`;
  else {
    const { stamps, sittings } = sittingsOf(versions);
    const chart = chartBars(stamps);
    const row = findRow(cat.all, listOwner, d.filename);
    body = html`
      <${SlotBars} summary=${spanLine(versions, stamps, sittings)} caveat=${x('versions.chartHint')} fitAxis
        title=${x('versions.chartTitle')} peak=${x('versions.chartMax', { n: chart.max })}
        bars=${chart.bars} parts=${PARTS} tip=${(bar) => bar.title} from=${chart.first} to=${chart.last} />
      <${List} tone="history" rows=${versions} render=${(v, i) => {
        const kb = v.size ? (Math.round(v.size / 102.4) / 10) + ' KB' : '';
        const when = v.created_at ? dateTime(v.created_at) : '';
        const url = appUrl(listOwner, d.filename) + '?version=' + v.version_number + '&mode=inline';
        return html`<${Row} key=${v.version_number}>
          <${Name} meta=${kb + (when ? ' · ' + when : '') + versionSinceText(versions, i)}
            tag=${i === 0 ? html`<${Mark} tone="sun">${x('versions.current')}<//>` : null}>v${v.version_number}${i === 0 ? ' ' : ''}<//>
          <${Doors}>
            <${Action} small row onClick=${() => openPublished(url, row)}>${x('card.view')}<//>
            ${i === 0 || !d.isOwn ? null : html`<${Action} small row onClick=${() => restore(v.version_number)}>${x('card.restore')}<//>`}
            <${Action} small row onClick=${() => d.openDialog('fork', { owner: listOwner, filename: d.filename, version: v.version_number })}>${x('card.fork')}<//>
          <//>
        <//>`;
      }} />`;
  }
  return html`<${Note} kind="lead" chapter>${x('versions.publishedHint')}<//>${body}`;
}
