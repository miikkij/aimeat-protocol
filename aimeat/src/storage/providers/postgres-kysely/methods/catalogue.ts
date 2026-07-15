/**
 * @file src/storage/providers/postgres-kysely/methods/catalogue.ts
 * @description CSM / MSM catalogue domain for the Postgres+Kysely backend (Csm / Msm tables). CSM =
 *   Content Service Manifest, MSM = MCP Service Manifest; both keyed by unique `name`. Backs the CSM/MSM
 *   registration + the startup template seeding. Translated to match the Prisma provider.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: CSM/MSM catalogue on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { CsmRecord, MsmRecord } from '../../../interface.js';
import type { Csm, Msm } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toCsm(r: Selectable<Csm>): CsmRecord {
  return {
    name: r.name, definition: r.definition as Record<string, unknown>, jsonSchemaKey: r.jsonSchemaKey, serviceType: r.serviceType,
    registeredBy: r.registeredBy, registeredAt: iso(r.registeredAt), updatedAt: iso(r.updatedAt),
    semantic: (r.semantic ?? undefined) as CsmRecord['semantic'], federate: r.federate ?? undefined,
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
    await this.db.insertInto('Csm').values({
      name: r.name, definition: jsonb(r.definition), jsonSchemaKey: r.jsonSchemaKey, serviceType: r.serviceType,
      registeredBy: r.registeredBy, registeredAt: new Date(r.registeredAt), updatedAt: new Date(r.updatedAt),
      semantic: jsonb(r.semantic ?? null), federate: r.federate ?? false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
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
  async updateCsm(this: PostgresKyselyStorage, name: string, updates: Partial<CsmRecord>): Promise<CsmRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.definition !== undefined) data.definition = jsonb(updates.definition);
    if (updates.serviceType !== undefined) data.serviceType = updates.serviceType;
    if (updates.jsonSchemaKey !== undefined) data.jsonSchemaKey = updates.jsonSchemaKey;
    if (updates.semantic !== undefined) data.semantic = jsonb(updates.semantic ?? null);
    if (updates.federate !== undefined) data.federate = updates.federate;
    data.updatedAt = new Date();
    const rows = await this.db.updateTable('Csm').set(data as never).where('name', '=', name).returningAll().execute();
    return rows[0] ? toCsm(rows[0]) : null;
  },
  async deleteCsm(this: PostgresKyselyStorage, name: string): Promise<boolean> {
    const r = await this.db.deleteFrom('Csm').where('name', '=', name).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
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
