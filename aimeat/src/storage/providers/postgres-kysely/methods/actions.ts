/**
 * @file src/storage/providers/postgres-kysely/methods/actions.ts
 * @description Action (offers/services) domain for the Postgres+Kysely backend (Action table). Backs the
 *   provider-owned action definitions + the owner delete/usage cascades. Translated 1:1 from the Prisma
 *   implementation: the flat pricing columns fold back into the nested `pricing` object, the JSON columns
 *   (input/output schema, perUnit, semantic) round-trip through jsonb, and the (actionId, providerGaii)
 *   unique key is enforced by an explicit existence check on create (ACTION_EXISTS).
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: action domain on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import type { ActionRecord } from '../../../interface.js';
import type { Action } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toAction(r: Selectable<Action>): ActionRecord {
  return {
    id: r.actionId, providerGaii: r.providerGaii, displayName: r.displayName, description: r.description,
    category: r.category ?? undefined,
    inputSchema: r.inputSchema as Record<string, unknown>, outputSchema: r.outputSchema as Record<string, unknown>,
    pricing: { baseMorsels: r.pricingBaseMorsels, perUnit: r.pricingPerUnit as ActionRecord['pricing']['perUnit'] },
    estimatedTimeSeconds: r.estimatedTimeSeconds ?? undefined, maxInputSizeBytes: r.maxInputSizeBytes ?? undefined,
    tags: r.tags ?? [], webhookUrl: r.webhookUrl ?? undefined,
    semantic: (r.semantic ?? undefined) as ActionRecord['semantic'], federate: r.federate ?? false,
    createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  };
}

export const actionMethods = {
  async createAction(this: PostgresKyselyStorage, action: ActionRecord): Promise<ActionRecord> {
    const existing = await this.db.selectFrom('Action').select('actionId')
      .where('actionId', '=', action.id).where('providerGaii', '=', action.providerGaii).executeTakeFirst();
    if (existing) throw new Error('ACTION_EXISTS');
    const [row] = await this.db.insertInto('Action').values({
      actionId: action.id, providerGaii: action.providerGaii, displayName: action.displayName, description: action.description,
      category: action.category ?? null, inputSchema: jsonb(action.inputSchema), outputSchema: jsonb(action.outputSchema),
      pricingBaseMorsels: action.pricing.baseMorsels, pricingPerUnit: jsonb(action.pricing.perUnit ?? null),
      estimatedTimeSeconds: action.estimatedTimeSeconds ?? null, maxInputSizeBytes: action.maxInputSizeBytes ?? null,
      tags: action.tags, webhookUrl: action.webhookUrl ?? null, semantic: jsonb(action.semantic ?? null),
      federate: action.federate ?? false, createdAt: new Date(action.createdAt), updatedAt: new Date(action.updatedAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).returningAll().execute();
    return toAction(row);
  },
  async getAction(this: PostgresKyselyStorage, id: string, providerGaii: string): Promise<ActionRecord | null> {
    const r = await this.db.selectFrom('Action').selectAll()
      .where('actionId', '=', id).where('providerGaii', '=', providerGaii).executeTakeFirst();
    return r ? toAction(r) : null;
  },
  async listActions(this: PostgresKyselyStorage, opts?: { search?: string; category?: string }): Promise<ActionRecord[]> {
    let q = this.db.selectFrom('Action').selectAll();
    if (opts?.category) q = q.where('category', '=', opts.category);
    let results = (await q.execute()).map(toAction);
    if (opts?.search) {
      const term = opts.search.toLowerCase();
      results = results.filter(a =>
        a.displayName.toLowerCase().includes(term) ||
        a.description.toLowerCase().includes(term) ||
        a.tags.some(t => t.toLowerCase().includes(term))
      );
    }
    return results;
  },
  async deleteAction(this: PostgresKyselyStorage, id: string, providerGaii: string): Promise<boolean> {
    const r = await this.db.deleteFrom('Action')
      .where('actionId', '=', id).where('providerGaii', '=', providerGaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
  async deleteActionsByProvider(this: PostgresKyselyStorage, gaii: string): Promise<number> {
    const r = await this.db.deleteFrom('Action').where('providerGaii', '=', gaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
  async listActionsByProvider(this: PostgresKyselyStorage, gaii: string): Promise<ActionRecord[]> {
    return (await this.db.selectFrom('Action').selectAll().where('providerGaii', '=', gaii).execute()).map(toAction);
  },
  async countActionsForProviders(this: PostgresKyselyStorage, providerGaiis: string[]): Promise<number> {
    if (providerGaiis.length === 0) return 0;
    const r = await this.db.selectFrom('Action').select(sql<number>`count(*)`.as('n'))
      .where('providerGaii', 'in', providerGaiis).executeTakeFirst();
    return Number(r?.n ?? 0);
  },
  async updateAction(this: PostgresKyselyStorage, id: string, providerGaii: string, updates: Partial<ActionRecord>): Promise<ActionRecord | null> {
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.displayName !== undefined) data.displayName = updates.displayName;
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.category !== undefined) data.category = updates.category ?? null;
    if (updates.inputSchema !== undefined) data.inputSchema = jsonb(updates.inputSchema);
    if (updates.outputSchema !== undefined) data.outputSchema = jsonb(updates.outputSchema);
    if (updates.estimatedTimeSeconds !== undefined) data.estimatedTimeSeconds = updates.estimatedTimeSeconds ?? null;
    if (updates.maxInputSizeBytes !== undefined) data.maxInputSizeBytes = updates.maxInputSizeBytes ?? null;
    if (updates.tags !== undefined) data.tags = updates.tags;
    if (updates.webhookUrl !== undefined) data.webhookUrl = updates.webhookUrl ?? null;
    if (updates.semantic !== undefined) data.semantic = jsonb(updates.semantic ?? null);
    if (updates.federate !== undefined) data.federate = updates.federate;
    if (updates.pricing) {
      data.pricingBaseMorsels = updates.pricing.baseMorsels;
      data.pricingPerUnit = jsonb(updates.pricing.perUnit ?? null);
    }
    const rows = await this.db.updateTable('Action').set(data as never)
      .where('actionId', '=', id).where('providerGaii', '=', providerGaii).returningAll().execute();
    return rows[0] ? toAction(rows[0]) : null;
  },
};
