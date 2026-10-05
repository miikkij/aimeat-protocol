/**
 * @file src/storage/providers/sqlite/methods/agent-tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/agent-tasks.ts (agentTaskMethods), so
 *   a fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure agentTaskMethods
 * @usage Object.assign(SqliteStorage.prototype, agentTaskMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 12 methods (createAgentTask, getAgentTask, findLiveTaskByDedupeKey, …) moved here
 *     from capability-agents.ts so the file mirrors postgres-kysely/methods/agent-tasks.ts (secaudit 2026-10,
 *     M8).
 */
import type { AgentTaskRecord, AgentTaskEventRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import * as agentTaskRepo from '../repos/agent-task.js';

export const agentTaskMethods = {

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

  async countTasksByOwner(this: SqliteStorage, ownerGaii: string): Promise<Record<string, { queued: number; active: number; done: number; failed: number; doneToday: number; doneWeek: number; lastTaskUpdateAt: string | null; lastFailedAt: string | null }>> {
    return agentTaskRepo.countTasksByOwner(this.db, ownerGaii);
  },

  async findStalledTasks(this: SqliteStorage, thresholdMinutes: number): Promise<AgentTaskRecord[]> {
    return agentTaskRepo.findStalledTasks(this.db, thresholdMinutes);
  },
};
