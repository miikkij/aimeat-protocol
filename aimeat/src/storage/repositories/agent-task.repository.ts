/**
 * @file agent-task.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for agent task CRUD, events, and stall detection
 * @version-history
 *   2026-10-31 — countTasksByOwner rows are OwnerTaskCounts and carry done24h and done30d, done tasks
 *     of the last 24 hours and the last 30 days, rolling (the overview's activity counts).
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import type { AgentTaskRecord, AgentTaskEventRecord } from '../interface.js';

/**
 * One agent's row in countTasksByOwner. `doneToday` = done tasks whose completedAt is on the current
 * UTC day; `doneWeek` = done in the last 7 days; `done24h` = done in the last 24 hours and `done30d` =
 * done in the last 30 days, both rolling from now rather than from a calendar boundary.
 * `lastTaskUpdateAt` = MAX(updatedAt) across the agent's tasks; `lastFailedAt` = MAX(updatedAt) of
 * failed tasks.
 */
export interface OwnerTaskCounts {
  queued: number; active: number; done: number; failed: number;
  doneToday: number; doneWeek: number; done24h: number; done30d: number;
  lastTaskUpdateAt: string | null; lastFailedAt: string | null;
}

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
   * The fields are described on OwnerTaskCounts; `doneWeek` is the Fleet page's "what your agents
   * did this week", `done24h` and `done30d` the overview's rolling activity counts.
   */
  countTasksByOwner(ownerGaii: string): Promise<Record<string, OwnerTaskCounts>>;
  findStalledTasks(thresholdMinutes: number): Promise<AgentTaskRecord[]>;
}
