/**
 * @file src/storage/providers/sqlite/methods/owner.ts
 * @description Owner, Agent, and Memory storage methods. Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 *   v1.1.0 — 2026-07-14 — Perf: add listMemoryMeta (metadata + byteSize projection, no value column)
 *     backing ?include=meta.
 *   v1.2.0 — 2026-07-25 — listAllMemory gains excludeOwnerPrefix (filters in SQL, so a windowed read
 *     is not emptied by rows it was going to drop); newestFirst is accepted for Postgres parity and
 *     is already this backend's ordering.
 */
import type {
  OwnerRecord, AgentRecord, MemoryRecord, ArchiveFilter
} from '../../../interface.js';
import type { MemoryTextHit, MemoryTextSearchOpts, MemoryVersionRecord } from '../../../repositories/memory.repository.js';
import type { SqliteStorage } from '../index.js';
import { searchTextMemory, countMemory as countMemoryRepo, sumMemoryBytes as sumMemoryBytesRepo, sumMemoryBytesForOwners as sumMemoryBytesForOwnersRepo, archivedSql, archiveMemoryByKey as archiveMemoryByKeyRepo, unarchiveMemoryByRoot as unarchiveMemoryByRootRepo, unarchiveMemoryByKey as unarchiveMemoryByKeyRepo, countArchivedByKeyPrefix as countArchivedByKeyPrefixRepo } from '../repos/memory.js';

export const ownerMethods = {
  // ══════════════════════════════════════════════════════════
  // ── Owners ──
  // ══════════════════════════════════════════════════════════

  async createOwner(this: SqliteStorage, owner: OwnerRecord): Promise<OwnerRecord> {
    try {
      this.db.prepare(
        `INSERT INTO owners (name, displayName, publicKey, roles, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        owner.name,
        owner.displayName ?? null,
        owner.publicKey,
        JSON.stringify(owner.roles),
        owner.createdAt,
      );
      return owner;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('NAME_TAKEN', { cause: err });
      throw err;
    }
  },

  async getOwner(this: SqliteStorage, name: string): Promise<OwnerRecord | null> {
    const row = this.db.prepare('SELECT * FROM owners WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeOwner(row) : null;
  },

  async listOwners(this: SqliteStorage): Promise<OwnerRecord[]> {
    const rows = this.db.prepare('SELECT * FROM owners').all() as Record<string, unknown>[];
    return rows.map(r => this.deserializeOwner(r));
  },

  async updateOwner(this: SqliteStorage, name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null> {
    const existing = await this.getOwner(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE owners SET displayName = ?, publicKey = ?, roles = ?, createdAt = ? WHERE name = ?`
    ).run(
      updated.displayName ?? null,
      updated.publicKey,
      JSON.stringify(updated.roles),
      updated.createdAt,
      name,
    );
    return updated;
  },

  async deleteOwner(this: SqliteStorage, name: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      // 1. Get all agents belonging to this owner
      const agentRows = this.db.prepare('SELECT gaii FROM agents WHERE owner = ?').all(name) as { gaii: string }[];
      const agentGaiis = agentRows.map(r => r.gaii);

      // 2. Cascade delete all agent-related data for each agent
      for (const gaii of agentGaiis) {
        this.cascadeDeleteAgentData(gaii);
      }

      // 3. Delete all agents for this owner
      this.db.prepare('DELETE FROM agents WHERE owner = ?').run(name);

      // 4. Delete GHII records for this owner
      this.db.prepare('DELETE FROM ghiis WHERE ownerName = ?').run(name);

      // 5. Delete personal nodes and their mailbox items & push subscriptions
      const nodeRows = this.db.prepare('SELECT nodeId FROM personal_nodes WHERE ownerName = ?').all(name) as { nodeId: string }[];
      for (const node of nodeRows) {
        this.db.prepare('DELETE FROM mailbox_items WHERE personalNodeId = ?').run(node.nodeId);
        this.db.prepare('DELETE FROM personal_push_subscriptions WHERE personalNodeId = ?').run(node.nodeId);
        this.db.prepare('DELETE FROM notification_preferences WHERE personalNodeId = ?').run(node.nodeId);
      }
      this.db.prepare('DELETE FROM personal_nodes WHERE ownerName = ?').run(name);

      // 6. Delete push subscriptions for this owner
      this.db.prepare('DELETE FROM push_subscriptions WHERE ownerName = ?').run(name);
      this.db.prepare('DELETE FROM personal_push_subscriptions WHERE ownerName = ?').run(name);

      // 7. Delete listings for this owner
      this.db.prepare('DELETE FROM listings WHERE ownerName = ?').run(name);

      // 8. Delete purchases for this owner (as buyer or seller)
      this.db.prepare('DELETE FROM purchases WHERE buyerOwner = ? OR sellerOwner = ?').run(name, name);

      // 9. Delete chat instances for this owner
      this.db.prepare('DELETE FROM chat_instances WHERE ownerName = ?').run(name);

      // 10. Delete email verifications for this owner
      this.db.prepare('DELETE FROM email_verifications WHERE ownerName = ?').run(name);

      // 11. Delete the owner record itself
      const result = this.db.prepare('DELETE FROM owners WHERE name = ?').run(name);
      return result.changes > 0;
    });
    return txn();
  },

  /**
   * Cascade-delete all data associated with a single agent GAII.
   * Called inside a transaction by both deleteOwner and deleteAgent.
   */
  cascadeDeleteAgentData(this: SqliteStorage, gaii: string): void {
    // Memory
    this.db.prepare('DELETE FROM memory WHERE ownerGaii = ?').run(gaii);
    // Micro-memory
    this.db.prepare('DELETE FROM micro_memory WHERE gaii = ?').run(gaii);
    // Actions
    this.db.prepare('DELETE FROM actions WHERE providerGaii = ?').run(gaii);
    // Work (as provider or requester) — also clean up related disputes
    const workRows = this.db.prepare(
      'SELECT trackingCode FROM work WHERE providerGaii = ? OR requesterGaii = ?'
    ).all(gaii, gaii) as { trackingCode: string }[];
    for (const w of workRows) {
      this.db.prepare('DELETE FROM dispute_audit WHERE disputeId IN (SELECT id FROM disputes WHERE trackingCode = ?)').run(w.trackingCode);
      this.db.prepare('DELETE FROM disputes WHERE trackingCode = ?').run(w.trackingCode);
    }
    this.db.prepare('DELETE FROM work WHERE providerGaii = ? OR requesterGaii = ?').run(gaii, gaii);
    // Wallet transactions
    this.db.prepare('DELETE FROM wallet_transactions WHERE gaii = ?').run(gaii);
    // Board posts authored by this agent
    this.db.prepare('DELETE FROM board_posts WHERE authorGaii = ?').run(gaii);
    // Board subscriptions
    this.db.prepare('DELETE FROM board_subscriptions WHERE gaii = ?').run(gaii);
    // Boards owned by this agent — also delete their posts and subscriptions
    const boardRows = this.db.prepare('SELECT id FROM boards WHERE ownerGaii = ?').all(gaii) as { id: string }[];
    for (const b of boardRows) {
      this.db.prepare('DELETE FROM board_posts WHERE boardId = ?').run(b.id);
      this.db.prepare('DELETE FROM board_subscriptions WHERE boardId = ?').run(b.id);
    }
    this.db.prepare('DELETE FROM boards WHERE ownerGaii = ?').run(gaii);
    // Consents and consent audit
    this.db.prepare('DELETE FROM consent_audit WHERE ownerGaii = ?').run(gaii);
    this.db.prepare('DELETE FROM consents WHERE ownerGaii = ?').run(gaii);
    // Storage files
    this.db.prepare('DELETE FROM storage_files WHERE ownerGaii = ?').run(gaii);
    // Matches (as profileA or profileB)
    this.db.prepare('DELETE FROM matches WHERE profileA = ? OR profileB = ?').run(gaii, gaii);
    // Flags raised by this agent
    this.db.prepare('DELETE FROM flags WHERE flaggedBy = ?').run(gaii);
    // Escrow holds
    this.db.prepare('DELETE FROM escrow_holds WHERE fromGaii = ?').run(gaii);
    // OTKs (one-time keys)
    this.db.prepare('DELETE FROM otks WHERE ownerGaii = ?').run(gaii);
    // OAuth refresh tokens and approvals for this agent
    this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE gaii = ?').run(gaii);
    this.db.prepare('DELETE FROM oauth_approvals WHERE gaii = ?').run(gaii);
    // Agent tasks and events
    const taskRows = this.db.prepare('SELECT id FROM agent_tasks WHERE agentGaii = ?').all(gaii) as { id: string }[];
    for (const t of taskRows) {
      this.db.prepare('DELETE FROM agent_task_events WHERE taskId = ?').run(t.id);
    }
    this.db.prepare('DELETE FROM agent_tasks WHERE agentGaii = ?').run(gaii);
    // Agent directives
    this.db.prepare('DELETE FROM agent_directives WHERE agentGaii = ?').run(gaii);
    // Agent activity
    this.db.prepare('DELETE FROM agent_activity WHERE agentGaii = ?').run(gaii);
    // Agent messages
    this.db.prepare('DELETE FROM agent_messages WHERE agentGaii = ?').run(gaii);
    // Telemetry events
    this.db.prepare('DELETE FROM telemetry_events WHERE agentGaii = ?').run(gaii);
    // Webhook delivery logs
    this.db.prepare('DELETE FROM webhook_delivery_log WHERE agentGaii = ?').run(gaii);
    // Onboarding record
    this.db.prepare('DELETE FROM agent_onboarding WHERE agentGaii = ?').run(gaii);
    // Sharing groups
    this.db.prepare('DELETE FROM sharing_groups WHERE ownerGaii = ?').run(gaii);
  },

  deserializeOwner(this: SqliteStorage, row: Record<string, unknown>): OwnerRecord {
    return {
      name: row.name as string,
      displayName: (row.displayName as string) ?? undefined,
      publicKey: row.publicKey as string,
      roles: JSON.parse(row.roles as string) as string[],
      createdAt: row.createdAt as string,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Agents ──
  // ══════════════════════════════════════════════════════════

  async createAgent(this: SqliteStorage, agent: AgentRecord): Promise<AgentRecord> {
    try {
      this.db.prepare(
        `INSERT INTO agents (gaii, name, owner, displayName, description, capabilities, publicKey, trustScore, morselBalance, createdAt, lastSeen, semantic, allowedOrigins, defaultScopes, federate,
         webhookUrl, webhookSecret, webhookEnabled, webhookLastSuccess, webhookLastFailure, webhookFailCount, platform, platformVersion, platformDetectedBy, model, modelDetectedBy, tags, mode, maxConcurrentTasks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
       dailySpendLimit = ?, scheduleConstraintDefaults = ?
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
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Memory ──
  // ══════════════════════════════════════════════════════════

  async setMemory(this: SqliteStorage, record: MemoryRecord): Promise<MemoryRecord> {
    const existing = await this.getMemory(record.ownerGaii, record.key);
    // Trackable is a property of the key: inherit the existing setting if the writer didn't specify, so
    // a generic rewrite never silently turns tracking off. Archiving keeps the PREVIOUS version.
    const trackable = record.trackable ?? existing?.trackable ?? false;
    record.trackable = trackable || undefined;
    const valueStr = JSON.stringify(record.value);
    const byteSize = Buffer.byteLength(valueStr, 'utf8');   // cached for the O(1) total-size quota sum + ?include=meta
    if (existing) {
      if (existing.trackable) {
        // Archive the about-to-be-overwritten version into the separate history table (append-only).
        this.db.prepare(
          `INSERT OR IGNORE INTO memory_history (ownerGaii, key, version, value, actor, event, recordedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          existing.ownerGaii, existing.key, existing.version,
          JSON.stringify(existing.value),
          this.memoryAnnotation(existing.value, '_actor'), this.memoryAnnotation(existing.value, '_event'),
          existing.updatedAt,
        );
      }
      record.version = existing.version + 1;
      this.db.prepare(
        `UPDATE memory SET value = ?, visibility = ?, workspaceRef = ?, tags = ?, ttlHours = ?, version = ?,
         createdAt = ?, updatedAt = ?, flagCount = ?, allowedOrigins = ?, trackable = ?, byteSize = ?,
         aiProvenanceId = ? WHERE ownerGaii = ? AND key = ?`
      ).run(
        valueStr, record.visibility, record.workspaceRef ?? null,
        JSON.stringify(record.tags), record.ttlHours,
        record.version, record.createdAt, record.updatedAt,
        record.flagCount ?? 0,
        record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
        trackable ? 1 : 0, byteSize,
        // Write-through, deliberately NOT inherited from `existing`: a new value is new content, and
        // keeping the old provenance id would assert something about bytes that no longer exist.
        record.aiProvenanceId ?? null,
        record.ownerGaii, record.key,
      );
    } else {
      this.db.prepare(
        `INSERT INTO memory (ownerGaii, key, value, visibility, workspaceRef, tags, ttlHours, version, createdAt, updatedAt, flagCount, allowedOrigins, trackable, byteSize, aiProvenanceId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.ownerGaii, record.key,
        valueStr, record.visibility, record.workspaceRef ?? null,
        JSON.stringify(record.tags), record.ttlHours,
        record.version, record.createdAt, record.updatedAt,
        record.flagCount ?? 0,
        record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
        trackable ? 1 : 0, byteSize,
        record.aiProvenanceId ?? null,
      );
    }
    return record;
  },

  async listMemoryHistory(this: SqliteStorage, ownerGaii: string, key: string, opts?: { limit?: number }): Promise<MemoryVersionRecord[]> {
    const limit = opts?.limit ?? 200;
    const rows = this.db.prepare(
      'SELECT * FROM memory_history WHERE ownerGaii = ? AND key = ? ORDER BY version DESC LIMIT ?'
    ).all(ownerGaii, key, limit) as Record<string, unknown>[];
    return rows.map(r => ({
      ownerGaii: r.ownerGaii as string,
      key: r.key as string,
      version: r.version as number,
      value: JSON.parse(r.value as string),
      actor: (r.actor as string | null) ?? null,
      event: (r.event as string | null) ?? null,
      recordedAt: r.recordedAt as string,
    }));
  },

  async setMemoryIfVersion(this: SqliteStorage, record: MemoryRecord, expectedVersion: number): Promise<MemoryRecord | null> {
    const valueStr = JSON.stringify(record.value);
    const result = this.db.prepare(
      `UPDATE memory SET value = ?, visibility = ?, workspaceRef = ?, tags = ?, ttlHours = ?, version = ?,
       updatedAt = ?, flagCount = ?, allowedOrigins = ?, byteSize = ?, aiProvenanceId = ?
       WHERE ownerGaii = ? AND key = ? AND version = ?`
    ).run(
      valueStr, record.visibility, record.workspaceRef ?? null,
      JSON.stringify(record.tags), record.ttlHours,
      record.version, record.updatedAt,
      record.flagCount ?? 0,
      record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
      Buffer.byteLength(valueStr, 'utf8'),
      record.aiProvenanceId ?? null,
      record.ownerGaii, record.key, expectedVersion,
    );
    if (result.changes === 0) return null; // version conflict
    return record;
  },

  isMemoryExpired(this: SqliteStorage, record: MemoryRecord): boolean {
    if (!record.ttlHours) return false;
    const createdMs = new Date(record.createdAt).getTime();
    return Date.now() > createdMs + record.ttlHours * 3_600_000;
  },

  async getMemory(this: SqliteStorage, ownerGaii: string, key: string): Promise<MemoryRecord | null> {
    const row = this.db.prepare('SELECT * FROM memory WHERE ownerGaii = ? AND key = ?').get(ownerGaii, key) as Record<string, unknown> | undefined;
    if (!row) return null;
    const record = this.deserializeMemory(row);
    if (this.isMemoryExpired(record)) {
      this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(ownerGaii, key);
      return null;
    }
    return record;
  },

  async listMemory(this: SqliteStorage, ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number; archived?: ArchiveFilter }): Promise<MemoryRecord[]> {
    let sql = 'SELECT * FROM memory WHERE ownerGaii = ?';
    const params: unknown[] = [ownerGaii];

    if (opts?.prefix) {
      sql += ' AND key LIKE ?';
      params.push(opts.prefix + '%');
    }
    if (opts?.visibility) {
      sql += ' AND visibility = ?';
      params.push(opts.visibility);
    }
    sql += archivedSql(opts?.archived);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const results: MemoryRecord[] = [];
    for (const row of rows) {
      const record = this.deserializeMemory(row);
      if (this.isMemoryExpired(record)) {
        this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
        continue;
      }
      if (opts?.tags?.length) {
        const hasTags = opts.tags.every(t => record.tags.includes(t));
        if (!hasTags) continue;
      }
      if (opts?.maxFlags !== undefined && (record.flagCount ?? 0) > opts.maxFlags) continue;
      results.push(record);
    }
    return results;
  },

  async countMemory(this: SqliteStorage, ownerGaiis: string[], opts?: { prefix?: string; visibility?: string }): Promise<number> {
    return countMemoryRepo(this.db, ownerGaiis, opts);
  },

  async sumMemoryBytes(this: SqliteStorage, ownerGaii: string): Promise<number> {
    return sumMemoryBytesRepo(this.db, ownerGaii);
  },

  async sumMemoryBytesForOwners(this: SqliteStorage, ownerGaiis: string[]): Promise<number> {
    return sumMemoryBytesForOwnersRepo(this.db, ownerGaiis);
  },

  async listAllMemory(this: SqliteStorage, opts?: { prefix?: string; ownerPrefix?: string; excludeOwnerPrefix?: string; visibility?: string; limit?: number; offset?: number; archived?: ArchiveFilter; excludeVersionRows?: boolean; newestFirst?: boolean }): Promise<{ items: MemoryRecord[]; total: number }> {
    let whereClauses = '';
    const params: unknown[] = [];

    if (opts?.ownerPrefix) {
      whereClauses += ' AND ownerGaii LIKE ?';
      params.push(opts.ownerPrefix + '%');
    }
    // Excluded IN SQL, not after the slice: a windowed read whose window is entirely unwanted
    // rows would otherwise come back empty (how the landing ticker emptied itself).
    if (opts?.excludeOwnerPrefix) {
      whereClauses += ' AND ownerGaii NOT LIKE ?';
      params.push(opts.excludeOwnerPrefix + '%');
    }
    if (opts?.prefix) {
      whereClauses += ' AND key LIKE ?';
      params.push(opts.prefix + '%');
    }
    if (opts?.visibility) {
      whereClauses += ' AND visibility = ?';
      params.push(opts.visibility);
    }
    // Workspace `.version.N` history rows are dropped IN SQL so the hot read paths never load
    // (or JSON.parse) the historic full-copy values they always discard. See memory.repository.ts.
    if (opts?.excludeVersionRows) {
      whereClauses += " AND key NOT LIKE '%.version.%'";
    }
    whereClauses += archivedSql(opts?.archived);

    const whereStr = whereClauses ? ' WHERE ' + whereClauses.slice(5) : '';

    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM memory' + whereStr).get(...params) as { cnt: number };
    const total = countRow.cnt;

    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    // Always newest-first here; `newestFirst` is accepted for parity with the Postgres backend,
    // which defaults to key order and needs the flag to page by recency (see memory.repository.ts).
    const rows = this.db.prepare('SELECT * FROM memory' + whereStr + ' ORDER BY updatedAt DESC LIMIT ? OFFSET ?').all(...params, limit, offset) as Record<string, unknown>[];

    const items: MemoryRecord[] = [];
    for (const row of rows) {
      const record = this.deserializeMemory(row);
      if (this.isMemoryExpired(record)) {
        this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
        continue;
      }
      items.push(record);
    }
    return { items, total };
  },

  async deleteMemory(this: SqliteStorage, ownerGaii: string, key: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(ownerGaii, key);
    return result.changes > 0;
  },

  async deleteAllMemory(this: SqliteStorage, ownerGaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM memory WHERE ownerGaii = ?').run(ownerGaii);
    return result.changes;
  },

  async incrementMemoryFlagCount(this: SqliteStorage, ownerGaii: string, key: string): Promise<void> {
    this.db.prepare(
      'UPDATE memory SET flagCount = COALESCE(flagCount, 0) + 1 WHERE ownerGaii = ? AND key = ?'
    ).run(ownerGaii, key);
  },

  async searchMemory(this: SqliteStorage, ownerGaii: string, query: string, opts?: { visibility?: string; maxFlags?: number; prefix?: string; archived?: ArchiveFilter; limit?: number }): Promise<MemoryRecord[]> {
    const q = query.toLowerCase();
    let sql = 'SELECT * FROM memory WHERE ownerGaii = ?';
    const params: unknown[] = [ownerGaii];

    if (opts?.visibility) {
      sql += ' AND visibility = ?';
      params.push(opts.visibility);
    }

    if (opts?.prefix) {
      sql += ' AND key LIKE ?';
      params.push(opts.prefix + '%');
    }
    sql += archivedSql(opts?.archived);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const results: MemoryRecord[] = [];
    for (const row of rows) {
      const record = this.deserializeMemory(row);
      if (this.isMemoryExpired(record)) {
        this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
        continue;
      }
      if (opts?.maxFlags !== undefined && (record.flagCount ?? 0) > opts.maxFlags) continue;
      const valStr = typeof record.value === 'string' ? record.value : JSON.stringify(record.value);
      if (
        record.key.toLowerCase().includes(q) ||
        valStr.toLowerCase().includes(q) ||
        record.tags.some(t => t.toLowerCase().includes(q))
      ) {
        results.push(record);
        // Optional result cap (additive; callers that omit it keep the full result set). The substring
        // match is applied in JS, so the cap is enforced here — post-filter — not as a SQL LIMIT.
        if (opts?.limit !== undefined && results.length >= opts.limit) break;
      }
    }
    return results;
  },

  async searchText(this: SqliteStorage, query: string, opts?: MemoryTextSearchOpts): Promise<MemoryTextHit[]> {
    return searchTextMemory(this.db, query, opts);
  },

  async archiveMemoryByKey(this: SqliteStorage, keyOrPrefix: string, opts: { archivedRoot: string; archivedBy: string; archivedAt: string; match?: 'exact' | 'prefix' | 'subtree' }): Promise<number> {
    return archiveMemoryByKeyRepo(this.db, keyOrPrefix, opts);
  },

  async unarchiveMemoryByRoot(this: SqliteStorage, archivedRoot: string): Promise<number> {
    return unarchiveMemoryByRootRepo(this.db, archivedRoot);
  },

  async unarchiveMemoryByKey(this: SqliteStorage, keyOrPrefix: string, opts?: { match?: 'exact' | 'prefix' | 'subtree' }): Promise<number> {
    return unarchiveMemoryByKeyRepo(this.db, keyOrPrefix, opts);
  },

  async countArchivedByKeyPrefix(this: SqliteStorage, keyPrefix: string): Promise<{ active: number; archived: number }> {
    return countArchivedByKeyPrefixRepo(this.db, keyPrefix);
  },

  deserializeMemory(this: SqliteStorage, row: Record<string, unknown>): MemoryRecord {
    const record: MemoryRecord = {
      key: row.key as string,
      ownerGaii: row.ownerGaii as string,
      value: JSON.parse(row.value as string),
      visibility: row.visibility as MemoryRecord['visibility'],
      tags: JSON.parse(row.tags as string) as string[],
      ttlHours: row.ttlHours as number | null,
      version: row.version as number,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.flagCount !== null && row.flagCount !== undefined) {
      record.flagCount = row.flagCount as number;
    }
    if (row.allowedOrigins) record.allowedOrigins = JSON.parse(row.allowedOrigins as string);
    if (row.groupId) record.groupId = row.groupId as string;
    if (row.workspaceRef) record.workspaceRef = row.workspaceRef as string;
    if (row.trackable) record.trackable = true;
    if (row.archived) record.archived = true;
    if (row.archivedAt) record.archivedAt = row.archivedAt as string;
    if (row.archivedBy) record.archivedBy = row.archivedBy as string;
    if (row.archivedRoot) record.archivedRoot = row.archivedRoot as string;
    if (row.aiProvenanceId) record.aiProvenanceId = row.aiProvenanceId as string;
    return record;
  },

  /** Read an optional `_actor` / `_event` annotation off a record value (the convention the structure
   *  timeline uses) so archived history rows carry who/why. Best-effort. */
  memoryAnnotation(this: SqliteStorage, value: unknown, field: '_actor' | '_event'): string | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const v = (value as Record<string, unknown>)[field];
      if (typeof v === 'string' && v) return v;
    }
    return null;
  },

  // ══════════════════════════════════════════════════════════
};
