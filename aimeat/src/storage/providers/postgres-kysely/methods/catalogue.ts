/**
 * @file src/storage/providers/postgres-kysely/methods/catalogue.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description CSM / MSM catalogue domain for the Postgres+Kysely backend (Csm / Msm tables). CSM =
 *   Content Service Manifest, MSM = MCP Service Manifest; both keyed by unique `name`. Backs the CSM/MSM
 *   registration + the startup template seeding. Translated to match the Prisma provider.
 * @version-history
 *   v1.2.0 — 2026-11-07 — CSM visibility and versions (migration 0127): createCsm writes both and answers
 *     CSM_NAME_TAKEN on a unique violation as SQLite does, replaceCsmVersion keeps the replaced version in
 *     "CsmVersion" and raises the version in one transaction, setCsmVisibility, listCsmVersions,
 *     getCsmVersion; deleteCsm removes the kept versions too.
 *   v1.1.0 — 2026-09-09 — updateCsm deleted: no caller.
 *   v1.0.0 — 2026-07-15 — Phase 5: CSM/MSM catalogue on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { CsmRecord, CsmVersionRecord, MsmRecord } from '../../../interface.js';
import type { CsmVersionUpdate } from '../../../repositories/catalogue.repository.js';
import type { Csm, CsmVersion, Msm } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toCsm(r: Selectable<Csm>): CsmRecord {
  return {
    name: r.name, definition: r.definition as Record<string, unknown>, jsonSchemaKey: r.jsonSchemaKey, serviceType: r.serviceType,
    registeredBy: r.registeredBy, registeredAt: iso(r.registeredAt), updatedAt: iso(r.updatedAt),
    semantic: (r.semantic ?? undefined) as CsmRecord['semantic'], federate: r.federate ?? undefined,
    visibility: r.visibility || 'public', version: r.version > 0 ? r.version : 1,
  };
}
function toCsmVersion(r: Selectable<CsmVersion>): CsmVersionRecord {
  return {
    name: r.name, version: r.version, definition: r.definition as Record<string, unknown>,
    jsonSchema: r.jsonSchema as Record<string, unknown>, registeredBy: r.registeredBy, createdAt: iso(r.createdAt),
  };
}
function toMsm(r: Selectable<Msm>): MsmRecord {
  return {
    name: r.name, definition: r.definition as Record<string, unknown>, category: r.category, authType: r.authType,
    actionsCount: r.actionsCount, registeredBy: r.registeredBy, registeredAt: iso(r.registeredAt), updatedAt: iso(r.updatedAt),
    federate: r.federate ?? undefined,
  };
}

export const catalogueMethods = {
  async createCsm(this: PostgresKyselyStorage, r: CsmRecord): Promise<CsmRecord> {
    try {
      await this.db.insertInto('Csm').values({
        name: r.name, definition: jsonb(r.definition), jsonSchemaKey: r.jsonSchemaKey, serviceType: r.serviceType,
        registeredBy: r.registeredBy, registeredAt: new Date(r.registeredAt), updatedAt: new Date(r.updatedAt),
        semantic: jsonb(r.semantic ?? null), federate: r.federate ?? false,
        visibility: r.visibility ?? 'public', version: r.version ?? 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any).execute();
    } catch (err: unknown) {
      // The SQLite provider answers a taken name with CSM_NAME_TAKEN; the same here (23505 unique_violation).
      if ((err as { code?: string })?.code === '23505') throw new Error('CSM_NAME_TAKEN', { cause: err });
      throw err;
    }
    return r;
  },
  async getCsm(this: PostgresKyselyStorage, name: string): Promise<CsmRecord | null> {
    const r = await this.db.selectFrom('Csm').selectAll().where('name', '=', name).executeTakeFirst();
    return r ? toCsm(r) : null;
  },
  async listCsms(this: PostgresKyselyStorage, opts?: { serviceType?: string }): Promise<CsmRecord[]> {
    let q = this.db.selectFrom('Csm').selectAll();
    if (opts?.serviceType) q = q.where('serviceType', '=', opts.serviceType);
    return (await q.execute()).map(toCsm);
  },
  async deleteCsm(this: PostgresKyselyStorage, name: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('CsmVersion').where('name', '=', name).execute();
      const r = await trx.deleteFrom('Csm').where('name', '=', name).executeTakeFirst();
      return Number(r.numDeletedRows ?? 0) > 0;
    });
  },
  async replaceCsmVersion(
    this: PostgresKyselyStorage, name: string, expectedVersion: number, next: CsmVersionUpdate, previous: CsmVersionRecord,
  ): Promise<CsmRecord | null> {
    // The UPDATE names the expected version, so of two writers holding the same version one updates a
    // row and the other none; the history row is written only by the one that did, in its transaction.
    return this.db.transaction().execute(async (trx) => {
      const rows = await trx.updateTable('Csm').set({
        definition: jsonb(next.definition), serviceType: next.serviceType, semantic: jsonb(next.semantic ?? null),
        updatedAt: new Date(next.updatedAt), version: expectedVersion + 1,
      } as never).where('name', '=', name).where('version', '=', expectedVersion).returningAll().execute();
      if (!rows[0]) return null;
      await trx.insertInto('CsmVersion').values({
        name, version: previous.version, definition: jsonb(previous.definition), jsonSchema: jsonb(previous.jsonSchema),
        registeredBy: previous.registeredBy, createdAt: new Date(previous.createdAt),
      } as never).execute();
      return toCsm(rows[0]);
    });
  },
  async setCsmVisibility(this: PostgresKyselyStorage, name: string, visibility: string, updatedAt: string): Promise<boolean> {
    const r = await this.db.updateTable('Csm').set({ visibility, updatedAt: new Date(updatedAt) }).where('name', '=', name).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },
  async listCsmVersions(this: PostgresKyselyStorage, name: string, opts?: { limit?: number }): Promise<CsmVersionRecord[]> {
    const limit = Math.max(1, Math.min(opts?.limit ?? 1000, 1000));
    const rows = await this.db.selectFrom('CsmVersion').selectAll().where('name', '=', name).orderBy('version', 'asc').limit(limit).execute();
    return rows.map(toCsmVersion);
  },
  async getCsmVersion(this: PostgresKyselyStorage, name: string, version: number): Promise<CsmVersionRecord | null> {
    const r = await this.db.selectFrom('CsmVersion').selectAll().where('name', '=', name).where('version', '=', version).executeTakeFirst();
    return r ? toCsmVersion(r) : null;
  },

  async createMsm(this: PostgresKyselyStorage, r: MsmRecord): Promise<MsmRecord> {
    await this.db.insertInto('Msm').values({
      name: r.name, definition: jsonb(r.definition), category: r.category, authType: r.authType, actionsCount: r.actionsCount,
      registeredBy: r.registeredBy, registeredAt: new Date(r.registeredAt), updatedAt: new Date(r.updatedAt), federate: r.federate ?? false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return r;
  },
  async getMsm(this: PostgresKyselyStorage, name: string): Promise<MsmRecord | null> {
    const r = await this.db.selectFrom('Msm').selectAll().where('name', '=', name).executeTakeFirst();
    return r ? toMsm(r) : null;
  },
  async listMsms(this: PostgresKyselyStorage, opts?: { category?: string }): Promise<MsmRecord[]> {
    let q = this.db.selectFrom('Msm').selectAll();
    if (opts?.category) q = q.where('category', '=', opts.category);
    return (await q.execute()).map(toMsm);
  },
  async updateMsm(this: PostgresKyselyStorage, name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.definition !== undefined) data.definition = jsonb(updates.definition);
    if (updates.category !== undefined) data.category = updates.category;
    if (updates.authType !== undefined) data.authType = updates.authType;
    if (updates.actionsCount !== undefined) data.actionsCount = updates.actionsCount;
    if (updates.federate !== undefined) data.federate = updates.federate;
    data.updatedAt = new Date();
    const rows = await this.db.updateTable('Msm').set(data as never).where('name', '=', name).returningAll().execute();
    return rows[0] ? toMsm(rows[0]) : null;
  },
  async deleteMsm(this: PostgresKyselyStorage, name: string): Promise<boolean> {
    const r = await this.db.deleteFrom('Msm').where('name', '=', name).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
};
