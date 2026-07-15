/**
 * @file src/storage/providers/postgres-kysely/methods/agent-onboarding.ts
 * @description Agent onboarding records for the Postgres+Kysely backend (AgentOnboarding table, keyed by
 *   agentGaii). Agent registration creates one, so this unblocks POST /v1/agents. Translated 1:1 from the
 *   Prisma implementation.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: agent onboarding on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { AgentOnboardingRecord, AgentOnboardingStep } from '../../../interface.js';
import type { AgentOnboarding } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const isoOpt = (t: Date | string | null | undefined): string | undefined =>
  t == null ? undefined : (t instanceof Date ? t : new Date(t)).toISOString();

function toRecord(r: Selectable<AgentOnboarding>): AgentOnboardingRecord {
  return {
    agentGaii: r.agentGaii, status: r.status as AgentOnboardingRecord['status'],
    startedAt: (r.startedAt instanceof Date ? r.startedAt : new Date(r.startedAt)).toISOString(),
    completedAt: isoOpt(r.completedAt), steps: (r.steps ?? []) as unknown as AgentOnboardingStep[],
    readinessScore: r.readinessScore ?? undefined, readinessLevel: (r.readinessLevel ?? undefined) as AgentOnboardingRecord['readinessLevel'],
    detectedPlatform: r.detectedPlatform ?? undefined, installedRuntime: r.installedRuntime ?? undefined,
    onboardingBaseline: r.onboardingBaseline ?? undefined, operationalHealth: r.operationalHealth ?? undefined,
    healthComponents: (r.healthComponents ?? undefined) as AgentOnboardingRecord['healthComponents'],
    healthRecalculatedAt: isoOpt(r.healthRecalculatedAt),
    readinessOverride: (r.readinessOverride ?? undefined) as AgentOnboardingRecord['readinessOverride'],
  };
}

export const agentOnboardingMethods = {
  async createOnboarding(this: PostgresKyselyStorage, record: AgentOnboardingRecord): Promise<AgentOnboardingRecord> {
    const [row] = await this.db.insertInto('AgentOnboarding').values({
      agentGaii: record.agentGaii, status: record.status, startedAt: new Date(record.startedAt),
      completedAt: record.completedAt ? new Date(record.completedAt) : null, steps: jsonb(record.steps),
      readinessScore: record.readinessScore ?? null, readinessLevel: record.readinessLevel ?? null,
      detectedPlatform: record.detectedPlatform ?? null, installedRuntime: record.installedRuntime ?? null,
      onboardingBaseline: record.onboardingBaseline ?? null, operationalHealth: record.operationalHealth ?? null,
      healthComponents: jsonb(record.healthComponents ?? null),
      healthRecalculatedAt: record.healthRecalculatedAt ? new Date(record.healthRecalculatedAt) : null,
      readinessOverride: jsonb(record.readinessOverride ?? null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).returningAll().execute();
    return toRecord(row);
  },

  async getOnboarding(this: PostgresKyselyStorage, agentGaii: string): Promise<AgentOnboardingRecord | null> {
    const r = await this.db.selectFrom('AgentOnboarding').selectAll().where('agentGaii', '=', agentGaii).executeTakeFirst();
    return r ? toRecord(r) : null;
  },

  async updateOnboarding(this: PostgresKyselyStorage, agentGaii: string, updates: Partial<AgentOnboardingRecord>): Promise<AgentOnboardingRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.startedAt !== undefined) data.startedAt = new Date(updates.startedAt);
    if (updates.completedAt !== undefined) data.completedAt = updates.completedAt ? new Date(updates.completedAt) : null;
    if (updates.steps !== undefined) data.steps = jsonb(updates.steps);
    if (updates.readinessScore !== undefined) data.readinessScore = updates.readinessScore ?? null;
    if (updates.readinessLevel !== undefined) data.readinessLevel = updates.readinessLevel ?? null;
    if (updates.detectedPlatform !== undefined) data.detectedPlatform = updates.detectedPlatform ?? null;
    if (updates.installedRuntime !== undefined) data.installedRuntime = updates.installedRuntime ?? null;
    if (updates.onboardingBaseline !== undefined) data.onboardingBaseline = updates.onboardingBaseline ?? null;
    if (updates.operationalHealth !== undefined) data.operationalHealth = updates.operationalHealth ?? null;
    if (updates.healthComponents !== undefined) data.healthComponents = jsonb(updates.healthComponents ?? null);
    if (updates.healthRecalculatedAt !== undefined) data.healthRecalculatedAt = updates.healthRecalculatedAt ? new Date(updates.healthRecalculatedAt) : null;
    if (updates.readinessOverride !== undefined) data.readinessOverride = jsonb(updates.readinessOverride ?? null);
    if (Object.keys(data).length === 0) return this.getOnboarding(agentGaii);
    const rows = await this.db.updateTable('AgentOnboarding').set(data as never).where('agentGaii', '=', agentGaii).returningAll().execute();
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async deleteOnboarding(this: PostgresKyselyStorage, agentGaii: string): Promise<boolean> {
    const r = await this.db.deleteFrom('AgentOnboarding').where('agentGaii', '=', agentGaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async listOnboardingByOwner(this: PostgresKyselyStorage, owner: string): Promise<AgentOnboardingRecord[]> {
    const rows = await this.db.selectFrom('AgentOnboarding').selectAll().where('agentGaii', 'like', `%#${owner}@%`).orderBy('startedAt', 'desc').execute();
    return rows.map(toRecord);
  },

  async listOnboardingByStatus(this: PostgresKyselyStorage, status: string): Promise<AgentOnboardingRecord[]> {
    const rows = await this.db.selectFrom('AgentOnboarding').selectAll().where('status', '=', status).orderBy('startedAt', 'desc').execute();
    return rows.map(toRecord);
  },
};
