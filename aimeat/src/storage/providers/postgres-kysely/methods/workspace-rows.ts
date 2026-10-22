/**
 * @file src/storage/providers/postgres-kysely/methods/workspace-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres implementation of workspace row spaces.
 *
 *   THE APPEND IS ONE STATEMENT for the whole batch, with ON CONFLICT on the (organism, workspace,
 *   namespace, rowId) identity. A per-row loop was the shape the storage redesign measured and
 *   replaced: proper bulk insert took an import from 600 queries to 104, and a publish of 50 records
 *   from 350 to 5. A new table starts at the destination rather than repeating the journey.
 *
 *   THE CURSOR EXPRESSION IS WRITTEN OUT rather than using a row-value comparison, so it is
 *   character-for-character the condition the SQLite side runs. Two spellings of pagination is how
 *   two backends end up paginating differently, which passes every test on the fast local one.
 * @structure workspaceRowMethods — append / get / getByIds / list / delete / deleteBefore / trim /
 *   stats / usage, and the row revisions (append / list / get / deleteForRow / prune)
 * @usage Object.assign(PostgresKyselyStorage.prototype, workspaceRowMethods) in ../index.ts
 * @version-history
 *   v1.2.0 — 2026-10-22 — updatedBy (migration 0113), getWorkspaceRowsByIds, and the row revisions:
 *     a row's earlier content kept when another writer family replaced it (secaudit 2026-10, v80).
 *   v1.1.0 — 2026-09-09 — deleteWorkspaceRowSpace deleted: no caller outside its unit test.
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { sql } from 'kysely';
import type {
  WorkspaceRowRecord,
  WorkspaceRowFilter,
  WorkspaceRowPage,
  WorkspaceRowStats,
  WorkspaceRowUsage,
  WorkspaceRowScope,
  WorkspaceRowRevision,
} from '../../../interface.js';
import { encodeRowCursor, decodeRowCursor } from '../../../workspace-row-cursor.js';
import type { PostgresKyselyStorage } from '../index.js';

function toRow(r: Record<string, unknown>): WorkspaceRowRecord {
  const body = r.body && typeof r.body === 'object' && !Array.isArray(r.body)
    ? (r.body as Record<string, unknown>) : {};
  return {
    id: r.id as string,
    organismId: r.organismId as string,
    wsId: r.wsId as string,
    namespace: r.namespace as string,
    rowId: r.rowId as string,
    k1: (r.k1 as string) ?? '',
    k2: (r.k2 as string) ?? '',
    k3: (r.k3 as string) ?? '',
    occurredAt: r.occurredAt as string,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
    createdBy: (r.createdBy as string) ?? '',
    updatedBy: (r.updatedBy as string | null) ?? '',
    body,
    bytes: Number(r.bytes ?? 0),
  };
}

function toRevision(r: Record<string, unknown>): WorkspaceRowRevision {
  const body = r.body && typeof r.body === 'object' && !Array.isArray(r.body)
    ? (r.body as Record<string, unknown>) : {};
  return {
    revisionId: r.revisionId as string,
    organismId: r.organismId as string,
    wsId: r.wsId as string,
    namespace: r.namespace as string,
    rowId: r.rowId as string,
    id: r.id as string,
    occurredAt: r.occurredAt as string,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
    createdBy: (r.createdBy as string) ?? '',
    updatedBy: (r.updatedBy as string) ?? '',
    body,
    bytes: Number(r.bytes ?? 0),
    replacedAt: r.replacedAt as string,
    replacedBy: (r.replacedBy as string) ?? '',
  };
}

const bounded = (n: number | undefined, fallback: number): number =>
  Math.min(Math.max(n ?? fallback, 1), 500);

export const workspaceRowMethods = {
  async appendWorkspaceRows(this: PostgresKyselyStorage, rows: WorkspaceRowRecord[]): Promise<void> {
    if (!rows.length) return;
    // ON CONFLICT keeps "id" and "createdAt": when a row first arrived is a fact a re-run of an
    // ingest does not get to rewrite.
    await this.db.insertInto('WorkspaceRow')
      .values(rows.map(r => ({
        id: r.id, organismId: r.organismId, wsId: r.wsId, namespace: r.namespace, rowId: r.rowId,
        k1: r.k1, k2: r.k2, k3: r.k3,
        occurredAt: r.occurredAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
        createdBy: r.createdBy, updatedBy: r.updatedBy || r.createdBy,
        body: JSON.stringify(r.body), bytes: r.bytes,
      })))
      // `excluded."col"` written as raw SQL rather than through a builder ref: that is the idiom
      // the memory tally already runs in production here, and the `excluded` pseudo-table is not a
      // table the schema types know about.
      .onConflict(oc => oc
        .columns(['organismId', 'wsId', 'namespace', 'rowId'])
        .doUpdateSet({
          k1: () => sql`excluded."k1"`,
          k2: () => sql`excluded."k2"`,
          k3: () => sql`excluded."k3"`,
          occurredAt: () => sql`excluded."occurredAt"`,
          updatedAt: () => sql`excluded."updatedAt"`,
          createdBy: () => sql`excluded."createdBy"`,
          updatedBy: () => sql`excluded."updatedBy"`,
          body: () => sql`excluded."body"`,
          bytes: () => sql`excluded."bytes"`,
        }))
      .execute();
  },

  async getWorkspaceRow(
    this: PostgresKyselyStorage, organismId: string, wsId: string, namespace: string, rowId: string,
  ): Promise<WorkspaceRowRecord | null> {
    const row = await this.db.selectFrom('WorkspaceRow').selectAll()
      .where('organismId', '=', organismId)
      .where('wsId', '=', wsId)
      .where('namespace', '=', namespace)
      .where('rowId', '=', rowId)
      .executeTakeFirst();
    return row ? toRow(row as unknown as Record<string, unknown>) : null;
  },

  async listWorkspaceRows(
    this: PostgresKyselyStorage, filter: WorkspaceRowFilter,
  ): Promise<WorkspaceRowPage> {
    const desc = filter.order !== 'asc';
    let q = this.db.selectFrom('WorkspaceRow').selectAll()
      .where('organismId', '=', filter.organismId)
      .where('wsId', '=', filter.wsId)
      .where('namespace', '=', filter.namespace);

    if (filter.k1) q = q.where('k1', '=', filter.k1);
    if (filter.k2) q = q.where('k2', '=', filter.k2);
    if (filter.k3) q = q.where('k3', '=', filter.k3);
    if (filter.since) q = q.where('occurredAt', '>=', filter.since);
    if (filter.until) q = q.where('occurredAt', '<=', filter.until);
    if (filter.changedSince) q = q.where('updatedAt', '>', filter.changedSince);

    const after = decodeRowCursor(filter.cursor);
    if (after) {
      const { occurredAt, id } = after;
      q = desc
        ? q.where(sql<boolean>`("occurredAt" < ${occurredAt} OR ("occurredAt" = ${occurredAt} AND "id" < ${id}))`)
        : q.where(sql<boolean>`("occurredAt" > ${occurredAt} OR ("occurredAt" = ${occurredAt} AND "id" > ${id}))`);
    }

    // One more than asked for, so "is there another page" costs no second query.
    const limit = bounded(filter.limit, 100);
    const dir = desc ? 'desc' : 'asc';
    const rows = await q
      .orderBy('occurredAt', dir).orderBy('id', dir)
      .limit(limit + 1).execute();

    const page = rows.slice(0, limit).map(r => toRow(r as unknown as Record<string, unknown>));
    const more = rows.length > limit;
    const last = page[page.length - 1];
    return { rows: page, cursor: more && last ? encodeRowCursor(last.occurredAt, last.id) : null };
  },

  async deleteWorkspaceRow(
    this: PostgresKyselyStorage, organismId: string, wsId: string, namespace: string, rowId: string,
  ): Promise<boolean> {
    const res = await this.db.deleteFrom('WorkspaceRow')
      .where('organismId', '=', organismId)
      .where('wsId', '=', wsId)
      .where('namespace', '=', namespace)
      .where('rowId', '=', rowId)
      .executeTakeFirst();
    return Number(res?.numDeletedRows ?? 0) > 0;
  },

  async deleteWorkspaceRowsBefore(
    this: PostgresKyselyStorage, organismId: string, wsId: string, namespace: string, before: string,
  ): Promise<number> {
    // createdAt, not occurredAt: retention is a promise about how long WE keep a row.
    const res = await this.db.deleteFrom('WorkspaceRow')
      .where('organismId', '=', organismId)
      .where('wsId', '=', wsId)
      .where('namespace', '=', namespace)
      .where('createdAt', '<', before)
      .executeTakeFirst();
    return Number(res?.numDeletedRows ?? 0);
  },

  async trimWorkspaceRows(
    this: PostgresKyselyStorage, organismId: string, wsId: string, namespace: string, keep: number,
  ): Promise<number> {
    return this.transaction(async () => {
      const overflow = await this.db.selectFrom('WorkspaceRow').select('id')
        .where('organismId', '=', organismId)
        .where('wsId', '=', wsId)
        .where('namespace', '=', namespace)
        .orderBy('occurredAt', 'desc').orderBy('id', 'desc')
        .offset(Math.max(keep, 0)).limit(5000).execute();
      const ids = overflow.map(r => r.id);
      if (!ids.length) return 0;
      await this.db.deleteFrom('WorkspaceRow').where('id', 'in', ids).execute();
      return ids.length;
    });
  },

  async workspaceRowStats(
    this: PostgresKyselyStorage, organismId: string, wsId: string, namespace?: string,
  ): Promise<WorkspaceRowStats[]> {
    let q = this.db.selectFrom('WorkspaceRow')
      .select(({ fn }) => [
        'namespace',
        fn.countAll<string>().as('rows'),
        fn.sum<string>('bytes').as('bytes'),
        fn.min<string>('occurredAt').as('oldest'),
        fn.max<string>('occurredAt').as('newest'),
        fn.max<string>('createdAt').as('lastWriteAt'),
      ])
      .where('organismId', '=', organismId)
      .where('wsId', '=', wsId);
    if (namespace) q = q.where('namespace', '=', namespace);
    const rows = await q.groupBy('namespace').execute();
    return rows.map(r => ({
      namespace: r.namespace as string,
      rows: Number(r.rows ?? 0),
      bytes: Number(r.bytes ?? 0),
      oldest: (r.oldest as string | null) ?? null,
      newest: (r.newest as string | null) ?? null,
      lastWriteAt: (r.lastWriteAt as string | null) ?? null,
    }));
  },

  async workspaceRowUsage(
    this: PostgresKyselyStorage, scope: WorkspaceRowScope,
  ): Promise<WorkspaceRowUsage> {
    let q = this.db.selectFrom('WorkspaceRow')
      .select(({ fn }) => [fn.countAll<string>().as('rows'), fn.sum<string>('bytes').as('bytes')])
      .where('organismId', '=', scope.organismId);
    if (scope.wsId) q = q.where('wsId', '=', scope.wsId);
    const row = await q.executeTakeFirst();
    return { rows: Number(row?.rows ?? 0), bytes: Number(row?.bytes ?? 0) };
  },

  async getWorkspaceRowsByIds(
    this: PostgresKyselyStorage, organismId: string, wsId: string, namespace: string, rowIds: string[],
  ): Promise<WorkspaceRowRecord[]> {
    const ids = [...new Set(rowIds)];
    if (!ids.length) return [];
    const rows = await this.db.selectFrom('WorkspaceRow').selectAll()
      .where('organismId', '=', organismId)
      .where('wsId', '=', wsId)
      .where('namespace', '=', namespace)
      .where('rowId', 'in', ids)
      .execute();
    return rows.map(r => toRow(r as unknown as Record<string, unknown>));
  },

  // ── Row revisions: a row's earlier content, kept when another writer family replaced it
  //    (services/workspace-rows/row-service.ts). The prune runs the same three conditions as the
  //    SQLite side (repos/workspace-row-revisions.ts). ──

  async appendWorkspaceRowRevisions(this: PostgresKyselyStorage, revisions: WorkspaceRowRevision[]): Promise<void> {
    if (!revisions.length) return;
    await this.db.insertInto('WorkspaceRowRevision')
      .values(revisions.map(r => ({
        revisionId: r.revisionId, organismId: r.organismId, wsId: r.wsId, namespace: r.namespace,
        rowId: r.rowId, id: r.id, occurredAt: r.occurredAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
        createdBy: r.createdBy, updatedBy: r.updatedBy, body: JSON.stringify(r.body), bytes: r.bytes,
        replacedAt: r.replacedAt, replacedBy: r.replacedBy,
      })))
      .execute();
  },

  async listWorkspaceRowRevisions(
    this: PostgresKyselyStorage, organismId: string, wsId: string, namespace: string, rowId: string,
  ): Promise<WorkspaceRowRevision[]> {
    const rows = await this.db.selectFrom('WorkspaceRowRevision').selectAll()
      .where('organismId', '=', organismId)
      .where('wsId', '=', wsId)
      .where('namespace', '=', namespace)
      .where('rowId', '=', rowId)
      .orderBy('replacedAt', 'desc').orderBy('revisionId', 'desc')
      .limit(100).execute();
    return rows.map(r => toRevision(r as unknown as Record<string, unknown>));
  },

  async getWorkspaceRowRevision(
    this: PostgresKyselyStorage, organismId: string, wsId: string, namespace: string, revisionId: string,
  ): Promise<WorkspaceRowRevision | null> {
    const row = await this.db.selectFrom('WorkspaceRowRevision').selectAll()
      .where('organismId', '=', organismId)
      .where('wsId', '=', wsId)
      .where('namespace', '=', namespace)
      .where('revisionId', '=', revisionId)
      .executeTakeFirst();
    return row ? toRevision(row as unknown as Record<string, unknown>) : null;
  },

  async deleteWorkspaceRowRevisions(
    this: PostgresKyselyStorage, organismId: string, wsId: string, namespace: string, rowId: string,
  ): Promise<number> {
    const res = await this.db.deleteFrom('WorkspaceRowRevision')
      .where('organismId', '=', organismId)
      .where('wsId', '=', wsId)
      .where('namespace', '=', namespace)
      .where('rowId', '=', rowId)
      .executeTakeFirst();
    return Number(res?.numDeletedRows ?? 0);
  },

  async pruneWorkspaceRowRevisions(
    this: PostgresKyselyStorage, organismId: string, wsId: string, namespace: string, before: string, keepPerRow: number,
  ): Promise<number> {
    return this.transaction(async () => {
      const space = sql<boolean>`"organismId" = ${organismId} AND "wsId" = ${wsId} AND "namespace" = ${namespace}`;
      const aged = await this.db.deleteFrom('WorkspaceRowRevision')
        .where(space).where('replacedAt', '<', before).executeTakeFirst();
      const orphaned = await sql`
        DELETE FROM "WorkspaceRowRevision" r
        WHERE r."organismId" = ${organismId} AND r."wsId" = ${wsId} AND r."namespace" = ${namespace}
          AND NOT EXISTS (SELECT 1 FROM "WorkspaceRow" w WHERE w."organismId" = r."organismId"
            AND w."wsId" = r."wsId" AND w."namespace" = r."namespace" AND w."rowId" = r."rowId")`
        .execute(this.db);
      const over = await sql`
        DELETE FROM "WorkspaceRowRevision" WHERE "revisionId" IN (
          SELECT "revisionId" FROM (
            SELECT "revisionId", ROW_NUMBER() OVER (PARTITION BY "rowId" ORDER BY "replacedAt" DESC, "revisionId" DESC) AS n
            FROM "WorkspaceRowRevision"
            WHERE "organismId" = ${organismId} AND "wsId" = ${wsId} AND "namespace" = ${namespace}
          ) ranked WHERE n > ${Math.max(keepPerRow, 0)})`
        .execute(this.db);
      return Number(aged?.numDeletedRows ?? 0)
        + Number(orphaned.numAffectedRows ?? 0) + Number(over.numAffectedRows ?? 0);
    });
  },
};
