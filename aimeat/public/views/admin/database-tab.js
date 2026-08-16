/**
 * @file database-tab.js
 * @description Admin dashboard Database tab — operator storage-growth telemetry. Shows the LIVE per-table
 *   row counts (backend-specific server-side), the total + how it changed over the last hour / 24h / 7d
 *   (derived from the hourly snapshots the storage-stats core job captures), and a per-table table with a
 *   relative-size bar and a 24h growth delta. A "Capture now" button forces a snapshot. Re-fetches on the
 *   aimeat-live-update event like the other server-data tabs.
 * @structure
 *   - snapshotAt(snaps, hoursAgo) -- newest snapshot at or before now-hoursAgo (baseline for a delta)
 *   - Delta                       -- +N / -N with up/down colour
 *   - DatabaseTab (default)       -- summary cards + capture button + per-table counts table
 * @version-history
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
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, StatCard, Spinner, Empty, useToast, Toast } from './shared.js';
import * as api from '/js/services/admin.js';

/** The newest snapshot captured at or before (now - hoursAgo), or null if none that old. */
function snapshotAt(snaps, hoursAgo) {
  const cutoff = Date.now() - hoursAgo * 3600_000;
  // snaps are newest-first; the first one older than the cutoff is the best baseline.
  return snaps.find(s => new Date(s.capturedAt).getTime() <= cutoff) ?? null;
}

/** Signed delta with colour: positive = grew (up), negative = shrank (down), 0 = muted. */
function Delta({ value }) {
  if (value === null || value === undefined) return html`<span class="adm-delta-zero">—</span>`;
  const cls = value > 0 ? 'adm-delta-up' : value < 0 ? 'adm-delta-down' : 'adm-delta-zero';
  const sign = value > 0 ? '+' : '';
  return html`<span class=${cls}>${sign}${num(value)}</span>`;
}

export default function DatabaseTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [toast, showErr, showOk, clearToast] = useToast();

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
    try { await api.captureStorageSnapshot(); showOk(t('admin.database.captured')); await load(); }
    catch (e) { showErr(e.message); }
    finally { setCapturing(false); }
  }, [load, showOk, showErr]);

  if (loading && !data) return html`<${Spinner} text=${t('admin.database.loading')} />`;
  if (!data) return html`<${Empty} text=${t('admin.database.empty')} />`;

  const { current, snapshots } = data;
  const counts = current.counts || {};
  const base1h = snapshotAt(snapshots, 1);
  const base24h = snapshotAt(snapshots, 24);
  const base7d = snapshotAt(snapshots, 24 * 7) ?? snapshots[snapshots.length - 1] ?? null;
  const totalDelta = base => (base ? current.totalRows - base.totalRows : null);

  // Per-table rows, largest first, with a 24h delta and a relative-size bar.
  const baseCounts = base24h?.counts || {};
  const maxCount = Math.max(1, ...Object.values(counts));
  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([table, n]) => ({ table, n, delta: baseCounts[table] === undefined ? null : n - baseCounts[table], pct: Math.round((n / maxCount) * 100) }));

  return html`<div>
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <div class="adm-section-head">
      <div>
        <div class="section-title">${t('admin.database.title')}</div>
        <div class="section-desc">${t('admin.database.desc')}</div>
      </div>
      <button class="btn-outline" onClick=${capture} disabled=${capturing}>
        ${capturing ? t('admin.database.capturing') : t('admin.database.captureNow')}
      </button>
    </div>

    <div class="adm-grid adm-grid-4">
      <${StatCard} label=${t('admin.database.totalRows')} value=${current.totalRows}
        sub=${`${num(current.tableCount)} ${t('admin.database.tables')}`
          + (current.memoryVersionRows !== undefined ? ` · ${num(current.memoryVersionRows)} ${t('admin.database.memoryVersionRows')}` : '')
          + (current.memoryArchivedRows !== undefined ? ` · ${num(current.memoryArchivedRows)} ${t('admin.database.memoryArchivedRows')}` : '')} />
      <div class="adm-card">
        <h2>${t('admin.database.lastHour')}</h2>
        <div class="adm-stat"><${Delta} value=${totalDelta(base1h)} /></div>
        <div class="adm-stat-label">${base1h ? t('admin.database.rowsDelta') : t('admin.database.noBaseline')}</div>
      </div>
      <div class="adm-card">
        <h2>${t('admin.database.last24h')}</h2>
        <div class="adm-stat"><${Delta} value=${totalDelta(base24h)} /></div>
        <div class="adm-stat-label">${base24h ? t('admin.database.rowsDelta') : t('admin.database.noBaseline')}</div>
      </div>
      <div class="adm-card">
        <h2>${t('admin.database.last7d')}</h2>
        <div class="adm-stat"><${Delta} value=${totalDelta(base7d)} /></div>
        <div class="adm-stat-label">${num(snapshots.length)} ${t('admin.database.snapshots')}</div>
      </div>
    </div>

    <div class="adm-card">
      <table class="adm-db-table">
        <thead>
          <tr>
            <th>${t('admin.database.table')}</th>
            <th class="num">${t('admin.database.rows')}</th>
            <th class="num">${t('admin.database.delta24h')}</th>
            <th>${t('admin.database.relSize')}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => html`<tr key=${r.table}>
            <td>${r.table}</td>
            <td class="num">${num(r.n)}</td>
            <td class="num"><${Delta} value=${r.delta} /></td>
            <td><div class="adm-db-bar-track"><div class="adm-db-bar" style=${`width:${r.pct}%`}></div></div></td>
          </tr>`)}
        </tbody>
      </table>
    </div>
  </div>`;
}
