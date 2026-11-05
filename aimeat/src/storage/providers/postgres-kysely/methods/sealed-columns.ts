/**
 * @file src/storage/providers/postgres-kysely/methods/sealed-columns.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SealedColumnRepository on PostgreSQL: the data key's re-encrypt job reads a sealed
 *   column a page at a time in id order, and writes a resealed value with one UPDATE that matches the
 *   value it read (a JSON column by jsonb equality), so a write another process made meanwhile is
 *   never undone. Table and column names come from SEALED_COLUMNS only, never from a caller.
 * @structure sealedColumnMethods
 * @usage Object.assign(PostgresKyselyStorage.prototype, sealedColumnMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */
import { sql } from 'kysely';
import type { PostgresKyselyStorage } from '../index.js';
import { SEALED_COLUMNS, type SealedColumn, type SealedColumnRow } from '../../../repositories/sealed-column.repository.js';
import { likePrefix } from '../../../key-prefix.js';

export const sealedColumnMethods = {
  async listSealedColumn(this: PostgresKyselyStorage, column: SealedColumn, opts: { after?: string[] | null; limit: number; prefix?: string }): Promise<SealedColumnRow[]> {
    const spec = SEALED_COLUMNS[column];
    const idList = sql.join(spec.ids.map(c => sql.ref(c)));
    const conds = [];
    if (spec.column) conds.push(sql`${sql.ref(spec.column)} IS NOT NULL`);
    if (column === 'memory') {
      if (!opts.prefix) throw new Error('listSealedColumn(memory) needs a key prefix');
      conds.push(sql`"deletedAt" IS NULL`, sql`"key" LIKE ${likePrefix(opts.prefix)}`);
    }
    if (opts.after && opts.after.length === spec.ids.length) {
      conds.push(sql`(${idList}) > (${sql.join(opts.after.map(v => sql`${v}`))})`);
    }
    const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
    const cols = spec.column ? sql`${idList}, ${sql.ref(spec.column)} AS "sealedValue"` : idList;
    const limit = Math.max(1, Math.floor(opts.limit));
    const r = await sql<Record<string, unknown>>`SELECT ${cols} FROM ${sql.table(spec.pg)} ${where} ORDER BY ${idList} LIMIT ${limit}`.execute(this.db);
    return r.rows.map(row => ({ id: spec.ids.map(c => String(row[c])), value: spec.column ? row.sealedValue : null }));
  },

  async swapSealedColumn(this: PostgresKyselyStorage, column: SealedColumn, id: string[], expected: unknown, next: unknown): Promise<boolean> {
    const spec = SEALED_COLUMNS[column];
    if (!spec.column) throw new Error('memory is written on its version through the memory methods');
    if (id.length !== spec.ids.length) throw new Error(`swapSealedColumn(${column}) needs ${spec.ids.length} id value(s)`);
    const match = sql.join(spec.ids.map((c, i) => sql`${sql.ref(c)} = ${id[i]}`), sql` AND `);
    const col = sql.ref(spec.column);
    const r = spec.json
      ? await sql`UPDATE ${sql.table(spec.pg)} SET ${col} = ${JSON.stringify(next ?? null)}::jsonb WHERE ${match} AND ${col} = ${JSON.stringify(expected ?? null)}::jsonb RETURNING 1 AS "written"`.execute(this.db)
      : await sql`UPDATE ${sql.table(spec.pg)} SET ${col} = ${next} WHERE ${match} AND ${col} = ${expected} RETURNING 1 AS "written"`.execute(this.db);
    return r.rows.length > 0;
  },
};
