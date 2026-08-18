/**
 * @file src/storage/providers/postgres-kysely/methods/schema.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Memory JSON-schema locks for the Postgres+Kysely backend (SchemaLock table). Backs
 *   validateMemoryWrite (findApplicableSchema runs on EVERY write). Reuses the shared process cache
 *   (schema-lock-cache) + wildcard matcher (pattern-utils) so the resolution logic + 0-DB-after-warmup
 *   behaviour match the other backends exactly.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: schema locks on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { SchemaRecord } from '../../../interface.js';
import { matchWildcardPattern } from '../../../pattern-utils.js';
import { getCachedSchemaLocks, invalidateSchemaLockCache, setCachedSchemaLocks } from '../../../schema-lock-cache.js';
import type { SchemaLock } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

function toSchema(r: Selectable<SchemaLock>): SchemaRecord {
  return {
    keyPattern: r.keyPattern, applyTo: r.applyTo as SchemaRecord['applyTo'],
    schemaJson: r.schemaJson as Record<string, unknown>, schemaMode: r.schemaMode as SchemaRecord['schemaMode'],
    lockedBy: r.lockedBy, setAt: (r.setAt instanceof Date ? r.setAt : new Date(r.setAt)).toISOString(),
    updatedAt: (r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt)).toISOString(),
    semanticContext: (r.semanticContext ?? undefined) as SchemaRecord['semanticContext'],
  };
}

export const schemaMethods = {
  async setSchema(this: PostgresKyselyStorage, record: SchemaRecord): Promise<SchemaRecord> {
    await this.db.insertInto('SchemaLock').values({
      keyPattern: record.keyPattern, applyTo: record.applyTo, schemaJson: jsonb(record.schemaJson),
      schemaMode: record.schemaMode, lockedBy: record.lockedBy, setAt: new Date(record.setAt),
      updatedAt: new Date(record.updatedAt), semanticContext: jsonb(record.semanticContext ?? null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).onConflict(oc => oc.columns(['applyTo', 'keyPattern']).doUpdateSet({
      schemaJson: jsonb(record.schemaJson), schemaMode: record.schemaMode, lockedBy: record.lockedBy,
      updatedAt: new Date(record.updatedAt), semanticContext: jsonb(record.semanticContext ?? null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)).execute();
    invalidateSchemaLockCache();
    return record;
  },

  async getSchema(this: PostgresKyselyStorage, keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null> {
    if (applyTo) {
      const r = await this.db.selectFrom('SchemaLock').selectAll().where('keyPattern', '=', keyPattern).where('applyTo', '=', applyTo).executeTakeFirst();
      return r ? toSchema(r) : null;
    }
    const exact = await this.db.selectFrom('SchemaLock').selectAll().where('keyPattern', '=', keyPattern).where('applyTo', '=', 'exact').executeTakeFirst();
    if (exact) return toSchema(exact);
    const prefix = await this.db.selectFrom('SchemaLock').selectAll().where('keyPattern', '=', keyPattern).where('applyTo', '=', 'prefix').executeTakeFirst();
    return prefix ? toSchema(prefix) : null;
  },

  async deleteSchema(this: PostgresKyselyStorage, keyPattern: string): Promise<boolean> {
    const r = await this.db.deleteFrom('SchemaLock').where('keyPattern', '=', keyPattern).executeTakeFirst();
    const deleted = Number(r.numDeletedRows ?? 0) > 0;
    if (deleted) invalidateSchemaLockCache();
    return deleted;
  },

  async listSchemas(this: PostgresKyselyStorage, prefix?: string): Promise<SchemaRecord[]> {
    let q = this.db.selectFrom('SchemaLock').selectAll();
    if (prefix) q = q.where('keyPattern', 'like', prefix + '%');
    return (await q.execute()).map(toSchema);
  },

  // Runs on EVERY write — resolve against the process-cached lock set (loaded once, invalidated on
  // set/delete): exact > longest wildcard > longest simple prefix. 0 DB round-trips after warm-up.
  async findApplicableSchema(this: PostgresKyselyStorage, memoryKey: string): Promise<SchemaRecord | null> {
    let locks = getCachedSchemaLocks();
    if (!locks) { locks = await this.listSchemas(); setCachedSchemaLocks(locks); }

    const exact = locks.find(l => l.applyTo === 'exact' && l.keyPattern === memoryKey);
    if (exact) return exact;

    const prefixLocks = locks.filter(l => l.applyTo === 'prefix');
    let bestWildcard: SchemaRecord | null = null, bestSegments = 0;
    for (const rec of prefixLocks) {
      if (!rec.keyPattern.includes('*')) continue;
      if (matchWildcardPattern(rec.keyPattern, memoryKey)) {
        const segments = rec.keyPattern.split('.').length;
        if (segments > bestSegments) { bestWildcard = rec; bestSegments = segments; }
      }
    }
    if (bestWildcard) return bestWildcard;

    const parts = memoryKey.split('.');
    for (let i = parts.length - 1; i >= 1; i--) {
      const pfx = parts.slice(0, i).join('.');
      const row = prefixLocks.find(l => l.keyPattern === pfx);
      if (row) return row;
    }
    return null;
  },
};
