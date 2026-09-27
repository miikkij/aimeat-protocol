/**
 * @file database-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Database page in the poster face (design canvas "AIMEAT Admin
 *   Database"): the live row count beside the seven-day line the hourly snapshots were already
 *   carrying, the hour/day/week numerals, and the tables with a share of all rows, a bar and a
 *   day's growth, ordered by size, by growth or by name. "Capture a snapshot now" forces one.
 *   Re-fetches on the aimeat-live-update event like the other server-data tabs. The page draws
 *   library components only and writes no class (admin page group G3).
 * @structure
 *   - snapshotAt(snaps, hoursAgo) -- newest snapshot at or before now-hoursAgo (baseline for a delta)
 *   - signed(n)                   -- +N / -N / 0 as text
 *   - Headline                    -- the row count in the poster face, and what it is made of
 *   - Waiting                     -- the box before the second snapshot, with the capture action
 *   - DatabaseTab (default)       -- the two sections
 * @version-history
 *   v3.0.0 -- 2026-09-27 -- Library components only: Section, Beside with the TrendLine, FigureStrip,
 *     SearchLine and the filter Tabs, the tables as a List with the share Meter, Box for the wait;
 *     admin-database.css goes. The line (formerly Line here) is components/TrendLine.js.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v2.1.0 -- 2026-09-13 -- Compose shared B1 headings; table ratios use SVG width data.
 *   v2.0.0 -- 2026-09-12 -- The poster face. The cards become two sections; the 168 hourly
 *     snapshots the page already fetched are drawn as a line instead of three numbers; "relative
 *     size" (rows, measured against the biggest table, with no number) becomes a share of all rows
 *     with the bar beside it; the list can be ordered by growth, which is a different order from
 *     size and the one an operator is looking for; and before the second snapshot the deltas read
 *     as absent rather than as zero.
 *   v1.2.0 -- 2026-08-17 -- Two defects found while the Metrics tab was built from this file as
 *     the model. (1) Root wrapper is a plain div: the class .adm is the dashboard SHELL's flex-row
 *     class, so the nested copy laid this tab out as one horizontal row of full-height columns
 *     (delta cards pushed off-screen). (2) `load` depended on useToast's unstable showErr, so
 *     every fetch re-ran the load effect: a continuous ~25 req/s poll whenever the tab was open.
 *   v1.1.0 -- 2026-07-16 -- Total-rows card sub-line shows the memory-table composition
 *     (version-history + archived row counts) when the server reports them.
 *   v1.0.0 -- 2026-07-16 -- Initial: live counts, hour/24h/7d totals, per-table 24h growth.
 */
import { h, Fragment } from 'preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, dt, Spinner, Empty, useToast, Toast } from './shared.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure, Tinted, Meter } from '/components/Figure.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Loud } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { SubHeading } from '/components/SubHeading.js';
import { Tabs } from '/components/Tabs.js';
import { List, Row as ListRow, Name, Num, Cell, SearchLine } from '/components/List.js';
import { Row, Stack, Beside } from '/components/Layout.js';
import { TrendLine } from '/components/TrendLine.js';
import * as api from '/js/services/admin.js';

const D = (key, params) => t('admin.database.' + key, params);

/** The newest snapshot captured at or before (now - hoursAgo), or null if none that old. */
function snapshotAt(snaps, hoursAgo) {
  const cutoff = Date.now() - hoursAgo * 3600_000;
  // snaps are newest-first; the first one older than the cutoff is the best baseline.
  return snaps.find(s => new Date(s.capturedAt).getTime() <= cutoff) ?? null;
}

/** A delta as text. A dash means there was no snapshot that far back — not a zero. */
function signed(n) {
  if (n === null || n === undefined) return '—';
  return (n > 0 ? '+' : '') + num(n);
}

/** The row count in the poster face, and what it is made of. */
function Headline({ current }) {
  return html`
    <${Stack} gap="none">
      <${Label} block>${D('heroLabel')}<//>
      <${Figure} large n=${num(current.totalRows)} />
      ${/* The two memory numbers count rows INSIDE the Memory table, so they say so: printed
            bare under "rows, all tables" they read as counts of the whole database. */ ''}
      <${Stack} gap="none" above="small">
        <${Note} kind="meta" mono><${Tinted} strong>${num(current.tableCount)}<//> ${D('tables')}<//>
        ${current.memoryVersionRows !== undefined && current.memoryArchivedRows !== undefined
    ? html`<${Note} kind="meta" mono>${D('memoryComposition', { v: num(current.memoryVersionRows), a: num(current.memoryArchivedRows) })}<//>`
    : null}
      <//>
    <//>`;
}

/** Before the second snapshot there is nothing to subtract, and the page says so. */
function Waiting({ capturing, onCapture }) {
  return html`
    <${Box} tone="dim">
      <${Stack} gap="medium">
        <${SubHeading} level=${3}>${D('waitTitle')}<//>
        <${Note} kind="lead">${D('waitBody')}<//>
        <${Row}><${Loud} control onClick=${onCapture} disabled=${capturing}>${capturing ? D('capturing') : D('captureNow')}<//><//>
        <${Note} kind="meta" mono>${D('waitHourly')}<//>
      <//>
    <//>`;
}

export default function DatabaseTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [toast, showErr, showOk, clearToast] = useToast();
  const [find, setFind] = useState('');
  const [order, setOrder] = useState('biggest');

  // This ref kept `load` stable before useToast memoized its callbacks. Previously every
  // completed fetch rebuilt `load` and re-ran the effect, measured at about 25 requests/s.
  const showErrRef = useRef(showErr);
  showErrRef.current = showErr;

  const load = useCallback(async () => {
    try {
      const res = await api.getStorageStats(168);   // up to 7 days of hourly snapshots
      setData(res.data);
    } catch (e) { showErrRef.current(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const capture = useCallback(async () => {
    setCapturing(true);
    try { await api.captureStorageSnapshot(); showOk(D('captured')); await load(); }
    catch (e) { showErr(e.message); }
    finally { setCapturing(false); }
  }, [load, showOk, showErr]);

  const current = data?.current;
  const snapshots = data?.snapshots;

  // Oldest first, with the live count as the last point: the line ends where the hero number is.
  const series = useMemo(() => {
    if (!current || !snapshots) return [];
    const past = [...snapshots].reverse().map(s => ({ at: s.capturedAt, v: s.totalRows }));
    return [...past, { at: current.capturedAt, v: current.totalRows }];
  }, [current, snapshots]);

  const rows = useMemo(() => {
    if (!current) return [];
    const counts = current.counts || {};
    const base24h = snapshotAt(snapshots || [], 24);
    const baseCounts = base24h?.counts || {};
    const total = Math.max(1, current.totalRows);
    const all = Object.entries(counts).map(([table, n]) => ({
      table, n,
      delta: base24h && baseCounts[table] !== undefined ? n - baseCounts[table] : null,
      share: (n / total) * 100,
    }));
    const q = find.trim().toLowerCase();
    const shown = q ? all.filter(r => r.table.toLowerCase().includes(q)) : all;
    if (order === 'az') shown.sort((a, b) => a.table.localeCompare(b.table));
    else if (order === 'growth') shown.sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
    else shown.sort((a, b) => b.n - a.n);
    return shown;
  }, [current, snapshots, find, order]);

  if (loading && !data) return html`<${Spinner} text=${D('loading')} />`;
  if (!data || !current) return html`<${Empty} text=${D('empty')} />`;

  const base1h = snapshotAt(snapshots, 1);
  const base24h = snapshotAt(snapshots, 24);
  // A week's growth needs a week-old snapshot. Without one the oldest reading is still worth
  // showing, but it is not "last week": a node two hours old read +10700 % against its own first
  // snapshot under that label.
  const weekBase = snapshotAt(snapshots, 24 * 7);
  const oldest = snapshots.length > 1 ? snapshots[snapshots.length - 1] : null;
  const base7d = weekBase ?? oldest;
  const totalDelta = base => (base ? current.totalRows - base.totalRows : null);
  const week = totalDelta(base7d);
  const weekPct = weekBase && week !== null && weekBase.totalRows ? ((week / weekBase.totalRows) * 100).toFixed(1) : null;

  // The bar is drawn against the biggest value in the ORDER being shown, so the small rows stay
  // readable; the number beside it is the share of the whole, which is the honest reading.
  const growthTotal = rows.reduce((a, r) => a + Math.max(0, r.delta ?? 0), 0);
  const maxN = Math.max(1, ...rows.map(r => r.n));
  const maxD = Math.max(1, ...rows.map(r => Math.max(0, r.delta ?? 0)));
  const byGrowth = order === 'growth';
  const barOf = r => (byGrowth ? (Math.max(0, r.delta ?? 0) / maxD) : (r.n / maxN)) * 100;
  const shareOf = (r) => {
    if (!byGrowth) return r.share.toFixed(1) + ' %';
    if (!r.delta || r.delta <= 0 || growthTotal <= 0) return '—';
    return ((r.delta / growthTotal) * 100).toFixed(1) + ' %';
  };
  const stillCount = rows.filter(r => !r.delta).length;

  // The line's midline marks the value half way between its lowest and highest reading.
  const values = series.map(p => p.v);
  const lo = values.length ? Math.min(...values) : 0;
  const span = values.length ? Math.max(1, Math.max(...values) - lo) : 1;

  /** A strip figure; `dim` when there is nothing to measure yet, which reads as absent, not zero. */
  const cell = (key, value, label, sub, dim) => ({ key, n: value, label, sub, tone: dim ? 'dim' : undefined });

  return html`
    <${Fragment}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Section} first num="01" title=${D('sizeTitle')}
        doors=${html`<${Action} small onClick=${capture} disabled=${capturing}>${capturing ? D('capturing') : D('captureNow')}<//>`}>
        <${Beside} start narrow side=${html`<${Headline} current=${current} />`}>
          ${series.length > 1 ? html`
            <${TrendLine} label=${D('chartLabel')} note=${D('chartRange', { n: num(snapshots.length) })}
              points=${values} mid=${num(Math.round(lo + span / 2))}
              readAt=${(i) => `${dt(series[i].at)} · ${num(series[i].v)}`}
              ends=${[`${num(series[0].v)} · ${dt(series[0].at)}`, `${num(current.totalRows)} · ${D('chartNow')}`]} />
          ` : html`<${Waiting} capturing=${capturing} onCapture=${capture} />`}
        <//>

        <${FigureStrip} wrap items=${[
    cell('hour', signed(totalDelta(base1h)), D('lastHour'), base1h ? D('subHour') : D('noBaseline'), !base1h),
    cell('day', signed(totalDelta(base24h)), D('lastDay'), base24h ? D('subDay') : D('noBaseline'), !base24h),
    cell('week', signed(week),
      weekBase ? D('lastWeek') : D('sinceFirst'),
      weekPct !== null ? D('subWeek', { pct: weekPct })
        : base7d ? D('subSinceFirst', { when: dt(base7d.capturedAt) }) : D('noBaseline'),
      week === null),
    // The count is what this page ASKED for (a week of hourly readings), not what the store
    // holds: the job keeps thirty days. The label says which.
    cell('snapshots', num(snapshots.length), D('snapshots'), D('subSnapshots')),
  ]} />
      <//>

      <${Section} num="02" title=${D('whereTitle')}>
        <${Note} kind="lead">${byGrowth ? D('leadGrowth') : D('leadSize')}<//>

        <${Row} wrap justify="between" align="end">
          <${SearchLine} beside find text value=${find} onInput=${e => setFind(e.target.value)}
            placeholder=${D('findPlaceholder')} />
          <${Tabs} tone="filter" value=${order} onSelect=${setOrder} items=${[
    { value: 'biggest', label: D('orderBiggest') },
    { value: 'growth', label: D('orderGrowth') },
    { value: 'az', label: D('orderAz') },
  ]} />
        <//>

        <${List} cols="name-n-n-n-bar" labels head=${[
    D('table'), { label: D('rows'), num: true }, { label: D('colDay'), num: true }, { label: D('colShare'), num: true }, '',
  ]}>
          ${rows.map(r => html`
            <${ListRow} key=${r.table}>
              <${Name} code>${r.table}<//>
              <${Num}>${num(r.n)}<//>
              <${Num} quiet>${signed(r.delta)}<//>
              <${Num} quiet>${shareOf(r)}<//>
              <${Cell}><${Meter} thin pct=${barOf(r)} /><//>
            <//>`)}
        <//>

        <${Row} wrap justify="between" align="baseline" above="medium">
          <${Note} kind="meta" inline>${D('shown', { n: num(rows.length), total: num(current.tableCount) })}${
  byGrowth && stillCount > 0 ? ' ' + D('stillCount', { n: num(stillCount) }) : ''}<//>
          <${Note} kind="meta" inline mono>${byGrowth ? D('noteGrowth') : D('noteSize')}<//>
        <//>
      <//>
    <//>
  `;
}
