/**
 * @file src/storage/providers/sqlite/methods/system.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/system.ts (systemMethods), so a fix
 *   in one provider finds its twin by file name. Bodies moved verbatim from the files named in the version
 *   history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure systemMethods
 * @usage Object.assign(SqliteStorage.prototype, systemMethods) in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-10-09 — setNodeKey seals the private key and getNodeKey opens it
 *     (storage/node-key-at-rest.ts), the same as postgres-kysely (secrets audit 2026-10-09, S4a).
 *   v1.0.0 — 2026-10-05 — setNodeKey, getNodeKey moved here from work.ts; getMaintenanceMode,
 *     setMaintenanceMode moved here from identity-nodes.ts; supportsConfigPersistence, setConfigValue,
 *     deleteConfigValue, getAllConfigValues moved here from apps.ts; 9 methods (flushStats, loadStats,
 *     flushDailyHistory, …) moved here from capability-agents.ts so the file mirrors
 *     postgres-kysely/methods/system.ts (secaudit 2026-10, M8).
 */
import type { MaintenanceState, StorageStatsSnapshot } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import { sealNodePrivateKey, openNodePrivateKey, isSealedNodeKey } from '../../../node-key-at-rest.js';

export const systemMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Node Key ──
  // ══════════════════════════════════════════════════════════

  // The private key is sealed on write and opened on read (storage/node-key-at-rest.ts), so every
  // caller keeps receiving the plain key; `sealed` says which form the row is in.
  async setNodeKey(this: SqliteStorage, publicKey: string, privateKey: string): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO node_key (id, publicKey, privateKey) VALUES (1, ?, ?)`
    ).run(publicKey, sealNodePrivateKey(privateKey, publicKey));
  },

  async getNodeKey(this: SqliteStorage): Promise<{ publicKey: string; privateKey: string; sealed: boolean } | null> {
    const row = this.db.prepare('SELECT * FROM node_key WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!row) return null;
    const stored = row.privateKey as string;
    return { publicKey: row.publicKey as string, privateKey: openNodePrivateKey(stored, row.publicKey as string), sealed: isSealedNodeKey(stored) };
  },

  // ══════════════════════════════════════════════════════════
  // ── Maintenance Mode ──
  // ══════════════════════════════════════════════════════════

  async getMaintenanceMode(this: SqliteStorage): Promise<MaintenanceState> {
    const row = this.db.prepare('SELECT * FROM maintenance WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!row) {
      return { enabled: false, message: '', enabledAt: null, enabledBy: null };
    }
    return {
      enabled: (row.enabled as number) === 1,
      message: row.message as string,
      enabledAt: (row.enabledAt as string) ?? null,
      enabledBy: (row.enabledBy as string) ?? null,
    };
  },

  async setMaintenanceMode(this: SqliteStorage, state: MaintenanceState): Promise<MaintenanceState> {
    this.db.prepare(
      `INSERT OR REPLACE INTO maintenance (id, enabled, message, enabledAt, enabledBy) VALUES (1, ?, ?, ?, ?)`
    ).run(
      state.enabled ? 1 : 0, state.message,
      state.enabledAt, state.enabledBy,
    );
    return state;
  },

  // ══════════════════════════════════════════════════════════
  // ── Config Persistence ──
  // ══════════════════════════════════════════════════════════

  supportsConfigPersistence(this: SqliteStorage): boolean {
    // In-memory SQLite (:memory:) does not persist across restarts
    return this.db.name !== ':memory:';
  },

  async setConfigValue(this: SqliteStorage, key: string, value: string): Promise<void> {
    this.db.prepare(`
      INSERT INTO system_settings (key, value, updatedAt) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now')
    `).run(`config:${key}`, value);
  },

  async deleteConfigValue(this: SqliteStorage, key: string): Promise<void> {
    this.db.prepare('DELETE FROM system_settings WHERE key = ?').run(`config:${key}`);
  },

  async getAllConfigValues(this: SqliteStorage): Promise<Record<string, string>> {
    const rows = this.db.prepare("SELECT key, value FROM system_settings WHERE key LIKE 'config:%'").all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const r of rows) result[r.key.replace('config:', '')] = r.value;
    return result;
  },

  // ── Stats Persistence ──

  async flushStats(this: SqliteStorage, counters: Record<string, number>): Promise<void> {
    const upsert = this.db.prepare(
      `INSERT INTO stats_counters (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    const tx = this.db.transaction((entries: [string, number][]) => {
      for (const [key, value] of entries) {
        upsert.run(key, value);
      }
    });
    tx(Object.entries(counters));
  },

  async loadStats(this: SqliteStorage): Promise<Record<string, number>> {
    const rows = this.db.prepare('SELECT key, value FROM stats_counters').all() as Array<{ key: string; value: number }>;
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  },

  async flushDailyHistory(this: SqliteStorage, history: Record<string, Record<string, number>>): Promise<void> {
    const upsert = this.db.prepare(
      `INSERT INTO stats_daily_history (date, key, value) VALUES (?, ?, ?)
       ON CONFLICT(date, key) DO UPDATE SET value = excluded.value`
    );
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const tx = this.db.transaction((entries: [string, Record<string, number>][]) => {
      for (const [date, counters] of entries) {
        for (const [key, value] of Object.entries(counters)) {
          upsert.run(date, key, value);
        }
      }
      this.db.prepare('DELETE FROM stats_daily_history WHERE date < ?').run(cutoffStr);
    });
    tx(Object.entries(history));
  },

  async loadDailyHistory(this: SqliteStorage): Promise<Record<string, Record<string, number>>> {
    const rows = this.db.prepare('SELECT date, key, value FROM stats_daily_history ORDER BY date').all() as Array<{ date: string; key: string; value: number }>;
    const result: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      if (!result[row.date]) result[row.date] = {};
      result[row.date][row.key] = row.value;
    }
    return result;
  },

  // ── Storage-size telemetry (operator DB tab) ──
  async getTableRowCounts(this: SqliteStorage): Promise<Record<string, number>> {
    const tables = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as Array<{ name: string }>;
    const counts: Record<string, number> = {};
    for (const { name } of tables) {
      // Table names come from sqlite_master (not user input); quote defensively for odd names.
      const row = this.db.prepare(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as { n: number };
      counts[name] = row.n;
    }
    return counts;
  },
  async getMemoryRowBreakdown(this: SqliteStorage): Promise<{ versionRows: number; archivedRows: number }> {
    // One aggregate over the memory table — no values loaded. `.version.N` history + archived rows
    // both inflate the table invisibly; the admin DB tab shows the composition.
    const row = this.db.prepare(
      `SELECT
         SUM(CASE WHEN key LIKE '%.version.%' THEN 1 ELSE 0 END) AS v,
         SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END) AS a
       FROM memory`
    ).get() as { v: number | null; a: number | null };
    return { versionRows: row.v ?? 0, archivedRows: row.a ?? 0 };
  },
  async saveStorageStatsSnapshot(this: SqliteStorage, s: StorageStatsSnapshot): Promise<void> {
    this.db.prepare(
      `INSERT INTO storage_stats_snapshots (id, capturedAt, counts, totalRows) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET capturedAt = excluded.capturedAt, counts = excluded.counts, totalRows = excluded.totalRows`
    ).run(s.id, s.capturedAt, JSON.stringify(s.counts), s.totalRows);
  },
  async listStorageStatsSnapshots(this: SqliteStorage, opts?: { limit?: number; sinceIso?: string }): Promise<StorageStatsSnapshot[]> {
    let sql = 'SELECT id, capturedAt, counts, totalRows FROM storage_stats_snapshots';
    const params: unknown[] = [];
    if (opts?.sinceIso) { sql += ' WHERE capturedAt >= ?'; params.push(opts.sinceIso); }
    sql += ' ORDER BY capturedAt DESC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    const rows = this.db.prepare(sql).all(...params) as Array<{ id: string; capturedAt: string; counts: string; totalRows: number }>;
    return rows.map(r => ({ id: r.id, capturedAt: r.capturedAt, counts: JSON.parse(r.counts) as Record<string, number>, totalRows: r.totalRows }));
  },
  async pruneStorageStatsSnapshots(this: SqliteStorage, beforeIso: string): Promise<number> {
    return this.db.prepare('DELETE FROM storage_stats_snapshots WHERE capturedAt < ?').run(beforeIso).changes;
  },
};
