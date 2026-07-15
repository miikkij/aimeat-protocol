/**
 * @file src/storage/providers/postgres-kysely/methods/system.ts
 * @description Node-wide system methods for the Postgres+Kysely backend: config persistence, maintenance
 *   mode, the node keypair, and the stats counters/daily-history — the group the server touches during
 *   boot (config-init) and the stats flusher. Translated 1:1 from the Prisma implementations against the
 *   same tables (SystemSetting keyed `config:*` / `maintenance`, NodeKey, StatsCounter, StatsDailyHistory).
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: startup/system domain on Postgres+Kysely.
 */
import type { MaintenanceState } from '../../../interface.js';
import type { PostgresKyselyStorage } from '../index.js';

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
};
