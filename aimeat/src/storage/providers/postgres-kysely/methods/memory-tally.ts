/**
 * @file src/storage/providers/postgres-kysely/methods/memory-tally.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres implementation of the memory write tally. Counts are DELTAS: every statement
 *   adds rather than sets, keeps the EARLIEST firstAt and the LATEST lastAt, and creates the row on
 *   first sighting. No delete and no prune, on purpose — see the repository contract.
 *
 *   The counts are BIGINT, which the driver hands back as a string so a value past 2^53 cannot be
 *   silently rounded. They are converted at the edge here rather than anywhere else, because one of
 *   these counters is already past ten thousand after four months and this table never resets.
 * @structure memoryTallyMethods
 * @usage Object.assign(PostgresKyselyStorage.prototype, memoryTallyMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 8.
 */
import { sql } from 'kysely';
import { createHash } from 'node:crypto';
import type { PostgresKyselyStorage } from '../index.js';
import type {
  MemoryWriteTallyRow, MemoryFamilyTallyRow,
  MemoryWriteTallyUpsert, MemoryFamilyTallyUpsert,
} from '../../../repositories/memory-tally.repository.js';

/** BIGINT arrives as a string; a count is a number everywhere above this layer. */
const n = (v: unknown): number => (typeof v === 'string' ? Number(v) : (v as number) ?? 0);

function toWriteRow(r: Record<string, unknown>): MemoryWriteTallyRow {
  return {
    ownerGaii: r.ownerGaii as string,
    key: r.key as string,
    writerPrincipal: r.writerPrincipal as string,
    writeCount: n(r.writeCount),
    deleteCount: n(r.deleteCount),
    firstAt: r.firstAt as string,
    lastAt: r.lastAt as string,
  };
}

function toFamilyRow(r: Record<string, unknown>): MemoryFamilyTallyRow {
  return {
    ownerGaii: r.ownerGaii as string,
    keyFamily: r.keyFamily as string,
    writerPrincipal: r.writerPrincipal as string,
    tier: (r.tier as string) ?? '',
    writeCount: n(r.writeCount),
    deleteCount: n(r.deleteCount),
    firstAt: r.firstAt as string,
    lastAt: r.lastAt as string,
  };
}

/** LIKE has its own wildcards; a key holding % or _ must not become a prefix match for more. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, m => `\\${m}`);
}

export const memoryTallyMethods = {
  async upsertMemoryWriteTally(this: PostgresKyselyStorage, rows: MemoryWriteTallyUpsert[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insertInto('MemoryWriteTally')
      .values(rows.map(r => ({
        ownerGaii: r.ownerGaii, key: r.key, writerPrincipal: r.writerPrincipal,
        writeCount: String(r.writeCount), deleteCount: String(r.deleteCount),
        firstAt: r.at, lastAt: r.at,
      })))
      .onConflict(oc => oc.columns(['ownerGaii', 'key', 'writerPrincipal']).doUpdateSet({
        writeCount: eb => sql`${eb.ref('MemoryWriteTally.writeCount')} + excluded."writeCount"`,
        deleteCount: eb => sql`${eb.ref('MemoryWriteTally.deleteCount')} + excluded."deleteCount"`,
        firstAt: eb => sql`least(${eb.ref('MemoryWriteTally.firstAt')}, excluded."firstAt")`,
        lastAt: eb => sql`greatest(${eb.ref('MemoryWriteTally.lastAt')}, excluded."lastAt")`,
      }))
      .execute();
  },

  async upsertMemoryFamilyTally(this: PostgresKyselyStorage, rows: MemoryFamilyTallyUpsert[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insertInto('MemoryFamilyTally')
      .values(rows.map(r => ({
        ownerGaii: r.ownerGaii, keyFamily: r.keyFamily, writerPrincipal: r.writerPrincipal,
        tier: r.tier, writeCount: String(r.writeCount), deleteCount: String(r.deleteCount),
        firstAt: r.at, lastAt: r.at,
      })))
      .onConflict(oc => oc.columns(['ownerGaii', 'keyFamily', 'writerPrincipal']).doUpdateSet({
        tier: () => sql`excluded."tier"`,
        writeCount: eb => sql`${eb.ref('MemoryFamilyTally.writeCount')} + excluded."writeCount"`,
        deleteCount: eb => sql`${eb.ref('MemoryFamilyTally.deleteCount')} + excluded."deleteCount"`,
        firstAt: eb => sql`least(${eb.ref('MemoryFamilyTally.firstAt')}, excluded."firstAt")`,
        lastAt: eb => sql`greatest(${eb.ref('MemoryFamilyTally.lastAt')}, excluded."lastAt")`,
      }))
      .execute();
  },

  async listMemoryWriteTally(
    this: PostgresKyselyStorage,
    f: { ownerGaii: string; key?: string; keyPrefix?: string; limit?: number },
  ): Promise<MemoryWriteTallyRow[]> {
    let q = this.db.selectFrom('MemoryWriteTally').selectAll().where('ownerGaii', '=', f.ownerGaii);
    if (f.key) q = q.where('key', '=', f.key);
    else if (f.keyPrefix) q = q.where('key', 'like', `${escapeLike(f.keyPrefix)}%`);
    const rows = await q.orderBy('lastAt', 'desc').limit(Math.min(f.limit ?? 500, 5000)).execute();
    return rows.map(r => toWriteRow(r as unknown as Record<string, unknown>));
  },

  async listMemoryFamilyTally(
    this: PostgresKyselyStorage,
    f: { ownerGaii: string; family?: string; limit?: number },
  ): Promise<MemoryFamilyTallyRow[]> {
    let q = this.db.selectFrom('MemoryFamilyTally').selectAll().where('ownerGaii', '=', f.ownerGaii);
    if (f.family) q = q.where('keyFamily', '=', f.family);
    const rows = await q.orderBy('writeCount', 'desc').limit(Math.min(f.limit ?? 500, 5000)).execute();
    return rows.map(r => toFamilyRow(r as unknown as Record<string, unknown>));
  },

  async countTalliedKeys(this: PostgresKyselyStorage, ownerGaii: string, familyPrefix: string): Promise<number> {
    const row = await this.db.selectFrom('MemoryWriteTally')
      .select(eb => eb.fn.count<string>(sql`DISTINCT "key"`).as('n'))
      .where('ownerGaii', '=', ownerGaii)
      .where('key', 'like', `${escapeLike(familyPrefix)}%`)
      .executeTakeFirst();
    return n(row?.n);
  },

  async pseudonymiseTallyWriter(this: PostgresKyselyStorage, ownerName: string, nodeId: string): Promise<number> {
    return pseudonymiseTallyWriterDb(this.db, ownerName, nodeId);
  },
};

/**
 * Rewrite this owner's name out of the WRITER column, wherever the row belongs to somebody else.
 *
 * A free function so the owner cascade can run it inside the SAME transaction as the deletes, rather
 * than reaching for the prototype method and landing outside it. A stable hash rather than a
 * constant, so two erased writers stay two hands and do not merge into one. Rows in the erased
 * owner's OWN namespace are untouched here — the cascade removes those with the rest of their data.
 */
export async function pseudonymiseTallyWriterDb(
  db: PostgresKyselyStorage['db'], ownerName: string, nodeId: string,
): Promise<number> {
  const marker = `erased:${createHash('sha256').update(`${ownerName}@${nodeId}`).digest('hex').slice(0, 12)}`;
  const mine = `${ownerName}@${nodeId}`;
  const asAgent = `%#${ownerName}@${nodeId}`;
  let total = 0;
  for (const table of ['MemoryWriteTally', 'MemoryFamilyTally'] as const) {
    const res = await db.updateTable(table)
      .set({ writerPrincipal: marker })
      .where('ownerGaii', '!=', mine)
      .where(eb => eb.or([eb('writerPrincipal', '=', mine), eb('writerPrincipal', 'like', asAgent)]))
      .executeTakeFirst();
    total += Number(res?.numUpdatedRows ?? 0);
  }
  return total;
}
