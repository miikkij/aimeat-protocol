/**
 * @file src/storage/providers/sqlite/methods/agent-onboarding.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/agent-onboarding.ts
 *   (agentOnboardingMethods), so a fix in one provider finds its twin by file name. Bodies moved verbatim
 *   from the files named in the version history; bound to SqliteStorage via the prototype merge in
 *   ../index.ts.
 * @structure agentOnboardingMethods
 * @usage Object.assign(SqliteStorage.prototype, agentOnboardingMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — deserializeOnboarding, createOnboarding, getOnboarding, updateOnboarding,
 *     deleteOnboarding, listOnboardingByStatus moved here from messaging.ts so the file mirrors
 *     postgres-kysely/methods/agent-onboarding.ts (secaudit 2026-10, M8).
 */
import type { AgentOnboardingRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const agentOnboardingMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Agent Onboarding ──
  // ══════════════════════════════════════════════════════════

  deserializeOnboarding(this: SqliteStorage, row: Record<string, unknown>): AgentOnboardingRecord {
    return {
      agentGaii: row.agentGaii as string,
      status: row.status as AgentOnboardingRecord['status'],
      startedAt: row.startedAt as string,
      completedAt: row.completedAt as string | undefined,
      steps: JSON.parse(row.steps as string),
      readinessScore: row.readinessScore as number | undefined,
      readinessLevel: row.readinessLevel as AgentOnboardingRecord['readinessLevel'],
      detectedPlatform: row.detectedPlatform as string | undefined,
      installedRuntime: row.installedRuntime as string | undefined,
      onboardingBaseline: row.onboardingBaseline as number | undefined,
      operationalHealth: row.operationalHealth as number | undefined,
      healthComponents: row.healthComponents ? JSON.parse(row.healthComponents as string) : undefined,
      healthRecalculatedAt: row.healthRecalculatedAt as string | undefined,
      readinessOverride: row.readinessOverride ? JSON.parse(row.readinessOverride as string) : undefined,
    };
  },

  async createOnboarding(this: SqliteStorage, record: AgentOnboardingRecord): Promise<AgentOnboardingRecord> {
    this.db.prepare(
      // ONE ONBOARDING PER AGENT, AND WRITING IT TWICE IS NOT AN ERROR. Three paths create this row
      // — agent registration, device authorization, and POST /onboarding/start — and the last one
      // decides between create and update by reading first. A row that appears between that read and
      // this write used to end as a 500: the Postgres sweep of 2026-09-16 failed exactly there
      // ("duplicate key value violates unique constraint AgentOnboarding_agentGaii_key", one
      // millisecond before the suite's INTERNAL_ERROR). agentGaii is the primary key here and a
      // unique index there, so the same call is a constraint violation on both; SQLite only lost the
      // race less often. The write is the caller's whole intent — this agent's onboarding is now
      // THIS — so it replaces what is there instead of refusing.
      `INSERT INTO agent_onboarding
       (agentGaii, status, startedAt, completedAt, steps, readinessScore, readinessLevel,
        detectedPlatform, installedRuntime, onboardingBaseline, operationalHealth,
        healthComponents, healthRecalculatedAt, readinessOverride)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agentGaii) DO UPDATE SET
         status = excluded.status, startedAt = excluded.startedAt, completedAt = excluded.completedAt,
         steps = excluded.steps, readinessScore = excluded.readinessScore,
         readinessLevel = excluded.readinessLevel, detectedPlatform = excluded.detectedPlatform,
         installedRuntime = excluded.installedRuntime, onboardingBaseline = excluded.onboardingBaseline,
         operationalHealth = excluded.operationalHealth, healthComponents = excluded.healthComponents,
         healthRecalculatedAt = excluded.healthRecalculatedAt, readinessOverride = excluded.readinessOverride`
    ).run(
      record.agentGaii,
      record.status,
      record.startedAt,
      record.completedAt ?? null,
      JSON.stringify(record.steps),
      record.readinessScore ?? null,
      record.readinessLevel ?? null,
      record.detectedPlatform ?? null,
      record.installedRuntime ?? null,
      record.onboardingBaseline ?? null,
      record.operationalHealth ?? null,
      record.healthComponents ? JSON.stringify(record.healthComponents) : null,
      record.healthRecalculatedAt ?? null,
      record.readinessOverride ? JSON.stringify(record.readinessOverride) : null,
    );
    return record;
  },

  async getOnboarding(this: SqliteStorage, agentGaii: string): Promise<AgentOnboardingRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM agent_onboarding WHERE agentGaii = ?'
    ).get(agentGaii) as Record<string, unknown> | undefined;
    return row ? this.deserializeOnboarding(row) : null;
  },

  async updateOnboarding(this: SqliteStorage, agentGaii: string, updates: Partial<AgentOnboardingRecord>): Promise<AgentOnboardingRecord | null> {
    const existing = await this.getOnboarding(agentGaii);
    if (!existing) return null;

    const merged = { ...existing, ...updates, agentGaii };
    this.db.prepare(
      `UPDATE agent_onboarding SET
         status = ?, startedAt = ?, completedAt = ?, steps = ?,
         readinessScore = ?, readinessLevel = ?,
         detectedPlatform = ?, installedRuntime = ?,
         onboardingBaseline = ?, operationalHealth = ?,
         healthComponents = ?, healthRecalculatedAt = ?, readinessOverride = ?
       WHERE agentGaii = ?`
    ).run(
      merged.status,
      merged.startedAt,
      merged.completedAt ?? null,
      JSON.stringify(merged.steps),
      merged.readinessScore ?? null,
      merged.readinessLevel ?? null,
      merged.detectedPlatform ?? null,
      merged.installedRuntime ?? null,
      merged.onboardingBaseline ?? null,
      merged.operationalHealth ?? null,
      merged.healthComponents ? JSON.stringify(merged.healthComponents) : null,
      merged.healthRecalculatedAt ?? null,
      merged.readinessOverride ? JSON.stringify(merged.readinessOverride) : null,
      agentGaii,
    );
    return this.getOnboarding(agentGaii);
  },

  async deleteOnboarding(this: SqliteStorage, agentGaii: string): Promise<boolean> {
    const result = this.db.prepare(
      'DELETE FROM agent_onboarding WHERE agentGaii = ?'
    ).run(agentGaii);
    return result.changes > 0;
  },

  async listOnboardingByStatus(this: SqliteStorage, status: string): Promise<AgentOnboardingRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM agent_onboarding WHERE status = ? ORDER BY startedAt DESC'
    ).all(status) as Record<string, unknown>[];
    return rows.map(row => this.deserializeOnboarding(row));
  },
};
