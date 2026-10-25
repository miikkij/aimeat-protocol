/**
 * @file src/storage/providers/postgres-kysely/methods/component-versions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres (Kysely) methods for kept extension and cortex versions
 *   (repositories/component-version.repository.ts). Table "ComponentVersion" (migration 0066);
 *   the snapshot is jsonb.
 * @structure componentVersionMethods — saveComponentVersion · listComponentVersions ·
 *   getComponentVersion · deleteComponentVersions · recordReleasedComponentName ·
 *   getReleasedComponentName · deleteReleasedComponentName
 * @version-history
 *   v1.2.0 — 2026-10-25 — The released bare names, table "ReleasedComponentName" (migration 0119;
 *     owner namespaces wish, secaudit2026oct22).
 *   v1.1.0 — 2026-09-24 — saveComponentVersion keeps a version once (ON CONFLICT DO NOTHING) and
 *     answers whether it stored this one. ON CONFLICT DO UPDATE let a re-publish replace the snapshot
 *     a pinned address serves (secaudit 2026-09, A6-7).
 *   v1.0.0 — 2026-09-03 — Initial (versions, slice 2).
 */
import type { PostgresKyselyStorage } from '../index.js';
import type {
  ComponentKind, ComponentVersionRecord, ComponentVersionSummary, ReleasedComponentNameRecord,
} from '../../../types/component-versions.js';
import { jsonb } from '../helpers.js';

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : String(v));

export const componentVersionMethods = {
  async saveComponentVersion(this: PostgresKyselyStorage, record: ComponentVersionRecord): Promise<boolean> {
    const bytes = Buffer.byteLength(JSON.stringify(record.snapshot), 'utf8');
    // A kept version is never replaced: the conflict on the primary key writes nothing.
    const r = await this.db.insertInto('ComponentVersion').values({
      kind: record.kind, name: record.name, version: record.version,
      snapshot: jsonb(record.snapshot), bytes, createdAt: new Date(record.createdAt), createdBy: record.createdBy,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).onConflict(oc => oc.columns(['kind', 'name', 'version']).doNothing()).executeTakeFirst();
    return Number(r.numInsertedOrUpdatedRows ?? 0) > 0;
  },

  async listComponentVersions(this: PostgresKyselyStorage, kind: ComponentKind, name: string): Promise<ComponentVersionSummary[]> {
    const rows = await this.db.selectFrom('ComponentVersion')
      .select(['kind', 'name', 'version', 'bytes', 'createdAt', 'createdBy'])
      .where('kind', '=', kind).where('name', '=', name).orderBy('createdAt', 'desc').execute();
    return rows.map(r => ({ kind: r.kind as ComponentKind, name: r.name, version: r.version, bytes: Number(r.bytes), createdAt: iso(r.createdAt), createdBy: r.createdBy }));
  },

  async getComponentVersion(this: PostgresKyselyStorage, kind: ComponentKind, name: string, version: string): Promise<ComponentVersionRecord | null> {
    const r = await this.db.selectFrom('ComponentVersion').selectAll()
      .where('kind', '=', kind).where('name', '=', name).where('version', '=', version).executeTakeFirst();
    if (!r) return null;
    const snap = typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot;
    return { kind: r.kind as ComponentKind, name: r.name, version: r.version, snapshot: snap as Record<string, unknown>, bytes: Number(r.bytes), createdAt: iso(r.createdAt), createdBy: r.createdBy };
  },

  async deleteComponentVersions(this: PostgresKyselyStorage, kind: ComponentKind, name: string): Promise<number> {
    const r = await this.db.deleteFrom('ComponentVersion').where('kind', '=', kind).where('name', '=', name).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  async recordReleasedComponentName(this: PostgresKyselyStorage, record: ReleasedComponentNameRecord): Promise<void> {
    const releasedAt = new Date(record.releasedAt);
    await this.db.insertInto('ReleasedComponentName')
      .values({ kind: record.kind, name: record.name, holder: record.holder, releasedAt })
      .onConflict(oc => oc.columns(['kind', 'name']).doUpdateSet({ holder: record.holder, releasedAt }))
      .execute();
  },

  async getReleasedComponentName(this: PostgresKyselyStorage, kind: ComponentKind, name: string): Promise<ReleasedComponentNameRecord | null> {
    const r = await this.db.selectFrom('ReleasedComponentName').selectAll()
      .where('kind', '=', kind).where('name', '=', name).executeTakeFirst();
    return r ? { kind: r.kind as ComponentKind, name: r.name, holder: r.holder, releasedAt: iso(r.releasedAt) } : null;
  },

  async deleteReleasedComponentName(this: PostgresKyselyStorage, kind: ComponentKind, name: string): Promise<boolean> {
    const r = await this.db.deleteFrom('ReleasedComponentName').where('kind', '=', kind).where('name', '=', name).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
};
