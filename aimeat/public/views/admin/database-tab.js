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
 *   - Line({ points, onPick })    -- the seven-day line with a reading under the cursor
 *   - DatabaseTab (default)       -- the two sections, and the wait state before the second snapshot
 * @version-history
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
import { useViewCSS } from '/components/useViewCSS.js';
import { num, dt, Spinner, Empty, useToast, Toast } from './shared.js';
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

const W = 720, H = 160;

/**
 * The row count over the snapshots the page holds: one series, one hue, one recessive midline.
 * The cursor reads the point nearest to it; the newest point is marked, because "where we are now"
 * is the one value a person looks for first.
 */
function Line({ series, at, onPick }) {
  const lo = Math.min(...series.map(p => p.v));
  const hi = Math.max(...series.map(p => p.v));
  const span = Math.max(1, hi - lo);
  // The newest point carries a 3px tick, so the series stops two units short of the right edge
  // and the tick is not sliced in half by the viewBox.
  const x = i => (series.length < 2 ? W - 2 : (i / (series.length - 1)) * (W - 2));
  const y = v => H - 12 - ((v - lo) / span) * (H - 24);
  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const pick = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / Math.max(1, box.width);
    onPick(Math.min(series.length - 1, Math.max(0, Math.round(rel * (series.length - 1)))));
  };
  const cur = at != null ? series[at] : null;
  return html`
    <div class="adm-db-chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label=${D('chartLabel')}>
        <line class="adm-db-mid" x1="0" y1=${H / 2} x2=${W} y2=${H / 2} vector-effect="non-scaling-stroke" />
        <text class="adm-db-midlabel" x="4" y=${H / 2 - 5}>${num(Math.round(lo + span / 2))}</text>
        <polyline class="adm-db-line" points=${points} vector-effect="non-scaling-stroke" />
        ${cur ? html`<line class="adm-db-cursor" x1=${x(at)} y1="0" x2=${x(at)} y2=${H} vector-effect="non-scaling-stroke" />` : null}
        ${/* The box scales to its column, so a circle would draw as an ellipse: the newest point
              is a tick whose stroke does not scale. */ ''}
        <line class="adm-db-dot" x1=${x(series.length - 1)} y1=${y(series[series.length - 1].v) - 7}
          x2=${x(series.length - 1)} y2=${y(series[series.length - 1].v) + 7} vector-effect="non-scaling-stroke" />
        <rect class="adm-db-hit" x="0" y="0" width=${W} height=${H}
          onMouseMove=${pick} onMouseLeave=${() => onPick(null)} />
      </svg>
      ${cur ? html`<span class="adm-db-read">${dt(cur.at)} · ${num(cur.v)}</span>` : null}
    </div>`;
}

export default function DatabaseTab() {
  useViewCSS('/css/views/admin-database.css');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [toast, showErr, showOk, clearToast] = useToast();
  const [find, setFind] = useState('');
  const [order, setOrder] = useState('biggest');
  const [at, setAt] = useState(null);

  // useToast returns fresh function identities every render; reached through a ref so `load`
  // stays stable. With showErr as a dependency every completed fetch re-rendered, rebuilt
  // `load`, re-ran the load effect and fetched again — a continuous poll measured at about
  // 25 requests/s while this tab was open.
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

  const cell = (value, label, sub, dim) => html`
    <div class=${dim ? 'adm-db-strip-dim' : ''}><b>${value}</b><span>${label}</span><small>${sub}</small></div>`;
  const chip = (id, label) => html`
    <button type="button" class="adm-db-chip ${order === id ? 'on' : ''}" onClick=${() => setOrder(id)}>${label}</button>`;

  return html`
    <div class="og adm-db">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <section class="og-sec og-sec--first">
        <div class="og-sec-h"><h2>${D('sizeTitle')}<small>01</small></h2>
          <div class="og-doors">
            <button type="button" class="og-door" onClick=${capture} disabled=${capturing}>
              ${capturing ? D('capturing') : D('captureNow')}
            </button>
          </div></div>

        <div class="adm-db-top">
          <div>
            <div class="adm-db-lbl">${D('heroLabel')}</div>
            <div class="adm-db-hero">${num(current.totalRows)}</div>
            ${/* The two memory numbers count rows INSIDE the Memory table, so they say so: printed
                  bare under "rows, all tables" they read as counts of the whole database. */ ''}
            <p class="adm-db-hero-sub">
              <b>${num(current.tableCount)}</b> ${D('tables')}<br />
              ${current.memoryVersionRows !== undefined && current.memoryArchivedRows !== undefined
    ? D('memoryComposition', { v: num(current.memoryVersionRows), a: num(current.memoryArchivedRows) })
    : null}
            </p>
          </div>

          ${series.length > 1 ? html`
            <div>
              <div class="adm-db-chart-h">
                <span class="adm-db-lbl">${D('chartLabel')}</span>
                <small>${D('chartRange', { n: num(snapshots.length) })}</small>
              </div>
              <${Line} series=${series} at=${at} onPick=${setAt} />
              <div class="adm-db-x">
                <span>${num(series[0].v)} · ${dt(series[0].at)}</span>
                <span>${num(current.totalRows)} · ${D('chartNow')}</span>
              </div>
            </div>
          ` : html`
            <div class="adm-db-wait">
              <h3>${D('waitTitle')}</h3>
              <p>${D('waitBody')}</p>
              <button class="adm-btn" onClick=${capture} disabled=${capturing}>
                ${capturing ? D('capturing') : D('captureNow')}
              </button>
              <small>${D('waitHourly')}</small>
            </div>
          `}
        </div>

        <div class="og-strip">
          ${cell(signed(totalDelta(base1h)), D('lastHour'), base1h ? D('subHour') : D('noBaseline'), !base1h)}
          ${cell(signed(totalDelta(base24h)), D('lastDay'), base24h ? D('subDay') : D('noBaseline'), !base24h)}
          ${cell(signed(week),
    weekBase ? D('lastWeek') : D('sinceFirst'),
    weekPct !== null ? D('subWeek', { pct: weekPct })
      : base7d ? D('subSinceFirst', { when: dt(base7d.capturedAt) }) : D('noBaseline'),
    week === null)}
          ${/* The count is what this page ASKED for (a week of hourly readings), not what the
                store holds: the job keeps thirty days. The label says which. */ ''}
          ${cell(num(snapshots.length), D('snapshots'), D('subSnapshots'))}
        </div>
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${D('whereTitle')}<small>02</small></h2></div>
        <p class="adm-db-lead">${byGrowth ? D('leadGrowth') : D('leadSize')}</p>

        <div class="adm-db-tools">
          <div class="adm-db-find">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="M16 16 L21 21"></path></svg>
            <input type="text" value=${find} onInput=${e => setFind(e.target.value)} placeholder=${D('findPlaceholder')} />
          </div>
          <div class="adm-db-chips">
            ${chip('biggest', D('orderBiggest'))}
            ${chip('growth', D('orderGrowth'))}
            ${chip('az', D('orderAz'))}
          </div>
        </div>

        <div class="adm-db-rows">
          <div class="adm-db-hrow">
            <span>${D('table')}</span><span class="r">${D('rows')}</span>
            <span class="r">${D('colDay')}</span><span class="r">${D('colShare')}</span><span></span>
          </div>
          ${rows.map(r => html`
            <div class="adm-db-row" key=${r.table}>
              <span class="adm-db-name">${r.table}</span>
              <span class="adm-db-n r">${num(r.n)}</span>
              <span class="adm-db-d r">${signed(r.delta)}</span>
              <span class="adm-db-pct r">${shareOf(r)}</span>
              <span class="adm-db-share"><i style=${`width:${barOf(r).toFixed(1)}%`}></i></span>
            </div>`)}
        </div>

        <div class="adm-db-foot">
          <span>${D('shown', { n: num(rows.length), total: num(current.tableCount) })}${
  byGrowth && stillCount > 0 ? ' ' + D('stillCount', { n: num(stillCount) }) : ''}</span>
          <span class="adm-db-note">${byGrowth ? D('noteGrowth') : D('noteSize')}</span>
        </div>
      </section>
    </div>
  `;
}
