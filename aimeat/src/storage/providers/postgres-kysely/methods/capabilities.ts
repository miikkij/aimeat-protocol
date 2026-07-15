/**
 * @file src/storage/providers/postgres-kysely/methods/capabilities.ts
 * @description Capability domain for the Postgres+Kysely backend (Capability / CapabilityLog): agent
 *   capability CRUD, listing/filtering with pagination, invocation stats, execution logs, operator
 *   overrides, and trust/vouch tracking. `stats`, `trust`, `operatorOverride` (and the schema/exports/
 *   cost/examples/tags JSON columns) are stored as JSONB, so the increment/trust mutators are
 *   read-modify-write on the JSON blob — identical semantics to the Prisma (Mongo/PG) implementation.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: capability layer on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { CapabilityRecord, CapabilityLogEntry, CapabilityOverride, CapabilityTrust, CapabilityFilter } from '../../../interface.js';
import type { Capability } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

const DEFAULT_TRUST: CapabilityTrust = { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null };
const DEFAULT_STATS: CapabilityRecord['stats'] = { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null };

function toCapability(r: Selectable<Capability>): CapabilityRecord {
  return {
    id: r.id,
    name: r.name,
    summary: r.summary ?? '',
    ownerGhii: r.ownerGhii,
    visibility: (r.visibility ?? 'private') as CapabilityRecord['visibility'],
    scope: 'local',
    status: (r.status ?? 'draft') as CapabilityRecord['status'],
    rejectionReason: r.rejectionReason ?? null,
    deprecationMessage: r.deprecationMessage ?? null,
    replacedBy: r.replacedBy ?? null,
    source: { type: r.sourceType as CapabilityRecord['source']['type'], ref: r.sourceRef, version: r.sourceVersion ?? '' },
    authRequired: (r.authRequired ?? 'registered') as CapabilityRecord['authRequired'],
    callable: r.callable ?? false,
    inputSchema: (r.inputSchema ?? null) as CapabilityRecord['inputSchema'],
    outputSchema: (r.outputSchema ?? null) as CapabilityRecord['outputSchema'],
    exports: (r.exports ?? null) as CapabilityRecord['exports'],
    usage: r.usage ?? '',
    whenToUse: r.whenToUse ?? '',
    whenNotToUse: r.whenNotToUse ?? '',
    examples: (r.examples ?? []) as CapabilityRecord['examples'],
    dependencies: (r.dependencies ?? []) as unknown as CapabilityRecord['dependencies'],
    schemaHash: r.schemaHash ?? '',
    webhookUrl: r.webhookUrl ?? null,
    cost: (r.cost ?? null) as CapabilityRecord['cost'],
    trustRequired: r.trustRequired ?? null,
    trust: (r.trust ?? DEFAULT_TRUST) as CapabilityRecord['trust'],
    redactedFields: (r.redactedFields ?? []) as CapabilityRecord['redactedFields'],
    operatorOverride: (r.operatorOverride ?? null) as CapabilityRecord['operatorOverride'],
    stats: (r.stats ?? DEFAULT_STATS) as CapabilityRecord['stats'],
    tags: (r.tags ?? []) as CapabilityRecord['tags'],
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export const capabilityMethods = {
  async createCapability(this: PostgresKyselyStorage, record: CapabilityRecord): Promise<CapabilityRecord> {
    await this.db.insertInto('Capability').values({
      id: record.id, name: record.name, summary: record.summary,
      ownerGhii: record.ownerGhii, visibility: record.visibility, scope: record.scope,
      status: record.status, rejectionReason: record.rejectionReason ?? null,
      deprecationMessage: record.deprecationMessage ?? null, replacedBy: record.replacedBy ?? null,
      sourceType: record.source.type, sourceRef: record.source.ref, sourceVersion: record.source.version,
      authRequired: record.authRequired, callable: record.callable,
      inputSchema: jsonb(record.inputSchema ?? null), outputSchema: jsonb(record.outputSchema ?? null),
      exports: jsonb(record.exports ?? null), usage: record.usage,
      whenToUse: record.whenToUse, whenNotToUse: record.whenNotToUse,
      examples: jsonb(record.examples), dependencies: jsonb(record.dependencies),
      schemaHash: record.schemaHash, webhookUrl: record.webhookUrl ?? null,
      cost: jsonb(record.cost ?? null), trustRequired: record.trustRequired ?? null,
      trust: jsonb(record.trust), redactedFields: jsonb(record.redactedFields),
      operatorOverride: jsonb(record.operatorOverride ?? null),
      stats: jsonb(record.stats), tags: jsonb(record.tags),
      createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return record;
  },

  async getCapability(this: PostgresKyselyStorage, id: string): Promise<CapabilityRecord | null> {
    const r = await this.db.selectFrom('Capability').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toCapability(r) : null;
  },

  async updateCapability(this: PostgresKyselyStorage, id: string, updates: Partial<CapabilityRecord>): Promise<CapabilityRecord | null> {
    const data: Record<string, unknown> = { ...updates };
    delete data.id;
    if (updates.source) {
      data.sourceType = updates.source.type;
      data.sourceRef = updates.source.ref;
      data.sourceVersion = updates.source.version;
      delete data.source;
    }
    // nullable JSONB columns (value or null)
    for (const f of ['inputSchema', 'outputSchema', 'exports', 'cost', 'operatorOverride'] as const) {
      if (f in data) data[f] = jsonb(updates[f] ?? null);
    }
    // required JSONB columns
    for (const f of ['examples', 'dependencies', 'trust', 'stats', 'tags', 'redactedFields'] as const) {
      if (f in data) data[f] = jsonb(updates[f]);
    }
    if (typeof data.createdAt === 'string') data.createdAt = new Date(data.createdAt);
    data.updatedAt = updates.updatedAt ? new Date(updates.updatedAt) : new Date();
    try {
      const rows = await this.db.updateTable('Capability').set(data as never).where('id', '=', id).returningAll().execute();
      return rows[0] ? toCapability(rows[0]) : null;
    } catch { return null; }
  },

  async deleteCapability(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('Capability').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async listCapabilities(this: PostgresKyselyStorage, filters: CapabilityFilter): Promise<{ capabilities: CapabilityRecord[]; total: number }> {
    const page = filters.page || 1;
    const perPage = filters.perPage || 20;
    let base = this.db.selectFrom('Capability');
    if (filters.ownerGhii) base = base.where('ownerGhii', '=', filters.ownerGhii);
    if (filters.visibility) base = base.where('visibility', '=', filters.visibility);
    if (filters.publicOrOwner) base = base.where(eb => eb.or([eb('visibility', '=', 'public'), eb('ownerGhii', '=', filters.publicOrOwner!)]));
    if (filters.status) base = base.where('status', '=', filters.status);
    if (filters.sourceType) base = base.where('sourceType', '=', filters.sourceType);
    if (filters.authRequired) base = base.where('authRequired', '=', filters.authRequired);
    if (filters.callable !== undefined) base = base.where('callable', '=', filters.callable);
    if (filters.search) base = base.where(eb => eb.or([eb('name', 'ilike', `%${filters.search}%`), eb('summary', 'ilike', `%${filters.search}%`)]));
    const rows = await base.selectAll().orderBy('updatedAt', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    const totalRow = await base.select(this.db.fn.countAll<number>().as('n')).executeTakeFirst();
    let caps = rows.map(toCapability);
    if (filters.tags?.length) {
      caps = caps.filter(c => filters.tags!.some(t => c.tags.includes(t)));
    }
    return { capabilities: caps, total: Number(totalRow?.n ?? 0) };
  },

  async listCapabilitiesByOwner(this: PostgresKyselyStorage, ownerGhii: string): Promise<CapabilityRecord[]> {
    const rows = await this.db.selectFrom('Capability').selectAll().where('ownerGhii', '=', ownerGhii).orderBy('updatedAt', 'desc').execute();
    return rows.map(toCapability);
  },

  async getCapabilityBySourceRef(this: PostgresKyselyStorage, sourceRef: string): Promise<CapabilityRecord | null> {
    const r = await this.db.selectFrom('Capability').selectAll().where('sourceRef', '=', sourceRef).executeTakeFirst();
    return r ? toCapability(r) : null;
  },

  async listCapabilitiesBySourceType(this: PostgresKyselyStorage, sourceType: string): Promise<CapabilityRecord[]> {
    const rows = await this.db.selectFrom('Capability').selectAll().where('sourceType', '=', sourceType).execute();
    return rows.map(toCapability);
  },

  async incrementCapabilityStats(this: PostgresKyselyStorage, id: string, delta: { success: number; error: number; totalMs: number; lastError?: string }): Promise<void> {
    const cap = await this.getCapability(id);
    if (!cap) return;
    const s = cap.stats;
    const newTotal = s.totalInvocations + delta.success + delta.error;
    const totalMs = (s.avgResponseMs * s.totalInvocations) + delta.totalMs;
    const updated = {
      totalInvocations: newTotal,
      successCount: s.successCount + delta.success,
      errorCount: s.errorCount + delta.error,
      lastInvokedAt: new Date().toISOString(),
      avgResponseMs: newTotal > 0 ? Math.round(totalMs / newTotal) : 0,
      lastError: delta.lastError ?? s.lastError,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.updateTable('Capability').set({ stats: jsonb(updated) } as any).where('id', '=', id).execute();
  },

  async addCapabilityLog(this: PostgresKyselyStorage, entry: CapabilityLogEntry): Promise<void> {
    await this.db.insertInto('CapabilityLog').values({
      capabilityId: entry.capabilityId, callerGhii: entry.callerGhii,
      input: jsonb(entry.input), status: entry.status,
      durationMs: entry.durationMs, error: entry.error ?? null,
      timestamp: new Date(entry.timestamp),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
  },

  async listCapabilityLogs(this: PostgresKyselyStorage, capabilityId: string, filters: { status?: 'success' | 'error'; page?: number; perPage?: number }): Promise<{ logs: CapabilityLogEntry[]; total: number }> {
    const page = filters.page || 1;
    const perPage = filters.perPage || 50;
    let base = this.db.selectFrom('CapabilityLog').where('capabilityId', '=', capabilityId);
    if (filters.status) base = base.where('status', '=', filters.status);
    const rows = await base.selectAll().orderBy('timestamp', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    const totalRow = await base.select(this.db.fn.countAll<number>().as('n')).executeTakeFirst();
    const logs: CapabilityLogEntry[] = rows.map(r => ({
      id: r.id,
      capabilityId: r.capabilityId,
      callerGhii: r.callerGhii,
      input: (r.input ?? {}) as CapabilityLogEntry['input'],
      status: r.status as CapabilityLogEntry['status'],
      durationMs: r.durationMs,
      error: r.error ?? null,
      timestamp: iso(r.timestamp),
    }));
    return { logs, total: Number(totalRow?.n ?? 0) };
  },

  async deleteCapabilityLogsBefore(this: PostgresKyselyStorage, before: string): Promise<number> {
    const r = await this.db.deleteFrom('CapabilityLog').where('timestamp', '<', new Date(before)).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  async setCapabilityOverride(this: PostgresKyselyStorage, id: string, override: CapabilityOverride | null): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.updateTable('Capability').set({ operatorOverride: jsonb(override ?? null) } as any).where('id', '=', id).execute();
  },

  async setCapabilityTrust(this: PostgresKyselyStorage, id: string, trustUpdates: Partial<CapabilityTrust>): Promise<void> {
    const cap = await this.getCapability(id);
    if (!cap) return;
    const merged = { ...cap.trust, ...trustUpdates };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.updateTable('Capability').set({ trust: jsonb(merged) } as any).where('id', '=', id).execute();
  },

  async incrementVouchCount(this: PostgresKyselyStorage, id: string): Promise<void> {
    const cap = await this.getCapability(id);
    if (!cap) return;
    const trust = { ...cap.trust, vouchCount: cap.trust.vouchCount + 1 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.updateTable('Capability').set({ trust: jsonb(trust) } as any).where('id', '=', id).execute();
  },

  async decrementVouchCount(this: PostgresKyselyStorage, id: string): Promise<void> {
    const cap = await this.getCapability(id);
    if (!cap) return;
    const trust = { ...cap.trust, vouchCount: Math.max(0, cap.trust.vouchCount - 1) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.updateTable('Capability').set({ trust: jsonb(trust) } as any).where('id', '=', id).execute();
  },
};
