/**
 * @file src/storage/providers/sqlite/methods/classification-audit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of the classification audit log (TARGET-082 V4). A batch is one
 *   transaction running one prepared upsert per row, which is the fast path in better-sqlite3; a row
 *   with an address (minute, reader, action, scope, kind, key) that already exists has its count
 *   added to. Rows repeated inside a batch merge the same way, because each statement sees the one
 *   before it. The label and reader kind of the row with the later lastAt win, so a batch that
 *   arrives late (a retried flush) never overwrites a newer label with an older one.
 *   Mirrors ../../postgres-kysely/methods/classification-audit.ts. Schema: ../schema-tables-4.ts.
 * @structure classificationAuditMethods — addClassificationAudit · listClassificationAudit ·
 *   pruneClassificationAudit · deleteClassificationAuditByScope
 * @usage merged onto SqliteStorage.prototype in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-09-29 — An older row no longer overwrites a newer row's label (compare lastAt).
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import type {
  ClassificationAuditRow, ClassificationAuditFilter, ContentLabelKind,
} from '../../../interface.js';
import type Database from 'better-sqlite3';

/** The one member these methods read off the provider. Named structurally rather than imported
 *  from ../index.js, so this file does not close an import cycle with the class it is merged into. */
type SqliteStorage = { db: Database.Database };

function deserialize(r: Record<string, unknown>): ClassificationAuditRow {
  return {
    id: r.id as string,
    minute: r.minute as string,
    scope: r.scope as string,
    ownerGaii: (r.ownerGaii as string | null) ?? null,
    kind: r.kind as ContentLabelKind,
    key: r.key as string,
    label: r.label as string,
    reader: r.reader as string,
    readerKind: r.readerKind as ClassificationAuditRow['readerKind'],
    action: r.action as ClassificationAuditRow['action'],
    purpose: (r.purpose as string | null) ?? null,
    count: Number(r.count),
    firstAt: r.firstAt as string,
    lastAt: r.lastAt as string,
  };
}

const UPSERT = `
  INSERT INTO classification_audit (id, minute, scope, ownerGaii, kind, key, label, reader, readerKind,
    action, purpose, count, firstAt, lastAt)
  VALUES (@id, @minute, @scope, @ownerGaii, @kind, @key, @label, @reader, @readerKind,
    @action, @purpose, @count, @firstAt, @lastAt)
  ON CONFLICT(minute, reader, action, scope, kind, key) DO UPDATE SET
    count = classification_audit.count + excluded.count,
    firstAt = min(classification_audit.firstAt, excluded.firstAt),
    lastAt = max(classification_audit.lastAt, excluded.lastAt),
    label = CASE WHEN excluded.lastAt >= classification_audit.lastAt THEN excluded.label ELSE classification_audit.label END,
    readerKind = CASE WHEN excluded.lastAt >= classification_audit.lastAt THEN excluded.readerKind ELSE classification_audit.readerKind END,
    purpose = coalesce(excluded.purpose, classification_audit.purpose),
    ownerGaii = coalesce(excluded.ownerGaii, classification_audit.ownerGaii)
`;

export const classificationAuditMethods = {
  async addClassificationAudit(this: SqliteStorage, rows: ClassificationAuditRow[]): Promise<void> {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(UPSERT);
    const run = this.db.transaction((batch: ClassificationAuditRow[]) => {
      for (const r of batch) {
        stmt.run({
          id: r.id, minute: r.minute, scope: r.scope, ownerGaii: r.ownerGaii, kind: r.kind, key: r.key,
          label: r.label, reader: r.reader, readerKind: r.readerKind, action: r.action,
          purpose: r.purpose, count: r.count, firstAt: r.firstAt, lastAt: r.lastAt,
        });
      }
    });
    run(rows);
  },

  async listClassificationAudit(this: SqliteStorage, filter: ClassificationAuditFilter): Promise<ClassificationAuditRow[]> {
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.ownerGaii) { where.push('ownerGaii = ?'); args.push(filter.ownerGaii); }
    if (filter.scope) { where.push('scope = ?'); args.push(filter.scope); }
    if (filter.since) { where.push('lastAt >= ?'); args.push(filter.since); }
    if (filter.action) { where.push('action = ?'); args.push(filter.action); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM classification_audit ${clause} ORDER BY lastAt DESC, id ASC LIMIT ?`)
      .all(...args, limit) as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  async pruneClassificationAudit(this: SqliteStorage, before: string): Promise<number> {
    return this.db.prepare('DELETE FROM classification_audit WHERE lastAt < ?').run(before).changes;
  },

  async deleteClassificationAuditByScope(this: SqliteStorage, scope: string): Promise<number> {
    return this.db.prepare('DELETE FROM classification_audit WHERE scope = ?').run(scope).changes;
  },
};
