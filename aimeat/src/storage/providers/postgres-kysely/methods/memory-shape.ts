/**
 * @file src/storage/providers/postgres-kysely/methods/memory-shape.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description PostgreSQL methods for the MemoryShapeRepository reads
 *   (repositories/memory-shape.repository.ts), with the filter, the order and the window in SQL. The
 *   JSON tests read the JSONB value column; `truthy()` is JavaScript's truthiness for each JSON type.
 *   Bound to PostgresKyselyStorage via the prototype merge in ../index.ts.
 * @structure truthy · inboxWhere · keyShapeWhere · memoryShapeMethods
 * @usage Object.assign(PostgresKyselyStorage.prototype, memoryShapeMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item C7).
 */
import { sql, type RawBuilder } from 'kysely';
import type { MemoryRecord } from '../../../interface.js';
import type { MemoryMetaRow } from '../../../repositories/memory.repository.js';
import type { InboxCounts, InboxRowOpts, KeyShapeOpts } from '../../../repositories/memory-shape.repository.js';
import type { PostgresKyselyStorage } from '../index.js';
import { likePrefix, likeShape } from '../../../key-prefix.js';
import { rowToMeta, rowToRecord } from '../helpers.js';
import { META_COLS } from './memory.js';
import { completeInboxPage } from '../../../inbox-order.js';

/**
 * JavaScript's truthiness of the value's field `field`, as SQL: true is true, a number is true unless
 * 0, a string unless empty, an array or object always; null, false and an absent field are false. A
 * value that is not an object has no field (`->` answers NULL), so false.
 */
const truthy = (field: 'id' | 'read'): RawBuilder<boolean> => {
  // A literal, not a parameter: `jsonb -> $1` cannot tell the text form from the integer form.
  const f = sql.lit(field);
  return sql<boolean>`(CASE jsonb_typeof("value" -> ${f})
  WHEN 'boolean' THEN ("value" ->> ${f}) = 'true'
  WHEN 'number' THEN ("value" ->> ${f})::numeric <> 0
  WHEN 'string' THEN ("value" ->> ${f}) <> ''
  WHEN 'array' THEN true WHEN 'object' THEN true ELSE false END)`;
};

/** Live: no TTL, or created + TTL not yet past `now` (helpers.ts isLive, as memory.ts liveSql says it). */
const live = (now: Date): RawBuilder<boolean> =>
  sql<boolean>`("ttlHours" IS NULL OR "ttlHours" = 0 OR "createdAt" + ("ttlHours" * interval '1 hour') >= ${now})`;

/** One owner's inbox rows under `prefix`: live, not archived, not in the bin, id truthy. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inboxWhere(q: any, ownerGaii: string, prefix: string) {
  return q.where('ownerGaii', '=', ownerGaii).where('key', 'like', likePrefix(prefix))
    .where('archived', '=', false).where('deletedAt', 'is', null)
    .where(live(new Date())).where(truthy('id'));
}

/** The filters of listAllMemory, for a key shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function keyShapeWhere(q: any, prefix: string, suffix: string, opts?: KeyShapeOpts) {
  q = q.where('key', 'like', likeShape(prefix, suffix)).where('archived', '=', false).where('deletedAt', 'is', null).where(live(new Date()));
  if (opts?.visibility) q = q.where('visibility', '=', opts.visibility);
  q = q.orderBy('key').orderBy('ownerGaii');
  return opts?.limit !== undefined ? q.limit(opts.limit) : q;
}

export const memoryShapeMethods = {

  async listInboxRows(this: PostgresKyselyStorage, ownerGaii: string, prefix: string, opts?: InboxRowOpts): Promise<MemoryRecord[]> {
    const suffixes = opts?.keySuffixes;
    if (suffixes && suffixes.length === 0) return [];
    const read = async (under: string, limit: number | undefined): Promise<MemoryRecord[]> => {
      let q = inboxWhere(this.db.selectFrom('Memory').selectAll(), ownerGaii, under);
      if (opts?.unreadOnly) q = q.where(sql<boolean>`NOT ${truthy('read')}`);
      if (suffixes) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        q = q.where((eb: any) => eb.or(suffixes.map(s => eb('key', 'like', likeShape('', `.${s}`)))));
      }
      // By key, newest first: the (ownerGaii, key) index serves it and stops at the LIMIT.
      q = q.orderBy('key', 'desc');
      if (limit !== undefined) q = q.limit(limit);
      return (await q.execute()).map(rowToRecord);
    };
    return completeInboxPage(await read(prefix, opts?.limit), opts?.limit, stem => read(`${stem}.`, undefined));
  },

  async countInboxRows(this: PostgresKyselyStorage, ownerGaii: string, prefix: string): Promise<InboxCounts> {
    const r = await inboxWhere(this.db.selectFrom('Memory').select([
      sql<string>`count(*)`.as('total'),
      sql<string>`count(*) FILTER (WHERE NOT ${truthy('read')})`.as('unread'),
    ]), ownerGaii, prefix).executeTakeFirst() as { total: string; unread: string } | undefined;
    return { total: Number(r?.total ?? 0), unread: Number(r?.unread ?? 0) };
  },

  async listAllMemoryByKeyShape(this: PostgresKyselyStorage, prefix: string, suffix: string, opts?: KeyShapeOpts): Promise<MemoryRecord[]> {
    const rows = await keyShapeWhere(this.db.selectFrom('Memory').selectAll(), prefix, suffix, opts).execute();
    return rows.map(rowToRecord);
  },

  async listAllMemoryMetaByKeyShape(this: PostgresKyselyStorage, prefix: string, suffix: string, opts?: KeyShapeOpts): Promise<MemoryMetaRow[]> {
    const rows = await keyShapeWhere(this.db.selectFrom('Memory').select(META_COLS), prefix, suffix, opts).execute();
    return rows.map(rowToMeta);
  },
};
