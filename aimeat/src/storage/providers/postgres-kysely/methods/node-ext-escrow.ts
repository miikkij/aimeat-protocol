/**
 * @file src/storage/providers/postgres-kysely/methods/node-ext-escrow.ts
 * @description Node-level extension / cortex / escrow domain for the Postgres+Kysely backend:
 *   WASM extensions (Extension), per-owner extension instances (ExtensionInstance), generic escrow
 *   holds (EscrowHold), and manifest-based cortex extensions + their lib files (CortexExtension /
 *   CortexLibFile). Translated 1:1 from the Prisma implementation against the same tables — jsonb
 *   columns go through the shared `jsonb()` param helper; status/visibility unions are DB strings.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: node extension/instance/escrow/cortex on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type {
  CortexExtensionRecord, EscrowHoldRecord, ExtensionInstanceRecord, ExtensionRecord,
} from '../../../interface.js';
import type { CortexExtension, EscrowHold, Extension, ExtensionInstance } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoOpt = (t: Date | string | null | undefined): string | undefined => (t == null ? undefined : iso(t));

function toExtension(r: Selectable<Extension>): ExtensionRecord {
  return {
    name: r.name, version: r.version, description: r.description, author: r.author,
    status: r.status as ExtensionRecord['status'], requiredApis: r.requiredApis ?? [],
    actions: r.actions as unknown as ExtensionRecord['actions'], config: r.config as Record<string, unknown>,
    limits: r.limits as unknown as ExtensionRecord['limits'], federation: r.federation as unknown as ExtensionRecord['federation'],
    installedBy: r.installedBy, installedAt: iso(r.installedAt), activatedAt: isoOpt(r.activatedAt),
    ...(r.instances ? { instances: r.instances as unknown as ExtensionRecord['instances'] } : {}),
  };
}
function toEscrow(r: Selectable<EscrowHold>): EscrowHoldRecord {
  return {
    holdId: r.holdId, fromGaii: r.fromGaii, amount: r.amount, reason: r.reason,
    status: r.status as EscrowHoldRecord['status'], extensionName: r.extensionName,
    createdAt: iso(r.createdAt), releasedAt: isoOpt(r.releasedAt), releasedTo: r.releasedTo ?? undefined,
  };
}
function toCortex(r: Selectable<CortexExtension>): CortexExtensionRecord {
  return {
    name: r.name, namespace: r.namespace, shortName: r.shortName, apiVersion: r.apiVersion, version: r.version,
    description: r.description, author: r.author, license: r.license ?? undefined, tags: r.tags ?? [],
    labels: r.labels as unknown as Record<string, string>, aimeatCompat: r.aimeatCompat ?? undefined,
    status: r.status as CortexExtensionRecord['status'], visibility: r.visibility as CortexExtensionRecord['visibility'],
    installedAt: iso(r.installedAt), activatedAt: isoOpt(r.activatedAt), installedBy: r.installedBy, manifest: r.manifest,
    components: r.components as unknown as CortexExtensionRecord['components'],
    activationArtifacts: r.activationArtifacts as unknown as CortexExtensionRecord['activationArtifacts'],
  };
}
function toInstance(r: Selectable<ExtensionInstance>): ExtensionInstanceRecord {
  return {
    id: r.instanceId, extensionName: r.extensionName, config: (r.config as Record<string, unknown>) || {},
    status: r.status as ExtensionInstanceRecord['status'],
    translations: (r.translations ?? undefined) as ExtensionInstanceRecord['translations'],
    createdBy: r.createdBy, createdByAgent: r.createdByAgent ?? undefined,
    createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  };
}

export const nodeExtEscrowMethods = {
  // ── Node Extensions (WASM) ───────────────────────────────────
  async createExtension(this: PostgresKyselyStorage, record: ExtensionRecord): Promise<ExtensionRecord> {
    await this.db.insertInto('Extension').values({
      name: record.name, version: record.version, description: record.description, author: record.author,
      status: record.status, requiredApis: record.requiredApis, actions: jsonb(record.actions), config: jsonb(record.config),
      limits: jsonb(record.limits), federation: jsonb(record.federation), instances: jsonb(record.instances ?? null),
      installedBy: record.installedBy, installedAt: new Date(record.installedAt),
      activatedAt: record.activatedAt ? new Date(record.activatedAt) : null, updatedAt: new Date(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return record;
  },
  async getExtension(this: PostgresKyselyStorage, name: string): Promise<ExtensionRecord | null> {
    const r = await this.db.selectFrom('Extension').selectAll().where('name', '=', name).executeTakeFirst();
    return r ? toExtension(r) : null;
  },
  async listExtensions(this: PostgresKyselyStorage, opts?: { status?: string }): Promise<ExtensionRecord[]> {
    let q = this.db.selectFrom('Extension').selectAll();
    if (opts?.status) q = q.where('status', '=', opts.status);
    return (await q.execute()).map(toExtension);
  },
  async updateExtension(this: PostgresKyselyStorage, name: string, updates: Partial<ExtensionRecord>): Promise<ExtensionRecord | null> {
    try {
      const data: Record<string, unknown> = { ...updates };
      delete data.name;
      if ('actions' in data) data.actions = jsonb(data.actions);
      if ('config' in data) data.config = jsonb(data.config);
      if ('limits' in data) data.limits = jsonb(data.limits);
      if ('federation' in data) data.federation = jsonb(data.federation);
      if ('instances' in data) data.instances = jsonb(data.instances ?? null);
      if (typeof data.activatedAt === 'string') data.activatedAt = new Date(data.activatedAt);
      if (typeof data.installedAt === 'string') data.installedAt = new Date(data.installedAt);
      data.updatedAt = new Date();
      const rows = await this.db.updateTable('Extension').set(data as never).where('name', '=', name).returningAll().execute();
      return rows[0] ? toExtension(rows[0]) : null;
    } catch { return null; }
  },
  async deleteExtension(this: PostgresKyselyStorage, name: string): Promise<boolean> {
    const r = await this.db.deleteFrom('Extension').where('name', '=', name).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  // ── Generic Escrow ───────────────────────────────────────────
  async createEscrowHold(this: PostgresKyselyStorage, record: EscrowHoldRecord): Promise<EscrowHoldRecord> {
    await this.db.insertInto('EscrowHold').values({
      holdId: record.holdId, fromGaii: record.fromGaii, amount: record.amount, reason: record.reason,
      status: record.status, extensionName: record.extensionName, createdAt: new Date(record.createdAt),
      releasedAt: record.releasedAt ? new Date(record.releasedAt) : null, releasedTo: record.releasedTo ?? null,
      updatedAt: new Date(),
    }).execute();
    return record;
  },
  async getEscrowHold(this: PostgresKyselyStorage, holdId: string): Promise<EscrowHoldRecord | null> {
    const r = await this.db.selectFrom('EscrowHold').selectAll().where('holdId', '=', holdId).executeTakeFirst();
    return r ? toEscrow(r) : null;
  },
  async listEscrowHolds(this: PostgresKyselyStorage, fromGaii: string, opts?: { status?: string }): Promise<EscrowHoldRecord[]> {
    let q = this.db.selectFrom('EscrowHold').selectAll().where('fromGaii', '=', fromGaii);
    if (opts?.status) q = q.where('status', '=', opts.status);
    return (await q.execute()).map(toEscrow);
  },
  async releaseEscrowHold(this: PostgresKyselyStorage, holdId: string, toGaii: string): Promise<EscrowHoldRecord | null> {
    const existing = await this.db.selectFrom('EscrowHold').select('status').where('holdId', '=', holdId).executeTakeFirst();
    if (!existing || existing.status !== 'held') return null;
    const rows = await this.db.updateTable('EscrowHold')
      .set({ status: 'released', releasedTo: toGaii, releasedAt: new Date(), updatedAt: new Date() })
      .where('holdId', '=', holdId).returningAll().execute();
    return rows[0] ? toEscrow(rows[0]) : null;
  },
  async refundEscrowHold(this: PostgresKyselyStorage, holdId: string): Promise<EscrowHoldRecord | null> {
    const existing = await this.db.selectFrom('EscrowHold').select('status').where('holdId', '=', holdId).executeTakeFirst();
    if (!existing || existing.status !== 'held') return null;
    const rows = await this.db.updateTable('EscrowHold')
      .set({ status: 'refunded', releasedAt: new Date(), updatedAt: new Date() })
      .where('holdId', '=', holdId).returningAll().execute();
    return rows[0] ? toEscrow(rows[0]) : null;
  },

  // ── Cortex Extensions (manifest-based) + lib files ───────────
  async createCortexExtension(this: PostgresKyselyStorage, record: CortexExtensionRecord): Promise<CortexExtensionRecord> {
    try {
      await this.db.insertInto('CortexExtension').values({
        name: record.name, namespace: record.namespace, shortName: record.shortName, apiVersion: record.apiVersion,
        version: record.version, description: record.description, author: record.author, license: record.license ?? null,
        tags: record.tags, labels: jsonb(record.labels), aimeatCompat: record.aimeatCompat ?? null, status: record.status,
        visibility: record.visibility, installedAt: new Date(record.installedAt),
        activatedAt: record.activatedAt ? new Date(record.activatedAt) : null, installedBy: record.installedBy,
        manifest: record.manifest, components: jsonb(record.components), activationArtifacts: jsonb(record.activationArtifacts),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any).execute();
      return record;
    } catch { throw new Error(`Cortex extension "${record.name}" already exists`); }
  },
  async getCortexExtension(this: PostgresKyselyStorage, name: string): Promise<CortexExtensionRecord | null> {
    const r = await this.db.selectFrom('CortexExtension').selectAll().where('name', '=', name).executeTakeFirst();
    return r ? toCortex(r) : null;
  },
  async listCortexExtensions(this: PostgresKyselyStorage, opts?: { status?: string; namespace?: string; visibility?: string; installedBy?: string }): Promise<CortexExtensionRecord[]> {
    let q = this.db.selectFrom('CortexExtension').selectAll();
    if (opts?.status) q = q.where('status', '=', opts.status);
    if (opts?.namespace) q = q.where('namespace', '=', opts.namespace);
    if (opts?.visibility) q = q.where('visibility', '=', opts.visibility);
    if (opts?.installedBy) q = q.where('installedBy', '=', opts.installedBy);
    return (await q.execute()).map(toCortex);
  },
  async updateCortexExtension(this: PostgresKyselyStorage, name: string, updates: Partial<CortexExtensionRecord>): Promise<CortexExtensionRecord | null> {
    try {
      const data: Record<string, unknown> = { ...updates };
      delete data.name;
      if ('labels' in data) data.labels = jsonb(data.labels);
      if ('components' in data) data.components = jsonb(data.components);
      if ('activationArtifacts' in data) data.activationArtifacts = jsonb(data.activationArtifacts);
      if (typeof data.activatedAt === 'string') data.activatedAt = new Date(data.activatedAt);
      if (typeof data.installedAt === 'string') data.installedAt = new Date(data.installedAt);
      const rows = await this.db.updateTable('CortexExtension').set(data as never).where('name', '=', name).returningAll().execute();
      return rows[0] ? toCortex(rows[0]) : null;
    } catch { return null; }
  },
  async deleteCortexExtension(this: PostgresKyselyStorage, name: string): Promise<boolean> {
    const r = await this.db.deleteFrom('CortexExtension').where('name', '=', name).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
  async setCortexLibFile(this: PostgresKyselyStorage, extName: string, libName: string, content: string): Promise<void> {
    await this.db.insertInto('CortexLibFile').values({ extName, libName, content })
      .onConflict(oc => oc.columns(['extName', 'libName']).doUpdateSet({ content })).execute();
  },
  async getCortexLibFile(this: PostgresKyselyStorage, extName: string, libName: string): Promise<string | null> {
    const r = await this.db.selectFrom('CortexLibFile').select('content').where('extName', '=', extName).where('libName', '=', libName).executeTakeFirst();
    return r?.content ?? null;
  },
  async deleteCortexLibFile(this: PostgresKyselyStorage, extName: string, libName: string): Promise<boolean> {
    const r = await this.db.deleteFrom('CortexLibFile').where('extName', '=', extName).where('libName', '=', libName).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  // ── Extension Instances (per-owner) ──────────────────────────
  async createExtensionInstance(this: PostgresKyselyStorage, record: ExtensionInstanceRecord): Promise<ExtensionInstanceRecord> {
    await this.db.insertInto('ExtensionInstance').values({
      instanceId: record.id, extensionName: record.extensionName, config: jsonb(record.config), status: record.status,
      translations: jsonb(record.translations ?? null), createdBy: record.createdBy,
      createdByAgent: record.createdByAgent ?? null, createdAt: new Date(record.createdAt), updatedAt: new Date(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return record;
  },
  async getExtensionInstance(this: PostgresKyselyStorage, extensionName: string, instanceId: string): Promise<ExtensionInstanceRecord | null> {
    const r = await this.db.selectFrom('ExtensionInstance').selectAll().where('extensionName', '=', extensionName).where('instanceId', '=', instanceId).executeTakeFirst();
    return r ? toInstance(r) : null;
  },
  async listExtensionInstances(this: PostgresKyselyStorage, extensionName: string): Promise<ExtensionInstanceRecord[]> {
    const rows = await this.db.selectFrom('ExtensionInstance').selectAll().where('extensionName', '=', extensionName).orderBy('createdAt', 'desc').execute();
    return rows.map(toInstance);
  },
  async updateExtensionInstance(this: PostgresKyselyStorage, extensionName: string, instanceId: string, updates: Partial<ExtensionInstanceRecord>): Promise<ExtensionInstanceRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.config !== undefined) data.config = jsonb(updates.config);
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.translations !== undefined) data.translations = jsonb(updates.translations ?? null);
    data.updatedAt = new Date();
    const rows = await this.db.updateTable('ExtensionInstance').set(data as never)
      .where('extensionName', '=', extensionName).where('instanceId', '=', instanceId).returningAll().execute();
    return rows[0] ? toInstance(rows[0]) : null;
  },
  async deleteExtensionInstance(this: PostgresKyselyStorage, extensionName: string, instanceId: string): Promise<boolean> {
    const r = await this.db.deleteFrom('ExtensionInstance').where('extensionName', '=', extensionName).where('instanceId', '=', instanceId).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
  async deleteExtensionInstancesByOwner(this: PostgresKyselyStorage, ownerIdentity: string): Promise<number> {
    const r = await this.db.deleteFrom('ExtensionInstance').where('createdBy', '=', ownerIdentity).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
