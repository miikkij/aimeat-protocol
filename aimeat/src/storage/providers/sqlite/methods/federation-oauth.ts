/**
 * @file src/storage/providers/sqlite/methods/federation-oauth.ts
 * @description Operator-review, Scheduler, Execution-log, Extension-instance, Federation-peer, Replication, Device-auth, Ecosystem-app, OAuth methods. Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 */
import type {
  EcosystemAppRecord, EcoAuthorizationRecord, EcoAutomationRecipe, OperatorReviewRecord, ScheduledJobRecord, ExtensionInstanceRecord,
  FederationPeerRecord, ReplicationQueueEntry, DeviceAuthorizationRecord, OAuthClientRecord, OAuthRefreshTokenRecord, OAuthApprovalRecord,
  ExecutionLogEntry
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import { randomUUID } from 'node:crypto';
import * as ecosystemAppRepo from '../repos/ecosystem-app.js';

export const federationOauthMethods = {
  // ── Knowledge: Operator Reviews ──
  // ══════════════════════════════════════════════════════════

  async createReview(this: SqliteStorage, record: OperatorReviewRecord): Promise<OperatorReviewRecord> {
    this.db.prepare(`
      INSERT INTO knowledge_reviews (id, packageId, operatorGaii, reason, customText, action, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.packageId, record.operatorGaii, record.reason, record.customText ?? null, record.action, record.timestamp);
    return record;
  },

  async listReviews(this: SqliteStorage, packageId: string): Promise<OperatorReviewRecord[]> {
    return this.db.prepare('SELECT * FROM knowledge_reviews WHERE packageId = ? ORDER BY timestamp ASC').all(packageId) as OperatorReviewRecord[];
  },

  async listAllReviews(this: SqliteStorage, opts?: { page?: number; perPage?: number }): Promise<OperatorReviewRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    const offset = (page - 1) * perPage;
    return this.db.prepare('SELECT * FROM knowledge_reviews ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(perPage, offset) as OperatorReviewRecord[];
  },

  async deleteReviewsByOperator(this: SqliteStorage, gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM knowledge_reviews WHERE operatorGaii = ?').run(gaii);
    return result.changes;
  },

  // ══════════════════════════════════════════════════════════
  // ── Scheduled Jobs ──
  // ══════════════════════════════════════════════════════════

  async createScheduledJob(this: SqliteStorage, record: ScheduledJobRecord): Promise<ScheduledJobRecord> {
    try {
      this.db.prepare(
        `INSERT INTO scheduled_jobs (id, name, type, extensionName, instanceId, actionId,
         coreHandler, cron, enabled, input, lastRunAt, lastRunResult, lastRunError,
         lastRunDurationMs, nextRunAt, createdBy, createdAt, updatedAt,
         ownerScope, agentName, agentGaii, createdByAgent, displayName, description,
         purpose, timezone, constraints, runCount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id, record.name, record.type,
        record.extensionName ?? null, record.instanceId ?? null, record.actionId ?? null,
        record.coreHandler ?? null, record.cron, record.enabled ? 1 : 0,
        record.input ? JSON.stringify(record.input) : null,
        record.lastRunAt ?? null, record.lastRunResult ?? null, record.lastRunError ?? null,
        record.lastRunDurationMs ?? null, record.nextRunAt ?? null,
        record.createdBy, record.createdAt, record.updatedAt,
        record.ownerScope ?? null, record.agentName ?? null, record.agentGaii ?? null,
        record.createdByAgent ? 1 : 0, record.displayName ?? null, record.description ?? null,
        record.purpose ?? null, record.timezone ?? null,
        record.constraints ? JSON.stringify(record.constraints) : null,
        record.runCount ?? 0,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) {
        throw new Error(`Scheduled job "${record.id}" already exists`, { cause: err });
      }
      throw err;
    }
  },

  async getScheduledJob(this: SqliteStorage, id: string): Promise<ScheduledJobRecord | null> {
    const row = this.db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeScheduledJob(row) : null;
  },

  async listScheduledJobs(this: SqliteStorage, filter?: { type?: string; extensionName?: string; enabled?: boolean; ownerScope?: string; agentGaii?: string }): Promise<ScheduledJobRecord[]> {
    let sql = 'SELECT * FROM scheduled_jobs';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.type) { conditions.push('type = ?'); params.push(filter.type); }
    if (filter?.extensionName) { conditions.push('extensionName = ?'); params.push(filter.extensionName); }
    if (filter?.enabled !== undefined) { conditions.push('enabled = ?'); params.push(filter.enabled ? 1 : 0); }
    if (filter?.ownerScope) { conditions.push('ownerScope = ?'); params.push(filter.ownerScope); }
    if (filter?.agentGaii) { conditions.push('agentGaii = ?'); params.push(filter.agentGaii); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeScheduledJob(r));
  },

  async updateScheduledJob(this: SqliteStorage, id: string, updates: Partial<ScheduledJobRecord>): Promise<ScheduledJobRecord | null> {
    const existing = await this.getScheduledJob(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE scheduled_jobs SET name = ?, type = ?, extensionName = ?, instanceId = ?,
       actionId = ?, coreHandler = ?, cron = ?, enabled = ?, input = ?,
       lastRunAt = ?, lastRunResult = ?, lastRunError = ?, lastRunDurationMs = ?,
       nextRunAt = ?, createdBy = ?, createdAt = ?, updatedAt = ?,
       ownerScope = ?, agentName = ?, agentGaii = ?, createdByAgent = ?,
       displayName = ?, description = ?, purpose = ?, timezone = ?,
       constraints = ?, runCount = ? WHERE id = ?`
    ).run(
      updated.name, updated.type,
      updated.extensionName ?? null, updated.instanceId ?? null, updated.actionId ?? null,
      updated.coreHandler ?? null, updated.cron, updated.enabled ? 1 : 0,
      updated.input ? JSON.stringify(updated.input) : null,
      updated.lastRunAt ?? null, updated.lastRunResult ?? null, updated.lastRunError ?? null,
      updated.lastRunDurationMs ?? null, updated.nextRunAt ?? null,
      updated.createdBy, updated.createdAt, updated.updatedAt,
      updated.ownerScope ?? null, updated.agentName ?? null, updated.agentGaii ?? null,
      updated.createdByAgent ? 1 : 0, updated.displayName ?? null, updated.description ?? null,
      updated.purpose ?? null, updated.timezone ?? null,
      updated.constraints ? JSON.stringify(updated.constraints) : null,
      updated.runCount ?? 0, id,
    );
    return updated;
  },

  async deleteScheduledJob(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(id);
    return result.changes > 0;
  },

  deserializeScheduledJob(this: SqliteStorage, row: Record<string, unknown>): ScheduledJobRecord {
    const record: ScheduledJobRecord = {
      id: row.id as string,
      name: row.name as string,
      type: row.type as ScheduledJobRecord['type'],
      cron: row.cron as string,
      enabled: (row.enabled as number) === 1,
      createdBy: row.createdBy as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.extensionName) record.extensionName = row.extensionName as string;
    if (row.instanceId) record.instanceId = row.instanceId as string;
    if (row.actionId) record.actionId = row.actionId as string;
    if (row.coreHandler) record.coreHandler = row.coreHandler as string;
    if (row.input) record.input = JSON.parse(row.input as string);
    if (row.lastRunAt) record.lastRunAt = row.lastRunAt as string;
    if (row.lastRunResult) record.lastRunResult = row.lastRunResult as ScheduledJobRecord['lastRunResult'];
    if (row.lastRunError) record.lastRunError = row.lastRunError as string;
    if (row.lastRunDurationMs !== null && row.lastRunDurationMs !== undefined) record.lastRunDurationMs = row.lastRunDurationMs as number;
    if (row.nextRunAt) record.nextRunAt = row.nextRunAt as string;
    if (row.ownerScope) record.ownerScope = row.ownerScope as string;
    if (row.agentName) record.agentName = row.agentName as string;
    if (row.agentGaii) record.agentGaii = row.agentGaii as string;
    if ((row.createdByAgent as number) === 1) record.createdByAgent = true;
    if (row.displayName) record.displayName = row.displayName as string;
    if (row.description) record.description = row.description as string;
    if (row.purpose) record.purpose = row.purpose as string;
    if (row.timezone) record.timezone = row.timezone as string;
    if (row.constraints) record.constraints = JSON.parse(row.constraints as string);
    if (row.runCount !== null && row.runCount !== undefined) record.runCount = row.runCount as number;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Execution Log ──
  // ══════════════════════════════════════════════════════════

  async createExecutionLog(this: SqliteStorage, entry: ExecutionLogEntry): Promise<ExecutionLogEntry> {
    this.db.prepare(
      `INSERT INTO execution_log (id, jobId, jobName, type, extensionName, actionId,
       "trigger", result, errorMessage, durationMs, memoryReads, memoryWrites, taskId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.id, entry.jobId, entry.jobName, entry.type,
      entry.extensionName ?? null, entry.actionId ?? null,
      entry.trigger, entry.result, entry.errorMessage ?? null,
      entry.durationMs,
      JSON.stringify(entry.memoryReads),
      JSON.stringify(entry.memoryWrites),
      entry.taskId ?? null,
      entry.createdAt,
    );
    return entry;
  },

  async listExecutionLogs(this: SqliteStorage, filter?: {
    jobId?: string; extensionName?: string; trigger?: string; result?: string;
    limit?: number; offset?: number;
  }): Promise<ExecutionLogEntry[]> {
    let sql = 'SELECT * FROM execution_log';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.jobId) { conditions.push('jobId = ?'); params.push(filter.jobId); }
    if (filter?.extensionName) { conditions.push('extensionName = ?'); params.push(filter.extensionName); }
    if (filter?.trigger) { conditions.push('"trigger" = ?'); params.push(filter.trigger); }
    if (filter?.result) { conditions.push('result = ?'); params.push(filter.result); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY createdAt DESC';
    if (filter?.limit) { sql += ' LIMIT ?'; params.push(filter.limit); }
    if (filter?.offset) { sql += ' OFFSET ?'; params.push(filter.offset); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeExecutionLog(r));
  },

  async countExecutionLogs(this: SqliteStorage, filter?: {
    jobId?: string; extensionName?: string; trigger?: string; result?: string;
  }): Promise<number> {
    let sql = 'SELECT COUNT(*) as cnt FROM execution_log';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.jobId) { conditions.push('jobId = ?'); params.push(filter.jobId); }
    if (filter?.extensionName) { conditions.push('extensionName = ?'); params.push(filter.extensionName); }
    if (filter?.trigger) { conditions.push('"trigger" = ?'); params.push(filter.trigger); }
    if (filter?.result) { conditions.push('result = ?'); params.push(filter.result); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    const row = this.db.prepare(sql).get(...params) as Record<string, unknown>;
    return (row.cnt as number) ?? 0;
  },

  async pruneExecutionLogs(this: SqliteStorage, beforeDate: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM execution_log WHERE createdAt < ?').run(beforeDate);
    return result.changes;
  },

  deserializeExecutionLog(this: SqliteStorage, row: Record<string, unknown>): ExecutionLogEntry {
    return {
      id: row.id as string,
      jobId: row.jobId as string,
      jobName: row.jobName as string,
      type: row.type as ExecutionLogEntry['type'],
      extensionName: (row.extensionName as string) || undefined,
      actionId: (row.actionId as string) || undefined,
      trigger: row.trigger as ExecutionLogEntry['trigger'],
      result: row.result as ExecutionLogEntry['result'],
      errorMessage: (row.errorMessage as string) || undefined,
      durationMs: row.durationMs as number,
      memoryReads: JSON.parse(row.memoryReads as string || '[]'),
      memoryWrites: JSON.parse(row.memoryWrites as string || '[]'),
      taskId: (row.taskId as string) || undefined,
      createdAt: row.createdAt as string,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Extension Instances ──
  // ══════════════════════════════════════════════════════════

  async createExtensionInstance(this: SqliteStorage, record: ExtensionInstanceRecord): Promise<ExtensionInstanceRecord> {
    try {
      this.db.prepare(
        `INSERT INTO extension_instances (id, extensionName, config, status, createdBy, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id, record.extensionName, JSON.stringify(record.config),
        record.status, record.createdBy, record.createdAt, record.updatedAt,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) {
        throw new Error(`Extension instance "${record.id}" already exists for "${record.extensionName}"`, { cause: err });
      }
      throw err;
    }
  },

  async getExtensionInstance(this: SqliteStorage, extensionName: string, instanceId: string): Promise<ExtensionInstanceRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM extension_instances WHERE extensionName = ? AND id = ?'
    ).get(extensionName, instanceId) as Record<string, unknown> | undefined;
    return row ? this.deserializeExtensionInstance(row) : null;
  },

  async listExtensionInstances(this: SqliteStorage, extensionName: string): Promise<ExtensionInstanceRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM extension_instances WHERE extensionName = ?'
    ).all(extensionName) as Record<string, unknown>[];
    return rows.map(r => this.deserializeExtensionInstance(r));
  },

  async updateExtensionInstance(this: SqliteStorage, extensionName: string, instanceId: string, updates: Partial<ExtensionInstanceRecord>): Promise<ExtensionInstanceRecord | null> {
    const existing = await this.getExtensionInstance(extensionName, instanceId);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE extension_instances SET config = ?, status = ?, createdBy = ?, createdAt = ?, updatedAt = ?
       WHERE extensionName = ? AND id = ?`
    ).run(
      JSON.stringify(updated.config), updated.status,
      updated.createdBy, updated.createdAt, updated.updatedAt,
      extensionName, instanceId,
    );
    return updated;
  },

  async deleteExtensionInstance(this: SqliteStorage, extensionName: string, instanceId: string): Promise<boolean> {
    const result = this.db.prepare(
      'DELETE FROM extension_instances WHERE extensionName = ? AND id = ?'
    ).run(extensionName, instanceId);
    return result.changes > 0;
  },

  async deleteExtensionInstancesByOwner(this: SqliteStorage, ownerIdentity: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM extension_instances WHERE createdBy = ?').run(ownerIdentity);
    return result.changes;
  },

  deserializeExtensionInstance(this: SqliteStorage, row: Record<string, unknown>): ExtensionInstanceRecord {
    const record: ExtensionInstanceRecord = {
      id: row.id as string,
      extensionName: row.extensionName as string,
      config: JSON.parse(row.config as string),
      status: row.status as ExtensionInstanceRecord['status'],
      createdBy: row.createdBy as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.createdByAgent) record.createdByAgent = row.createdByAgent as string;
    if (row.translations) record.translations = JSON.parse(row.translations as string);
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Federation Peers (persisted active peer connections) ──
  // ══════════════════════════════════════════════════════════

  async saveFederationPeer(this: SqliteStorage, peer: FederationPeerRecord): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO federation_peers (nodeId, url, publicKey, status, addedAt, lastSeen, shareCatalogue, replicateMemory, allowRouting, peerMode, allowFederatedAuth, federationAuthScopes, tier, availability, expiresAt, heartbeatOk, heartbeatTotal, availabilityWindow, availabilityPct, softwareVersion, nodeCardHash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(peer.nodeId, peer.url, peer.publicKey, peer.status, peer.addedAt, peer.lastSeen,
      peer.shareCatalogue ? 1 : 0, peer.replicateMemory ? 1 : 0, peer.allowRouting ? 1 : 0,
      peer.peerMode || 'federation', peer.allowFederatedAuth ? 1 : 0,
      (peer.federationAuthScopes ?? []).join(','),
      peer.tier ?? 'member', peer.availability ?? null, peer.expiresAt ?? null,
      peer.heartbeatOk ?? 0, peer.heartbeatTotal ?? 0, peer.availabilityWindow ?? null, peer.availabilityPct ?? null,
      peer.softwareVersion ?? null, peer.nodeCardHash ?? null);
  },

  async listFederationPeers(this: SqliteStorage): Promise<FederationPeerRecord[]> {
    const rows = this.db.prepare('SELECT * FROM federation_peers').all() as Record<string, unknown>[];
    return rows.map(r => ({
      nodeId: r.nodeId as string,
      url: r.url as string,
      publicKey: r.publicKey as string,
      status: r.status as string,
      addedAt: r.addedAt as string,
      lastSeen: r.lastSeen as string,
      shareCatalogue: r.shareCatalogue === 1,
      replicateMemory: r.replicateMemory === 1,
      allowRouting: r.allowRouting === 1,
      peerMode: (r.peerMode as FederationPeerRecord['peerMode']) || 'federation',
      allowFederatedAuth: r.allowFederatedAuth === 1,
      federationAuthScopes: ((r.federationAuthScopes as string) || '').split(',').filter(Boolean),
      tier: (r.tier as FederationPeerRecord['tier']) || 'member',
      availability: (r.availability as FederationPeerRecord['availability']) ?? null,
      expiresAt: (r.expiresAt as string) ?? null,
      heartbeatOk: (r.heartbeatOk as number) ?? 0,
      heartbeatTotal: (r.heartbeatTotal as number) ?? 0,
      availabilityWindow: (r.availabilityWindow as string) ?? null,
      availabilityPct: r.availabilityPct == null ? null : (r.availabilityPct as number),
      softwareVersion: (r.softwareVersion as string) ?? null,
      nodeCardHash: (r.nodeCardHash as string) ?? null,
    }));
  },

  async deleteFederationPeer(this: SqliteStorage, nodeId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM federation_peers WHERE nodeId = ?').run(nodeId);
    return result.changes > 0;
  },

  // ══════════════════════════════════════════════════════════
  // ── Replication Queue (B.1) ──
  // ══════════════════════════════════════════════════════════

  async enqueueReplication(this: SqliteStorage, entry: Omit<ReplicationQueueEntry, 'id' | 'attempts' | 'lastAttemptAt' | 'status'>): Promise<string> {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO replication_queue (id, type, targetPeers, payload, createdAt, attempts, lastAttemptAt, status)
       VALUES (?, ?, ?, ?, ?, 0, NULL, 'pending')`
    ).run(
      id,
      entry.type,
      JSON.stringify(entry.targetPeers),
      JSON.stringify(entry.payload),
      entry.createdAt,
    );
    return id;
  },

  async dequeueReplication(this: SqliteStorage, peerId: string, limit: number): Promise<ReplicationQueueEntry[]> {
    // Fetch all pending entries ordered by creation time
    const rows = this.db.prepare(
      `SELECT * FROM replication_queue WHERE status = 'pending' ORDER BY createdAt ASC`
    ).all() as Record<string, unknown>[];
    const results: ReplicationQueueEntry[] = [];
    for (const row of rows) {
      const peers = JSON.parse(row.targetPeers as string) as string[];
      if (peers.includes(peerId)) {
        results.push(this.deserializeReplicationEntry(row));
        if (results.length >= limit) break;
      }
    }
    return results;
  },

  async markReplicationSent(this: SqliteStorage, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE replication_queue SET status = 'sent' WHERE id IN (${placeholders})`
    ).run(...ids);
  },

  async markReplicationFailed(this: SqliteStorage, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `UPDATE replication_queue SET status = 'failed', attempts = attempts + 1, lastAttemptAt = ? WHERE id = ?`
    );
    for (const id of ids) {
      stmt.run(now, id);
    }
  },

  async pruneReplicationQueue(this: SqliteStorage, maxAge: Date): Promise<number> {
    const maxAgeIso = maxAge.toISOString();
    const result = this.db.prepare(
      `DELETE FROM replication_queue WHERE createdAt < ? OR status = 'sent'`
    ).run(maxAgeIso);
    return result.changes;
  },

  async replicationQueueSize(this: SqliteStorage): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM replication_queue').get() as { cnt: number };
    return row.cnt;
  },

  deserializeReplicationEntry(this: SqliteStorage, row: Record<string, unknown>): ReplicationQueueEntry {
    return {
      id: row.id as string,
      type: row.type as ReplicationQueueEntry['type'],
      targetPeers: JSON.parse(row.targetPeers as string),
      payload: row.payload ? JSON.parse(row.payload as string) : null,
      createdAt: row.createdAt as string,
      attempts: row.attempts as number,
      lastAttemptAt: (row.lastAttemptAt as string) || null,
      status: row.status as ReplicationQueueEntry['status'],
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Device Authorization (RFC 8628) ──
  // ══════════════════════════════════════════════════════════

  async createDeviceAuth(this: SqliteStorage, req: DeviceAuthorizationRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO device_auth (deviceCode, userCode, ownerName, agentName, displayName, description, status, scopes, createdAt, expiresAt, lastPolledAt, pollInterval, approvedBy, agentCredentials, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.deviceCode, req.userCode, req.ownerName, req.agentName,
      req.displayName ?? null, req.description ?? null,
      req.status, req.scopes ? JSON.stringify(req.scopes) : null,
      req.createdAt, req.expiresAt, req.lastPolledAt ?? null,
      req.pollInterval, req.approvedBy ?? null,
      req.agentCredentials ? JSON.stringify(req.agentCredentials) : null,
      req.mode ?? 'interactive',
    );
  },

  async getDeviceAuthByDeviceCode(this: SqliteStorage, deviceCode: string): Promise<DeviceAuthorizationRecord | null> {
    const row = this.db.prepare('SELECT * FROM device_auth WHERE deviceCode = ?').get(deviceCode) as Record<string, unknown> | undefined;
    return row ? this.deserializeDeviceAuth(row) : null;
  },

  async getDeviceAuthByUserCode(this: SqliteStorage, userCode: string): Promise<DeviceAuthorizationRecord | null> {
    const row = this.db.prepare('SELECT * FROM device_auth WHERE userCode = ?').get(userCode) as Record<string, unknown> | undefined;
    return row ? this.deserializeDeviceAuth(row) : null;
  },

  async updateDeviceAuth(this: SqliteStorage, deviceCode: string, updates: Partial<DeviceAuthorizationRecord>): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.scopes !== undefined) { fields.push('scopes = ?'); values.push(JSON.stringify(updates.scopes)); }
    if (updates.lastPolledAt !== undefined) { fields.push('lastPolledAt = ?'); values.push(updates.lastPolledAt); }
    if (updates.pollInterval !== undefined) { fields.push('pollInterval = ?'); values.push(updates.pollInterval); }
    if (updates.approvedBy !== undefined) { fields.push('approvedBy = ?'); values.push(updates.approvedBy); }
    if ('agentCredentials' in updates) { fields.push('agentCredentials = ?'); values.push(updates.agentCredentials ? JSON.stringify(updates.agentCredentials) : null); }
    if (fields.length === 0) return;
    values.push(deviceCode);
    this.db.prepare(`UPDATE device_auth SET ${fields.join(', ')} WHERE deviceCode = ?`).run(...values);
  },

  async countPendingDeviceAuthByOwner(this: SqliteStorage, ownerName: string): Promise<number> {
    const row = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM device_auth WHERE ownerName = ? AND status = 'pending' AND expiresAt > ?`
    ).get(ownerName, new Date().toISOString()) as { cnt: number };
    return row.cnt;
  },

  async listPendingDeviceAuthByOwner(this: SqliteStorage, ownerName: string): Promise<DeviceAuthorizationRecord[]> {
    const rows = this.db.prepare(
      `SELECT * FROM device_auth WHERE ownerName = ? AND status = 'pending' AND expiresAt > ? ORDER BY createdAt DESC`
    ).all(ownerName, new Date().toISOString()) as Record<string, unknown>[];
    return rows.map(row => this.deserializeDeviceAuth(row));
  },

  async cleanupExpiredDeviceAuth(this: SqliteStorage): Promise<number> {
    const result = this.db.prepare(
      `DELETE FROM device_auth WHERE status = 'pending' AND expiresAt <= ?`
    ).run(new Date().toISOString());
    return result.changes;
  },

  async deleteDeviceAuthByOwner(this: SqliteStorage, ownerName: string): Promise<number> {
    const result = this.db.prepare(`DELETE FROM device_auth WHERE ownerName = ?`).run(ownerName);
    return result.changes;
  },

  // ── Ecosystem Applications (GEAI) + hello-integration handshake ──
  async createEcosystemApp(this: SqliteStorage, app: EcosystemAppRecord): Promise<EcosystemAppRecord> {
    return ecosystemAppRepo.createEcosystemApp(this.db, app);
  },
  async getEcosystemApp(this: SqliteStorage, geai: string): Promise<EcosystemAppRecord | null> {
    return ecosystemAppRepo.getEcosystemApp(this.db, geai);
  },
  async getEcosystemAppByOwnerAndApp(this: SqliteStorage, owner: string, app: string): Promise<EcosystemAppRecord | null> {
    return ecosystemAppRepo.getEcosystemAppByOwnerAndApp(this.db, owner, app);
  },
  async getEcosystemAppsByOwner(this: SqliteStorage, owner: string): Promise<EcosystemAppRecord[]> {
    return ecosystemAppRepo.getEcosystemAppsByOwner(this.db, owner);
  },
  async updateEcosystemApp(this: SqliteStorage, geai: string, updates: Partial<EcosystemAppRecord>): Promise<EcosystemAppRecord | null> {
    return ecosystemAppRepo.updateEcosystemApp(this.db, geai, updates);
  },
  async deleteEcosystemApp(this: SqliteStorage, geai: string): Promise<boolean> {
    return ecosystemAppRepo.deleteEcosystemApp(this.db, geai);
  },
  async createEcoAuth(this: SqliteStorage, req: EcoAuthorizationRecord): Promise<void> {
    return ecosystemAppRepo.createEcoAuth(this.db, req);
  },
  async getEcoAuthByDeviceCode(this: SqliteStorage, deviceCode: string): Promise<EcoAuthorizationRecord | null> {
    return ecosystemAppRepo.getEcoAuthByDeviceCode(this.db, deviceCode);
  },
  async getEcoAuthByUserCode(this: SqliteStorage, userCode: string): Promise<EcoAuthorizationRecord | null> {
    return ecosystemAppRepo.getEcoAuthByUserCode(this.db, userCode);
  },
  async updateEcoAuth(this: SqliteStorage, deviceCode: string, updates: Partial<EcoAuthorizationRecord>): Promise<void> {
    return ecosystemAppRepo.updateEcoAuth(this.db, deviceCode, updates);
  },
  async countPendingEcoAuthByOwner(this: SqliteStorage, ownerName: string): Promise<number> {
    return ecosystemAppRepo.countPendingEcoAuthByOwner(this.db, ownerName);
  },
  async listPendingEcoAuthByOwner(this: SqliteStorage, ownerName: string): Promise<EcoAuthorizationRecord[]> {
    return ecosystemAppRepo.listPendingEcoAuthByOwner(this.db, ownerName);
  },
  async cleanupExpiredEcoAuth(this: SqliteStorage): Promise<number> {
    return ecosystemAppRepo.cleanupExpiredEcoAuth(this.db);
  },
  async getAutomationRecipe(this: SqliteStorage, owner: string, app: string): Promise<EcoAutomationRecipe | null> {
    return ecosystemAppRepo.getAutomationRecipe(this.db, owner, app);
  },
  async upsertAutomationRecipe(this: SqliteStorage, recipe: EcoAutomationRecipe): Promise<EcoAutomationRecipe> {
    return ecosystemAppRepo.upsertAutomationRecipe(this.db, recipe);
  },
  async deleteAutomationRecipe(this: SqliteStorage, owner: string, app: string): Promise<boolean> {
    return ecosystemAppRepo.deleteAutomationRecipe(this.db, owner, app);
  },
  async listAutomationRecipesByOwner(this: SqliteStorage, owner: string): Promise<EcoAutomationRecipe[]> {
    return ecosystemAppRepo.listAutomationRecipesByOwner(this.db, owner);
  },

  deserializeDeviceAuth(this: SqliteStorage, row: Record<string, unknown>): DeviceAuthorizationRecord {
    return {
      deviceCode: row.deviceCode as string,
      userCode: row.userCode as string,
      ownerName: row.ownerName as string,
      agentName: row.agentName as string,
      displayName: row.displayName as string | undefined,
      description: row.description as string | undefined,
      status: row.status as DeviceAuthorizationRecord['status'],
      scopes: row.scopes ? JSON.parse(row.scopes as string) : undefined,
      createdAt: row.createdAt as string,
      expiresAt: row.expiresAt as string,
      lastPolledAt: row.lastPolledAt as string | undefined,
      pollInterval: row.pollInterval as number,
      approvedBy: row.approvedBy as string | undefined,
      agentCredentials: row.agentCredentials ? JSON.parse(row.agentCredentials as string) : undefined,
      mode: row.mode ? (row.mode as DeviceAuthorizationRecord['mode']) : undefined,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── OAuth 2.1 Persistent State ──
  // ══════════════════════════════════════════════════════════

  // ── Clients ──

  async createOAuthClient(this: SqliteStorage, client: OAuthClientRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO oauth_clients (clientId, clientSecret, clientName, redirectUris, createdAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      client.clientId, client.clientSecret, client.clientName,
      JSON.stringify(client.redirectUris), client.createdAt,
    );
  },

  async getOAuthClient(this: SqliteStorage, clientId: string): Promise<OAuthClientRecord | null> {
    const row = this.db.prepare('SELECT * FROM oauth_clients WHERE clientId = ?').get(clientId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      clientId: row.clientId as string,
      clientSecret: row.clientSecret as string,
      clientName: row.clientName as string,
      redirectUris: JSON.parse(row.redirectUris as string),
      createdAt: row.createdAt as string,
    };
  },

  async deleteOAuthClient(this: SqliteStorage, clientId: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE clientId = ?').run(clientId);
      this.db.prepare('DELETE FROM oauth_approvals WHERE clientId = ?').run(clientId);
      const result = this.db.prepare('DELETE FROM oauth_clients WHERE clientId = ?').run(clientId);
      return result.changes > 0;
    });
    return txn();
  },

  async listOAuthClients(this: SqliteStorage): Promise<OAuthClientRecord[]> {
    const rows = this.db.prepare('SELECT * FROM oauth_clients ORDER BY createdAt DESC').all() as Record<string, unknown>[];
    return rows.map(row => ({
      clientId: row.clientId as string,
      clientSecret: row.clientSecret as string,
      clientName: row.clientName as string,
      redirectUris: JSON.parse(row.redirectUris as string),
      createdAt: row.createdAt as string,
    }));
  },

  // ── Refresh Tokens ──

  async createOAuthRefreshToken(this: SqliteStorage, token: OAuthRefreshTokenRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO oauth_refresh_tokens (tokenHash, clientId, gaii, owner, roles, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      token.tokenHash, token.clientId, token.gaii, token.owner,
      JSON.stringify(token.roles), token.createdAt,
    );
  },

  async getOAuthRefreshToken(this: SqliteStorage, tokenHash: string): Promise<OAuthRefreshTokenRecord | null> {
    const row = this.db.prepare('SELECT * FROM oauth_refresh_tokens WHERE tokenHash = ?').get(tokenHash) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      tokenHash: row.tokenHash as string,
      clientId: row.clientId as string,
      gaii: row.gaii as string,
      owner: row.owner as string,
      roles: JSON.parse(row.roles as string),
      createdAt: row.createdAt as string,
    };
  },

  async deleteOAuthRefreshToken(this: SqliteStorage, tokenHash: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE tokenHash = ?').run(tokenHash);
    return result.changes > 0;
  },

  async deleteOAuthRefreshTokensByClient(this: SqliteStorage, clientId: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE clientId = ?').run(clientId);
    return result.changes;
  },

  async deleteOAuthRefreshTokensByGaii(this: SqliteStorage, gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE gaii = ?').run(gaii);
    return result.changes;
  },

  // ── Approvals ──

  async createOAuthApproval(this: SqliteStorage, approval: OAuthApprovalRecord): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO oauth_approvals (clientId, gaii, owner, scope, approvedAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      approval.clientId, approval.gaii, approval.owner,
      approval.scope, approval.approvedAt,
    );
  },

  async getOAuthApproval(this: SqliteStorage, clientId: string, gaii: string): Promise<OAuthApprovalRecord | null> {
    const row = this.db.prepare('SELECT * FROM oauth_approvals WHERE clientId = ? AND gaii = ?').get(clientId, gaii) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      clientId: row.clientId as string,
      gaii: row.gaii as string,
      owner: row.owner as string,
      scope: row.scope as string,
      approvedAt: row.approvedAt as string,
    };
  },

  async deleteOAuthApproval(this: SqliteStorage, clientId: string, gaii: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM oauth_approvals WHERE clientId = ? AND gaii = ?').run(clientId, gaii);
    return result.changes > 0;
  },

  async deleteOAuthApprovalsByClient(this: SqliteStorage, clientId: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM oauth_approvals WHERE clientId = ?').run(clientId);
    return result.changes;
  },

  async deleteOAuthApprovalsByGaii(this: SqliteStorage, gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM oauth_approvals WHERE gaii = ?').run(gaii);
    return result.changes;
  },

  async listOAuthApprovalsByOwner(this: SqliteStorage, owner: string): Promise<OAuthApprovalRecord[]> {
    const rows = this.db.prepare('SELECT * FROM oauth_approvals WHERE owner = ? ORDER BY approvedAt DESC').all(owner) as Record<string, unknown>[];
    return rows.map(row => ({
      clientId: row.clientId as string,
      gaii: row.gaii as string,
      owner: row.owner as string,
      scope: row.scope as string,
      approvedAt: row.approvedAt as string,
    }));
  },

};
