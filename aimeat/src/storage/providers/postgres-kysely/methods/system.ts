/**
 * @file src/storage/providers/postgres-kysely/methods/system.ts
 * @description Node-wide system methods for the Postgres+Kysely backend: config persistence, maintenance
 *   mode, the node keypair, and the stats counters/daily-history — the group the server touches during
 *   boot (config-init) and the stats flusher. Translated 1:1 from the Prisma implementations against the
 *   same tables (SystemSetting keyed `config:*` / `maintenance`, NodeKey, StatsCounter, StatsDailyHistory).
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: startup/system domain on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { MaintenanceState, StorageStatsSnapshot } from '../../../interface.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

export const systemMethods = {
  // ── Config persistence (SystemSetting, key `config:<dotPath>`) ──
  supportsConfigPersistence(this: PostgresKyselyStorage): boolean { return true; },

  async getConfigValue(this: PostgresKyselyStorage, key: string): Promise<string | null> {
    const r = await this.db.selectFrom('SystemSetting').select('value').where('key', '=', `config:${key}`).executeTakeFirst();
    return r?.value ?? null;
  },

  async setConfigValue(this: PostgresKyselyStorage, key: string, value: string): Promise<void> {
    await this.db.insertInto('SystemSetting').values({ key: `config:${key}`, value })
      .onConflict(oc => oc.column('key').doUpdateSet({ value })).execute();
  },

  async deleteConfigValue(this: PostgresKyselyStorage, key: string): Promise<void> {
    await this.db.deleteFrom('SystemSetting').where('key', '=', `config:${key}`).execute();
  },

  async getAllConfigValues(this: PostgresKyselyStorage): Promise<Record<string, string>> {
    const rows = await this.db.selectFrom('SystemSetting').select(['key', 'value']).where('key', 'like', 'config:%').execute();
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key.replace('config:', '')] = r.value;
    return out;
  },

  // ── Maintenance mode (SystemSetting key `maintenance`) ──
  async getMaintenanceMode(this: PostgresKyselyStorage): Promise<MaintenanceState> {
    const r = await this.db.selectFrom('SystemSetting').select('value').where('key', '=', 'maintenance').executeTakeFirst();
    return r ? JSON.parse(r.value) as MaintenanceState : { enabled: false, message: '', enabledAt: null, enabledBy: null };
  },

  async setMaintenanceMode(this: PostgresKyselyStorage, state: MaintenanceState): Promise<MaintenanceState> {
    const value = JSON.stringify(state);
    await this.db.insertInto('SystemSetting').values({ key: 'maintenance', value })
      .onConflict(oc => oc.column('key').doUpdateSet({ value })).execute();
    return state;
  },

  // ── Node keypair (single-row NodeKey) ──
  async setNodeKey(this: PostgresKyselyStorage, publicKey: string, privateKey: string): Promise<void> {
    const existing = await this.db.selectFrom('NodeKey').select('id').executeTakeFirst();
    if (existing) await this.db.updateTable('NodeKey').set({ publicKey, privateKey }).where('id', '=', existing.id).execute();
    else await this.db.insertInto('NodeKey').values({ publicKey, privateKey }).execute();
  },

  async getNodeKey(this: PostgresKyselyStorage): Promise<{ publicKey: string; privateKey: string } | null> {
    const r = await this.db.selectFrom('NodeKey').selectAll().executeTakeFirst();
    return r ? { publicKey: r.publicKey, privateKey: r.privateKey } : null;
  },

  // ── Stats counters + daily history ──
  async flushStats(this: PostgresKyselyStorage, counters: Record<string, number>): Promise<void> {
    for (const [id, value] of Object.entries(counters)) {
      await this.db.insertInto('StatsCounter').values({ id, value })
        .onConflict(oc => oc.column('id').doUpdateSet({ value })).execute();
    }
  },

  async loadStats(this: PostgresKyselyStorage): Promise<Record<string, number>> {
    const rows = await this.db.selectFrom('StatsCounter').selectAll().execute();
    const out: Record<string, number> = {};
    for (const r of rows) out[r.id] = r.value;
    return out;
  },

  async flushDailyHistory(this: PostgresKyselyStorage, history: Record<string, Record<string, number>>): Promise<void> {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    for (const [date, counters] of Object.entries(history)) {
      for (const [key, value] of Object.entries(counters)) {
        await this.db.insertInto('StatsDailyHistory').values({ date, key, value })
          .onConflict(oc => oc.columns(['date', 'key']).doUpdateSet({ value })).execute();
      }
    }
    await this.db.deleteFrom('StatsDailyHistory').where('date', '<', cutoffStr).execute();
  },

  async loadDailyHistory(this: PostgresKyselyStorage): Promise<Record<string, Record<string, number>>> {
    const rows = await this.db.selectFrom('StatsDailyHistory').selectAll().orderBy('date', 'asc').execute();
    const out: Record<string, Record<string, number>> = {};
    for (const r of rows) { (out[r.date] ??= {})[r.key] = r.value; }
    return out;
  },

  // ── Storage-size telemetry (operator DB tab) ──
  async getTableRowCounts(this: PostgresKyselyStorage): Promise<Record<string, number>> {
    // Exact count(*) per table in ONE round-trip (a UNION ALL). pg_stat's n_live_tup is instant but an
    // estimate that reads 0 until autovacuum analyses (e.g. right after a bulk load) — wrong for an
    // operator's accounting tool. Once an hour, a scan per table is an acceptable price for correct numbers.
    const tbls = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_kysely_migrations'
    `.execute(this.db);
    if (tbls.rows.length === 0) return {};
    const union = tbls.rows
      .map(r => `SELECT '${r.table_name.replace(/'/g, "''")}' AS t, count(*)::bigint AS n FROM "${r.table_name.replace(/"/g, '""')}"`)
      .join(' UNION ALL ');
    const res = await sql<{ t: string; n: string }>`${sql.raw(union)}`.execute(this.db);
    const counts: Record<string, number> = {};
    for (const r of res.rows) counts[r.t] = Number(r.n);
    return counts;
  },
  async getMemoryRowBreakdown(this: PostgresKyselyStorage): Promise<{ versionRows: number; archivedRows: number }> {
    // One aggregate over the Memory table — no values loaded. `.version.N` history + archived rows
    // both inflate the table invisibly; the admin DB tab shows the composition.
    const res = await sql<{ v: string | null; a: string | null }>`
      SELECT count(*) FILTER (WHERE "key" LIKE '%.version.%')::bigint AS v,
             count(*) FILTER (WHERE "archived")::bigint AS a
      FROM "Memory"`.execute(this.db);
    const r = res.rows[0];
    return { versionRows: Number(r?.v ?? 0), archivedRows: Number(r?.a ?? 0) };
  },
  async saveStorageStatsSnapshot(this: PostgresKyselyStorage, s: StorageStatsSnapshot): Promise<void> {
    await this.db.insertInto('StorageStatsSnapshot').values({
      id: s.id, capturedAt: new Date(s.capturedAt), counts: jsonb(s.counts), totalRows: s.totalRows,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).onConflict(oc => oc.column('id').doUpdateSet({ capturedAt: new Date(s.capturedAt), counts: jsonb(s.counts), totalRows: s.totalRows } as never)).execute();
  },
  async listStorageStatsSnapshots(this: PostgresKyselyStorage, opts?: { limit?: number; sinceIso?: string }): Promise<StorageStatsSnapshot[]> {
    let q = this.db.selectFrom('StorageStatsSnapshot').selectAll();
    if (opts?.sinceIso) q = q.where('capturedAt', '>=', new Date(opts.sinceIso));
    q = q.orderBy('capturedAt', 'desc');
    if (opts?.limit) q = q.limit(opts.limit);
    const rows = await q.execute();
    return rows.map(r => ({
      id: r.id, capturedAt: (r.capturedAt instanceof Date ? r.capturedAt : new Date(r.capturedAt)).toISOString(),
      counts: (r.counts ?? {}) as unknown as Record<string, number>, totalRows: r.totalRows,
    }));
  },
  async pruneStorageStatsSnapshots(this: PostgresKyselyStorage, beforeIso: string): Promise<number> {
    const r = await this.db.deleteFrom('StorageStatsSnapshot').where('capturedAt', '<', new Date(beforeIso)).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
