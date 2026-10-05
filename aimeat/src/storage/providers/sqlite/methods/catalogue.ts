/**
 * @file src/storage/providers/sqlite/methods/catalogue.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/catalogue.ts (catalogueMethods), so a
 *   fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure catalogueMethods
 * @usage Object.assign(SqliteStorage.prototype, catalogueMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 11 methods (createCsm, getCsm, listCsms, …) moved here from governance.ts so the
 *     file mirrors postgres-kysely/methods/catalogue.ts (secaudit 2026-10, M8).
 */
import type { CsmRecord, MsmRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const catalogueMethods = {

  // ══════════════════════════════════════════════════════════
  // ── CSM (Community Service Manifest) ──
  // ══════════════════════════════════════════════════════════

  async createCsm(this: SqliteStorage, record: CsmRecord): Promise<CsmRecord> {
    try {
      this.db.prepare(
        `INSERT INTO csms (name, definition, jsonSchemaKey, serviceType, registeredBy, registeredAt, updatedAt, semantic, federate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.name, JSON.stringify(record.definition), record.jsonSchemaKey,
        record.serviceType, record.registeredBy, record.registeredAt, record.updatedAt,
        record.semantic ? JSON.stringify(record.semantic) : null,
        record.federate ? 1 : 0,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('CSM_NAME_TAKEN', { cause: err });
      throw err;
    }
  },

  async getCsm(this: SqliteStorage, name: string): Promise<CsmRecord | null> {
    const row = this.db.prepare('SELECT * FROM csms WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeCsm(row) : null;
  },

  async listCsms(this: SqliteStorage, opts?: { serviceType?: string }): Promise<CsmRecord[]> {
    let sql = 'SELECT * FROM csms';
    const params: unknown[] = [];
    if (opts?.serviceType) { sql += ' WHERE serviceType = ?'; params.push(opts.serviceType); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeCsm(r));
  },

  async deleteCsm(this: SqliteStorage, name: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM csms WHERE name = ?').run(name);
    return result.changes > 0;
  },

  deserializeCsm(this: SqliteStorage, row: Record<string, unknown>): CsmRecord {
    const record: CsmRecord = {
      name: row.name as string,
      definition: JSON.parse(row.definition as string),
      jsonSchemaKey: row.jsonSchemaKey as string,
      serviceType: row.serviceType as string,
      registeredBy: row.registeredBy as string,
      registeredAt: row.registeredAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    if (row.federate) record.federate = (row.federate as number) === 1;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── MSM (Machine Service Manifest) ──
  // ══════════════════════════════════════════════════════════

  async createMsm(this: SqliteStorage, record: MsmRecord): Promise<MsmRecord> {
    try {
      this.db.prepare(
        `INSERT INTO msms (name, definition, category, authType, actionsCount, registeredBy, registeredAt, updatedAt, federate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.name, JSON.stringify(record.definition), record.category,
        record.authType, record.actionsCount, record.registeredBy,
        record.registeredAt, record.updatedAt,
        record.federate ? 1 : 0,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('MSM_NAME_TAKEN', { cause: err });
      throw err;
    }
  },

  async getMsm(this: SqliteStorage, name: string): Promise<MsmRecord | null> {
    const row = this.db.prepare('SELECT * FROM msms WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeMsm(row) : null;
  },

  async listMsms(this: SqliteStorage, opts?: { category?: string }): Promise<MsmRecord[]> {
    let sql = 'SELECT * FROM msms';
    const params: unknown[] = [];
    if (opts?.category) { sql += ' WHERE category = ?'; params.push(opts.category); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMsm(r));
  },

  async updateMsm(this: SqliteStorage, name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null> {
    const existing = await this.getMsm(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates, name: existing.name, updatedAt: new Date().toISOString() };
    this.db.prepare(
      `UPDATE msms SET definition = ?, category = ?, authType = ?, actionsCount = ?,
       registeredBy = ?, registeredAt = ?, updatedAt = ?, federate = ? WHERE name = ?`
    ).run(
      JSON.stringify(updated.definition), updated.category, updated.authType,
      updated.actionsCount, updated.registeredBy,
      updated.registeredAt, updated.updatedAt,
      updated.federate ? 1 : 0,
      name,
    );
    return updated;
  },

  async deleteMsm(this: SqliteStorage, name: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM msms WHERE name = ?').run(name);
    return result.changes > 0;
  },

  deserializeMsm(this: SqliteStorage, row: Record<string, unknown>): MsmRecord {
    const record: MsmRecord = {
      name: row.name as string,
      definition: JSON.parse(row.definition as string),
      category: row.category as string,
      authType: row.authType as string,
      actionsCount: row.actionsCount as number,
      registeredBy: row.registeredBy as string,
      registeredAt: row.registeredAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.federate) record.federate = (row.federate as number) === 1;
    return record;
  },
};
