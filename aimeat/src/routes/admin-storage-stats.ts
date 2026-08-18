/**
 * @file admin-storage-stats.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operator storage-growth telemetry for the admin Database tab. Serves the LIVE per-table
 *   row counts (so the current picture is always fresh) plus the recent hourly snapshots captured by the
 *   `storage-stats-snapshot` core job, from which the frontend derives per-table growth over time. The
 *   per-table count is backend-specific (pg_stat estimate on Postgres, count(*) on SQLite, collection
 *   counts on Mongo) — this route only reads the generic Storage surface. Operator-only.
 * @version-history
 *   v1.1.0 -- 2026-07-16 -- current gains memoryVersionRows + memoryArchivedRows (memory-table
 *     composition: workspace `.version.N` history + archived rows — the invisible inflators).
 *   v1.0.0 -- 2026-07-16 -- Initial: GET /v1/admin/storage-stats (live counts + snapshot timeline).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export function adminStorageStatsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/admin/storage-stats?limit=168 — live counts + recent snapshots (newest first).
  router.get('/v1/admin/storage-stats', requireAuth(), requireRole('operator'), async (req, res) => {
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '168', 10) || 168, 1), 1000);
    try {
      const [counts, snapshots, memory] = await Promise.all([
        storage.getTableRowCounts(),
        storage.listStorageStatsSnapshots({ limit }),
        // Composition of the memory table: `.version.N` workspace history + archived rows — the two
        // invisible inflators the retention window / archive flags produce.
        storage.getMemoryRowBreakdown(),
      ]);
      const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
      res.json(success(config.nodeId, {
        current: {
          capturedAt: new Date().toISOString(), counts, totalRows, tableCount: Object.keys(counts).length,
          memoryVersionRows: memory.versionRows, memoryArchivedRows: memory.archivedRows,
        },
        snapshots,   // newest first: [{ id, capturedAt, counts, totalRows }]
      }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'STORAGE_STATS_FAILED', `Could not read storage stats: ${(err as Error).message}`));
    }
  });

  // POST /v1/admin/storage-stats/snapshot — capture one snapshot now (the hourly job also does this).
  router.post('/v1/admin/storage-stats/snapshot', requireAuth(), requireRole('operator'), async (_req, res) => {
    try {
      const { runStorageStatsSnapshotJob } = await import('../services/core-jobs.js');
      await runStorageStatsSnapshotJob(storage);
      const [latest] = await storage.listStorageStatsSnapshots({ limit: 1 });
      res.json(success(config.nodeId, { captured: latest ?? null }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'STORAGE_STATS_FAILED', `Could not capture snapshot: ${(err as Error).message}`));
    }
  });

  return router;
}
