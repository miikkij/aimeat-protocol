/**
 * @file agent-task.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for agent task CRUD, events, and stall detection
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import type { AgentTaskRecord, AgentTaskEventRecord } from '../interface.js';

export interface AgentTaskRepository {
  createAgentTask(record: AgentTaskRecord): Promise<AgentTaskRecord>;
  getAgentTask(id: string): Promise<AgentTaskRecord | null>;
  /**
   * The OPEN task (LIVE_TASK_STATUSES) carrying this commission fingerprint, or null. Backs the
   * one-live-commission guard on POST /v1/agents/:name/tasks: a reload or a second tab re-orders the
   * same job, and the owner gets the run they already have instead of paying for a second one.
   */
  findLiveTaskByDedupeKey(agentGaii: string, dedupeKey: string): Promise<AgentTaskRecord | null>;
  listAgentTasks(agentGaii: string, opts?: {
    status?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ tasks: AgentTaskRecord[]; total: number }>;
  listAgentTasksByOwner(ownerGaii: string, opts?: {
    status?: string;
    agentGaii?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ tasks: AgentTaskRecord[]; total: number }>;
  updateAgentTask(id: string, updates: Partial<AgentTaskRecord>): Promise<AgentTaskRecord | null>;
  deleteAgentTask(id: string): Promise<boolean>;

  appendTaskEvent(event: AgentTaskEventRecord): Promise<AgentTaskEventRecord>;
  listTaskEvents(taskId: string, opts?: {
    page?: number;
    perPage?: number;
  }): Promise<{ events: AgentTaskEventRecord[]; total: number }>;

  countTasksByAgent(agentGaii: string): Promise<{ queued: number; active: number; done: number; failed: number }>;
  /**
   * Aggregate task counts for ALL of an owner's agents in one grouped query (for the bulk
   * `GET /v1/agents?include=stats` overview — avoids N per-agent round trips). Keyed by agentGaii.
   * `doneToday` = done tasks whose completedAt is on the current UTC day. `lastTaskUpdateAt` =
   * MAX(updatedAt) across the agent's tasks; `lastFailedAt` = MAX(updatedAt) of failed tasks.
   */
  countTasksByOwner(ownerGaii: string): Promise<Record<string, {
    queued: number; active: number; done: number; failed: number;
    doneToday: number; lastTaskUpdateAt: string | null; lastFailedAt: string | null;
  }>>;
  findStalledTasks(thresholdMinutes: number): Promise<AgentTaskRecord[]>;
}
