/**
 * @file src/storage/providers/sqlite/methods/dependencies.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the dependency map (repositories/dependency.repository.ts): the
 *   edges of one source are replaced inside one transaction, so a reader never sees a half-written
 *   set between the delete and the inserts.
 * @structure dependencyMethods — replaceDependencyEdges · listDependencyEdges · deleteDependencyEdges
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (dependency map, slice 1).
 */
import type { SqliteStorage } from '../index.js';
import type { DependencyEdge, DependencyEdgeFilter, DependencyFromKind } from '../../../types/dependencies.js';

function toEdge(row: Record<string, unknown>): DependencyEdge {
  return {
    fromKind: row.fromKind as DependencyEdge['fromKind'],
    fromRef: row.fromRef as string,
    fromVersion: row.fromVersion as string,
    toKind: row.toKind as DependencyEdge['toKind'],
    toName: row.toName as string,
    toVersion: (row.toVersion as string | null) ?? null,
    via: row.via as DependencyEdge['via'],
    updatedAt: row.updatedAt as string,
  };
}

export const dependencyMethods = {
  async replaceDependencyEdges(this: SqliteStorage, fromKind: DependencyFromKind, fromRef: string, edges: DependencyEdge[]): Promise<void> {
    const del = this.db.prepare('DELETE FROM dependency_edges WHERE fromKind = ? AND fromRef = ?');
    const ins = this.db.prepare(
      `INSERT OR REPLACE INTO dependency_edges (fromKind, fromRef, fromVersion, toKind, toName, toVersion, via, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      del.run(fromKind, fromRef);
      for (const e of edges) {
        ins.run(fromKind, fromRef, e.fromVersion, e.toKind, e.toName, e.toVersion ?? null, e.via, e.updatedAt);
      }
    })();
  },

  async listDependencyEdges(this: SqliteStorage, filter: DependencyEdgeFilter = {}): Promise<DependencyEdge[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.fromKind) { where.push('fromKind = ?'); args.push(filter.fromKind); }
    if (filter.fromRef) { where.push('fromRef = ?'); args.push(filter.fromRef); }
    if (filter.toKind) { where.push('toKind = ?'); args.push(filter.toKind); }
    if (filter.toName) { where.push('toName = ?'); args.push(filter.toName); }
    const sql = `SELECT * FROM dependency_edges${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY fromKind, fromRef, toKind, toName`;
    const rows = this.db.prepare(sql).all(...args) as Record<string, unknown>[];
    return rows.map(toEdge);
  },

  async deleteDependencyEdges(this: SqliteStorage, fromKind: DependencyFromKind, fromRef: string): Promise<number> {
    const r = this.db.prepare('DELETE FROM dependency_edges WHERE fromKind = ? AND fromRef = ?').run(fromKind, fromRef);
    return Number(r.changes ?? 0);
  },
};
