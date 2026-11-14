/**
 * @file src/storage/providers/sqlite/methods/sealed-columns.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SealedColumnRepository on SQLite: the data key's re-encrypt job reads a sealed column
 *   a page at a time in id order, and writes a resealed value with one UPDATE that matches the text
 *   it read, so a write another connection made meanwhile is never undone. A JSON column is compared
 *   as the text the provider wrote (JSON.stringify of the value that was read). Table and
 *   column names come from SEALED_COLUMNS only, never from a caller.
 * @structure sealedColumnMethods
 * @usage Object.assign(SqliteStorage.prototype, sealedColumnMethods) in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-11-14 — A spec's `exclude` filter on the listing and on the swap (a secret share's
 *     end-to-end envelope is neither listed nor written).
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */
import type { SqliteStorage } from '../index.js';
import { logger } from '../../../../utils/logger.js';
import { SEALED_COLUMNS, type SealedColumn, type SealedColumnRow, type SealedColumnSpec } from '../../../repositories/sealed-column.repository.js';
import { globPrefix } from '../../../key-prefix.js';

const q = (name: string): string => `"${name}"`;

export const sealedColumnMethods = {
  async listSealedColumn(this: SqliteStorage, column: SealedColumn, opts: { after?: string[] | null; limit: number; prefix?: string }): Promise<SealedColumnRow[]> {
    const spec: SealedColumnSpec = SEALED_COLUMNS[column];
    const idList = spec.ids.map(q).join(', ');
    const conds: string[] = [];
    const params: unknown[] = [];
    if (spec.column) conds.push(`${q(spec.column)} IS NOT NULL`);
    if (spec.exclude) {
      conds.push(`${q(spec.exclude.column)} <> ?`);
      params.push(spec.exclude.value);
    }
    if (column === 'memory') {
      if (!opts.prefix) throw new Error('listSealedColumn(memory) needs a key prefix');
      conds.push('deletedAt IS NULL', 'key GLOB ?');
      params.push(globPrefix(opts.prefix));
    }
    if (opts.after && opts.after.length === spec.ids.length) {
      conds.push(`(${idList}) > (${spec.ids.map(() => '?').join(', ')})`);
      params.push(...opts.after);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const cols = spec.column ? `${idList}, ${q(spec.column)} AS sealedValue` : idList;
    params.push(Math.max(1, Math.floor(opts.limit)));
    const rows = this.db.prepare(`SELECT ${cols} FROM ${spec.sqlite} ${where} ORDER BY ${idList} LIMIT ?`).all(...params) as Array<Record<string, unknown>>;
    return rows.map(row => {
      let value: unknown = spec.column ? row.sealedValue : null;
      if (spec.json && typeof value === 'string') {
        const text = value;
        try { value = JSON.parse(text); } catch (err) {
          // Handed over as text: the job finds nothing sealed in it, and a swap compares the same text.
          logger.warn('sealed columns: a JSON column does not parse; it is listed as text', { column, error: String((err as Error)?.message ?? err) });
        }
      }
      return { id: spec.ids.map(c => String(row[c])), value };
    });
  },

  async swapSealedColumn(this: SqliteStorage, column: SealedColumn, id: string[], expected: unknown, next: unknown): Promise<boolean> {
    const spec: SealedColumnSpec = SEALED_COLUMNS[column];
    if (!spec.column) throw new Error('memory is written on its version through the memory methods');
    if (id.length !== spec.ids.length) throw new Error(`swapSealedColumn(${column}) needs ${spec.ids.length} id value(s)`);
    const exclude = spec.exclude ? ` AND ${q(spec.exclude.column)} <> ?` : '';
    const match = spec.ids.map(c => `${q(c)} = ?`).join(' AND ') + exclude;
    const matchParams: unknown[] = spec.exclude ? [...id, spec.exclude.value] : [...id];
    const col = q(spec.column);
    if (!spec.json) {
      return this.db.prepare(`UPDATE ${spec.sqlite} SET ${col} = ? WHERE ${match} AND ${col} = ?`).run(next, ...matchParams, expected).changes > 0;
    }
    // The provider writes these columns with JSON.stringify, so the stored text of the value the caller
    // read is JSON.stringify of it (the listing parsed it, keeping its key order); text the listing
    // handed over as text is compared as it is. Either way one statement writes only over that text.
    const expectedText = typeof expected === 'string' ? expected : JSON.stringify(expected ?? null);
    return this.db.prepare(`UPDATE ${spec.sqlite} SET ${col} = ? WHERE ${match} AND ${col} = ?`).run(JSON.stringify(next ?? null), ...matchParams, expectedText).changes > 0;
  },
};
