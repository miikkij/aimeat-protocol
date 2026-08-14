/**
 * @file src/storage/providers/sqlite/methods/capability-agents.ts
 * @description Capability, Stats, Agent-task, Directives, Sharing-group, Activity, Usage-ledger methods. Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 */
import type {
  CapabilityRecord, CapabilityLogEntry, CapabilityStats, AgentTaskRecord, AgentTaskEventRecord, AgentDirectivesRecord,
  OwnerAgentDefaults, SharingGroupRecord, GroupShareRecord, AgentActivityRecord, AgentUsageEvent, AgentUsageDailyRecord, UsageDailyFilter,
  UsageEventFilter, AdminUsageDailyFilter, StorageStatsSnapshot
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import * as agentTaskRepo from '../repos/agent-task.js';
import * as sharingGroupRepo from '../repos/sharing-group.js';
import * as agentDirectivesRepo from '../repos/agent-directives.js';
import * as agentActivityRepo from '../repos/agent-activity.js';
import * as agentUsageRepo from '../repos/agent-usage.js';

export const capabilityAgentsMethods = {
  // ── Capability Layer ──────────────────────────────────────────────

  deserializeCapability(this: SqliteStorage, row: Record<string, unknown>): CapabilityRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      summary: (row.summary as string) || '',
      ownerGhii: row.ownerGhii as string,
      visibility: row.visibility as CapabilityRecord['visibility'],
      scope: 'local',
      status: row.status as CapabilityRecord['status'],
      rejectionReason: (row.rejectionReason as string) || null,
      deprecationMessage: (row.deprecationMessage as string) || null,
      replacedBy: (row.replacedBy as string) || null,
      source: { type: row.sourceType as string, ref: row.sourceRef as string, version: row.sourceVersion as string } as CapabilityRecord['source'],
      authRequired: row.authRequired as CapabilityRecord['authRequired'],
      callable: row.callable === 1 || row.callable === true,
      inputSchema: row.inputSchema ? JSON.parse(row.inputSchema as string) : null,
      outputSchema: row.outputSchema ? JSON.parse(row.outputSchema as string) : null,
      exports: row.exports ? JSON.parse(row.exports as string) : null,
      usage: (row.usage as string) || '',
      whenToUse: (row.whenToUse as string) || '',
      whenNotToUse: (row.whenNotToUse as string) || '',
      examples: JSON.parse((row.examples as string) || '[]'),
      dependencies: JSON.parse((row.dependencies as string) || '[]'),
      schemaHash: (row.schemaHash as string) || '',
      webhookUrl: (row.webhookUrl as string) || null,
      cost: row.cost ? JSON.parse(row.cost as string) : null,
      trustRequired: row.trustRequired as number | null,
      trust: JSON.parse((row.trust as string) || '{}'),
      redactedFields: JSON.parse((row.redactedFields as string) || '[]'),
      operatorOverride: row.operatorOverride ? JSON.parse(row.operatorOverride as string) : null,
      stats: JSON.parse((row.stats as string) || '{}'),
      tags: JSON.parse((row.tags as string) || '[]'),
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  },

  async createCapability(this: SqliteStorage, record: CapabilityRecord): Promise<CapabilityRecord> {
    this.db.prepare(`INSERT INTO capabilities (id, name, summary, ownerGhii, visibility, scope, status,
      rejectionReason, deprecationMessage, replacedBy, sourceType, sourceRef, sourceVersion,
      authRequired, callable, inputSchema, outputSchema, exports, usage, whenToUse, whenNotToUse,
      examples, dependencies, schemaHash, webhookUrl, cost, trustRequired, trust, redactedFields,
      operatorOverride, stats, tags, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.name, record.summary, record.ownerGhii, record.visibility, record.scope, record.status,
      record.rejectionReason, record.deprecationMessage, record.replacedBy,
      record.source.type, record.source.ref, record.source.version,
      record.authRequired, record.callable ? 1 : 0,
      record.inputSchema ? JSON.stringify(record.inputSchema) : null,
      record.outputSchema ? JSON.stringify(record.outputSchema) : null,
      record.exports ? JSON.stringify(record.exports) : null,
      record.usage, record.whenToUse, record.whenNotToUse,
      JSON.stringify(record.examples), JSON.stringify(record.dependencies), record.schemaHash,
      record.webhookUrl,
      record.cost ? JSON.stringify(record.cost) : null,
      record.trustRequired,
      JSON.stringify(record.trust), JSON.stringify(record.redactedFields),
      record.operatorOverride ? JSON.stringify(record.operatorOverride) : null,
      JSON.stringify(record.stats), JSON.stringify(record.tags),
      record.createdAt, record.updatedAt,
    );
    return record;
  },

  async getCapability(this: SqliteStorage, id: string): Promise<CapabilityRecord | null> {
    const row = this.db.prepare('SELECT * FROM capabilities WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeCapability(row) : null;
  },

  async updateCapability(this: SqliteStorage, id: string, updates: Partial<CapabilityRecord>): Promise<CapabilityRecord | null> {
    const existing = await this.getCapability(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates, updatedAt: updates.updatedAt || new Date().toISOString() };
    if (updates.source) {
      merged.source = { ...existing.source, ...updates.source };
    }
    this.db.prepare(`UPDATE capabilities SET name=?, summary=?, ownerGhii=?, visibility=?, status=?,
      rejectionReason=?, deprecationMessage=?, replacedBy=?, sourceType=?, sourceRef=?, sourceVersion=?,
      authRequired=?, callable=?, inputSchema=?, outputSchema=?, exports=?, usage=?, whenToUse=?, whenNotToUse=?,
      examples=?, dependencies=?, schemaHash=?, webhookUrl=?, cost=?, trustRequired=?, trust=?, redactedFields=?,
      operatorOverride=?, stats=?, tags=?, updatedAt=? WHERE id=?`
    ).run(
      merged.name, merged.summary, merged.ownerGhii, merged.visibility, merged.status,
      merged.rejectionReason, merged.deprecationMessage, merged.replacedBy,
      merged.source.type, merged.source.ref, merged.source.version,
      merged.authRequired, merged.callable ? 1 : 0,
      merged.inputSchema ? JSON.stringify(merged.inputSchema) : null,
      merged.outputSchema ? JSON.stringify(merged.outputSchema) : null,
      merged.exports ? JSON.stringify(merged.exports) : null,
      merged.usage, merged.whenToUse, merged.whenNotToUse,
      JSON.stringify(merged.examples), JSON.stringify(merged.dependencies), merged.schemaHash,
      merged.webhookUrl,
      merged.cost ? JSON.stringify(merged.cost) : null,
      merged.trustRequired,
      JSON.stringify(merged.trust), JSON.stringify(merged.redactedFields),
      merged.operatorOverride ? JSON.stringify(merged.operatorOverride) : null,
      JSON.stringify(merged.stats), JSON.stringify(merged.tags),
      merged.updatedAt, id,
    );
    return merged;
  },

  async deleteCapability(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM capabilities WHERE id = ?').run(id);
    return result.changes > 0;
  },

  async listCapabilities(this: SqliteStorage, filters: import('../../../interface.js').CapabilityFilter): Promise<{ capabilities: CapabilityRecord[]; total: number }> {
    let query = 'SELECT * FROM capabilities WHERE 1=1';
    const params: unknown[] = [];

    if (filters.ownerGhii) { query += ' AND ownerGhii = ?'; params.push(filters.ownerGhii); }
    if (filters.visibility) { query += ' AND visibility = ?'; params.push(filters.visibility); }
    if (filters.publicOrOwner) { query += ' AND (visibility = ? OR ownerGhii = ?)'; params.push('public', filters.publicOrOwner); }
    if (filters.status) { query += ' AND status = ?'; params.push(filters.status); }
    if (filters.sourceType) { query += ' AND sourceType = ?'; params.push(filters.sourceType); }
    if (filters.authRequired) { query += ' AND authRequired = ?'; params.push(filters.authRequired); }
    if (filters.callable !== undefined) { query += ' AND callable = ?'; params.push(filters.callable ? 1 : 0); }

    query += ' ORDER BY updatedAt DESC';
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];

    let results = rows.map(r => this.deserializeCapability(r));

    if (filters.search) {
      const q = filters.search.toLowerCase();
      results = results.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    if (filters.tags && filters.tags.length > 0) {
      results = results.filter(c => filters.tags!.some(t => c.tags.includes(t)));
    }

    const total = results.length;
    const page = filters.page || 1;
    const perPage = filters.perPage || 20;
    const start = (page - 1) * perPage;
    results = results.slice(start, start + perPage);

    return { capabilities: results, total };
  },

  async listCapabilitiesByOwner(this: SqliteStorage, ownerGhii: string): Promise<CapabilityRecord[]> {
    const rows = this.db.prepare('SELECT * FROM capabilities WHERE ownerGhii = ? ORDER BY updatedAt DESC').all(ownerGhii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeCapability(r));
  },

  async getCapabilityBySourceRef(this: SqliteStorage, sourceRef: string): Promise<CapabilityRecord | null> {
    const row = this.db.prepare('SELECT * FROM capabilities WHERE sourceRef = ?').get(sourceRef) as Record<string, unknown> | undefined;
    return row ? this.deserializeCapability(row) : null;
  },

  async listCapabilitiesBySourceType(this: SqliteStorage, sourceType: string): Promise<CapabilityRecord[]> {
    const rows = this.db.prepare('SELECT * FROM capabilities WHERE sourceType = ?').all(sourceType) as Record<string, unknown>[];
    return rows.map(r => this.deserializeCapability(r));
  },

  async incrementCapabilityStats(this: SqliteStorage, id: string, delta: { success: number; error: number; totalMs: number; lastError?: string }): Promise<void> {
    const cap = await this.getCapability(id);
    if (!cap) return;
    const s = cap.stats;
    const newTotal = s.totalInvocations + delta.success + delta.error;
    const newSuccess = s.successCount + delta.success;
    const newError = s.errorCount + delta.error;
    const totalMs = (s.avgResponseMs * s.totalInvocations) + delta.totalMs;
    const newAvg = newTotal > 0 ? Math.round(totalMs / newTotal) : 0;
    const updated: CapabilityStats = {
      totalInvocations: newTotal,
      successCount: newSuccess,
      errorCount: newError,
      lastInvokedAt: new Date().toISOString(),
      avgResponseMs: newAvg,
      lastError: delta.lastError ?? s.lastError,
    };
    this.db.prepare('UPDATE capabilities SET stats = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(updated), new Date().toISOString(), id);
  },

  async addCapabilityLog(this: SqliteStorage, entry: CapabilityLogEntry): Promise<void> {
    this.db.prepare(`INSERT INTO capability_logs (id, capabilityId, callerGhii, input, status, durationMs, error, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(entry.id, entry.capabilityId, entry.callerGhii, JSON.stringify(entry.input), entry.status, entry.durationMs, entry.error, entry.timestamp);
  },

  async listCapabilityLogs(this: SqliteStorage, capabilityId: string, filters: { status?: 'success' | 'error'; page?: number; perPage?: number }): Promise<{ logs: CapabilityLogEntry[]; total: number }> {
    let countQ = 'SELECT COUNT(*) as c FROM capability_logs WHERE capabilityId = ?';
    let dataQ = 'SELECT * FROM capability_logs WHERE capabilityId = ?';
    const params: unknown[] = [capabilityId];

    if (filters.status) {
      countQ += ' AND status = ?';
      dataQ += ' AND status = ?';
      params.push(filters.status);
    }

    const total = (this.db.prepare(countQ).get(...params) as { c: number }).c;
    dataQ += ' ORDER BY timestamp DESC';
    const page = filters.page || 1;
    const perPage = filters.perPage || 50;
    dataQ += ` LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`;

    const rows = this.db.prepare(dataQ).all(...params) as Record<string, unknown>[];
    const logs: CapabilityLogEntry[] = rows.map(r => ({
      id: r.id as string,
      capabilityId: r.capabilityId as string,
      callerGhii: r.callerGhii as string,
      input: JSON.parse((r.input as string) || '{}'),
      status: r.status as 'success' | 'error',
      durationMs: r.durationMs as number,
      error: (r.error as string) || null,
      timestamp: r.timestamp as string,
    }));
    return { logs, total };
  },

  async deleteCapabilityLogsBefore(this: SqliteStorage, before: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM capability_logs WHERE timestamp < ?').run(before);
    return result.changes;
  },

  async setCapabilityOverride(this: SqliteStorage, id: string, override: import('../../../interface.js').CapabilityOverride | null): Promise<void> {
    this.db.prepare('UPDATE capabilities SET operatorOverride = ?, updatedAt = ? WHERE id = ?')
      .run(override ? JSON.stringify(override) : null, new Date().toISOString(), id);
  },

  async setCapabilityTrust(this: SqliteStorage, id: string, trustUpdates: Partial<import('../../../interface.js').CapabilityTrust>): Promise<void> {
    const cap = await this.getCapability(id);
    if (!cap) return;
    const merged = { ...cap.trust, ...trustUpdates };
    this.db.prepare('UPDATE capabilities SET trust = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(merged), new Date().toISOString(), id);
  },

  async incrementVouchCount(this: SqliteStorage, id: string): Promise<void> {
    const cap = await this.getCapability(id);
    if (!cap) return;
    const trust = { ...cap.trust, vouchCount: cap.trust.vouchCount + 1 };
    this.db.prepare('UPDATE capabilities SET trust = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(trust), new Date().toISOString(), id);
  },

  async decrementVouchCount(this: SqliteStorage, id: string): Promise<void> {
    const cap = await this.getCapability(id);
    if (!cap) return;
    const trust = { ...cap.trust, vouchCount: Math.max(0, cap.trust.vouchCount - 1) };
    this.db.prepare('UPDATE capabilities SET trust = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(trust), new Date().toISOString(), id);
  },

  // ── Stats Persistence ──

  async flushStats(this: SqliteStorage, counters: Record<string, number>): Promise<void> {
    const upsert = this.db.prepare(
      `INSERT INTO stats_counters (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    const tx = this.db.transaction((entries: [string, number][]) => {
      for (const [key, value] of entries) {
        upsert.run(key, value);
      }
    });
    tx(Object.entries(counters));
  },

  async loadStats(this: SqliteStorage): Promise<Record<string, number>> {
    const rows = this.db.prepare('SELECT key, value FROM stats_counters').all() as Array<{ key: string; value: number }>;
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  },

  async flushDailyHistory(this: SqliteStorage, history: Record<string, Record<string, number>>): Promise<void> {
    const upsert = this.db.prepare(
      `INSERT INTO stats_daily_history (date, key, value) VALUES (?, ?, ?)
       ON CONFLICT(date, key) DO UPDATE SET value = excluded.value`
    );
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const tx = this.db.transaction((entries: [string, Record<string, number>][]) => {
      for (const [date, counters] of entries) {
        for (const [key, value] of Object.entries(counters)) {
          upsert.run(date, key, value);
        }
      }
      this.db.prepare('DELETE FROM stats_daily_history WHERE date < ?').run(cutoffStr);
    });
    tx(Object.entries(history));
  },

  async loadDailyHistory(this: SqliteStorage): Promise<Record<string, Record<string, number>>> {
    const rows = this.db.prepare('SELECT date, key, value FROM stats_daily_history ORDER BY date').all() as Array<{ date: string; key: string; value: number }>;
    const result: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      if (!result[row.date]) result[row.date] = {};
      result[row.date][row.key] = row.value;
    }
    return result;
  },

  // ── Storage-size telemetry (operator DB tab) ──
  async getTableRowCounts(this: SqliteStorage): Promise<Record<string, number>> {
    const tables = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as Array<{ name: string }>;
    const counts: Record<string, number> = {};
    for (const { name } of tables) {
      // Table names come from sqlite_master (not user input); quote defensively for odd names.
      const row = this.db.prepare(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as { n: number };
      counts[name] = row.n;
    }
    return counts;
  },
  async getMemoryRowBreakdown(this: SqliteStorage): Promise<{ versionRows: number; archivedRows: number }> {
    // One aggregate over the memory table — no values loaded. `.version.N` history + archived rows
    // both inflate the table invisibly; the admin DB tab shows the composition.
    const row = this.db.prepare(
      `SELECT
         SUM(CASE WHEN key LIKE '%.version.%' THEN 1 ELSE 0 END) AS v,
         SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END) AS a
       FROM memory`
    ).get() as { v: number | null; a: number | null };
    return { versionRows: row.v ?? 0, archivedRows: row.a ?? 0 };
  },
  async saveStorageStatsSnapshot(this: SqliteStorage, s: StorageStatsSnapshot): Promise<void> {
    this.db.prepare(
      `INSERT INTO storage_stats_snapshots (id, capturedAt, counts, totalRows) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET capturedAt = excluded.capturedAt, counts = excluded.counts, totalRows = excluded.totalRows`
    ).run(s.id, s.capturedAt, JSON.stringify(s.counts), s.totalRows);
  },
  async listStorageStatsSnapshots(this: SqliteStorage, opts?: { limit?: number; sinceIso?: string }): Promise<StorageStatsSnapshot[]> {
    let sql = 'SELECT id, capturedAt, counts, totalRows FROM storage_stats_snapshots';
    const params: unknown[] = [];
    if (opts?.sinceIso) { sql += ' WHERE capturedAt >= ?'; params.push(opts.sinceIso); }
    sql += ' ORDER BY capturedAt DESC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    const rows = this.db.prepare(sql).all(...params) as Array<{ id: string; capturedAt: string; counts: string; totalRows: number }>;
    return rows.map(r => ({ id: r.id, capturedAt: r.capturedAt, counts: JSON.parse(r.counts) as Record<string, number>, totalRows: r.totalRows }));
  },
  async pruneStorageStatsSnapshots(this: SqliteStorage, beforeIso: string): Promise<number> {
    return this.db.prepare('DELETE FROM storage_stats_snapshots WHERE capturedAt < ?').run(beforeIso).changes;
  },

  // ══════════════════════════════════════════════════════════
  // ── Agent Tasks ──
  // ══════════════════════════════════════════════════════════

  async createAgentTask(this: SqliteStorage, record: AgentTaskRecord): Promise<AgentTaskRecord> {
    return agentTaskRepo.createAgentTask(this.db, record);
  },

  async getAgentTask(this: SqliteStorage, id: string): Promise<AgentTaskRecord | null> {
    return agentTaskRepo.getAgentTask(this.db, id);
  },

  async findLiveTaskByDedupeKey(this: SqliteStorage, agentGaii: string, dedupeKey: string): Promise<AgentTaskRecord | null> {
    return agentTaskRepo.findLiveTaskByDedupeKey(this.db, agentGaii, dedupeKey);
  },

  async listAgentTasks(this: SqliteStorage, agentGaii: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<{ tasks: AgentTaskRecord[]; total: number }> {
    return agentTaskRepo.listAgentTasks(this.db, agentGaii, opts);
  },

  async listAgentTasksByOwner(this: SqliteStorage, ownerGaii: string, opts?: { status?: string; agentGaii?: string; page?: number; perPage?: number }): Promise<{ tasks: AgentTaskRecord[]; total: number }> {
    return agentTaskRepo.listAgentTasksByOwner(this.db, ownerGaii, opts);
  },

  async updateAgentTask(this: SqliteStorage, id: string, updates: Partial<AgentTaskRecord>): Promise<AgentTaskRecord | null> {
    return agentTaskRepo.updateAgentTask(this.db, id, updates);
  },

  async deleteAgentTask(this: SqliteStorage, id: string): Promise<boolean> {
    return agentTaskRepo.deleteAgentTask(this.db, id);
  },

  async appendTaskEvent(this: SqliteStorage, event: AgentTaskEventRecord): Promise<AgentTaskEventRecord> {
    return agentTaskRepo.appendTaskEvent(this.db, event);
  },

  async listTaskEvents(this: SqliteStorage, taskId: string, opts?: { page?: number; perPage?: number }): Promise<{ events: AgentTaskEventRecord[]; total: number }> {
    return agentTaskRepo.listTaskEvents(this.db, taskId, opts);
  },

  async countTasksByAgent(this: SqliteStorage, agentGaii: string): Promise<{ queued: number; active: number; done: number; failed: number }> {
    return agentTaskRepo.countTasksByAgent(this.db, agentGaii);
  },

  async countTasksByOwner(this: SqliteStorage, ownerGaii: string): Promise<Record<string, { queued: number; active: number; done: number; failed: number; doneToday: number; lastTaskUpdateAt: string | null; lastFailedAt: string | null }>> {
    return agentTaskRepo.countTasksByOwner(this.db, ownerGaii);
  },

  async findStalledTasks(this: SqliteStorage, thresholdMinutes: number): Promise<AgentTaskRecord[]> {
    return agentTaskRepo.findStalledTasks(this.db, thresholdMinutes);
  },

  // ══════════════════════════════════════════════════════════
  // ── Agent Directives ──
  // ══════════════════════════════════════════════════════════

  async getAgentDirectives(this: SqliteStorage, agentGaii: string): Promise<AgentDirectivesRecord | null> {
    return agentDirectivesRepo.getAgentDirectives(this.db, agentGaii);
  },

  async upsertAgentDirectives(this: SqliteStorage, record: AgentDirectivesRecord): Promise<AgentDirectivesRecord> {
    return agentDirectivesRepo.upsertAgentDirectives(this.db, record);
  },

  async deleteAgentDirectives(this: SqliteStorage, agentGaii: string): Promise<boolean> {
    return agentDirectivesRepo.deleteAgentDirectives(this.db, agentGaii);
  },

  async getOwnerAgentDefaults(this: SqliteStorage, ownerGaii: string): Promise<OwnerAgentDefaults | null> {
    return agentDirectivesRepo.getOwnerAgentDefaults(this.db, ownerGaii);
  },

  async upsertOwnerAgentDefaults(this: SqliteStorage, record: OwnerAgentDefaults): Promise<OwnerAgentDefaults> {
    return agentDirectivesRepo.upsertOwnerAgentDefaults(this.db, record);
  },

  // ══════════════════════════════════════════════════════════
  // ── Sharing Groups ──
  // ══════════════════════════════════════════════════════════

  async createSharingGroup(this: SqliteStorage, record: SharingGroupRecord): Promise<SharingGroupRecord> {
    return sharingGroupRepo.createSharingGroup(this.db, record);
  },

  async getSharingGroup(this: SqliteStorage, id: string): Promise<SharingGroupRecord | null> {
    return sharingGroupRepo.getSharingGroup(this.db, id);
  },

  async listSharingGroups(this: SqliteStorage, ownerGaii: string): Promise<SharingGroupRecord[]> {
    return sharingGroupRepo.listSharingGroups(this.db, ownerGaii);
  },

  async listSharingGroupsByMember(this: SqliteStorage, identifier: string): Promise<SharingGroupRecord[]> {
    return sharingGroupRepo.listSharingGroupsByMember(this.db, identifier);
  },

  async updateSharingGroup(this: SqliteStorage, id: string, updates: Partial<SharingGroupRecord>): Promise<SharingGroupRecord | null> {
    return sharingGroupRepo.updateSharingGroup(this.db, id, updates);
  },

  async deleteSharingGroup(this: SqliteStorage, id: string): Promise<boolean> {
    return sharingGroupRepo.deleteSharingGroup(this.db, id);
  },

  async countEntriesReferencingGroup(this: SqliteStorage, groupId: string): Promise<number> {
    return sharingGroupRepo.countEntriesReferencingGroup(this.db, groupId);
  },

  // ── Key-space shares ──

  async createGroupShare(this: SqliteStorage, record: GroupShareRecord): Promise<GroupShareRecord> {
    return sharingGroupRepo.createGroupShare(this.db, record);
  },

  async getGroupShare(this: SqliteStorage, id: string): Promise<GroupShareRecord | null> {
    return sharingGroupRepo.getGroupShare(this.db, id);
  },

  async listGroupSharesByOwner(this: SqliteStorage, ownerGaii: string): Promise<GroupShareRecord[]> {
    return sharingGroupRepo.listGroupSharesByOwner(this.db, ownerGaii);
  },

  async listGroupSharesByGroups(this: SqliteStorage, groupIds: string[]): Promise<GroupShareRecord[]> {
    return sharingGroupRepo.listGroupSharesByGroups(this.db, groupIds);
  },

  async deleteGroupShare(this: SqliteStorage, id: string): Promise<boolean> {
    return sharingGroupRepo.deleteGroupShare(this.db, id);
  },

  async deleteGroupSharesByGroup(this: SqliteStorage, groupId: string): Promise<number> {
    return sharingGroupRepo.deleteGroupSharesByGroup(this.db, groupId);
  },

  // ══════════════════════════════════════════════════════════
  // ── Agent Activity ──
  // ══════════════════════════════════════════════════════════

  async recordActivity(this: SqliteStorage, record: AgentActivityRecord): Promise<void> {
    return agentActivityRepo.recordActivity(this.db, record);
  },

  async getActivityHistory(this: SqliteStorage, agentGaii: string, opts?: { days?: number; granularity?: 'daily' | 'hourly' }): Promise<AgentActivityRecord[]> {
    return agentActivityRepo.getActivityHistory(this.db, agentGaii, opts);
  },

  // ══════════════════════════════════════════════════════════
  // ── Agent LLM Usage Ledger (LEDGER / TARGET-016) ──
  // ══════════════════════════════════════════════════════════

  async appendUsageEvent(this: SqliteStorage, event: AgentUsageEvent): Promise<void> {
    return agentUsageRepo.appendUsageEvent(this.db, event);
  },

  async incrementUsageDaily(this: SqliteStorage, delta: AgentUsageDailyRecord): Promise<void> {
    return agentUsageRepo.incrementUsageDaily(this.db, delta);
  },

  async queryUsageDaily(this: SqliteStorage, filter: UsageDailyFilter): Promise<AgentUsageDailyRecord[]> {
    return agentUsageRepo.queryUsageDaily(this.db, filter);
  },

  async listUsageEvents(this: SqliteStorage, filter: UsageEventFilter): Promise<AgentUsageEvent[]> {
    return agentUsageRepo.listUsageEvents(this.db, filter);
  },

  async queryUsageDailyAllOwners(this: SqliteStorage, filter: AdminUsageDailyFilter): Promise<AgentUsageDailyRecord[]> {
    return agentUsageRepo.queryUsageDailyAllOwners(this.db, filter);
  },

  // ══════════════════════════════════════════════════════════
};
