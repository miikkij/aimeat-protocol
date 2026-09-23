/**
 * @file database-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Database page in the poster face (design canvas "AIMEAT Admin
 *   Database"): the live row count beside the seven-day line the hourly snapshots were already
 *   carrying, the hour/day/week numerals, and the tables with a share of all rows, a bar and a
 *   day's growth, ordered by size, by growth or by name. "Capture a snapshot now" forces one.
 *   Re-fetches on the aimeat-live-update event like the other server-data tabs.
 * @structure
 *   - snapshotAt(snaps, hoursAgo) -- newest snapshot at or before now-hoursAgo (baseline for a delta)
 *   - signed(n)                   -- +N / -N / 0 as text
 *   - Line({ series })            -- the seven-day line, the shared chart; its tooltip reads a point
 *   - DatabaseTab (default)       -- the two sections, and the wait state before the second snapshot
 * @version-history
 *   v2.2.0 -- 2026-09-22 -- Composed from the shared component set: sections, a numeral band, the
 *     toolbar for the search and the three orders, the tables as a shared table with a progress
 *     meter, and the line drawn by the shared chart; the page's own sheet is gone.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v2.1.0 -- 2026-09-13 -- Compose shared B1 headings; table ratios use SVG width data.
 *   v2.0.0 -- 2026-09-12 -- The poster face. The cards become two sections; the 168 hourly
 *     snapshots the page already fetched are drawn as a line instead of three numbers; "relative
 *     size" (rows, measured against the biggest table, with no number) becomes a share of all rows
 *     with the bar beside it; the list can be ordered by growth, which is a different order from
 *     size and the one an operator is looking for; and before the second snapshot the deltas read
 *     as absent rather than as zero.
 *   v1.2.0 -- 2026-08-17 -- Two defects found while the Metrics tab was built from this file as
 *     the model. (1) Root wrapper is a plain div: class="adm" is the dashboard SHELL's flex-row
 *     class, so the nested copy laid this tab out as one horizontal row of full-height columns
 *     (delta cards pushed off-screen). (2) `load` depended on useToast's unstable showErr, so
 *     every fetch re-ran the load effect: a continuous ~25 req/s poll whenever the tab was open.
 *   v1.1.0 -- 2026-07-16 -- Total-rows card sub-line shows the memory-table composition
 *     (version-history + archived row counts) when the server reports them.
 *   v1.0.0 -- 2026-07-16 -- Initial: live counts, hour/24h/7d totals, per-table 24h growth.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, dt, Spinner, Empty, useToast, Toast } from './shared.js';
import { Section, Columns, Stack, Text, Action, NumeralBand, Toolbar, Table, Meter, Surface } from '/components/poster-parts.js';
import { UsageChart, colorForIndex } from '/components/UsageChart.js';
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

/**
 * The row count over the snapshots the page holds: one series, drawn by the shared chart. Its
 * tooltip reads the point under the cursor (the time and the count), which the hand-drawn line
 * showed in a box of its own.
 */
function Line({ series }) {
  const datasets = [{
    label: D('chartLabel'),
    data: series.map(p => p.v),
    borderColor: colorForIndex(0),
    backgroundColor: colorForIndex(0),
    pointRadius: 0,
    borderWidth: 2,
  }];
  return html`<${UsageChart} type="line" labels=${series.map(p => dt(p.at))} datasets=${datasets}
    height=${160} legend=${false} yFormat=${(v) => num(Math.round(v))} />`;
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

  const cell = (value, label, sub) => ({ label, value, note: sub });

  return html`
    <div>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Section} title=${D('sizeTitle')} count="01"
        actions=${html`<${Action} onClick=${capture} disabled=${capturing}>${capturing ? D('capturing') : D('captureNow')}<//>`}>
        <${Columns} layout="trailing" collapse=${900} density="roomy">
          <${Stack} density="compact">
            <${Text} kind="label">${D('heroLabel')}<//>
            <${Text} kind="number" size="large">${num(current.totalRows)}<//>
            ${/* The two memory numbers count rows INSIDE the Memory table, so they say so: printed
                  bare under "rows, all tables" they read as counts of the whole database. */ ''}
            <${Text} kind="mono" tone="muted">${num(current.tableCount)} ${D('tables')}<//>
            ${current.memoryVersionRows !== undefined && current.memoryArchivedRows !== undefined
    ? html`<${Text} kind="mono" tone="muted">${D('memoryComposition', { v: num(current.memoryVersionRows), a: num(current.memoryArchivedRows) })}<//>`
    : null}
          <//>

          ${series.length > 1 ? html`
            <${Stack} density="compact">
              <${Stack} direction="wrap" align="between">
                <${Text} kind="label">${D('chartLabel')}<//>
                <${Text} kind="mono" tone="muted">${D('chartRange', { n: num(snapshots.length) })}<//>
              <//>
              <${Line} series=${series} />
              <${Stack} direction="wrap" align="between">
                <${Text} kind="mono" tone="muted">${num(series[0].v)} · ${dt(series[0].at)}<//>
                <${Text} kind="mono" tone="muted">${num(current.totalRows)} · ${D('chartNow')}<//>
              <//>
            <//>
          ` : html`
            <${Surface} kind="box" density="roomy">
              <${Stack}>
                <${Text} kind="heading" size="small">${D('waitTitle')}<//>
                <${Text}>${D('waitBody')}<//>
                <${Stack} direction="wrap" align="center">
                  <${Action} onClick=${capture} disabled=${capturing}>
                    ${capturing ? D('capturing') : D('captureNow')}
                  <//>
                <//>
                <${Text} kind="mono" tone="muted">${D('waitHourly')}<//>
              <//>
            <//>
          `}
        <//>

        ${/* The snapshot count is what this page ASKED for (a week of hourly readings), not what the
              store holds: the job keeps thirty days. The label says which. */ ''}
        <${NumeralBand} tone="plain" size="small" items=${[
    cell(signed(totalDelta(base1h)), D('lastHour'), base1h ? D('subHour') : D('noBaseline')),
    cell(signed(totalDelta(base24h)), D('lastDay'), base24h ? D('subDay') : D('noBaseline')),
    cell(signed(week),
      weekBase ? D('lastWeek') : D('sinceFirst'),
      weekPct !== null ? D('subWeek', { pct: weekPct })
        : base7d ? D('subSinceFirst', { when: dt(base7d.capturedAt) }) : D('noBaseline')),
    cell(num(snapshots.length), D('snapshots'), D('subSnapshots')),
  ]} />
      <//>

      <${Section} title=${D('whereTitle')} count="02" description=${byGrowth ? D('leadGrowth') : D('leadSize')}>
        <${Toolbar} label=${D('whereTitle')}
          search=${{ ariaLabel: D('findPlaceholder'), placeholder: D('findPlaceholder'), value: find, onInput: e => setFind(e.target.value) }}
          filters=${[
    { id: 'biggest', label: D('orderBiggest'), selected: order === 'biggest', onClick: () => setOrder('biggest') },
    { id: 'growth', label: D('orderGrowth'), selected: order === 'growth', onClick: () => setOrder('growth') },
    { id: 'az', label: D('orderAz'), selected: order === 'az', onClick: () => setOrder('az') },
  ]} />

        ${/* A table that scrolls on a phone rather than stacking: stacked, each of 150 tables took
              five lines. */ ''}
        <${Table} density="compact" label=${D('whereTitle')}
          headers=${[D('table'), D('rows'), D('colDay'), D('colShare'), '']}
          rows=${rows.map(r => [
    { text: r.table, mono: true },
    { text: num(r.n), align: 'end' },
    { text: signed(r.delta), align: 'end' },
    { text: shareOf(r), align: 'end' },
    html`<${Meter} kind="progress" value=${barOf(r)} max=${100} label=${shareOf(r)} />`,
  ])} />

        <${Stack} direction="wrap" align="between">
          <${Text} kind="caption" tone="muted">${D('shown', { n: num(rows.length), total: num(current.tableCount) })}${
  byGrowth && stillCount > 0 ? ' ' + D('stillCount', { n: num(stillCount) }) : ''}<//>
          <${Text} kind="mono" tone="muted">${byGrowth ? D('noteGrowth') : D('noteSize')}<//>
        <//>
      <//>
    </div>
  `;
}
