/**
 * @file src/storage/providers/sqlite/methods/agent-misc.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/agent-misc.ts (agentDirectiveMethods,
 *   agentActivityMethods, agentWebhookMethods, sharingGroupMethods), so a fix in one provider finds its twin
 *   by file name. Bodies moved verbatim from the files named in the version history; bound to SqliteStorage
 *   via the prototype merge in ../index.ts.
 * @structure agentDirectiveMethods, agentActivityMethods, agentWebhookMethods, sharingGroupMethods
 * @usage Object.assign(SqliteStorage.prototype, agentDirectiveMethods, agentActivityMethods, agentWebhookMethods, sharingGroupMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 20 methods (getAgentDirectives, upsertAgentDirectives, deleteAgentDirectives, …)
 *     moved here from capability-agents.ts; appendDeliveryLog, listDeliveryLog, pruneDeliveryLog moved here
 *     from messaging.ts so the file mirrors postgres-kysely/methods/agent-misc.ts (secaudit 2026-10, M8).
 */
import type {
  AgentDirectivesRecord, OwnerAgentDefaults, SharingGroupRecord, GroupShareRecord, AgentActivityRecord,
  WebhookDeliveryLog,
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import * as sharingGroupRepo from '../repos/sharing-group.js';
import * as agentDirectivesRepo from '../repos/agent-directives.js';
import * as agentActivityRepo from '../repos/agent-activity.js';

export const agentDirectiveMethods = {

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
};

export const agentActivityMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Agent Activity ──
  // ══════════════════════════════════════════════════════════

  async recordActivity(this: SqliteStorage, record: AgentActivityRecord): Promise<void> {
    return agentActivityRepo.recordActivity(this.db, record);
  },

  async getActivityHistory(this: SqliteStorage, agentGaii: string, opts?: { days?: number; granularity?: 'daily' | 'hourly' }): Promise<AgentActivityRecord[]> {
    return agentActivityRepo.getActivityHistory(this.db, agentGaii, opts);
  },
};

export const agentWebhookMethods = {

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

export const sharingGroupMethods = {

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
};
