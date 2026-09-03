/**
 * @file src/storage/providers/postgres-kysely/methods/dependencies.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres (Kysely) methods for the dependency map (repositories/dependency.repository.ts).
 *   Table "DependencyEdge" (migration 0065). The edges of one source are replaced inside one
 *   transaction, so a reader never sees the set half-written.
 * @structure dependencyMethods — replaceDependencyEdges · listDependencyEdges · deleteDependencyEdges
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (dependency map, slice 1).
 */
import type { PostgresKyselyStorage } from '../index.js';
import type { DependencyEdge, DependencyEdgeFilter, DependencyFromKind } from '../../../types/dependencies.js';

interface Row {
  fromKind: string; fromRef: string; fromVersion: string; toKind: string; toName: string;
  toVersion: string | null; via: string; updatedAt: Date | string;
}

function toEdge(r: Row): DependencyEdge {
  return {
    fromKind: r.fromKind as DependencyEdge['fromKind'],
    fromRef: r.fromRef,
    fromVersion: r.fromVersion,
    toKind: r.toKind as DependencyEdge['toKind'],
    toName: r.toName,
    toVersion: r.toVersion ?? null,
    via: r.via as DependencyEdge['via'],
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  };
}

export const dependencyMethods = {
  async replaceDependencyEdges(this: PostgresKyselyStorage, fromKind: DependencyFromKind, fromRef: string, edges: DependencyEdge[]): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('DependencyEdge').where('fromKind', '=', fromKind).where('fromRef', '=', fromRef).execute();
      if (!edges.length) return;
      await trx.insertInto('DependencyEdge').values(edges.map(e => ({
        fromKind, fromRef, fromVersion: e.fromVersion, toKind: e.toKind, toName: e.toName,
        toVersion: e.toVersion ?? null, via: e.via, updatedAt: new Date(e.updatedAt),
      }))).execute();
    });
  },

  async listDependencyEdges(this: PostgresKyselyStorage, filter: DependencyEdgeFilter = {}): Promise<DependencyEdge[]> {
    let q = this.db.selectFrom('DependencyEdge').selectAll();
    if (filter.fromKind) q = q.where('fromKind', '=', filter.fromKind);
    if (filter.fromRef) q = q.where('fromRef', '=', filter.fromRef);
    if (filter.toKind) q = q.where('toKind', '=', filter.toKind);
    if (filter.toName) q = q.where('toName', '=', filter.toName);
    const rows = await q.orderBy('fromKind').orderBy('fromRef').orderBy('toKind').orderBy('toName').execute();
    return rows.map(r => toEdge(r as Row));
  },

  async deleteDependencyEdges(this: PostgresKyselyStorage, fromKind: DependencyFromKind, fromRef: string): Promise<number> {
    const r = await this.db.deleteFrom('DependencyEdge').where('fromKind', '=', fromKind).where('fromRef', '=', fromRef).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
