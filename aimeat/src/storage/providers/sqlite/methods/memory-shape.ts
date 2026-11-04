/**
 * @file src/storage/providers/sqlite/methods/memory-shape.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/memory-shape.ts
 *   (memoryShapeMethods): the MemoryShapeRepository reads (repositories/memory-shape.repository.ts),
 *   with the filter, the order and the window in SQL. The JSON tests use SQLite's built-in JSON
 *   functions over the TEXT value column; `truthy()` is JavaScript's truthiness for each JSON type.
 * @structure truthy · liveWhere · memoryShapeMethods
 * @usage Object.assign(SqliteStorage.prototype, memoryShapeMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item C7).
 */
import type { MemoryRecord } from '../../../interface.js';
import type { MemoryMetaRow } from '../../../repositories/memory.repository.js';
import type { InboxCounts, InboxRowOpts, KeyShapeOpts } from '../../../repositories/memory-shape.repository.js';
import type { SqliteStorage } from '../index.js';
import { globPrefix, globShape } from '../../../key-prefix.js';
import { LIVE_SQL } from '../repos/memory.js';
import { META_COLS, rowToMeta } from './memory.js';
import { completeInboxPage } from '../../../inbox-order.js';

/**
 * JavaScript's truthiness of the value's field `field` (a plain name), as SQL: true is true, a number
 * is true unless 0, a string unless empty, an array or object always; null, false and an absent
 * field are false. A value that is not an object has no field, so false.
 */
const truthy = (field: string): string => {
  const path = `'$.${field}'`;
  return `(CASE json_type(value, ${path})`
    + ` WHEN 'true' THEN 1`
    + ` WHEN 'integer' THEN json_extract(value, ${path}) <> 0`
    + ` WHEN 'real' THEN json_extract(value, ${path}) <> 0`
    + ` WHEN 'text' THEN json_extract(value, ${path}) <> ''`
    + ` WHEN 'array' THEN 1 WHEN 'object' THEN 1 ELSE 0 END)`;
};

/** One owner's inbox rows under `prefix`: live, not archived, not in the bin, id truthy. One `?` for now. */
const INBOX_WHERE = `ownerGaii = ? AND key GLOB ? AND archived = 0 AND deletedAt IS NULL${LIVE_SQL} AND ${truthy('id')}`;

export const memoryShapeMethods = {

  async listInboxRows(this: SqliteStorage, ownerGaii: string, prefix: string, opts?: InboxRowOpts): Promise<MemoryRecord[]> {
    const suffixes = opts?.keySuffixes;
    if (suffixes && suffixes.length === 0) return [];
    const read = (under: string, limit: number | undefined): MemoryRecord[] => {
      let sql = `SELECT * FROM memory WHERE ${INBOX_WHERE}`;
      const params: unknown[] = [ownerGaii, globPrefix(under), new Date().toISOString()];
      if (opts?.unreadOnly) sql += ` AND NOT ${truthy('read')}`;
      if (suffixes) {
        sql += ` AND (${suffixes.map(() => 'key GLOB ?').join(' OR ')})`;
        params.push(...suffixes.map(s => globShape('', `.${s}`)));
      }
      // By key, newest first: the (ownerGaii, key) index serves it and stops at the LIMIT.
      sql += ' ORDER BY key DESC';
      if (limit !== undefined) { sql += ' LIMIT ?'; params.push(limit); }
      return (this.db.prepare(sql).all(...params) as Record<string, unknown>[]).map(r => this.deserializeMemory(r));
    };
    return completeInboxPage(read(prefix, opts?.limit), opts?.limit, async stem => read(`${stem}.`, undefined));
  },

  async countInboxRows(this: SqliteStorage, ownerGaii: string, prefix: string): Promise<InboxCounts> {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN ${truthy('read')} THEN 0 ELSE 1 END), 0) AS unread FROM memory WHERE ${INBOX_WHERE}`,
    ).get(ownerGaii, globPrefix(prefix), new Date().toISOString()) as { total: number; unread: number };
    return { total: Number(row.total), unread: Number(row.unread) };
  },

  async listAllMemoryByKeyShape(this: SqliteStorage, prefix: string, suffix: string, opts?: KeyShapeOpts): Promise<MemoryRecord[]> {
    const { sql, params } = keyShapeQuery('*', prefix, suffix, opts);
    return (this.db.prepare(sql).all(...params) as Record<string, unknown>[]).map(r => this.deserializeMemory(r));
  },

  async listAllMemoryMetaByKeyShape(this: SqliteStorage, prefix: string, suffix: string, opts?: KeyShapeOpts): Promise<MemoryMetaRow[]> {
    const { sql, params } = keyShapeQuery(META_COLS, prefix, suffix, opts);
    return (this.db.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToMeta);
  },
};

/** The filters, the order and the window of listAllMemory, for a key shape. */
function keyShapeQuery(cols: string, prefix: string, suffix: string, opts?: KeyShapeOpts): { sql: string; params: unknown[] } {
  let sql = `SELECT ${cols} FROM memory WHERE key GLOB ? AND archived = 0 AND deletedAt IS NULL${LIVE_SQL}`;
  const params: unknown[] = [globShape(prefix, suffix), new Date().toISOString()];
  if (opts?.visibility) { sql += ' AND visibility = ?'; params.push(opts.visibility); }
  sql += ' ORDER BY key, ownerGaii';
  if (opts?.limit !== undefined) { sql += ' LIMIT ?'; params.push(opts.limit); }
  return { sql, params };
}
