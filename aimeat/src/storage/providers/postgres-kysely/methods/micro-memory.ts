/**
 * @file src/storage/providers/postgres-kysely/methods/micro-memory.ts
 * @description Micro-memory sets for the Postgres+Kysely backend (MicroMemory table, jsonb entries,
 *   keyed by (gaii, setName)). A deprecated feature kept for parity; the usage summary reads its byte
 *   total. Translated 1:1 from the Prisma implementation.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: micro-memory on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { MicroMemoryRecord } from '../../../interface.js';
import type { MicroMemory } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

function toRecord(r: Selectable<MicroMemory>): MicroMemoryRecord {
  return {
    gaii: r.gaii, set: r.setName, entries: (r.entries ?? {}) as Record<string, string>,
    visibility: r.visibility as MicroMemoryRecord['visibility'], accessCode: r.accessCode ?? undefined,
    updatedAt: (r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt)).toISOString(),
  };
}

export const microMemoryMethods = {
  async setMicroMemory(this: PostgresKyselyStorage, record: MicroMemoryRecord): Promise<MicroMemoryRecord> {
    const shared = { entries: jsonb(record.entries), visibility: record.visibility, accessCode: record.accessCode ?? null, updatedAt: new Date(record.updatedAt) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.insertInto('MicroMemory').values({ gaii: record.gaii, setName: record.set, ...shared } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict(oc => oc.columns(['gaii', 'setName']).doUpdateSet(shared as any)).execute();
    return record;
  },
  async getMicroMemory(this: PostgresKyselyStorage, gaii: string, set: string): Promise<MicroMemoryRecord | null> {
    const r = await this.db.selectFrom('MicroMemory').selectAll().where('gaii', '=', gaii).where('setName', '=', set).executeTakeFirst();
    return r ? toRecord(r) : null;
  },
  async listMicroMemorySets(this: PostgresKyselyStorage, gaii: string): Promise<MicroMemoryRecord[]> {
    return (await this.db.selectFrom('MicroMemory').selectAll().where('gaii', '=', gaii).execute()).map(toRecord);
  },
  async getMicroMemoryTotalForOwners(this: PostgresKyselyStorage, gaiis: string[]): Promise<{ bytes: number; sets: number }> {
    if (gaiis.length === 0) return { bytes: 0, sets: 0 };
    const rows = await this.db.selectFrom('MicroMemory').select('entries').where('gaii', 'in', gaiis).execute();
    let bytes = 0;
    for (const r of rows) {
      const entries = (r.entries ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(entries)) bytes += Buffer.byteLength(k, 'utf8') + Buffer.byteLength(String(v), 'utf8');
    }
    return { bytes, sets: rows.length };
  },
  async deleteMicroMemory(this: PostgresKyselyStorage, gaii: string, set: string): Promise<boolean> {
    const r = await this.db.deleteFrom('MicroMemory').where('gaii', '=', gaii).where('setName', '=', set).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
  async deleteMicroMemoryEntry(this: PostgresKyselyStorage, gaii: string, set: string, key: string): Promise<boolean> {
    const record = await this.getMicroMemory(gaii, set);
    if (!record || !(key in record.entries)) return false;
    delete record.entries[key];
    await this.setMicroMemory(record);
    return true;
  },
  async findMicroMemoryByAccessCode(this: PostgresKyselyStorage, set: string, accessCode: string): Promise<MicroMemoryRecord | null> {
    const r = await this.db.selectFrom('MicroMemory').selectAll().where('setName', '=', set).where('accessCode', '=', accessCode)
      .where('visibility', 'in', ['shared_read', 'shared_write']).executeTakeFirst();
    return r ? toRecord(r) : null;
  },
};
