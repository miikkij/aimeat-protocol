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
 *   v1.1.0 — 2026-11-07 — CSM visibility and versions: createCsm writes both, replaceCsmVersion keeps
 *     the replaced version in csm_versions and raises the version in one transaction, setCsmVisibility,
 *     listCsmVersions, getCsmVersion; deleteCsm removes the kept versions too.
 *   v1.0.0 — 2026-10-05 — 11 methods (createCsm, getCsm, listCsms, …) moved here from governance.ts so the
 *     file mirrors postgres-kysely/methods/catalogue.ts (secaudit 2026-10, M8).
 */
import type { CsmRecord, CsmVersionRecord, MsmRecord } from '../../../interface.js';
import type { CsmVersionUpdate } from '../../../repositories/catalogue.repository.js';
import type { SqliteStorage } from '../index.js';

function toCsmVersion(row: Record<string, unknown>): CsmVersionRecord {
  return {
    name: row.name as string,
    version: Number(row.version),
    definition: JSON.parse(row.definition as string),
    jsonSchema: JSON.parse(row.jsonSchema as string),
    registeredBy: row.registeredBy as string,
    createdAt: row.createdAt as string,
  };
}

export const catalogueMethods = {

  // ══════════════════════════════════════════════════════════
  // ── CSM (Community Service Manifest) ──
  // ══════════════════════════════════════════════════════════

  async createCsm(this: SqliteStorage, record: CsmRecord): Promise<CsmRecord> {
    try {
      this.db.prepare(
        `INSERT INTO csms (name, definition, jsonSchemaKey, serviceType, registeredBy, registeredAt, updatedAt, semantic, federate, visibility, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.name, JSON.stringify(record.definition), record.jsonSchemaKey,
        record.serviceType, record.registeredBy, record.registeredAt, record.updatedAt,
        record.semantic ? JSON.stringify(record.semantic) : null,
        record.federate ? 1 : 0,
        record.visibility ?? 'public',
        record.version ?? 1,
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
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM csm_versions WHERE name = ?').run(name);
      const result = this.db.prepare('DELETE FROM csms WHERE name = ?').run(name);
      return result.changes > 0;
    })();
  },

  async replaceCsmVersion(
    this: SqliteStorage, name: string, expectedVersion: number, next: CsmVersionUpdate, previous: CsmVersionRecord,
  ): Promise<CsmRecord | null> {
    // better-sqlite3 runs the transaction synchronously, so no other write lands between the
    // version-conditioned UPDATE and the history INSERT.
    const changed = this.db.transaction(() => {
      const result = this.db.prepare(
        `UPDATE csms SET definition = ?, serviceType = ?, semantic = ?, updatedAt = ?, version = version + 1
         WHERE name = ? AND version = ?`
      ).run(
        JSON.stringify(next.definition), next.serviceType,
        next.semantic ? JSON.stringify(next.semantic) : null, next.updatedAt,
        name, expectedVersion,
      );
      if (result.changes === 0) return false;
      this.db.prepare(
        `INSERT INTO csm_versions (name, version, definition, jsonSchema, registeredBy, createdAt) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        name, previous.version, JSON.stringify(previous.definition), JSON.stringify(previous.jsonSchema),
        previous.registeredBy, previous.createdAt,
      );
      return true;
    })();
    return changed ? this.getCsm(name) : null;
  },

  async setCsmVisibility(this: SqliteStorage, name: string, visibility: string, updatedAt: string): Promise<boolean> {
    const result = this.db.prepare('UPDATE csms SET visibility = ?, updatedAt = ? WHERE name = ?').run(visibility, updatedAt, name);
    return result.changes > 0;
  },

  async listCsmVersions(this: SqliteStorage, name: string, opts?: { limit?: number }): Promise<CsmVersionRecord[]> {
    const limit = Math.max(1, Math.min(opts?.limit ?? 1000, 1000));
    const rows = this.db.prepare('SELECT * FROM csm_versions WHERE name = ? ORDER BY version ASC LIMIT ?').all(name, limit) as Record<string, unknown>[];
    return rows.map(toCsmVersion);
  },

  async getCsmVersion(this: SqliteStorage, name: string, version: number): Promise<CsmVersionRecord | null> {
    const row = this.db.prepare('SELECT * FROM csm_versions WHERE name = ? AND version = ?').get(name, version) as Record<string, unknown> | undefined;
    return row ? toCsmVersion(row) : null;
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
    record.visibility = typeof row.visibility === 'string' && row.visibility ? row.visibility : 'public';
    record.version = typeof row.version === 'number' && row.version > 0 ? row.version : 1;
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
