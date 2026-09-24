/**
 * @file src/storage/providers/sqlite/methods/component-versions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for kept extension and cortex versions
 *   (repositories/component-version.repository.ts). The snapshot is one JSON column.
 * @structure componentVersionMethods — saveComponentVersion · listComponentVersions ·
 *   getComponentVersion · deleteComponentVersions
 * @version-history
 *   v1.1.0 — 2026-09-24 — saveComponentVersion keeps a version once (ON CONFLICT DO NOTHING) and
 *     answers whether it stored this one. INSERT OR REPLACE let a re-publish replace the snapshot a
 *     pinned address serves (secaudit 2026-09, A6-7).
 *   v1.0.0 — 2026-09-03 — Initial (versions, slice 2).
 */
import type { SqliteStorage } from '../index.js';
import type { ComponentKind, ComponentVersionRecord, ComponentVersionSummary } from '../../../types/component-versions.js';

export const componentVersionMethods = {
  async saveComponentVersion(this: SqliteStorage, record: ComponentVersionRecord): Promise<boolean> {
    const snapshot = JSON.stringify(record.snapshot);
    // A kept version is never replaced: the conflict on the primary key writes nothing.
    const r = this.db.prepare(
      `INSERT INTO component_versions (kind, name, version, snapshot, bytes, createdAt, createdBy)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (kind, name, version) DO NOTHING`,
    ).run(record.kind, record.name, record.version, snapshot, Buffer.byteLength(snapshot, 'utf8'), record.createdAt, record.createdBy);
    return Number(r.changes ?? 0) > 0;
  },

  async listComponentVersions(this: SqliteStorage, kind: ComponentKind, name: string): Promise<ComponentVersionSummary[]> {
    const rows = this.db.prepare(
      'SELECT kind, name, version, bytes, createdAt, createdBy FROM component_versions WHERE kind = ? AND name = ? ORDER BY createdAt DESC',
    ).all(kind, name) as ComponentVersionSummary[];
    return rows;
  },

  async getComponentVersion(this: SqliteStorage, kind: ComponentKind, name: string, version: string): Promise<ComponentVersionRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM component_versions WHERE kind = ? AND name = ? AND version = ?',
    ).get(kind, name, version) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      kind: row.kind as ComponentKind, name: row.name as string, version: row.version as string,
      snapshot: JSON.parse(row.snapshot as string) as Record<string, unknown>,
      bytes: Number(row.bytes), createdAt: row.createdAt as string, createdBy: row.createdBy as string,
    };
  },

  async deleteComponentVersions(this: SqliteStorage, kind: ComponentKind, name: string): Promise<number> {
    const r = this.db.prepare('DELETE FROM component_versions WHERE kind = ? AND name = ?').run(kind, name);
    return Number(r.changes ?? 0);
  },
};
