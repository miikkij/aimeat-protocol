/**
 * @file src/storage/providers/postgres-kysely/methods/content-labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres+Kysely implementation of the classification label store (TARGET-082). One
 *   row per labelled thing, addressed by (kind, scope, key); the batch read is one IN query per 500
 *   keys. Mirrors ../../sqlite/methods/content-labels.ts. Schema: migrations/0090_content_labels.sql.
 * @structure contentLabelMethods — getContentLabels · getContentLabel · getContentLabelsUnder ·
 *   putContentLabel · deleteContentLabel · listContentLabels · deleteContentLabelsByScope
 * @usage merged onto PostgresKyselyStorage.prototype in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-09-30 — getContentLabelsUnder: the labels under key prefixes (starts_with).
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import { sql, type Kysely, type Selectable, type SqlBool } from 'kysely';
import type {
  ContentLabelKind, ContentLabelRow, ContentLabelTarget, ContentLabelListQuery, ContentLabelSuggestion,
  ContentLabelEvent,
} from '../../../interface.js';
import type { ContentLabel as ContentLabelTable, DB } from '../db-types.js';
import { jsonb } from '../helpers.js';

/** The one member these methods read off the provider. Named structurally rather than imported
 *  from ../index.js, so this file does not close an import cycle with the class it is merged into. */
type PostgresKyselyStorage = { db: Kysely<DB> };

/** Keys per IN list. Well under the Postgres parameter limit, and a page is rarely larger. */
const CHUNK = 500;
/** Key prefixes per query. */
const PREFIX_CHUNK = 200;

function toRow(r: Selectable<ContentLabelTable>): ContentLabelRow {
  return {
    id: r.id,
    kind: r.kind as ContentLabelKind,
    scope: r.scope,
    key: r.key,
    ownerGaii: r.ownerGaii ?? null,
    label: r.label,
    source: r.source as ContentLabelRow['source'],
    locked: !!r.locked,
    suggestion: (r.suggestion as unknown as ContentLabelSuggestion | null) ?? null,
    justification: r.justification ?? null,
    humanSaid: r.humanSaid ?? null,
    history: (r.history as unknown as ContentLabelEvent[] | null) ?? [],
    setBy: r.setBy,
    updatedAt: r.updatedAt,
  };
}

export const contentLabelMethods = {
  async getContentLabels(this: PostgresKyselyStorage, kind: ContentLabelKind, scope: string, keys: string[]): Promise<ContentLabelRow[]> {
    const unique = [...new Set(keys)];
    const out: ContentLabelRow[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const part = unique.slice(i, i + CHUNK);
      const rows = await this.db.selectFrom('ContentLabel').selectAll()
        .where('kind', '=', kind).where('scope', '=', scope).where('key', 'in', part)
        .execute();
      for (const r of rows) out.push(toRow(r));
    }
    return out;
  },

  async getContentLabel(this: PostgresKyselyStorage, target: ContentLabelTarget): Promise<ContentLabelRow | undefined> {
    const r = await this.db.selectFrom('ContentLabel').selectAll()
      .where('kind', '=', target.kind).where('scope', '=', target.scope).where('key', '=', target.key)
      .executeTakeFirst();
    return r ? toRow(r) : undefined;
  },

  async getContentLabelsUnder(this: PostgresKyselyStorage, kind: ContentLabelKind, scope: string, prefixes: string[]): Promise<ContentLabelRow[]> {
    const unique = [...new Set(prefixes)].filter(Boolean);
    const out: ContentLabelRow[] = [];
    for (let i = 0; i < unique.length; i += PREFIX_CHUNK) {
      const part = unique.slice(i, i + PREFIX_CHUNK);
      // starts_with, not a key range: a range compares under the database collation, which need not
      // be byte order. The (kind, scope) part of the unique index narrows the scan.
      const rows = await this.db.selectFrom('ContentLabel').selectAll()
        .where('kind', '=', kind).where('scope', '=', scope)
        .where(eb => eb.or(part.map(p => sql<SqlBool>`starts_with(${sql.ref('key')}, ${p})`)))
        .execute();
      for (const r of rows) out.push(toRow(r));
    }
    return out;
  },

  async putContentLabel(this: PostgresKyselyStorage, row: ContentLabelRow): Promise<void> {
    const values = {
      id: row.id,
      kind: row.kind,
      scope: row.scope,
      key: row.key,
      ownerGaii: row.ownerGaii,
      label: row.label,
      source: row.source,
      locked: row.locked,
      suggestion: row.suggestion ? jsonb(row.suggestion) : null,
      justification: row.justification,
      humanSaid: row.humanSaid,
      history: jsonb(row.history.slice(-50)),
      setBy: row.setBy,
      updatedAt: row.updatedAt,
    };
    // The id of an existing row is kept: the conflict updates every column but it.
    await this.db.insertInto('ContentLabel').values(values as never)
      .onConflict(oc => oc.columns(['kind', 'scope', 'key']).doUpdateSet({
        ownerGaii: values.ownerGaii,
        label: values.label,
        source: values.source,
        locked: values.locked,
        suggestion: values.suggestion,
        justification: values.justification,
        humanSaid: values.humanSaid,
        history: values.history,
        setBy: values.setBy,
        updatedAt: values.updatedAt,
      } as never))
      .execute();
  },

  async deleteContentLabel(this: PostgresKyselyStorage, target: ContentLabelTarget): Promise<boolean> {
    const r = await this.db.deleteFrom('ContentLabel')
      .where('kind', '=', target.kind).where('scope', '=', target.scope).where('key', '=', target.key)
      .executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async listContentLabels(this: PostgresKyselyStorage, query: ContentLabelListQuery): Promise<ContentLabelRow[]> {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    let q = this.db.selectFrom('ContentLabel').selectAll().where('scope', '=', query.scope);
    if (query.kind) q = q.where('kind', '=', query.kind);
    if (query.after) q = q.where('key', '>', query.after);
    const rows = await q.orderBy('key', 'asc').orderBy('kind', 'asc').limit(limit).execute();
    return rows.map(toRow);
  },

  async deleteContentLabelsByScope(this: PostgresKyselyStorage, scope: string): Promise<number> {
    const r = await this.db.deleteFrom('ContentLabel').where('scope', '=', scope).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
