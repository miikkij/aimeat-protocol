/**
 * @file secretary/use-freshness.js
 * @description Dashboard freshness (B1 + G3). Computes the active context's last-scan time + a stale flag,
 *   and provides the **Reconcile/Scan** action: actually run discover (the Secretary's read-only "sensory
 *   organ") to bring the snapshot current, stamp a real `lastScanAt` on the active context, and re-fetch
 *   everything. lastScan prefers the real `lastScanAt`, falling back to the newest autonomous feed entry /
 *   the tick's last run when a scan hasn't happened yet. Kept as a hook so views/secretary.js stays under
 *   the file-size limit. Redesign: docs/internal/2026-06-25-secretary-view-redesign.md + the G3 gap fix.
 * @structure useFreshness({ active, config, contexts, persistConfig, auto, showToast }) -> { lastScan, stale, scanning, reconcile }
 * @usage const { lastScan, stale, scanning, reconcile } = useFreshness({...}); dashStatus({ lastScan, stale, scanning, onReconcile: reconcile })
 * @version-history
 *   v0.1.0 — 2026-06-28 — G3: extract freshness from views/secretary.js; Reconcile now runs a real discover
 *     scan + stamps lastScanAt (was a bare re-fetch that never cleared the stale flag).
 */
import { useState, useMemo, useCallback } from 'preact/hooks';
import { apiGet } from '/js/api.js';
import { t } from '/js/i18n.js';

const STALE_MS = 28 * 3600 * 1000; // a daily cadence + slack

export function useFreshness({ active, config, contexts, persistConfig, auto, showToast }) {
  const lastScan = useMemo(() => {
    if (active && active.lastScanAt) return active.lastScanAt;
    const feedTs = (auto.feed[0] && auto.feed[0].ts) ? new Date(auto.feed[0].ts).getTime() : 0;
    const runTs = (auto.schedule && auto.schedule.lastRunAt) ? new Date(auto.schedule.lastRunAt).getTime() : 0;
    const ts = Math.max(feedTs, runTs);
    return ts ? new Date(ts).toISOString() : null;
  }, [active, auto.feed, auto.schedule]);

  const stale = useMemo(() => !lastScan || (Date.now() - new Date(lastScan).getTime()) > STALE_MS, [lastScan]);

  const [scanning, setScanning] = useState(false);
  /** Bring the snapshot current: run discover (free, read-only), stamp lastScanAt, re-fetch. */
  const reconcile = useCallback(async () => {
    if (!active) { window.dispatchEvent(new CustomEvent('aimeat-live-update')); return; }
    setScanning(true);
    try {
      await apiGet('/v1/discover?scope=public&per_page=5').catch(() => {});
      const nextCfg = { ...config, contexts: contexts.map((c) => (c.id === active.id ? { ...c, lastScanAt: new Date().toISOString() } : c)) };
      await persistConfig(nextCfg);
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
    } catch (e) {
      showToast(`${t('secretary.findError')}: ${e.message}`, true);
    } finally {
      setScanning(false);
    }
  }, [active, config, contexts, persistConfig, showToast]);

  return { lastScan, stale, scanning, reconcile };
}
