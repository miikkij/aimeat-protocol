/**
 * @file src/storage/providers/sqlite/methods/schema.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/schema.ts (schemaMethods), so a fix
 *   in one provider finds its twin by file name. Bodies moved verbatim from the files named in the version
 *   history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure schemaMethods
 * @usage Object.assign(SqliteStorage.prototype, schemaMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — setSchema, getSchema, deleteSchema, listSchemas, findApplicableSchema,
 *     deserializeSchema moved here from governance.ts so the file mirrors postgres-kysely/methods/schema.ts
 *     (secaudit 2026-10, M8).
 */
import type { SchemaRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import { matchWildcardPattern } from '../../../pattern-utils.js';
import {
  getCachedSchemaLocks, setCachedSchemaLocks, invalidateSchemaLockCache,
} from '../../../schema-lock-cache.js';

export const schemaMethods = {


  // ══════════════════════════════════════════════════════════
  // ── Schema Locking ──
  // ══════════════════════════════════════════════════════════

  async setSchema(this: SqliteStorage, record: SchemaRecord): Promise<SchemaRecord> {
    this.db.prepare(
      `INSERT OR REPLACE INTO schemas (keyPattern, applyTo, schemaJson, schemaMode, lockedBy, setAt, updatedAt, semanticContext)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.keyPattern, record.applyTo,
      JSON.stringify(record.schemaJson), record.schemaMode,
      record.lockedBy, record.setAt, record.updatedAt,
      record.semanticContext ? JSON.stringify(record.semanticContext) : null,
    );
    invalidateSchemaLockCache();
    return record;
  },

  async getSchema(this: SqliteStorage, keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null> {
    if (applyTo) {
      const row = this.db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(keyPattern, applyTo) as Record<string, unknown> | undefined;
      return row ? this.deserializeSchema(row) : null;
    }
    // Try exact first, then prefix
    const exactRow = this.db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(keyPattern, 'exact') as Record<string, unknown> | undefined;
    if (exactRow) return this.deserializeSchema(exactRow);
    const prefixRow = this.db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(keyPattern, 'prefix') as Record<string, unknown> | undefined;
    return prefixRow ? this.deserializeSchema(prefixRow) : null;
  },

  async deleteSchema(this: SqliteStorage, keyPattern: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM schemas WHERE keyPattern = ?').run(keyPattern);
    if (result.changes > 0) invalidateSchemaLockCache();
    return result.changes > 0;
  },

  async listSchemas(this: SqliteStorage, prefix?: string): Promise<SchemaRecord[]> {
    let sql = 'SELECT * FROM schemas';
    const params: unknown[] = [];
    if (prefix) { sql += ' WHERE keyPattern LIKE ?'; params.push(prefix + '%'); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeSchema(r));
  },

  async findApplicableSchema(this: SqliteStorage, memoryKey: string): Promise<SchemaRecord | null> {
    // Resolve against the process-cached lock set (loaded once, invalidated on setSchema/deleteSchema).
    // findApplicableSchema runs on every write; matching in memory keeps it off the DB after warm-up.
    let locks = getCachedSchemaLocks();
    if (!locks) { locks = await this.listSchemas(); setCachedSchemaLocks(locks); }

    // 1. Exact match -- highest priority
    const exact = locks.find(l => l.applyTo === 'exact' && l.keyPattern === memoryKey);
    if (exact) return exact;

    // 2. Wildcard pattern match -- supports profile.*.interests style
    const allPrefixRecords = locks.filter(l => l.applyTo === 'prefix');
    let bestWildcard: SchemaRecord | null = null;
    let bestSegments = 0;
    for (const record of allPrefixRecords) {
      if (!record.keyPattern.includes('*')) continue;
      if (matchWildcardPattern(record.keyPattern, memoryKey)) {
        const segments = record.keyPattern.split('.').length;
        if (segments > bestSegments) {
          bestWildcard = record;
          bestSegments = segments;
        }
      }
    }
    if (bestWildcard) return bestWildcard;

    // 3. Simple prefix match -- longest prefix wins (in-memory over the cached prefix locks)
    const parts = memoryKey.split('.');
    for (let i = parts.length - 1; i >= 1; i--) {
      const prefix = parts.slice(0, i).join('.');
      const prefixRow = allPrefixRecords.find(l => l.keyPattern === prefix);
      if (prefixRow) return prefixRow;
    }

    return null;
  },

  deserializeSchema(this: SqliteStorage, row: Record<string, unknown>): SchemaRecord {
    const record: SchemaRecord = {
      keyPattern: row.keyPattern as string,
      applyTo: row.applyTo as SchemaRecord['applyTo'],
      schemaJson: JSON.parse(row.schemaJson as string),
      schemaMode: row.schemaMode as SchemaRecord['schemaMode'],
      lockedBy: row.lockedBy as string,
      setAt: row.setAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.semanticContext) record.semanticContext = JSON.parse(row.semanticContext as string);
    return record;
  },
};
