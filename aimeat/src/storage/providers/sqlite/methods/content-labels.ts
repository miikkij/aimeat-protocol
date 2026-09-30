/**
 * @file src/storage/providers/sqlite/methods/content-labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of the classification label store (TARGET-082). One row per
 *   labelled thing, addressed by (kind, scope, key); the batch read is one IN query per 500 keys.
 *   Mirrors ../../postgres-kysely/methods/content-labels.ts. Schema: ../schema-tables-4.ts.
 * @structure contentLabelMethods — getContentLabels · getContentLabel · getContentLabelsUnder ·
 *   putContentLabel · deleteContentLabel · listContentLabels · deleteContentLabelsByScope
 * @usage merged onto SqliteStorage.prototype in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-09-30 — getContentLabelsUnder: the labels under key prefixes, one key range each.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import type {
  ContentLabelKind, ContentLabelRow, ContentLabelTarget, ContentLabelListQuery,
} from '../../../interface.js';
import type Database from 'better-sqlite3';

/** The one member these methods read off the provider. Named structurally rather than imported
 *  from ../index.js, so this file does not close an import cycle with the class it is merged into. */
type SqliteStorage = { db: Database.Database };

/** Keys per IN list, under SQLite's default parameter limit. */
const CHUNK = 500;
/** Key prefixes per query (two parameters each). */
const PREFIX_CHUNK = 200;

function deserialize(r: Record<string, unknown>): ContentLabelRow {
  return {
    id: r.id as string,
    kind: r.kind as ContentLabelKind,
    scope: r.scope as string,
    key: r.key as string,
    ownerGaii: (r.ownerGaii as string | null) ?? null,
    label: r.label as string,
    source: r.source as ContentLabelRow['source'],
    locked: !!r.locked,
    suggestion: r.suggestion ? JSON.parse(r.suggestion as string) : null,
    justification: (r.justification as string | null) ?? null,
    humanSaid: (r.humanSaid as string | null) ?? null,
    history: r.history ? JSON.parse(r.history as string) : [],
    setBy: r.setBy as string,
    updatedAt: r.updatedAt as string,
  };
}

export const contentLabelMethods = {
  async getContentLabels(this: SqliteStorage, kind: ContentLabelKind, scope: string, keys: string[]): Promise<ContentLabelRow[]> {
    const unique = [...new Set(keys)];
    const out: ContentLabelRow[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const part = unique.slice(i, i + CHUNK);
      const marks = part.map(() => '?').join(', ');
      const rows = this.db.prepare(`SELECT * FROM content_labels WHERE kind = ? AND scope = ? AND key IN (${marks})`)
        .all(kind, scope, ...part) as Record<string, unknown>[];
      for (const r of rows) out.push(deserialize(r));
    }
    return out;
  },

  async getContentLabel(this: SqliteStorage, target: ContentLabelTarget): Promise<ContentLabelRow | undefined> {
    const r = this.db.prepare('SELECT * FROM content_labels WHERE kind = ? AND scope = ? AND key = ?')
      .get(target.kind, target.scope, target.key) as Record<string, unknown> | undefined;
    return r ? deserialize(r) : undefined;
  },

  async getContentLabelsUnder(this: SqliteStorage, kind: ContentLabelKind, scope: string, prefixes: string[]): Promise<ContentLabelRow[]> {
    const unique = [...new Set(prefixes)].filter(Boolean);
    const out: ContentLabelRow[] = [];
    for (let i = 0; i < unique.length; i += PREFIX_CHUNK) {
      const part = unique.slice(i, i + PREFIX_CHUNK);
      // A key range per prefix, [prefix, prefix with its last character raised), read on the
      // (kind, scope, key) index; the column compares bytes (BINARY), and startsWith below is exact.
      const ranges = part.map(() => '(key >= ? AND key < ?)').join(' OR ');
      const args = part.flatMap(p => [p, p.slice(0, -1) + String.fromCharCode(p.charCodeAt(p.length - 1) + 1)]);
      const rows = this.db.prepare(`SELECT * FROM content_labels WHERE kind = ? AND scope = ? AND (${ranges})`)
        .all(kind, scope, ...args) as Record<string, unknown>[];
      for (const r of rows) if (part.some(p => (r.key as string).startsWith(p))) out.push(deserialize(r));
    }
    return out;
  },

  async putContentLabel(this: SqliteStorage, row: ContentLabelRow): Promise<void> {
    // The id of an existing row is kept: the conflict updates every column but it.
    this.db.prepare(`
      INSERT INTO content_labels (id, kind, scope, key, ownerGaii, label, source, locked, suggestion,
        justification, humanSaid, history, setBy, updatedAt)
      VALUES (@id, @kind, @scope, @key, @ownerGaii, @label, @source, @locked, @suggestion,
        @justification, @humanSaid, @history, @setBy, @updatedAt)
      ON CONFLICT(kind, scope, key) DO UPDATE SET
        ownerGaii = excluded.ownerGaii, label = excluded.label, source = excluded.source,
        locked = excluded.locked, suggestion = excluded.suggestion,
        justification = excluded.justification, humanSaid = excluded.humanSaid,
        history = excluded.history, setBy = excluded.setBy, updatedAt = excluded.updatedAt
    `).run({
      id: row.id,
      kind: row.kind,
      scope: row.scope,
      key: row.key,
      ownerGaii: row.ownerGaii,
      label: row.label,
      source: row.source,
      locked: row.locked ? 1 : 0,
      suggestion: row.suggestion ? JSON.stringify(row.suggestion) : null,
      justification: row.justification,
      humanSaid: row.humanSaid,
      history: JSON.stringify(row.history.slice(-50)),
      setBy: row.setBy,
      updatedAt: row.updatedAt,
    });
  },

  async deleteContentLabel(this: SqliteStorage, target: ContentLabelTarget): Promise<boolean> {
    const r = this.db.prepare('DELETE FROM content_labels WHERE kind = ? AND scope = ? AND key = ?')
      .run(target.kind, target.scope, target.key);
    return r.changes > 0;
  },

  async listContentLabels(this: SqliteStorage, query: ContentLabelListQuery): Promise<ContentLabelRow[]> {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const where: string[] = ['scope = ?'];
    const args: unknown[] = [query.scope];
    if (query.kind) { where.push('kind = ?'); args.push(query.kind); }
    if (query.after) { where.push('key > ?'); args.push(query.after); }
    const rows = this.db.prepare(`SELECT * FROM content_labels WHERE ${where.join(' AND ')} ORDER BY key ASC, kind ASC LIMIT ?`)
      .all(...args, limit) as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  async deleteContentLabelsByScope(this: SqliteStorage, scope: string): Promise<number> {
    return this.db.prepare('DELETE FROM content_labels WHERE scope = ?').run(scope).changes;
  },
};
