/**
 * @file src/storage/providers/postgres-kysely/methods/classification-audit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres+Kysely implementation of the classification audit log (TARGET-082 V4). A
 *   batch is ONE INSERT … ON CONFLICT per 500 rows that adds counts on the unique address (minute,
 *   reader, action, scope, kind, key). Postgres refuses an ON CONFLICT DO UPDATE that touches one row
 *   twice in a statement, so rows with the same address inside a batch are merged here first. The
 *   label and reader kind of the row with the later lastAt win, in the merge and in the conflict
 *   clause, so a retried older batch never overwrites a newer label.
 *   Mirrors ../../sqlite/methods/classification-audit.ts. Schema: migrations/0091_classification_audit.sql.
 * @structure mergeByAddress · classificationAuditMethods — addClassificationAudit ·
 *   listClassificationAudit · pruneClassificationAudit · deleteClassificationAuditByScope
 * @usage merged onto PostgresKyselyStorage.prototype in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-09-29 — An older row no longer overwrites a newer row's label (compare lastAt).
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import { sql, type Kysely, type Selectable } from 'kysely';
import type {
  ClassificationAuditRow, ClassificationAuditFilter, ContentLabelKind,
} from '../../../interface.js';
import type { ClassificationAudit as ClassificationAuditTable, DB } from '../db-types.js';

/** The one member these methods read off the provider. Named structurally rather than imported
 *  from ../index.js, so this file does not close an import cycle with the class it is merged into. */
type PostgresKyselyStorage = { db: Kysely<DB> };

/** Rows per statement: 14 parameters a row keeps a chunk far under the Postgres parameter limit. */
const CHUNK = 500;

function toRow(r: Selectable<ClassificationAuditTable>): ClassificationAuditRow {
  return {
    id: r.id,
    minute: r.minute,
    scope: r.scope,
    ownerGaii: r.ownerGaii ?? null,
    kind: r.kind as ContentLabelKind,
    key: r.key,
    label: r.label,
    reader: r.reader,
    readerKind: r.readerKind as ClassificationAuditRow['readerKind'],
    action: r.action as ClassificationAuditRow['action'],
    purpose: r.purpose ?? null,
    count: Number(r.count),
    firstAt: r.firstAt,
    lastAt: r.lastAt,
  };
}

/** Merge rows with the same address the way the ON CONFLICT clause merges a row into the table. */
function mergeByAddress(rows: ClassificationAuditRow[]): ClassificationAuditRow[] {
  const byAddress = new Map<string, ClassificationAuditRow>();
  for (const r of rows) {
    const address = [r.minute, r.reader, r.action, r.scope, r.kind, r.key].join('\u0000');
    const had = byAddress.get(address);
    if (!had) { byAddress.set(address, { ...r }); continue; }
    had.count += r.count;
    if (r.firstAt < had.firstAt) had.firstAt = r.firstAt;
    if (r.lastAt >= had.lastAt) {
      had.lastAt = r.lastAt;
      had.label = r.label;
      had.readerKind = r.readerKind;
    }
    if (r.purpose) had.purpose = r.purpose;
    if (r.ownerGaii) had.ownerGaii = r.ownerGaii;
  }
  return [...byAddress.values()];
}

export const classificationAuditMethods = {
  async addClassificationAudit(this: PostgresKyselyStorage, rows: ClassificationAuditRow[]): Promise<void> {
    const merged = mergeByAddress(rows);
    for (let i = 0; i < merged.length; i += CHUNK) {
      const part = merged.slice(i, i + CHUNK);
      // The id of an existing row is kept: the conflict updates everything but it and the address.
      await this.db.insertInto('ClassificationAudit')
        .values(part.map(r => ({
          id: r.id, minute: r.minute, scope: r.scope, ownerGaii: r.ownerGaii, kind: r.kind, key: r.key,
          label: r.label, reader: r.reader, readerKind: r.readerKind, action: r.action,
          purpose: r.purpose, count: r.count, firstAt: r.firstAt, lastAt: r.lastAt,
        })))
        .onConflict(oc => oc.columns(['minute', 'reader', 'action', 'scope', 'kind', 'key']).doUpdateSet({
          count: eb => sql`${eb.ref('ClassificationAudit.count')} + excluded."count"`,
          firstAt: eb => sql`least(${eb.ref('ClassificationAudit.firstAt')}, excluded."firstAt")`,
          lastAt: eb => sql`greatest(${eb.ref('ClassificationAudit.lastAt')}, excluded."lastAt")`,
          // The later row's label wins: a retried, older batch never overwrites a newer label.
          label: eb => sql`case when excluded."lastAt" >= ${eb.ref('ClassificationAudit.lastAt')} then excluded."label" else ${eb.ref('ClassificationAudit.label')} end`,
          readerKind: eb => sql`case when excluded."lastAt" >= ${eb.ref('ClassificationAudit.lastAt')} then excluded."readerKind" else ${eb.ref('ClassificationAudit.readerKind')} end`,
          purpose: eb => sql`coalesce(excluded."purpose", ${eb.ref('ClassificationAudit.purpose')})`,
          ownerGaii: eb => sql`coalesce(excluded."ownerGaii", ${eb.ref('ClassificationAudit.ownerGaii')})`,
        }))
        .execute();
    }
  },

  async listClassificationAudit(this: PostgresKyselyStorage, filter: ClassificationAuditFilter): Promise<ClassificationAuditRow[]> {
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
    let q = this.db.selectFrom('ClassificationAudit').selectAll();
    if (filter.ownerGaii) q = q.where('ownerGaii', '=', filter.ownerGaii);
    if (filter.scope) q = q.where('scope', '=', filter.scope);
    if (filter.since) q = q.where('lastAt', '>=', filter.since);
    if (filter.action) q = q.where('action', '=', filter.action);
    const rows = await q.orderBy('lastAt', 'desc').orderBy('id', 'asc').limit(limit).execute();
    return rows.map(toRow);
  },

  async pruneClassificationAudit(this: PostgresKyselyStorage, before: string): Promise<number> {
    const r = await this.db.deleteFrom('ClassificationAudit').where('lastAt', '<', before).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  async deleteClassificationAuditByScope(this: PostgresKyselyStorage, scope: string): Promise<number> {
    const r = await this.db.deleteFrom('ClassificationAudit').where('scope', '=', scope).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
