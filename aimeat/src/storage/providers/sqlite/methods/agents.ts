/**
 * @file src/storage/providers/sqlite/methods/agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent storage methods for SQLite: create, read, update, delete, the balance moves and the
 *   row reader. Moved out of methods/owner.ts by pure extraction when that file reached the 800-line
 *   limit; bodies verbatim, bound to SqliteStorage via the prototype merge in sqlite/index.ts.
 * @version-history
 *   v1.1.0 — 2026-09-02 — createAgent/updateAgent/deserializeAgent carry `mcpClient` and `mcpLastSeen`
 *     (which AI tool the agent last spoke from over MCP, and when), matching Postgres migration 0063.
 *   v1.0.0 — 2026-09-02 — Extracted from methods/owner.ts (max-file-lines). The group's own history is
 *     in that file's header: consoleUrl (v1.4.0), registeredBy (v1.5.0).
 */
import type { AgentRecord } from '../../../interface.js';
import { logger } from '../../../../utils/logger.js';
import type { SqliteStorage } from '../index.js';

export const agentMethods = {

  async createAgent(this: SqliteStorage, agent: AgentRecord): Promise<AgentRecord> {
    try {
      this.db.prepare(
        `INSERT INTO agents (gaii, name, owner, displayName, description, capabilities, publicKey, trustScore, morselBalance, createdAt, lastSeen, semantic, allowedOrigins, defaultScopes, federate,
         webhookUrl, webhookSecret, webhookEnabled, webhookLastSuccess, webhookLastFailure, webhookFailCount, platform, platformVersion, platformDetectedBy, model, modelDetectedBy, tags, mode, maxConcurrentTasks, consoleUrl, registeredBy,
         runMode, runtimeSource, identityVersion, cardJws, cardIssuedAt, enrolledAt, mcpClient, mcpLastSeen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        agent.gaii, agent.name, agent.owner,
        agent.displayName ?? null, agent.description ?? null,
        JSON.stringify(agent.capabilities), agent.publicKey,
        agent.trustScore, agent.morselBalance,
        agent.createdAt, agent.lastSeen,
        agent.semantic ? JSON.stringify(agent.semantic) : null,
        agent.allowedOrigins ? JSON.stringify(agent.allowedOrigins) : null,
        agent.defaultScopes ? JSON.stringify(agent.defaultScopes) : null,
        agent.federate ? 1 : 0,
        agent.webhookUrl ?? null, agent.webhookSecret ?? null, agent.webhookEnabled ? 1 : 0,
        agent.webhookLastSuccess ?? null, agent.webhookLastFailure ?? null, agent.webhookFailCount ?? 0,
        agent.platform ?? null, agent.platformVersion ?? null, agent.platformDetectedBy ?? null,
        agent.model ?? null, agent.modelDetectedBy ?? null,
        agent.tags ? JSON.stringify(agent.tags) : null,
        agent.mode ?? 'interactive',
        agent.maxConcurrentTasks ?? 1,
        agent.consoleUrl ?? null,
        agent.registeredBy ?? null,
        agent.runMode ?? null,
        agent.runtimeSource ? JSON.stringify(agent.runtimeSource) : null,
        agent.identityVersion ?? null,
        agent.cardJws ?? null,
        agent.cardIssuedAt ?? null,
        agent.enrolledAt ?? null,
        agent.mcpClient ?? null,
        agent.mcpLastSeen ?? null,
      );
      return agent;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('NAME_TAKEN', { cause: err });
      throw err;
    }
  },

  async getAgent(this: SqliteStorage, gaii: string): Promise<AgentRecord | null> {
    const row = this.db.prepare('SELECT * FROM agents WHERE gaii = ?').get(gaii) as Record<string, unknown> | undefined;
    return row ? this.deserializeAgent(row) : null;
  },

  async getAgentByName(this: SqliteStorage, name: string, _nodeId: string): Promise<AgentRecord | null> {
    const row = this.db.prepare('SELECT * FROM agents WHERE name = ? LIMIT 1').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeAgent(row) : null;
  },

  // Ordered on purpose — see the note on the Postgres implementation. The two providers must agree
  // about which agent is agents[0], because a caller treats it as "the" agent.
  async getAgentsByOwner(this: SqliteStorage, owner: string): Promise<AgentRecord[]> {
    const rows = this.db.prepare('SELECT * FROM agents WHERE owner = ? ORDER BY createdAt ASC, gaii ASC').all(owner) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAgent(r));
  },

  async getAgentsByOwners(this: SqliteStorage, owners: string[]): Promise<Record<string, AgentRecord[]>> {
    const out: Record<string, AgentRecord[]> = {};
    if (owners.length === 0) return out;
    for (const o of owners) out[o] = [];
    const p = owners.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM agents WHERE owner IN (${p}) ORDER BY createdAt ASC, gaii ASC`).all(...owners) as Record<string, unknown>[];
    for (const r of rows) { const a = this.deserializeAgent(r); (out[a.owner] ??= []).push(a); }
    return out;
  },

  async updateAgent(this: SqliteStorage, gaii: string, updates: Partial<AgentRecord>): Promise<AgentRecord | null> {
    const existing = await this.getAgent(gaii);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE agents SET name = ?, owner = ?, displayName = ?, description = ?, capabilities = ?,
       publicKey = ?, trustScore = ?, morselBalance = ?, createdAt = ?, lastSeen = ?, semantic = ?,
       allowedOrigins = ?, defaultScopes = ?, federate = ?,
       technicalCapabilities = ?, domainCapabilities = ?, activityStats = ?,
       modulesLoaded = ?, agentLimitations = ?, languages = ?,
       webhookUrl = ?, webhookSecret = ?, webhookEnabled = ?, webhookLastSuccess = ?, webhookLastFailure = ?, webhookFailCount = ?,
       platform = ?, platformVersion = ?, platformDetectedBy = ?, model = ?, modelDetectedBy = ?, tags = ?, mode = ?, maxConcurrentTasks = ?,
       dailySpendLimit = ?, scheduleConstraintDefaults = ?, consoleUrl = ?, registeredBy = ?,
       runMode = ?, runtimeSource = ?, identityVersion = ?, cardJws = ?, cardIssuedAt = ?, enrolledAt = ?,
       mcpClient = ?, mcpLastSeen = ?
       WHERE gaii = ?`
    ).run(
      updated.name, updated.owner,
      updated.displayName ?? null, updated.description ?? null,
      JSON.stringify(updated.capabilities), updated.publicKey,
      updated.trustScore, updated.morselBalance,
      updated.createdAt, updated.lastSeen,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      updated.allowedOrigins ? JSON.stringify(updated.allowedOrigins) : null,
      updated.defaultScopes ? JSON.stringify(updated.defaultScopes) : null,
      updated.federate ? 1 : 0,
      JSON.stringify(updated.technicalCapabilities ?? []),
      JSON.stringify(updated.domainCapabilities ?? []),
      JSON.stringify(updated.activityStats ?? {}),
      JSON.stringify(updated.modulesLoaded ?? []),
      JSON.stringify(updated.agentLimitations ?? []),
      JSON.stringify(updated.languages ?? []),
      updated.webhookUrl ?? null, updated.webhookSecret ?? null, updated.webhookEnabled ? 1 : 0,
      updated.webhookLastSuccess ?? null, updated.webhookLastFailure ?? null, updated.webhookFailCount ?? 0,
      updated.platform ?? null, updated.platformVersion ?? null, updated.platformDetectedBy ?? null,
      updated.model ?? null, updated.modelDetectedBy ?? null,
      updated.tags ? JSON.stringify(updated.tags) : null,
      updated.mode ?? 'interactive',
      updated.maxConcurrentTasks ?? 1,
      updated.dailySpendLimit ?? null,
      updated.scheduleConstraintDefaults ? JSON.stringify(updated.scheduleConstraintDefaults) : null,
      updated.consoleUrl ?? null,
      // Carried through rather than fixed here: the write-once rule lives where the value is SET
      // (only createAgent writes it), so both providers behave the same way. Postgres passes any
      // key through generically, and a column one backend silently refuses is a worse trap than a
      // rule stated in one place.
      updated.registeredBy ?? null,
      updated.runMode ?? null,
      updated.runtimeSource ? JSON.stringify(updated.runtimeSource) : null,
      updated.identityVersion ?? null,
      updated.cardJws ?? null,
      updated.cardIssuedAt ?? null,
      updated.enrolledAt ?? null,
      updated.mcpClient ?? null,
      updated.mcpLastSeen ?? null,
      gaii,
    );
    return updated;
  },

  async deleteAgent(this: SqliteStorage, gaii: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      // Cascade delete all agent-related data
      this.cascadeDeleteAgentData(gaii);
      // Delete the agent record itself
      const result = this.db.prepare('DELETE FROM agents WHERE gaii = ?').run(gaii);
      return result.changes > 0;
    });
    return txn();
  },

  async listAgents(this: SqliteStorage): Promise<AgentRecord[]> {
    const rows = this.db.prepare('SELECT * FROM agents').all() as Record<string, unknown>[];
    return rows.map(r => this.deserializeAgent(r));
  },

  /**
   * Resolve any identity (GAII, GHII, bare owner) to the owner's GHII identifier.
   * All balance operations go through GHII — agents don't have their own balance.
   */
  resolveGhii(this: SqliteStorage, identity: string): string | null {
    // GHII format: owner@node (no #)
    if (!identity.includes('#') && identity.includes('@')) return identity;
    // GAII format: agent#owner@node → extract owner → lookup GHII
    if (identity.includes('#')) {
      const hashIdx = identity.indexOf('#');
      const atIdx = identity.lastIndexOf('@');
      if (atIdx > hashIdx) {
        const owner = identity.slice(hashIdx + 1, atIdx);
        const row = this.db.prepare('SELECT ghii FROM ghiis WHERE username = ?').get(owner) as { ghii: string } | undefined;
        return row?.ghii ?? null;
      }
    }
    // Bare owner name → lookup GHII
    const row = this.db.prepare('SELECT ghii FROM ghiis WHERE username = ?').get(identity) as { ghii: string } | undefined;
    return row?.ghii ?? null;
  },

  async debitBalance(this: SqliteStorage, gaii: string, amount: number): Promise<boolean> {
    // SECURITY: reject negative/non-finite amounts. A negative amount would INVERT the
    // subtraction (balance - (-n) = balance + n) and mint morsels. 0 is allowed (no-op;
    // free/0-cost work escrow relies on it).
    if (!Number.isFinite(amount) || amount < 0) return false;
    const ghii = this.resolveGhii(gaii);
    if (!ghii) return false;
    const result = this.db.prepare(
      `UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) - ? WHERE ghii = ? AND COALESCE(morselBalance, 0) >= ?`
    ).run(amount, ghii, amount);
    return result.changes > 0;
  },

  async creditBalance(this: SqliteStorage, gaii: string, amount: number): Promise<boolean> {
    // SECURITY: reject negative/non-finite amounts (a negative credit would silently debit); 0 is a no-op.
    if (!Number.isFinite(amount) || amount < 0) return false;
    const ghii = this.resolveGhii(gaii);
    if (!ghii) return false;
    const result = this.db.prepare(
      `UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) + ? WHERE ghii = ?`
    ).run(amount, ghii);
    return result.changes > 0;
  },

  async creditBalanceCapped(this: SqliteStorage, gaii: string, amount: number, cap: number): Promise<number> {
    // SECURITY: reject negative/non-finite amounts (NaN would slip past the actualCredit<=0 guard below).
    if (!Number.isFinite(amount) || amount < 0) return 0;
    const ghii = this.resolveGhii(gaii);
    if (!ghii) return 0;
    const txn = this.db.transaction(() => {
      const row = this.db.prepare('SELECT morselBalance FROM ghiis WHERE ghii = ?').get(ghii) as { morselBalance: number | null } | undefined;
      if (!row) return 0;
      const oldBalance = row.morselBalance ?? 0;
      if (oldBalance >= cap) return 0;
      const actualCredit = Math.min(amount, cap - oldBalance);
      if (actualCredit <= 0) return 0;
      this.db.prepare('UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) + ? WHERE ghii = ?').run(actualCredit, ghii);
      return actualCredit;
    });
    return txn();
  },

  async transferBalance(this: SqliteStorage, fromGaii: string, toGaii: string, amount: number): Promise<boolean> {
    // SECURITY: reject negative/non-finite amounts (a negative transfer would drain the recipient); 0 is a no-op.
    if (!Number.isFinite(amount) || amount < 0) return false;
    const fromGhii = this.resolveGhii(fromGaii);
    const toGhii = this.resolveGhii(toGaii);
    if (!fromGhii || !toGhii) return false;
    if (fromGhii === toGhii) return true; // Same owner — no-op
    const txn = this.db.transaction(() => {
      const debit = this.db.prepare(
        `UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) - ? WHERE ghii = ? AND COALESCE(morselBalance, 0) >= ?`
      ).run(amount, fromGhii, amount);
      if (debit.changes === 0) return false;
      this.db.prepare(
        `UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) + ? WHERE ghii = ?`
      ).run(amount, toGhii);
      return true;
    });
    return txn();
  },

  deserializeAgent(this: SqliteStorage, row: Record<string, unknown>): AgentRecord {
    const record: AgentRecord = {
      gaii: row.gaii as string,
      name: row.name as string,
      owner: row.owner as string,
      capabilities: JSON.parse(row.capabilities as string) as string[],
      publicKey: row.publicKey as string,
      trustScore: row.trustScore as number,
      morselBalance: row.morselBalance as number,
      createdAt: row.createdAt as string,
      lastSeen: row.lastSeen as string,
    };
    if (row.displayName) record.displayName = row.displayName as string;
    if (row.description) record.description = row.description as string;
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    if (row.allowedOrigins) record.allowedOrigins = JSON.parse(row.allowedOrigins as string);
    if (row.defaultScopes) record.defaultScopes = JSON.parse(row.defaultScopes as string);
    record.federate = row.federate === 1;
    if (row.technicalCapabilities) record.technicalCapabilities = JSON.parse(row.technicalCapabilities as string);
    if (row.domainCapabilities) record.domainCapabilities = JSON.parse(row.domainCapabilities as string);
    if (row.activityStats) record.activityStats = JSON.parse(row.activityStats as string);
    if (row.modulesLoaded) record.modulesLoaded = JSON.parse(row.modulesLoaded as string);
    if (row.agentLimitations) record.agentLimitations = JSON.parse(row.agentLimitations as string);
    if (row.languages) record.languages = JSON.parse(row.languages as string);
    if (row.webhookUrl) record.webhookUrl = row.webhookUrl as string;
    if (row.webhookSecret) record.webhookSecret = row.webhookSecret as string;
    record.webhookEnabled = row.webhookEnabled === 1;
    if (row.webhookLastSuccess) record.webhookLastSuccess = row.webhookLastSuccess as string;
    if (row.webhookLastFailure) record.webhookLastFailure = row.webhookLastFailure as string;
    record.webhookFailCount = (row.webhookFailCount as number) ?? 0;
    if (row.platform) record.platform = row.platform as string;
    if (row.platformVersion) record.platformVersion = row.platformVersion as string;
    if (row.platformDetectedBy) record.platformDetectedBy = row.platformDetectedBy as 'auto' | 'self_report' | 'message_reply';
    if (row.model) record.model = row.model as string;
    if (row.modelDetectedBy) record.modelDetectedBy = row.modelDetectedBy as 'self_report';
    if (row.tags) record.tags = JSON.parse(row.tags as string);
    if (row.mode) record.mode = row.mode as 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation';
    if (row.maxConcurrentTasks != null) record.maxConcurrentTasks = row.maxConcurrentTasks as number;
    if (row.dailySpendLimit != null) record.dailySpendLimit = row.dailySpendLimit as number;
    if (row.scheduleConstraintDefaults) record.scheduleConstraintDefaults = JSON.parse(row.scheduleConstraintDefaults as string);
    if (row.consoleUrl) record.consoleUrl = row.consoleUrl as string;
    if (row.registeredBy) record.registeredBy = row.registeredBy as string;
    if (row.runMode) record.runMode = row.runMode as AgentRecord['runMode'];
    if (row.runtimeSource) {
      // A row written before this column, or by a build that stored something else, must not stop
      // an agent loading: the field is a report about someone else's disk, not a load-bearing one.
      try { record.runtimeSource = JSON.parse(row.runtimeSource as string); }
      catch (err) { logger.warn('agents: unreadable runtimeSource, ignoring', { gaii: record.gaii, error: String(err) }); }
    }
    if (row.identityVersion != null) record.identityVersion = row.identityVersion as 1 | 2;
    if (row.cardJws) record.cardJws = row.cardJws as string;
    if (row.cardIssuedAt) record.cardIssuedAt = row.cardIssuedAt as string;
    if (row.enrolledAt) record.enrolledAt = row.enrolledAt as string;
    if (row.mcpClient) record.mcpClient = row.mcpClient as string;
    if (row.mcpLastSeen) record.mcpLastSeen = row.mcpLastSeen as string;
    return record;
  },
};
