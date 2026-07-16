/**
 * @file src/storage/providers/sqlite/methods/messaging.ts
 * @description Agent-message, Direct-message, Onboarding, Telemetry, Webhook-log methods. Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge.
 * @version-history
 *   v1.1.0 — 2026-07-16 — Wire listConversationsForOwners (Phase 3 batch) through to the repo.
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 */
import type {
  AgentMessageRecord, DirectMessageRecord, ContactConsentRecord, MessageDeliveryLog, MessageDeliveryStats, TelemetryEvent,
  WebhookDeliveryLog, AgentOnboardingRecord
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import * as agentMessageRepo from '../repos/agent-message.js';
import * as directMessageRepo from '../repos/direct-message.js';

export const messagingMethods = {
  // ── Agent Messages ──
  // ══════════════════════════════════════════════════════════

  async createMessage(this: SqliteStorage, record: AgentMessageRecord): Promise<AgentMessageRecord> {
    return agentMessageRepo.createMessage(this.db, record);
  },

  async getMessage(this: SqliteStorage, id: string): Promise<AgentMessageRecord | null> {
    return agentMessageRepo.getMessage(this.db, id);
  },

  async listMessages(this: SqliteStorage, agentGaii: string, opts?: { direction?: 'inbound' | 'outbound'; threadId?: string; page?: number; perPage?: number }): Promise<{ messages: AgentMessageRecord[]; total: number }> {
    return agentMessageRepo.listMessages(this.db, agentGaii, opts);
  },

  async listPendingMessages(this: SqliteStorage, agentGaii: string): Promise<AgentMessageRecord[]> {
    return agentMessageRepo.listPendingMessages(this.db, agentGaii);
  },

  async updateMessageStatus(this: SqliteStorage, id: string, status: string, processedAt?: string): Promise<AgentMessageRecord | null> {
    return agentMessageRepo.updateMessageStatus(this.db, id, status, processedAt);
  },

  async countMessagesByAgents(this: SqliteStorage, agentGaiis: string[]): Promise<Record<string, { total: number; lastMessageAt: string | null }>> {
    return agentMessageRepo.countMessagesByAgents(this.db, agentGaiis);
  },

  async listThreads(this: SqliteStorage, agentGaii: string): Promise<{ threadId: string; lastMessage: string; messageCount: number; updatedAt: string }[]> {
    return agentMessageRepo.listThreads(this.db, agentGaii);
  },

  // ══════════════════════════════════════════════════════════
  // ── Direct Messages (human↔human) ──
  // ══════════════════════════════════════════════════════════

  async createDirectMessage(this: SqliteStorage, record: DirectMessageRecord): Promise<DirectMessageRecord> {
    return directMessageRepo.createDirectMessage(this.db, record);
  },

  async getDirectMessage(this: SqliteStorage, id: string, ownerGhii: string): Promise<DirectMessageRecord | null> {
    return directMessageRepo.getDirectMessage(this.db, id, ownerGhii);
  },

  async listInbox(this: SqliteStorage, ownerGhii: string, opts?: { unreadOnly?: boolean; page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number; unread: number }> {
    return directMessageRepo.listInbox(this.db, ownerGhii, opts);
  },

  async listConversation(this: SqliteStorage, ownerGhii: string, conversationId: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
    return directMessageRepo.listConversation(this.db, ownerGhii, conversationId, opts);
  },

  async listDmsAddressedTo(this: SqliteStorage, recipientGhii: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
    return directMessageRepo.listDmsAddressedTo(this.db, recipientGhii, opts);
  },

  async listAgentDmThread(this: SqliteStorage, agentGaii: string, conversationId: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
    return directMessageRepo.listAgentDmThread(this.db, agentGaii, conversationId, opts);
  },

  async listDmsByBroadcast(this: SqliteStorage, broadcastId: string, ownerGhii: string): Promise<DirectMessageRecord[]> {
    return directMessageRepo.listDmsByBroadcast(this.db, broadcastId, ownerGhii);
  },

  async listConversations(this: SqliteStorage, ownerGhii: string): Promise<Array<{ conversationId: string; peerGhii: string; subject?: string; lastMessage: string; lastDirection: 'inbound' | 'outbound'; messageCount: number; unread: number; updatedAt: string }>> {
    return directMessageRepo.listConversations(this.db, ownerGhii);
  },

  async listConversationsForOwners(this: SqliteStorage, ownerGhiis: string[]): Promise<Record<string, Array<{ conversationId: string; peerGhii: string; subject?: string; lastMessage: string; lastDirection: 'inbound' | 'outbound'; messageCount: number; unread: number; updatedAt: string }>>> {
    return directMessageRepo.listConversationsForOwners(this.db, ownerGhiis);
  },

  async markMessageRead(this: SqliteStorage, id: string, ownerGhii: string): Promise<DirectMessageRecord | null> {
    return directMessageRepo.markMessageRead(this.db, id, ownerGhii);
  },

  async markConversationRead(this: SqliteStorage, ownerGhii: string, conversationId: string): Promise<number> {
    return directMessageRepo.markConversationRead(this.db, ownerGhii, conversationId);
  },

  async updateMessageDeliveryStatus(this: SqliteStorage, id: string, status: DirectMessageRecord['status'], extra?: { deliveredAt?: string; error?: string }): Promise<DirectMessageRecord | null> {
    return directMessageRepo.updateMessageDeliveryStatus(this.db, id, status, extra);
  },

  async setMessageReadReceipt(this: SqliteStorage, id: string, readAt: string): Promise<DirectMessageRecord | null> {
    return directMessageRepo.setMessageReadReceipt(this.db, id, readAt);
  },

  async listOutboundForRetry(this: SqliteStorage, limit?: number): Promise<DirectMessageRecord[]> {
    return directMessageRepo.listOutboundForRetry(this.db, limit);
  },

  async listInboundWithAttachments(this: SqliteStorage, limit?: number): Promise<DirectMessageRecord[]> {
    return directMessageRepo.listInboundWithAttachments(this.db, limit);
  },

  async updateMessageAttachments(this: SqliteStorage, id: string, ownerGhii: string, attachments: DirectMessageRecord['attachments']): Promise<DirectMessageRecord | null> {
    return directMessageRepo.updateMessageAttachments(this.db, id, ownerGhii, attachments);
  },

  async deleteDirectMessage(this: SqliteStorage, id: string, ownerGhii: string): Promise<boolean> {
    return directMessageRepo.deleteDirectMessage(this.db, id, ownerGhii);
  },

  async appendMessageDeliveryLog(this: SqliteStorage, log: MessageDeliveryLog): Promise<void> {
    directMessageRepo.appendMessageDeliveryLog(this.db, log);
  },

  async listMessageDeliveryLogs(this: SqliteStorage, limit?: number): Promise<MessageDeliveryLog[]> {
    return directMessageRepo.listMessageDeliveryLogs(this.db, limit);
  },

  async getMessageDeliveryStats(this: SqliteStorage): Promise<MessageDeliveryStats> {
    return directMessageRepo.getMessageDeliveryStats(this.db);
  },

  async pruneMessageDeliveryLogs(this: SqliteStorage, keep?: number): Promise<number> {
    return directMessageRepo.pruneMessageDeliveryLogs(this.db, keep);
  },

  async getContact(this: SqliteStorage, ownerGhii: string, contactId: string): Promise<ContactConsentRecord | null> {
    return directMessageRepo.getContact(this.db, ownerGhii, contactId);
  },

  async setContactState(this: SqliteStorage, ownerGhii: string, contactId: string, state: ContactConsentRecord['state'], firstMessageId?: string): Promise<ContactConsentRecord> {
    return directMessageRepo.setContactState(this.db, ownerGhii, contactId, state, firstMessageId);
  },

  async listContacts(this: SqliteStorage, ownerGhii: string, opts?: { state?: ContactConsentRecord['state'] }): Promise<ContactConsentRecord[]> {
    return directMessageRepo.listContacts(this.db, ownerGhii, opts);
  },

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
      `INSERT INTO agent_onboarding
       (agentGaii, status, startedAt, completedAt, steps, readinessScore, readinessLevel,
        detectedPlatform, installedRuntime, onboardingBaseline, operationalHealth,
        healthComponents, healthRecalculatedAt, readinessOverride)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

  async listOnboardingByOwner(this: SqliteStorage, owner: string): Promise<AgentOnboardingRecord[]> {
    const rows = this.db.prepare(
      `SELECT * FROM agent_onboarding WHERE agentGaii LIKE ? ORDER BY startedAt DESC`
    ).all(`%#${owner}@%`) as Record<string, unknown>[];
    return rows.map(row => this.deserializeOnboarding(row));
  },

  async listOnboardingByStatus(this: SqliteStorage, status: string): Promise<AgentOnboardingRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM agent_onboarding WHERE status = ? ORDER BY startedAt DESC'
    ).all(status) as Record<string, unknown>[];
    return rows.map(row => this.deserializeOnboarding(row));
  },

  // ══════════════════════════════════════════════════════════
  // ── Telemetry Events ──
  // ══════════════════════════════════════════════════════════

  async appendTelemetry(this: SqliteStorage, event: TelemetryEvent): Promise<void> {
    this.db.prepare(
      `INSERT INTO telemetry_events (id, agentGaii, type, data, sessionId, taskId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.id,
      event.agentGaii,
      event.type,
      JSON.stringify(event.data),
      event.sessionId ?? null,
      event.taskId ?? null,
      event.createdAt,
    );
  },

  async listTelemetry(this: SqliteStorage, agentGaii: string, opts: { since?: string; type?: string; limit?: number }): Promise<TelemetryEvent[]> {
    let whereSql = 'WHERE agentGaii = ?';
    const params: unknown[] = [agentGaii];

    if (opts.since) {
      whereSql += ' AND createdAt > ?';
      params.push(opts.since);
    }
    if (opts.type) {
      whereSql += ' AND type = ?';
      params.push(opts.type);
    }

    const limit = opts.limit ?? 50;

    const rows = this.db.prepare(
      `SELECT * FROM telemetry_events ${whereSql} ORDER BY createdAt DESC LIMIT ?`
    ).all(...params, limit) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      agentGaii: row.agentGaii as string,
      type: row.type as TelemetryEvent['type'],
      data: JSON.parse(row.data as string),
      sessionId: row.sessionId as string | undefined,
      taskId: row.taskId as string | undefined,
      createdAt: row.createdAt as string,
    }));
  },

  // ══════════════════════════════════════════════════════════
  // ── Webhook Delivery Log ──
  // ══════════════════════════════════════════════════════════

  async appendDeliveryLog(this: SqliteStorage, log: WebhookDeliveryLog): Promise<void> {
    this.db.prepare(
      `INSERT INTO webhook_delivery_log
       (id, agentGaii, event, payload, status, httpStatus, errorMessage, attemptCount, latencyMs, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      log.id,
      log.agentGaii,
      log.event,
      JSON.stringify(log.payload),
      log.status,
      log.httpStatus ?? null,
      log.errorMessage ?? null,
      log.attemptCount,
      log.latencyMs,
      log.createdAt,
    );
  },

  async listDeliveryLog(this: SqliteStorage, agentGaii: string, limit?: number): Promise<WebhookDeliveryLog[]> {
    const rows = this.db.prepare(
      `SELECT * FROM webhook_delivery_log WHERE agentGaii = ? ORDER BY createdAt DESC LIMIT ?`
    ).all(agentGaii, limit ?? 50) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      agentGaii: row.agentGaii as string,
      event: row.event as string,
      payload: JSON.parse(row.payload as string),
      status: row.status as WebhookDeliveryLog['status'],
      httpStatus: row.httpStatus as number | undefined,
      errorMessage: row.errorMessage as string | undefined,
      attemptCount: row.attemptCount as number,
      latencyMs: row.latencyMs as number,
      createdAt: row.createdAt as string,
    }));
  },

  async pruneDeliveryLog(this: SqliteStorage, agentGaii: string, keepCount: number): Promise<number> {
    const result = this.db.prepare(
      `DELETE FROM webhook_delivery_log
       WHERE agentGaii = ? AND id NOT IN (
         SELECT id FROM webhook_delivery_log WHERE agentGaii = ? ORDER BY createdAt DESC LIMIT ?
       )`
    ).run(agentGaii, agentGaii, keepCount);
    return result.changes;
  },
};
